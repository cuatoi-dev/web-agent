import type { DataQuery, QueryResult, FieldSchema, FieldType, Dimension, Measure, Aggregation } from "@cuatoi/web-agent-core";
import type { EsSchema, EsSearchPlan } from "./types.js";
import { ES_COMPOSITE_PAGE_SIZE, ES_MAX_COMPOSITE_PAGES } from "./types.js";

function truncateLeaves(val: unknown, depth = 0): unknown {
  if (depth > 6) return "…";
  if (val === null || val === undefined) return val;
  if (typeof val === "string") {
    return val.length > 300 ? val.slice(0, 300) + "…" : val;
  }
  if (Array.isArray(val)) return val.map((v) => truncateLeaves(v, depth + 1));
  if (typeof val === "object") {
    const res: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      res[k] = truncateLeaves(v, depth + 1);
    }
    return res;
  }
  return val;
}

function projectFields(schema: EsSchema, select?: string[]): FieldSchema[] {
  if (!select) return schema.fields;
  return select.map((name) => schema.fields.find((f) => f.name === name)!);
}

/** Reads a possibly dotted path out of a `_source` object. */
function readSourcePath(src: Record<string, unknown>, path: string): unknown {
  let cur: unknown = src;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/**
 * An Elasticsearch field alias is not present in `_source` (8.15.3, probed
 * 2026-08-20 — `_source: ["alias_customer_id"]` returned `{}`), so the hit
 * carries the alias target's path instead. Copy the target's value under the
 * alias name. When the caller selected the alias but not its target, drop the
 * target key it did not ask for — only for a top-level target, because
 * deleting a dotted key from a nested object is not the same operation and
 * ordinary nested fields must keep behaving exactly as before.
 */
function projectRow(
  src: Record<string, unknown>,
  schema: EsSchema,
  select?: string[],
): Record<string, unknown> {
  const out = { ...src };
  for (const info of Object.values(schema.byName)) {
    if (!info.sourcePath || info.sourcePath === info.name) continue;
    const value = readSourcePath(src, info.sourcePath);
    if (value === undefined) continue;
    out[info.name] = value;
    if (select && !select.includes(info.sourcePath) && !info.sourcePath.includes(".")) {
      delete out[info.sourcePath];
    }
  }
  return out;
}

function fromRowResponse(plan: EsSearchPlan, q: DataQuery, schema: EsSchema, response: unknown): QueryResult {
  const r = response as {
    hits: { total: { value: number }; hits: { _source: Record<string, unknown> }[] };
  };
  const rows = r.hits.hits.map(
    (h) => truncateLeaves(projectRow(h._source, schema, q.select)) as Record<string, unknown>,
  );
  const total = r.hits.total.value;
  const body = plan.body as { from: number; size: number };
  const offset = body.from;

  return {
    source: q.source,
    aggregated: false,
    fields: projectFields(schema, q.select),
    rows,
    // Honest delivered count (rows.length), not the requested ES page size
    // (body.size) — the same defect fixed in the aggregation branch below
    // and in core's runQuery (query-engine.ts).
    page: { limit: rows.length, offset, total, hasMore: offset + rows.length < total },
  };
}

// A copy of the private bucketDate in core's aggregate.ts (lines 163-202).
// It cannot be imported: core exports neither the function nor the module.
// es-response.test.ts pins the two together by running runQuery over the same
// rows and comparing the labels, so a change to either side fails a test.
export function bucketDateUtc(epochMillis: number, granularity: string): string {
  const d = new Date(epochMillis);
  if (isNaN(d.getTime())) return String(epochMillis);

  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const HH = String(d.getUTCHours()).padStart(2, "0");
  const MM = String(d.getUTCMinutes()).padStart(2, "0");

  switch (granularity) {
    case "minute":
      return `${yyyy}-${mm}-${dd} ${HH}:${MM}`;
    case "hour":
      return `${yyyy}-${mm}-${dd} ${HH}:00`;
    case "day":
      return `${yyyy}-${mm}-${dd}`;
    case "week": {
      const dayOfWeek = d.getUTCDay();
      const diff = d.getUTCDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
      const monday = new Date(d);
      monday.setUTCDate(diff);
      const mmm = String(monday.getUTCMonth() + 1).padStart(2, "0");
      const mdd = String(monday.getUTCDate()).padStart(2, "0");
      return `${monday.getUTCFullYear()}-${mmm}-${mdd}`;
    }
    case "month":
      return `${yyyy}-${mm}-01`;
    case "quarter": {
      const q = Math.floor(d.getUTCMonth() / 3) + 1;
      return `${yyyy}-Q${q}`;
    }
    case "year":
      return `${yyyy}`;
    default:
      return `${yyyy}-${mm}-${dd}`;
  }
}

// A copy of compareValues (core filter.ts:187-226). It cannot be imported at
// runtime: this folder imports core with `import type` only, so the compiled
// ./datasource graph carries no runtime dependency on core.
function compareValuesLocal(a: unknown, b: unknown, type: FieldType): number {
  if (a === undefined || a === null) {
    if (b === undefined || b === null) return 0;
    return -1;
  }
  if (b === undefined || b === null) return 1;

  if (type === "number") {
    const numA = Number(a);
    const numB = Number(b);
    if (numA < numB) return -1;
    if (numA > numB) return 1;
    return 0;
  }
  if (type === "date") {
    const timeA = toTimeLocal(a);
    const timeB = toTimeLocal(b);
    if (timeA < timeB) return -1;
    if (timeA > timeB) return 1;
    return 0;
  }
  if (type === "boolean") {
    const boolA = !!a;
    const boolB = !!b;
    if (boolA === boolB) return 0;
    return boolA ? 1 : -1;
  }
  // Typed as a value with its own `toString` so `no-base-to-string` reads this
  // as an intentional stringification rather than a value falling through to
  // `Object.prototype.toString` — no cast needed, `a`/`b` already structurally
  // satisfy the interface at this point. Runtime is unaffected: an object
  // still stringifies to "[object Object]" and therefore sorts equal, exactly
  // as it does today.
  const stringableA: { toString(): string } = a;
  const stringableB: { toString(): string } = b;
  const strA = String(stringableA);
  const strB = String(stringableB);
  if (strA < strB) return -1;
  if (strA > strB) return 1;
  return 0;
}

function toTimeLocal(val: unknown): number {
  if (val instanceof Date) return val.getTime();
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const parsed = Date.parse(val);
    if (!isNaN(parsed)) return parsed;
  }
  throw new Error(`Invalid date value: ${String(val)}`);
}

