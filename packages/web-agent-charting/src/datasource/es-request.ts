import type { DataQuery } from "@cuatoi/web-agent-core";
import type { EsSchema, EsSearchPlan } from "./types.js";
import { ES_COMPOSITE_PAGE_SIZE } from "./types.js";
import { assertNoTopLevelSortOrSelect } from "./aggregate-guard.js";
import { fieldInfo, groupByFieldInfo, measureFieldInfo, requireTermPath } from "./es-request-fields.js";
import { buildQueryClause } from "./es-request-filter.js";
import { collectHavingAliases, havingBucketsPath, havingScript } from "./es-request-having.js";

function buildRowBody(q: DataQuery, schema: EsSchema): Record<string, unknown> {
  // Page size — must match runQuery exactly (core query-engine.ts:94-96).
  const offset = q.page?.offset ?? 0;
  const rawLimit = q.page?.limit ?? 50;
  const limit = Math.min(Math.max(rawLimit, 1), 500);

  const body: Record<string, unknown> = { from: offset, size: limit, track_total_hits: true };

  const query = buildQueryClause(q, schema);
  if (query) body.query = query;

  if (q.select) {
    for (const name of q.select) fieldInfo(schema, name);
    // An Elasticsearch field alias is absent from _source (8.15.3, probed
    // 2026-08-20), so ask for the target path and rename it back in
    // es-response.ts.
    body._source = { includes: q.select.map((n) => schema.byName[n].sourcePath ?? n) };
  }

  if (q.sort && q.sort.length > 0) {
    body.sort = q.sort.map((s) => {
      const info = fieldInfo(schema, s.field);
      const t = requireTermPath(schema, s.field, info);
      const dir = s.dir ?? "asc";
      return { [t]: { order: dir, missing: dir === "asc" ? "_first" : "_last" } };
    });
  }

  return body;
}

