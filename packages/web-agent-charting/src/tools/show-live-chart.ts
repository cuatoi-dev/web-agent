import { validateDataQuery } from "@cuatoi/web-agent-core";
import { ChartEncodingSchema, ChartRefreshSchema } from "../ui-blocks/chart-schema.js";
import { validateChartSchema } from "../ui-blocks/validate-chart.js";
import type { ChartEncoding, ChartRefresh } from "../ui-blocks/chart-schema.js";
import type { ToolOutcome, RenderableBlock, JsonSchemaObject } from "@cuatoi/web-agent-core";

export const SHOW_LIVE_CHART_SCHEMA: JsonSchemaObject = {
  type: "object",
  properties: {
    title: { type: "string", description: "Chart title" },
    // Structural check only. The query language lives in JSON Schema (core's
    // DataQuerySchema), so runShowLiveChart validates the body with core's
    // validateDataQuery immediately below — the same gate as before, now
    // that the whole schema is JSON Schema too.
    query: {
      type: "object",
      additionalProperties: {},
      description: "DataQuery targeting a registered data source",
    },
    encoding: {
      ...ChartEncodingSchema,
      description:
        'Field-to-chart mapping. Call load_skill("chart") for marks, channels, examples.',
    },
    refresh: {
      ...ChartRefreshSchema,
      description: "Default: auto-refresh every 60s when visible.",
    },
  },
  required: ["query", "encoding"],
  additionalProperties: false,
};

export async function runShowLiveChart(
  input: Record<string, unknown>,
): Promise<ToolOutcome> {
  const error = await validateChartSchema("", SHOW_LIVE_CHART_SCHEMA, input);
  if (error) return { content: error, isError: true };

  const { title, query, encoding, refresh } = input as {
    title?: string;
    query: Record<string, unknown>;
    encoding: ChartEncoding;
    refresh?: ChartRefresh;
  };

  // A genuine `{ ok: false }` verdict rejects the call; a THROW from
  // validateDataQuery is a bundler-side ajv load/compile failure — the
  // webpack module-id collision documented in docs/tests/0167 — not a bad
  // query. Pre-existing (this call was unguarded before this task too); own
  // it here rather than let it crash the tool call, matching the same
  // non-fatal design build-tools.ts already uses for that failure mode.
  try {
    const queryCheck = await validateDataQuery(query);
    if (!queryCheck.ok) {
      return { content: `query: ${queryCheck.message}`, isError: true };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[web-agent] DataQuery validation unavailable for "show_live_chart" — running unvalidated (${msg}).`,
    );
  }

  const block: RenderableBlock = {
    type: "chart",
    ...(title ? { title: String(title) } : {}),
    query,
    encoding,
    ...(refresh ? { refresh } : {}),
  };

  return { content: "live chart rendered", block };
}