// A missing_bucket key arrives from Elasticsearch as JSON null; write
// undefined instead so the row matches what the in-memory engine produces
// (core aggregate.ts:96-100 copies the raw value, and an absent key reads as
// undefined). This is the difference between {"region": null} and {} in the
// JSON the agent sees.
function decodeDimensionValue(key: unknown, dim: Dimension): unknown {
  if (key === null || key === undefined) return undefined;
  if (dim.granularity) return bucketDateUtc(key as number, dim.granularity);
  return key;
}

function decodeMeasureValue(
  m: Measure,
  bucket: Record<string, unknown>,
  key: string,
  schema: EsSchema,
): number {
  if (m.op === "count") {
    return bucket.doc_count as number;
  }
  if (m.op === "first" || m.op === "last") {
    const sub = bucket[key] as { h?: { hits?: { hits?: Array<{ _source: Record<string, unknown> }> } } };
    const hit = sub?.h?.hits?.hits?.[0];
    if (!hit) return 0;
    // An alias measure's value arrives under the target path; see projectRow.
    const path = schema.byName[m.field!]?.sourcePath ?? m.field!;
    const val = readSourcePath(hit._source, path);
    return typeof val === "number" ? val : Number(val) || 0;
  }
  // sum/avg/min/max/countDistinct: sub-agg's `value`, null mapped to 0
  // (aggregate.ts:215-224 returns 0 for an empty group).
  const sub = bucket[key] as { value: number | null } | undefined;
  return sub?.value ?? 0;
}

function buildResultFields(
  agg: Aggregation,
  schema: EsSchema,
  dimensionAliases: string[],
  measureAliases: string[],
): FieldSchema[] {
  const fields: FieldSchema[] = [];
  agg.groupBy.forEach((dim, i) => {
    const fs = schema.fields.find((f) => f.name === dim.field)!;
    const outType = dim.granularity ? ("string" as const) : fs.type;
    fields.push({ name: dimensionAliases[i], type: outType, description: fs.description });
  });
  agg.measures.forEach((_m, i) => {
    fields.push({ name: measureAliases[i], type: "number", description: undefined });
  });
  return fields;
}

/**
 * `responses` is one element for a row plan, and one per composite page for an
 * aggregated plan, in request order.
 */
