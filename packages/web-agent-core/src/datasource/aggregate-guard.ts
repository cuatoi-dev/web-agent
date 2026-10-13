import type { Aggregation, DataQuery } from "./types.js";

/**
 * The result columns an aggregate produces, in order: one per groupBy
 * dimension, then one per measure. The naming rule matches aggregate.ts:27
 * and aggregate.ts:49 (and es-request.ts:53 / :81 for the Elasticsearch
 * path). Computed here so the rejection message can name the real columns
 * the caller should sort on.
 */
function resultColumns(agg: Aggregation): string[] {
  const names: string[] = [];
  for (const dim of agg.groupBy) {
    names.push(dim.as || (dim.granularity ? `${dim.field}_${dim.granularity}` : dim.field));
  }
  for (const m of agg.measures) {
    names.push(m.as || (m.op === "count" && !m.field ? "count" : `${m.op}_${m.field}`));
  }
  return names;
}

/**
 * An aggregate query used to have its top-level `sort` and `select` dropped
 * without a word (the old query-engine.ts comment said so outright), so a
 * caller that asked for a ranked aggregate got group order and presented it
 * as the answer. Reject instead: name the fields, name this query's real
 * result columns, and show the exact fix.
 *
 * This is the one implementation of the rule, and runQuery calls it. The
 * Elasticsearch translator cannot import it at runtime — charting's
 * ./datasource subpath must reach zero bare specifiers — so
 * web-agent-charting/src/datasource/aggregate-guard.ts carries an identical
 * local copy, kept honest by the byte-identical-message tests in
 * es-request.test.ts, which compare the two engines' thrown messages for the
 * same queries.
 *
 * An empty `sort: []` / `select: []` is treated as absent,
 * matching query-engine.ts:68 and query-data.ts:31.
 *
 * No-op when `q.aggregate` is absent: top-level sort and select are the
 * supported way to order and project a row query.
 */
export function assertNoTopLevelSortOrSelect(q: DataQuery): void {
  if (!q.aggregate) return;
  const hasSort = !!q.sort && q.sort.length > 0;
  const hasSelect = !!q.select && q.select.length > 0;
  if (!hasSort && !hasSelect) return;

  const columns = resultColumns(q.aggregate);
  const columnList = columns.join(", ");
  const example = columns[columns.length - 1] ?? "<result column>";
  const parts: string[] = [];

  if (hasSort) {
    parts.push(
      `Top-level "sort" does not apply to an aggregate query, so this query ` +
      `was rejected rather than answered in the wrong order. It named: ` +
      `${q.sort!.map((s) => `"${s.field}"`).join(", ")}. Move the sort inside ` +
      `"aggregate" and name a result column, for example ` +
      `"aggregate": { "sort": [{ "field": "${example}", "dir": "desc" }] }.`,
    );
  }
  if (hasSelect) {
    parts.push(
      `Top-level "select" does not apply to an aggregate query, so this query ` +
      `was rejected rather than answered with columns you did not ask for. It ` +
      `named: ${q.select!.map((f) => `"${f}"`).join(", ")}. Remove "select" — an ` +
      `aggregate returns only its grouping and measure columns. To rename one, ` +
      `set "as" on the groupBy entry or on the measure.`,
    );
  }
  parts.push(`This query's result columns are: ${columnList}.`);
  throw new Error(parts.join(" "));
}
