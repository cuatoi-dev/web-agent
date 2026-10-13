import type { ToolOutcome, ToolContext } from "./types.js";
import type { FieldSampleQuery, FieldSampleResult } from "../datasource/types.js";

export function serializeFieldSampleResult(result: FieldSampleResult, maxChars = 6000): string {
  const pretty = JSON.stringify(result, null, 2);
  if (pretty.length <= maxChars) return pretty;
  const compact = JSON.stringify(result);
  if (compact.length <= maxChars) return compact;

  const requested = result.values.length;
  const values = [...result.values];
  while (values.length > 0) {
    const candidate: FieldSampleResult = {
      ...result,
      values,
      truncation: {
        requested,
        included: values.length,
        dropped: requested - values.length,
        reason: `Sample values exceeded character budget (${maxChars.toLocaleString()} chars).`,
        hint: `Lower the limit parameter.`,
      },
    };
    const json = JSON.stringify(candidate, null, 2);
    if (json.length <= maxChars) return json;
    const compactCandidate = JSON.stringify(candidate);
    if (compactCandidate.length <= maxChars) return compactCandidate;
    values.pop();
  }

  return JSON.stringify({
    source: result.source,
    field: result.field,
    values: [],
    hasMore: result.hasMore,
    truncation: {
      requested,
      included: 0,
      dropped: requested,
      reason: `Sample values exceeded character budget (${maxChars.toLocaleString()} chars).`,
      hint: `Lower the limit parameter.`,
    },
  });
}

export async function runSampleFieldValues(
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  const { dataSource } = ctx;
  if (!dataSource) {
    return { content: "Error: dataSource not available in context.", isError: true };
  }
  if (ctx.signal?.aborted) {
    return { content: "Tool execution aborted.", isError: true };
  }
  const query = input as unknown as FieldSampleQuery;
  const result = await dataSource.sampleValues(query);
  if (ctx.signal?.aborted) {
    return { content: "Tool execution aborted.", isError: true };
  }
  const maxChars = ctx.queryResultMaxChars ?? 6000;
  return { content: serializeFieldSampleResult(result, maxChars) };
}
