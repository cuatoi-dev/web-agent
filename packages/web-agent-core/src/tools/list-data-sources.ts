import type { ToolOutcome, ToolContext } from "./types.js";

/**
 * Executor for list_data_sources.
 * If source given → describeSource, the full SourceInfo with every field.
 * Else → listSources, one compact SourceSummary per source and no field detail.
 */
export async function runListDataSources(
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  const { dataSource } = ctx;
  if (!dataSource) {
    return { content: "Error: dataSource not available in context." };
  }

  const sourceName = input.source as string | undefined;

  if (sourceName) {
    const info = await dataSource.describeSource(sourceName);
    return {
      content: JSON.stringify(info, null, 2),
    };
  }

  const sources = await dataSource.listSources();
  return {
    content: JSON.stringify(sources, null, 2),
  };
}
