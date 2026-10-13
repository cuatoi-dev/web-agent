import type { ToolOutcome, ToolContext } from "./types.js";
import { DataQuery } from "../datasource/types.js";
import { serializeResult } from "../datasource/query-engine.js";
import { DEFAULT_WIDE_SOURCE_FIELD_THRESHOLD } from "../config.js";
import { selectRequiredForWideSource } from "./error-messages.js";

/**
 * Executor for query_data.
 * Validates, delegates to provider, serializes with caps, honours abort signal.
 */
export async function runQueryData(
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  const { dataSource } = ctx;
  if (!dataSource) {
    return { content: "Error: dataSource not available in context." };
  }

  if (ctx.signal.aborted) {
    return { content: "Tool execution aborted." };
  }

  const query = input as unknown as DataQuery;

  // A row query that names no column asks for every column. On a wide
  // source that cannot fit any budget, so answer with the way out instead
  // of a truncated blob. Aggregates return only their grouping and measure
  // columns, so they never take this path — and neither does a query that
  // already projects, which keeps describeSource off the common path.
  if (!query.aggregate && (!query.select || query.select.length === 0)) {
    const threshold = ctx.wideSourceFieldThreshold ?? DEFAULT_WIDE_SOURCE_FIELD_THRESHOLD;
    const info = await dataSource.describeSource(query.source);
    if (info.fields.length > threshold) {
      return {
        content: selectRequiredForWideSource(
          query.source,
          info.fields.length,
          threshold,
          info.fields.map((f) => f.name),
        ),
        isError: true,
      };
    }
  }

  // runQuery / aggregate / describeSource already throw descriptive errors
  // (unknown source/field, op/type mismatch, bad agg). Let them bubble to
  // wrapExecutor, which returns the error message flagged as isError.
  const result = await dataSource.query(query);

  if (ctx.signal.aborted) {
    return { content: "Tool execution aborted." };
  }

  // Cap at configured maxChars (default 6000 from AgentConfig)
  const maxChars = ctx.queryResultMaxChars ?? 6000;
  const output = serializeResult(result, maxChars);

  return { content: output };
}
