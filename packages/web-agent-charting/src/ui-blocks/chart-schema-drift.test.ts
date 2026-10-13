/**
 * Runtime half of the drift guard (D3 in the refine plan).
 *
 * The chain is: hand-written interface -> (tsc) -> `*_KEYS`/`*_MEMBERS`
 * witness -> (Vitest, this file) -> schema. Each witness's key set is
 * derived by the COMPILER from its interface (`Record<keyof T, true>`), so
 * these assertions compare two independently-maintained artefacts, not a
 * constant against its own literal value:
 *
 *  - add a field to an interface and forget the schema: the witness object
 *    literal fails `tsc` with TS2741 (missing property) before this file
 *    ever runs;
 *  - add a property to a schema and forget the interface: the key-set
 *    assertion below fails at runtime.
 *
 * Neither side can drift alone.
 */
import { describe, it, expect } from "vitest";
import {
  ChartTypeSchema, CHART_TYPE_MEMBERS,
  ChartDatasetSchema, CHART_DATASET_KEYS,
  ChartDataSchema, CHART_DATA_KEYS,
  ChartConfigSchema, CHART_CONFIG_KEYS,
  ChartRefreshModeSchema, CHART_REFRESH_MODE_MEMBERS,
  ChartRefreshSchema, CHART_REFRESH_KEYS,
  EncodingChannelSchema, ENCODING_CHANNEL_KEYS,
  EncodingSimpleChannelSchema, ENCODING_SIMPLE_CHANNEL_KEYS,
  ChartEncodingSchema, CHART_ENCODING_KEYS,
  ChartBlockDiscriminant, CHART_BLOCK_KEYS,
} from "./chart-schema.js";
import type { ChartRefresh, EncodingChannel, ChartConfig, ChartDataset, ChartData } from "./chart-schema.js";
import { validateChartSchema } from "./validate-chart.js";

// ── Key-set equality: schema properties vs interface witness ──

describe("drift guard — schema property sets match their interface witnesses", () => {
  it("ChartDatasetSchema properties match the ChartDataset interface", () => {
    expect(Object.keys(ChartDatasetSchema.properties as object).sort())
      .toEqual(Object.keys(CHART_DATASET_KEYS).sort());
  });

  it("ChartDataSchema properties match the ChartData interface", () => {
    expect(Object.keys(ChartDataSchema.properties as object).sort())
      .toEqual(Object.keys(CHART_DATA_KEYS).sort());
  });

  it("ChartConfigSchema properties match the ChartConfig interface", () => {
    expect(Object.keys(ChartConfigSchema.properties as object).sort())
      .toEqual(Object.keys(CHART_CONFIG_KEYS).sort());
  });

  it("ChartRefreshSchema properties match the ChartRefresh interface", () => {
    expect(Object.keys(ChartRefreshSchema.properties as object).sort())
      .toEqual(Object.keys(CHART_REFRESH_KEYS).sort());
  });

  it("EncodingChannelSchema properties match the EncodingChannel interface", () => {
    expect(Object.keys(EncodingChannelSchema.properties as object).sort())
      .toEqual(Object.keys(ENCODING_CHANNEL_KEYS).sort());
  });

  it("EncodingSimpleChannelSchema properties match the EncodingSimpleChannel interface", () => {
    expect(Object.keys(EncodingSimpleChannelSchema.properties as object).sort())
      .toEqual(Object.keys(ENCODING_SIMPLE_CHANNEL_KEYS).sort());
  });

  it("ChartEncodingSchema properties match the ChartEncoding interface", () => {
    expect(Object.keys(ChartEncodingSchema.properties as object).sort())
      .toEqual(Object.keys(CHART_ENCODING_KEYS).sort());
  });

  it("ChartBlockDiscriminant properties match the ChartBlock interface", () => {
    expect(Object.keys(ChartBlockDiscriminant.properties as object).sort())
      .toEqual(Object.keys(CHART_BLOCK_KEYS).sort());
  });
});

// ── Enum-member equality: schema enum vs interface witness ──

