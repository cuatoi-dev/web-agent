import { ChartConfigSchema } from "../ui-blocks/chart-schema.js";
import { normalizeChartConfig } from "../ui-blocks/chart-normalize.js";
import { validateChartSchema } from "../ui-blocks/validate-chart.js";
import { sanitizeChartConfig, hasDataUrl, checkRowCountExceeded, checkAxisIdMismatch } from "../ui-blocks/chart-spec.js";
import type { ToolOutcome, RenderableBlock, JsonSchemaObject } from "@cuatoi/web-agent-core";

export const SHOW_CHART_SCHEMA: JsonSchemaObject = {
  type: "object",
  properties: {
    title: { type: "string", description: "Optional chart title" },
    config: {
      ...ChartConfigSchema,
      description:
        'Chart.js 2.x config object. Call load_skill("chart") for shape, types, and examples.',
    },
  },
  required: ["config"],
  additionalProperties: false,
};

export async function runShowChart(
  input: Record<string, unknown>,
): Promise<ToolOutcome> {
  const { title, config } = input as { title?: string; config: unknown };

  // JSON Schema validates but does not transform, so the coercion the old
  // z.preprocess did runs here as an explicit step. Validate the NORMALIZED
  // value: that is what the pre-migration schema effectively checked.
  const normalized = normalizeChartConfig(config);
  const error = await validateChartSchema("config", ChartConfigSchema, normalized);
  if (error) return { content: error, isError: true };

  // Check violations on the normalized config BEFORE sanitization, because
  // sanitizeChartConfig strips remote URLs and caps data lengths — those
  // hard limits must surface as errors to the model, not be silently fixed.
  if (hasDataUrl(normalized)) {
    return {
      content:
        "config.data: external data URLs are not allowed; embed data values inline",
      isError: true,
    };
  }
  if (checkRowCountExceeded(normalized)) {
    return {
      content:
        "config.data: a dataset exceeds the 2 000-row limit; reduce the dataset before charting",
      isError: true,
    };
  }

  const axisMismatch = checkAxisIdMismatch(normalized);
  if (axisMismatch) {
    return { content: `config.${axisMismatch}`, isError: true };
  }

  const sanitized = sanitizeChartConfig(normalized);

  const block: RenderableBlock = {
    type: "chart",
    ...(title ? { title: String(title) } : {}),
    config: sanitized,
  };

  return { content: "chart rendered", block };
}
