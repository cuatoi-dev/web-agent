import { describe, it, expect } from "vitest";
import { validateChartSchema, validateChartBlock } from "./validate-chart.js";
import { ChartConfigSchema } from "./chart-schema.js";

describe("validateChartSchema", () => {
  it("formats an error as config.<dotted-path>: <message> with a prefix", async () => {
    const err = await validateChartSchema("config", ChartConfigSchema, { type: "donut", data: { datasets: [] } });
    expect(err).not.toBeNull();
    expect(err).toMatch(/^config\.type: /);
  });

  it("formats an error as <dotted-path>: <message> with no leading dot when prefix is empty", async () => {
    const err = await validateChartSchema("", ChartConfigSchema, { type: "donut", data: { datasets: [] } });
    expect(err).not.toBeNull();
    expect(err).toMatch(/^type: /);
    expect(err).not.toMatch(/^\./);
  });

  it("a root-level violation yields config.root: <message>", async () => {
    const err = await validateChartSchema("config", ChartConfigSchema, "not an object");
    expect(err).not.toBeNull();
    expect(err).toMatch(/^config\.root: /);
  });

  it("joins multiple violations with '; '", async () => {
    const err = await validateChartSchema("config", ChartConfigSchema, {});
    expect(err).not.toBeNull();
    expect(err).toContain("; ");
  });

  it("returns null on a valid input", async () => {
    const err = await validateChartSchema(
      "config",
      ChartConfigSchema,
      { type: "bar", data: { datasets: [{ data: [1, 2] }] } },
    );
    expect(err).toBeNull();
  });
});

describe("validateChartBlock", () => {
  it("returns { ok: true, value } on accept", async () => {
    const res = await validateChartBlock({ type: "chart", config: { type: "bar", data: { datasets: [] } } });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.type).toBe("chart");
  });

  it("returns { ok: false, message } on reject", async () => {
    const res = await validateChartBlock({ type: "chart" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(typeof res.message).toBe("string");
  });
});