export function fromEsResponses(
  plan: EsSearchPlan,
  q: DataQuery,
  schema: EsSchema,
  responses: unknown[],
): QueryResult {
  if (!plan.aggregated) {
    return fromRowResponse(plan, q, schema, responses[0]);
  }

  const agg = q.aggregate!;
  const dimensionAliases = plan.dimensionAliases!;
  const measureAliases = plan.measureAliases!;
  const resultFields = buildResultFields(agg, schema, dimensionAliases, measureAliases);

  let rows: Record<string, unknown>[] = [];
  let lastAfterKey: Record<string, unknown> | undefined;

  for (const raw of responses) {
    const r = raw as {
      aggregations: { g?: { buckets: Array<Record<string, unknown>>; after_key?: Record<string, unknown> } };
    };
    // A response with `aggregations` present but no "g" key crashed this code
    // with "Cannot read properties of undefined (reading 'buckets')" — observed
    // once during review (task 004, 2026-08-19). The trigger is not identified:
    // a live ES 8.15.3 probe (empty index, and a composite agg matching zero
    // groups) always returned `aggregations: {g: {buckets: []}}` with "g"
    // present, so the commit message's "empty index" explanation does not
    // hold. Repeated re-runs across two reviews, including with a diagnostic
    // log on this branch, did not reproduce the missing-"g" shape, so the
    // exact condition remains unknown. Treat a missing "g" as zero buckets
    // regardless of cause — the guard is correct defense either way, and a
    // data-decode path should degrade rather than crash on a response shape
    // it doesn't recognize.
    const g = r.aggregations.g;
    if (!g) continue;
    const buckets = g.buckets;
    lastAfterKey = g.after_key;

    for (const bucket of buckets) {
      const key = bucket.key as Record<string, unknown>;
      const row: Record<string, unknown> = {};
      agg.groupBy.forEach((dim, i) => {
        row[dimensionAliases[i]] = decodeDimensionValue(key[`d${i}`], dim);
      });
      agg.measures.forEach((m, i) => {
        row[measureAliases[i]] = decodeMeasureValue(m, bucket, `m${i}`, schema);
      });
      rows.push(row);
    }
  }

  if (responses.length >= ES_MAX_COMPOSITE_PAGES && lastAfterKey !== undefined) {
    throw new Error(
      `Grouped query produced more than ${ES_MAX_COMPOSITE_PAGES * ES_COMPOSITE_PAGE_SIZE} groups. ` +
        `Add a filter, or group by fewer fields.`,
    );
  }

  // 1. having is already applied by bucket_selector; do not re-apply it.

  // 2. sort — a local comparator that reproduces compareValues, negated for desc.
  if (agg.sort && agg.sort.length > 0) {
    for (const item of agg.sort) {
      const fs = resultFields.find((f) => f.name === item.field);
      if (!fs) {
        throw new Error(
          `Unknown sort field "${item.field}" in aggregate sort. Available: ${resultFields.map((f) => f.name).join(", ")}`,
        );
      }
    }
    rows.sort((a, b) => {
      for (const item of agg.sort!) {
        const fs = resultFields.find((f) => f.name === item.field)!;
        const cmp = compareValuesLocal(a[item.field], b[item.field], fs.type);
        if (cmp !== 0) return item.dir === "desc" ? -cmp : cmp;
      }
      return 0;
    });
  }

  // 3. agg.limit
  const aggLimit = agg.limit !== undefined ? Math.min(Math.max(agg.limit, 1), 500) : 100;
  if (rows.length > aggLimit) rows = rows.slice(0, aggLimit);

  // 4. total = length after step 3
  const total = rows.length;

  // 5. page — slice by offset and the clamped limit
  const offset = q.page?.offset ?? 0;
  const rawLimit = q.page?.limit ?? 50;
  const limit = Math.min(Math.max(rawLimit, 1), 500);
  const paginated = rows.slice(offset, offset + limit);

  // 6. leaf truncation
  const truncated = paginated.map((row) => truncateLeaves(row) as Record<string, unknown>);

  return {
    source: q.source,
    // 7. aggregated: true
    aggregated: true,
    fields: resultFields,
    rows: truncated,
    // Honest delivered count, not the requested/clamped limit — matches
    // core's runQuery (query-engine.ts), which this path stays in parity
    // with (see es-response.test.ts "sort/limit/paging parity").
    page: { limit: paginated.length, offset, total, hasMore: offset + paginated.length < total },
  };
}
