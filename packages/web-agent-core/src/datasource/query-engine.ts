import { FieldSchema, DataQuery, QueryResult, TruncationReport } from "./types.js";
import { matchesFilter, compareValues, matchesSearch } from "./filter.js";
import { aggregate } from "./aggregate.js";
import { assertNoTopLevelSortOrSelect } from "./aggregate-guard.js";

export function runQuery(rows: Record<string, unknown>[], schema: FieldSchema[], q: DataQuery): QueryResult {
  // Must run before the select validation below: on an aggregate query the
  // select names would fail there as "Unknown field" and hide the real
  // problem.
  assertNoTopLevelSortOrSelect(q);

  // Validate that select fields exist in schema
  if (q.select) {
    for (const fieldName of q.select) {
      if (!schema.some(f => f.name === fieldName)) {
        throw new Error(`Unknown field "${fieldName}". Fields: ${schema.map(f => f.name).join(", ")}`);
      }
    }
  }

  // 1. Filter
  let filtered = [...rows];
  // Free-text search runs first, so it also narrows the aggregation branch
  // below and the bucket counts it produces. Blank terms are ignored.
  const needle = q.search?.trim().toLowerCase();
  if (needle) {
    filtered = filtered.filter(row => matchesSearch(row, needle, schema));
  }
  if (q.filter) {
    filtered = filtered.filter(row => matchesFilter(row, q.filter!, schema));
  }

  if (q.aggregate) {
    // Aggregation path: filter → aggregate → having → sort → limit → paginate
    // The sort and limit named there are aggregate.sort and aggregate.limit,
    // applied inside aggregate(). A top-level q.sort/q.select never reaches
    // here: assertNoTopLevelSortOrSelect rejected it at the top of runQuery.
    const { rows: aggRows, fields: aggFields } = aggregate(filtered, schema, q.aggregate);
    const aggTotal = aggRows.length;

    // Paginate aggregated rows
    const offset = q.page?.offset ?? 0;
    const rawLimit = q.page?.limit ?? 50;
    const limit = Math.min(Math.max(rawLimit, 1), 500);
    const paginated = aggRows.slice(offset, offset + limit);

    // Truncate leaves
    const truncated = paginated.map(row => truncateLeaves(row) as Record<string, unknown>);

    return {
      source: q.source,
      aggregated: true,
      fields: aggFields,
      rows: truncated,
      page: {
        // Honest delivered count, not the requested/clamped limit — a page
        // must not claim rows it does not contain (e.g. fewer groups than
        // `limit` when the source runs out before the requested page fills).
        limit: paginated.length,
        offset,
        total: aggTotal,
        hasMore: offset + paginated.length < aggTotal
      }
    };
  }

  // 2. Sort (non-aggregation path)
  if (q.sort && q.sort.length > 0) {
    for (const item of q.sort) {
      const fieldSchema = schema.find(f => f.name === item.field);
      if (!fieldSchema) {
        throw new Error(`Unknown field "${item.field}". Fields: ${schema.map(f => f.name).join(", ")}`);
      }
    }
    filtered.sort((a, b) => {
      for (const item of q.sort!) {
        const fieldSchema = schema.find(f => f.name === item.field)!;
        const type = fieldSchema.type;
        const valA = a[item.field];
        const valB = b[item.field];
        const cmp = compareValues(valA, valB, type);
        if (cmp !== 0) {
          return item.dir === "desc" ? -cmp : cmp;
        }
      }
      return 0;
    });
  }

  // 3. Total (filtered count)
  const total = filtered.length;

  // 4. Paginate
  const offset = q.page?.offset ?? 0;
  const rawLimit = q.page?.limit ?? 50;
  const limit = Math.min(Math.max(rawLimit, 1), 500);
  const paginated = filtered.slice(offset, offset + limit);

  // 5. Project (select)
  const projected = paginated.map(row => {
    if (q.select) {
      const proj: Record<string, unknown> = {};
      for (const key of q.select) {
        proj[key] = row[key];
      }
      return proj;
    }
    return { ...row };
  });

  // 6. Truncate leaves
  const truncated = projected.map(row => truncateLeaves(row) as Record<string, unknown>);

  // Projected schema fields
  const resultFields = q.select
    ? q.select.map(name => schema.find(f => f.name === name)!)
    : schema;

  return {
    source: q.source,
    aggregated: false,
    fields: resultFields,
    rows: truncated,
    page: {
      // Honest delivered count, not the requested/clamped limit — see the
      // aggregation branch above for why.
      limit: paginated.length,
      offset,
      total,
      hasMore: offset + paginated.length < total
    }
  };
}

/**
 * Serializes a QueryResult into a string that is always valid JSON and
 * never exceeds `maxChars` except in the pathological case where even the
 * empty-result envelope cannot fit (see the final fallback below).
 *
 * Width-aware: it measures actual row width up front instead of dropping
 * rows one at a time, which cannot converge when a single row already
 * exceeds the budget (a wide, many-column source). When rows must be
 * dropped or field metadata lightened, it attaches a `truncation` report so
 * the caller can tell the model the honest reason instead of handing it a
 * silently-cut fragment.
 */