describe("drift guard — enum members match their union-type witnesses", () => {
  it("ChartTypeSchema enum matches the ChartType union", () => {
    expect([...(ChartTypeSchema.enum as string[])].sort())
      .toEqual(Object.keys(CHART_TYPE_MEMBERS).sort());
  });

  it("ChartRefreshModeSchema enum matches the ChartRefreshMode union", () => {
    expect([...(ChartRefreshModeSchema.enum as string[])].sort())
      .toEqual(Object.keys(CHART_REFRESH_MODE_MEMBERS).sort());
  });
});

// ── Typed fixtures: positive (tsc-checked) and negative (per constraint) ──

describe("drift guard — typed fixtures validate against their schemas", () => {
  const refreshOk: ChartRefresh = { mode: "auto", intervalMs: 5000 };
  it("a value typed as ChartRefresh validates against ChartRefreshSchema", async () => {
    expect(await validateChartSchema("", ChartRefreshSchema, refreshOk)).toBeNull();
  });

  const channelOk: EncodingChannel = { field: "revenue", type: "quantitative", title: "Revenue" };
  it("a value typed as EncodingChannel validates against EncodingChannelSchema", async () => {
    expect(await validateChartSchema("", EncodingChannelSchema, channelOk)).toBeNull();
  });

  const datasetOk: ChartDataset = { data: [1, 2, 3], label: "series" };
  it("a value typed as ChartDataset validates against ChartDatasetSchema", async () => {
    expect(await validateChartSchema("", ChartDatasetSchema, datasetOk)).toBeNull();
  });

  const chartDataOk: ChartData = { labels: ["A", "B"], datasets: [{ data: [1, 2] }] };
  it("a value typed as ChartData validates against ChartDataSchema", async () => {
    expect(await validateChartSchema("", ChartDataSchema, chartDataOk)).toBeNull();
  });

  const configOk: ChartConfig = { type: "bar", data: { datasets: [{ data: [1, 2] }] } };
  it("a value typed as ChartConfig validates against ChartConfigSchema", async () => {
    expect(await validateChartSchema("", ChartConfigSchema, configOk)).toBeNull();
  });
});

describe("drift guard — negative fixtures fail their constraint", () => {
  it("ChartRefresh.mode outside the enum is rejected", async () => {
    const bad: unknown = { mode: "never" };
    expect(await validateChartSchema("", ChartRefreshSchema, bad)).not.toBeNull();
  });

  it("ChartRefresh.intervalMs non-integer is rejected", async () => {
    const bad: unknown = { mode: "auto", intervalMs: 1.5 };
    expect(await validateChartSchema("", ChartRefreshSchema, bad)).not.toBeNull();
  });

  it("ChartRefresh.intervalMs of 0 is rejected (exclusiveMinimum)", async () => {
    const bad: unknown = { mode: "auto", intervalMs: 0 };
    expect(await validateChartSchema("", ChartRefreshSchema, bad)).not.toBeNull();
  });

  it("EncodingChannel with an unknown key is rejected", async () => {
    const bad: unknown = { field: "x", bogus: true };
    expect(await validateChartSchema("", EncodingChannelSchema, bad)).not.toBeNull();
  });

  it("EncodingChannel missing 'field' is rejected", async () => {
    const bad: unknown = { type: "nominal" };
    expect(await validateChartSchema("", EncodingChannelSchema, bad)).not.toBeNull();
  });

  it("ChartData with 51 datasets is rejected (maxItems: 50)", async () => {
    const bad: unknown = { datasets: Array.from({ length: 51 }, () => ({ data: [1] })) };
    expect(await validateChartSchema("", ChartDataSchema, bad)).not.toBeNull();
  });

  it("ChartDataset missing 'data' is rejected", async () => {
    const bad: unknown = { label: "series" };
    expect(await validateChartSchema("", ChartDatasetSchema, bad)).not.toBeNull();
  });

  it("ChartConfig missing 'type' is rejected", async () => {
    const bad: unknown = { data: { datasets: [] } };
    expect(await validateChartSchema("", ChartConfigSchema, bad)).not.toBeNull();
  });

  it("ChartConfig missing 'data' is rejected", async () => {
    const bad: unknown = { type: "bar" };
    expect(await validateChartSchema("", ChartConfigSchema, bad)).not.toBeNull();
  });
});