function buildAggBody(
  q: DataQuery,
  schema: EsSchema,
): { body: Record<string, unknown>; dimensionAliases: string[]; measureAliases: string[] } {
  const agg = q.aggregate!;

  const sources: Record<string, unknown>[] = [];
  const dimensionAliases: string[] = [];
  for (let i = 0; i < agg.groupBy.length; i++) {
    const dim = agg.groupBy[i];
    const info = groupByFieldInfo(schema, dim.field);
    const t = requireTermPath(schema, dim.field, info);
    const key = `d${i}`;
    const alias = dim.as || (dim.granularity ? `${dim.field}_${dim.granularity}` : dim.field);
    dimensionAliases.push(alias);

    if (dim.granularity) {
      if (info.type !== "date") {
        throw new Error(
          `granularity "${dim.granularity}" is only valid on date fields, but "${dim.field}" is ${info.type}.`,
        );
      }
      sources.push({
        [key]: {
          date_histogram: { field: t, calendar_interval: dim.granularity, time_zone: "UTC", missing_bucket: true },
        },
      });
    } else {
      sources.push({ [key]: { terms: { field: t, missing_bucket: true } } });
    }
  }

  const measureAliases: string[] = [];
  const measureAggs: Record<string, unknown> = {};
  const dateField = schema.fields.find((f) => f.type === "date");
  const dateFieldInfo = dateField ? schema.byName[dateField.name] : undefined;
  const dateSortField = dateFieldInfo?.termPath ?? dateField?.name;

  for (let i = 0; i < agg.measures.length; i++) {
    const m = agg.measures[i];
    const key = `m${i}`;
    const alias = m.as || (m.op === "count" && !m.field ? "count" : `${m.op}_${m.field}`);
    measureAliases.push(alias);

    if (m.op === "count") {
      // No sub-aggregation; the reader uses doc_count.
      continue;
    }
    if (!m.field) {
      throw new Error(`Measure "${m.op}" requires a "field".`);
    }
    const info = measureFieldInfo(schema, m.field);
    const t = requireTermPath(schema, m.field, info);

    if (["sum", "avg", "min", "max", "first", "last"].includes(m.op) && info.type !== "number") {
      throw new Error(`Measure "${m.op}" on field "${m.field}" requires a number type, but it is ${info.type}.`);
    }

    switch (m.op) {
      case "sum":
      case "avg":
      case "min":
      case "max":
        measureAggs[key] = { [m.op]: { field: t } };
        break;
      case "countDistinct":
        // cardinality is a HyperLogLog++ sketch, so countDistinct is
        // APPROXIMATE, not exact — exact for small groups, drifting on large
        // ones. This is inherent to Elasticsearch, not a translation choice.
        measureAggs[key] = { cardinality: { field: t, precision_threshold: 40000 } };
        break;
      case "first":
      case "last": {
        // aggregate.ts:56-58 falls back to source row order when the schema has no
        // date field. Elasticsearch has no equivalent, so _doc (index order) is the
        // closest stand-in. It is stable within a segment but not across a merge.
        const sortEntry = dateSortField
          ? { [dateSortField]: { order: m.op === "first" ? "asc" : "desc" } }
          : { _doc: { order: "asc" as const } };
        measureAggs[key] = {
          filter: { exists: { field: t } },
          aggs: { h: { top_hits: { size: 1, sort: [sortEntry], _source: [info.sourcePath ?? m.field] } } },
        };
        break;
      }
      default:
        throw new Error(`Unknown measure op: ${String((m as { op: unknown }).op)}`);
    }
  }

  if (agg.having) {
    const aliases = new Set<string>();
    collectHavingAliases(agg.having, aliases);
    const bucketsPath = havingBucketsPath(aliases, measureAliases, agg);
    measureAggs["h"] = { bucket_selector: { buckets_path: bucketsPath, script: havingScript(agg.having) } };
  }

  const body: Record<string, unknown> = {
    size: 0,
    aggs: {
      g: { composite: { size: ES_COMPOSITE_PAGE_SIZE, sources }, aggs: measureAggs },
    },
  };

  const query = buildQueryClause(q, schema);
  if (query) body.query = query;

  // sort, limit and paging are NOT pushed into the aggregation. Measured:
  // bucket_sort works on a composite agg but sorts only the buckets in that
  // one response, and truncating there destroys the post-having bucket count
  // that QueryResult.page.total needs (core query-engine.ts:39 takes total
  // from the length of the aggregated rows AFTER having, sort and agg.limit).
  // Composite also pages by after_key, which cannot express an arbitrary
  // offset. So the reader collects every bucket, then applies sort, agg.limit
  // and page with the same rules as core.
  //
  // That is agg.sort — the sort INSIDE aggregate. A top-level q.sort or
  // q.select never reaches this function: assertNoTopLevelSortOrSelect
  // rejected it at the top of toEsSearchBody. Do not start ignoring one here.

  return { body, dimensionAliases, measureAliases };
}

export function toEsSearchBody(q: DataQuery, schema: EsSchema): EsSearchPlan {
  // Local copy of the guard runQuery calls (see ./aggregate-guard.ts for why
  // it is a copy) — the two engines reject the same queries with the same
  // words, pinned by the byte-identical-message tests in es-request.test.ts.
  assertNoTopLevelSortOrSelect(q);
  if (q.aggregate) {
    const { body, dimensionAliases, measureAliases } = buildAggBody(q, schema);
    return { body, aggregated: true, dimensionAliases, measureAliases };
  }
  return { body: buildRowBody(q, schema), aggregated: false };
}

/** The next composite page for an aggregated plan. Throws if not aggregated. */
export function nextEsCompositeBody(plan: EsSearchPlan, afterKey: Record<string, unknown>): Record<string, unknown> {
  if (!plan.aggregated) {
    throw new Error("nextEsCompositeBody: plan is not an aggregated plan.");
  }
  const body = JSON.parse(JSON.stringify(plan.body)) as Record<string, unknown>;
  const aggs = body.aggs as Record<string, { composite: Record<string, unknown> }>;
  aggs.g.composite.after = afterKey;
  return body;
}