export function serializeResult(result: QueryResult, maxChars = 6000): string {
  // 1. Try full pretty print — the common, untruncated case.
  const pretty = JSON.stringify(result, null, 2);
  if (pretty.length <= maxChars) {
    return pretty;
  }

  // 2. Try full compact print.
  const compact = JSON.stringify(result);
  if (compact.length <= maxChars) {
    return compact;
  }

  // 3. Width-aware budgeting: measure row width, lighten field metadata if
  // needed, and compute the exact row count that fits.
  const requested = result.page.limit ?? result.rows.length;

  const sampleSize = Math.min(result.rows.length, 10);
  const avgRowChars = sampleSize > 0
    ? Math.round(
        result.rows.slice(0, sampleSize).reduce((sum, row) => sum + JSON.stringify(row).length, 0) / sampleSize
      )
    : 0;

  // Field schema stripped to name/type only — drops the optional label,
  // enumValues, description, and limitation metadata that can dominate a
  // wide (many-field) schema's envelope size.
  const lightFields: FieldSchema[] = result.fields.map(f => ({ name: f.name, type: f.type }));

  function buildCandidate(rowCount: number, fields: FieldSchema[], fieldsTruncated: boolean): QueryResult {
    const included = rowCount;
    const dropped = Math.max(0, requested - included);
    const isTruncated = dropped > 0 || fieldsTruncated;

    let truncation: TruncationReport | undefined;
    if (isTruncated) {
      const reason = included === 0
        ? `Row width (~${avgRowChars.toLocaleString()} chars/row) exceeds the character budget (${maxChars.toLocaleString()} chars).`
        : `Result exceeded the character budget (${maxChars.toLocaleString()} chars); included ${included} of ${requested} row(s) (~${avgRowChars.toLocaleString()} chars/row).`;
      const hintField = fields[0]?.name ?? result.fields[0]?.name ?? "id";
      const hint = `Select specific columns with "select" (e.g. select: ["${hintField}"]) to reduce row width, or lower the page limit.`;
      truncation = {
        requested,
        included,
        dropped,
        reason,
        hint,
        ...(fieldsTruncated ? { fieldsTruncated: true } : {}),
      };
    }

    return {
      source: result.source,
      aggregated: result.aggregated,
      fields,
      rows: result.rows.slice(0, included),
      page: {
        limit: included,
        offset: result.page.offset,
        total: result.page.total,
        hasMore: result.page.offset + included < result.page.total,
      },
      ...(truncation ? { truncation } : {}),
    };
  }

  // Full fields unless even the empty-row envelope with full fields already
  // eats most of the budget.
  let fields = result.fields;
  if (JSON.stringify(buildCandidate(0, fields, false)).length > maxChars * 0.6) {
    fields = lightFields;
  }

  // If even lightened fields with 0 rows don't fit, shrink the field list
  // itself until the envelope fits (or one field remains).
  let fieldsTruncated = fields.length < result.fields.length;
  while (fields.length > 1 && JSON.stringify(buildCandidate(0, fields, true)).length > maxChars) {
    fieldsTruncated = true;
    fields = fields.slice(0, Math.max(1, Math.floor(fields.length * 0.7)));
  }

  // Binary search for the exact row count that fits within maxChars.
  let low = 0;
  let high = result.rows.length;
  let bestCount = 0;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const json = JSON.stringify(buildCandidate(mid, fields, fieldsTruncated));
    if (json.length <= maxChars) {
      bestCount = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  const finalCandidate = buildCandidate(bestCount, fields, fieldsTruncated);
  const finalPretty = JSON.stringify(finalCandidate, null, 2);
  if (finalPretty.length <= maxChars) {
    return finalPretty;
  }
  const finalCompact = JSON.stringify(finalCandidate);
  if (finalCompact.length <= maxChars) {
    return finalCompact;
  }

  // Worst-case fallback: maxChars is too small even for the empty-result
  // envelope. Still guaranteed valid JSON, still honest about what happened.
  return JSON.stringify({
    source: result.source,
    aggregated: result.aggregated,
    fields: [],
    rows: [],
    page: { limit: 0, offset: result.page.offset, total: result.page.total, hasMore: result.page.total > 0 },
    truncation: {
      requested,
      included: 0,
      dropped: requested,
      reason: `Result exceeds the character budget (${maxChars.toLocaleString()} chars) even with 0 rows and no field metadata.`,
      hint: `Increase queryResultMaxChars or select fewer fields.`,
    },
  });
}

function truncateLeaves(val: unknown, depth = 0): unknown {
  if (depth > 6) return "…";
  if (val === null || val === undefined) return val;
  if (typeof val === "string") {
    if (val.length > 300) {
      return val.slice(0, 300) + "…";
    }
    return val;
  }
  if (Array.isArray(val)) {
    return val.map(v => truncateLeaves(v, depth + 1));
  }
  if (typeof val === "object") {
    if (val instanceof Date) return val;
    if (val instanceof RegExp) return val;
    const res: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val)) {
      res[k] = truncateLeaves(v, depth + 1);
    }
    return res;
  }
  return val;
}
