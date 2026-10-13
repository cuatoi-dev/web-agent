import type { Aggregation, DataQuery } from "@cuatoi/web-agent-core";

// A copy of assertNoTopLevelSortOrSelect (web-agent-core
// src/datasource/aggregate-guard.ts), following the compareValuesLocal
// precedent at es-response.ts:130-132. It cannot be imported at runtime:
// the ./datasource subpath must reach ZERO bare specifiers — this folder
// imports core with `import type` only (docs/import-paths.md promises "no
// runtime dependency either"; entry-no-runtime-deps.test.ts enforces it).
// Nothing here can drift silently: the byte-identical-message tests in
// es-request.test.ts run the same queries through this copy and through
// core's runQuery and assert the two thrown messages are equal.

/**
 * The result columns an aggregate produces, in order: one per groupBy
 * dimension, then one per measure. Same alias rule as core's copy,
 * aggregate.ts:27 / :49 and es-request.ts buildAggBody.
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
 * Local copy of core's assertNoTopLevelSortOrSelect — see the module comment
 * above for why the copy exists and what pins it to the original.
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
