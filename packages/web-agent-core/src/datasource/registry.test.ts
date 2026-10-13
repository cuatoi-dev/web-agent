import { describe, it, expect } from "vitest";
import { summarizeSource } from "./registry.js";
import type { SourceInfo } from "./types.js";

describe("summarizeSource", () => {
  it("counts one entry per field type and omits types with no field", () => {
    const info: SourceInfo = {
      name: "test-source",
      description: "A test source",
      rowCount: 3,
      fields: [
        { name: "a", type: "string" },
        { name: "b", type: "string" },
        { name: "c", type: "number" },
      ],
    };
    const summary = summarizeSource(info);
    expect(summary.fieldTypes).toEqual({ string: 2, number: 1 });
    expect("boolean" in summary.fieldTypes).toBe(false);
  });

  it("fieldCount equals the number of fields", () => {
    const zero: SourceInfo = { name: "zero", description: "d", rowCount: 0, fields: [] };
    const one: SourceInfo = { name: "one", description: "d", rowCount: 1, fields: [{ name: "a", type: "string" }] };
    const five: SourceInfo = {
      name: "five",
      description: "d",
      rowCount: 5,
      fields: [
        { name: "a", type: "string" },
        { name: "b", type: "number" },
        { name: "c", type: "boolean" },
        { name: "d", type: "date" },
        { name: "e", type: "enum" },
      ],
    };

    expect(summarizeSource(zero).fieldCount).toBe(0);
    expect(summarizeSource(one).fieldCount).toBe(1);
    expect(summarizeSource(five).fieldCount).toBe(5);
  });

  it("carries name, description and rowCount through unchanged", () => {
    const info: SourceInfo = {
      name: "source-1",
      description: "Description 1",
      rowCount: 42,
      fields: [{ name: "x", type: "string" }],
    };
    const summary = summarizeSource(info);
    expect(summary.name).toBe(info.name);
    expect(summary.description).toBe(info.description);
    expect(summary.rowCount).toBe(info.rowCount);
  });

  it("drops fields, enumValues and unsupportedFields", () => {
    const info: SourceInfo = {
      name: "wide",
      description: "Wide source",
      rowCount: 100,
      fields: [
        { name: "status", type: "enum", enumValues: ["active", "inactive"] },
      ],
      unsupportedFields: [{ name: "geo", esType: "geo_point", reason: "unsupported" }],
    };
    const summary = summarizeSource(info);
    expect(Object.keys(summary).sort()).toEqual([
      "description",
      "fieldCount",
      "fieldTypes",
      "name",
      "rowCount",
    ]);
    expect(JSON.stringify(summary)).not.toContain("enumValues");
    expect(JSON.stringify(summary)).not.toContain("unsupportedFields");
  });

  it("copies error when the source reports one", () => {
    const info: SourceInfo = {
      name: "err-src",
      description: "Broken source",
      rowCount: 0,
      fields: [],
      error: "boom",
    };
    const summary = summarizeSource(info);
    expect(summary.error).toBe("boom");
  });

  it("omits error when the source has none", () => {
    const info: SourceInfo = {
      name: "healthy",
      description: "Healthy source",
      rowCount: 10,
      fields: [{ name: "id", type: "number" }],
    };
    const summary = summarizeSource(info);
    expect("error" in summary).toBe(false);
  });

  it("a discovery failure summarises as zero fields with the error", () => {
    const info: SourceInfo = {
      name: "failed",
      description: "Failed source",
      rowCount: 0,
      fields: [],
      error: "Connection timeout — no usable fields could be discovered",
    };
    const summary = summarizeSource(info);
    expect(summary.fieldCount).toBe(0);
    expect(summary.fieldTypes).toEqual({});
    expect(summary.error).toBe("Connection timeout — no usable fields could be discovered");
  });
});
