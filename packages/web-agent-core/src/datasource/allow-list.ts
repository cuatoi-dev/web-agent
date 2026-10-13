import type {
  Aggregation, DataQuery, FieldAllowEntry, FieldSchema, FilterExpr,
  QueryResult, Scalar, SourceInfo,
} from "./types.js";
import type { SourceEntry } from "./types.js";

/** Field names referenced by a filter expression, including nested $and/$or/$not. */
function filterFieldNames(expr: FilterExpr, out: string[] = []): string[] {
  for (const [key, value] of Object.entries(expr)) {
    if (key === "$and" || key === "$or") {
      for (const sub of value as FilterExpr[]) filterFieldNames(sub, out);
    } else if (key === "$not") {
      filterFieldNames(value as FilterExpr, out);
    } else {
      out.push(key);
    }
  }
  return out;
}

/** Every source-field reference in a query, tagged with the path it came from. */
function queryFieldRefs(q: DataQuery): { path: string; field: string }[] {
  const refs: { path: string; field: string }[] = [];
  for (const f of q.select ?? []) refs.push({ path: "select", field: f });
  if (q.filter) {
    for (const f of filterFieldNames(q.filter)) refs.push({ path: "filter", field: f });
  }
  for (const s of q.sort ?? []) refs.push({ path: "sort", field: s.field });
  const agg: Aggregation | undefined = q.aggregate;
  if (agg) {
    for (const d of agg.groupBy) refs.push({ path: "groupBy", field: d.field });
    for (const m of agg.measures) {
      if (m.field) refs.push({ path: "measure", field: m.field });
    }
  }
  return refs;
}

/**
 * Throws on the first reference to a field the source does not allow. The
 * message names the rejected field, the path it appeared in, and every allowed
 * field name. `aggregate.sort` and `aggregate.having` are not checked: they
 * address result aliases, which aggregate() already validates.
 */
export function assertQueryAllowed(q: DataQuery, allow: FieldAllowEntry[]): void {
  const allowed = new Set(allow.map((a) => a.name));
  for (const ref of queryFieldRefs(q)) {
    if (!allowed.has(ref.field)) {
      throw new Error(
        `Field "${ref.field}" is not available on source "${q.source}" ` +
        `(referenced in ${ref.path}). Available fields: ` +
        `${allow.map((a) => a.name).join(", ")}.`
      );
    }
  }
}

/** Narrow a SourceInfo's fields to the allow-list, in the host's order, labelled. */
export function applyAllowList(info: SourceInfo, allow: FieldAllowEntry[]): SourceInfo {
  const byName = new Map(info.fields.map((f) => [f.name, f]));
  const fields: FieldSchema[] = [];
  for (const entry of allow) {
    const field = byName.get(entry.name);
    if (field) fields.push({ ...field, label: entry.label });
  }
  // The unsupported-field report names fields too, so it obeys the same
  // allow-list. Without this, a host that hid a field would still see its
  // name reach the agent through the report.
  const allowed = new Set(allow.map((a) => a.name));
  const unsupportedFields = (info.unsupportedFields ?? []).filter((u) => allowed.has(u.name));
  const out: SourceInfo = { ...info, fields };
  if (unsupportedFields.length > 0) out.unsupportedFields = unsupportedFields;
  else delete out.unsupportedFields;
  return out;
}

/** Narrow a non-aggregated result to the allowed columns, in the host's order. */
function narrowResult(result: QueryResult, allow: FieldAllowEntry[]): QueryResult {
  const byName = new Map(result.fields.map((f) => [f.name, f]));
  const fields: FieldSchema[] = [];
  for (const entry of allow) {
    const field = byName.get(entry.name);
    if (field) fields.push({ ...field, label: entry.label });
  }
  const keep = fields.map((f) => f.name);
  const rows = result.rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const key of keep) {
      if (key in row) out[key] = row[key];
    }
    return out;
  });
  return { ...result, fields, rows };
}

/**
 * Attach labels to aggregate result columns. A column whose alias is itself
 * an allowed field name (e.g. a groupBy with no `as`) is labelled directly;
 * a renamed column (e.g. measure alias "avg_price" computed from field
 * "price") is labelled by mapping its alias back to the source field it was
 * computed from, via the same alias-derivation rules as `aggregate()`.
 */
function labelAggregated(result: QueryResult, allow: FieldAllowEntry[], agg?: Aggregation): QueryResult {
  const labels = new Map(allow.map((a) => [a.name, a.label]));
  const aliasSourceField = new Map<string, string>();
  for (const dim of agg?.groupBy ?? []) {
    const alias = dim.as || (dim.granularity ? `${dim.field}_${dim.granularity}` : dim.field);
    aliasSourceField.set(alias, dim.field);
  }
  for (const m of agg?.measures ?? []) {
    if (!m.field) continue;
    const alias = m.as || `${m.op}_${m.field}`;
    aliasSourceField.set(alias, m.field);
  }
  return {
    ...result,
    fields: result.fields.map((f) => {
      const sourceField = aliasSourceField.get(f.name) ?? f.name;
      return labels.has(sourceField) ? { ...f, label: labels.get(sourceField)! } : f;
    }),
  };
}

/**
 * Wrap a source so its allow-list is enforced on every path the provider
 * exposes: describe (list and describe tools), query and sampleValues.
 */
export function withAllowList(entry: SourceEntry, allow: FieldAllowEntry[]): SourceEntry {
  const allowed = new Set(allow.map((a) => a.name));
  return {
    allowFields: allow,
    async describe(): Promise<SourceInfo> {
      return applyAllowList(await entry.describe(), allow);
    },
    async query(q: DataQuery): Promise<QueryResult> {
      assertQueryAllowed(q, allow);
      const result = await entry.query(q);
      return result.aggregated
        ? labelAggregated(result, allow, q.aggregate)
        : narrowResult(result, allow);
    },
    async sampleValues(field: string, limit = 20): Promise<{ values: (string | number | boolean)[]; hasMore: boolean }> {
      if (!allowed.has(field)) {
        throw new Error(
          `Field "${field}" is not available on source. ` +
          `Available fields: ${allow.map((a) => a.name).join(", ")}.`
        );
      }
      if (entry.sampleValues) {
        return entry.sampleValues(field, limit);
      }
      const res = await entry.query({
        source: "",
        aggregate: { groupBy: [{ field }], measures: [], limit: limit + 1 },
      });
      const rows = res.rows;
      const hasMore = rows.length > limit;
      const values = rows.slice(0, limit).map((r) => r[field] as Scalar);
      return { values, hasMore };
    },
  };
}
