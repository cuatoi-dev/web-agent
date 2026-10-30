import { describe, it, expect } from "vitest";
import { validateChartSchema, validateChartBlock } from "./validate-chart.js";
import { ChartConfigSchema } from "./chart-schema.js";
import { SHOW_CHART_SCHEMA } from "../tools/show-chart.js";

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

  /** ajv is constructed with `meta: false, validateSchema: false`, so no
   *  meta-schema is compiled. `allErrors` must still hold, and a schema naming
   *  its own `$schema` must validate normally. */
  it("collects every violation of a schema that names its own $schema", async () => {
    const schema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: { a: { type: "number" }, b: { type: "number" } },
      required: ["a", "b"],
    };
    const err = await validateChartSchema("config", schema, { a: "one", b: "two" });
    expect(err).not.toBeNull();
    expect(err).toContain("config.a: ");
    expect(err).toContain("config.b: ");
    await expect(validateChartSchema("config", schema, { a: 1, b: 2 })).resolves.toBeNull();
  });

  /** ajv's default `inlineRefs: true` expands `WRAPPED_SCALAR_SCHEMA` ten times
   *  inside `SHOW_CHART_SCHEMA`, generating 66,928 characters of validator
   *  code. Compiling a hoisted copy keeps the repeated subschema in one
   *  `$defs` slot, and the error paths stay the data's, not the schema's. */
  it("compiles a hoisted copy without mutating the exported schemas", async () => {
    const input = {
      type: "nope",
      data: { labels: 5, datasets: [{ data: [1], borderWidth: "wide" }] },
    };
    const err = await validateChartSchema("config", ChartConfigSchema, input);
    expect(err).toContain("config.type: ");
    expect(err).toContain("config.data.labels: ");
    expect(err).toContain("config.data.datasets.0.borderWidth: ");

    const wrapped = await validateChartSchema("", SHOW_CHART_SCHEMA, {
      config: { type: "bar", data: { datasets: [{ data: [{ x: "one" }] }] } },
    });
    expect(wrapped).toContain("config.data.datasets.0.data.0");
    expect(wrapped).toContain("must have required property 'y'");

    expect("$defs" in ChartConfigSchema).toBe(false);
    expect("$defs" in SHOW_CHART_SCHEMA).toBe(false);
    expect("$defs" in (SHOW_CHART_SCHEMA.properties as Record<string, object>).config).toBe(false);
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
