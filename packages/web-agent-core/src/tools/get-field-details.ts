import type { ToolOutcome, ToolContext } from "./types.js";
import type {
  FieldDetailsQuery, FieldDetailsResult, FieldSchema, UnsupportedField,
} from "../datasource/types.js";

export function serializeFieldDetailsResult(result: FieldDetailsResult, maxChars = 6000): string {
  const pretty = JSON.stringify(result, null, 2);
  if (pretty.length <= maxChars) return pretty;
  const compact = JSON.stringify(result);
  if (compact.length <= maxChars) return compact;

  // Both arrays count toward the budget, and both are counted in the one
  // truncation report, so nothing is dropped without being reported.
  const requested = result.fields.length + (result.unsupportedFields?.length ?? 0);

  const reason = `Field details exceeded character budget (${maxChars.toLocaleString()} chars).`;
  const hint = `Use "filter" to search for specific fields or lower "limit".`;

  const build = (fields: FieldSchema[], unsupported: UnsupportedField[]): FieldDetailsResult => {
    const included = fields.length + unsupported.length;
    const candidate: FieldDetailsResult = {
      ...result,
      fields,
      limit: fields.length,
      truncation: {
        requested,
        included,
        dropped: requested - included,
        reason,
        hint,
        fieldsTruncated: true,
      },
    };
    if (unsupported.length > 0) candidate.unsupportedFields = unsupported;
    else delete candidate.unsupportedFields;
    return candidate;
  };

  const fit = (candidate: FieldDetailsResult): string | undefined => {
    const json = JSON.stringify(candidate, null, 2);
    if (json.length <= maxChars) return json;
    const compactCandidate = JSON.stringify(candidate);
    if (compactCandidate.length <= maxChars) return compactCandidate;
    return undefined;
  };

  // Unsupported entries go first: the field cannot be queried either way, so
  // the usable field list is the higher-value half of the payload.
  const unsupported = [...(result.unsupportedFields ?? [])];
  while (unsupported.length > 0) {
    const json = fit(build(result.fields, unsupported));
    if (json) return json;
    unsupported.pop();
  }

  const fields = [...result.fields];
  while (fields.length > 0) {
    const json = fit(build(fields, []));
    if (json) return json;
    fields.pop();
  }

  return JSON.stringify({
    source: result.source,
    fields: [],
    total: result.total,
    offset: result.offset,
    limit: 0,
    hasMore: result.hasMore,
    truncation: {
      requested,
      included: 0,
      dropped: requested,
      reason,
      hint,
      fieldsTruncated: true,
    },
  });
}

export async function runGetFieldDetails(
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
  const query = input as unknown as FieldDetailsQuery;
  const result = await dataSource.getFieldDetails(query);
  if (ctx.signal?.aborted) {
    return { content: "Tool execution aborted.", isError: true };
  }
  const maxChars = ctx.queryResultMaxChars ?? 6000;
  return { content: serializeFieldDetailsResult(result, maxChars) };
}
