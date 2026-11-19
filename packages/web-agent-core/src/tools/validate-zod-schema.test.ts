import { describe, it, expect } from "vitest";
import { z } from "zod";
import { validateZodInput } from "./validate-zod-schema.js";
import { schemaViolation } from "./error-messages.js";

// These tool schemas moved to JSON Schema (validated by ajv, not
// this module — see validate-json-schema.test.ts). validateZodInput() is
// still exercised generically here against equivalent hand-authored zod
// schemas, so this file keeps proving the same behaviors (strict mode,
// required fields, enum, numeric ranges) it always did.
const clickSchema = z.object({ ref: z.string() }).strict();
const snapshotPageSchema = z.object({ scope: z.string().optional() }).strict();
const queryStateSchema = z
  .object({
    path: z.string(),
    keys_only: z.boolean().optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();
const waitForSchema = z
  .object({
    condition: z.enum(["dom_idle", "text_present", "state_path_truthy"]),
    timeout_ms: z.number().int().min(100).max(15000).optional(),
  })
  .strict();
const fillSchema = z.object({ ref: z.string(), value: z.string() }).strict();
const selectOptionSchema = z.object({ ref: z.string(), option: z.string() }).strict();
const seeSchema = z.object({ ref: z.string().optional() }).strict();
const waitSchema = z.object({ seconds: z.number().int().min(1).max(30) }).strict();
const getFieldDetailsSchema = z
  .object({
    source: z.string(),
    filter: z.string().optional(),
    offset: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).max(500).optional(),
  })
  .strict();
const sampleFieldValuesSchema = z
  .object({
    source: z.string(),
    field: z.string(),
    limit: z.number().int().min(1).max(500).optional(),
  })
  .strict();

describe("validateZodInput", () => {
  it("click — missing ref returns schema-violation message", () => {
    const res = validateZodInput("click", clickSchema, {});
    expect(res).toBe("Invalid input for click: ref: Required.");
  });

  it("click — valid ref returns null", () => {
    const res = validateZodInput("click", clickSchema, { ref: "7" });
    expect(res).toBeNull();
  });

  it("snapshot_page — rejects unknown key in strict mode", () => {
    const res = validateZodInput("snapshot_page", snapshotPageSchema, {
      scope: "1",
      bogus: true,
    });
    expect(res).toMatch(/^Invalid input for snapshot_page:/);
    expect(res).toContain("Unrecognized key(s) in object: 'bogus'");
  });

  it("query_state — limit over 100 rejected", () => {
    const res = validateZodInput("query_state", queryStateSchema, {
      path: "$.x",
      limit: 999,
    });
    expect(res).toContain("limit: Number must be less than or equal to 100");
  });

  it("query_state — valid input accepted", () => {
    const res = validateZodInput("query_state", queryStateSchema, {
      path: "$.x",
      limit: 50,
      keys_only: true,
    });
    expect(res).toBeNull();
  });

  it("wait_for — invalid enum value rejects", () => {
    const res = validateZodInput("wait_for", waitForSchema, {
      condition: "invalid",
    });
    expect(res).toContain("condition: Invalid enum value");
  });

  it("wait_for — timeout_ms out of range rejected", () => {
    const res = validateZodInput("wait_for", waitForSchema, {
      condition: "dom_idle",
      timeout_ms: 3600000,
    });
    expect(res).toContain("timeout_ms: Number must be less than or equal to 15000");
  });

  it("wait_for — valid input accepted", () => {
    const res = validateZodInput("wait_for", waitForSchema, {
      condition: "dom_idle",
      timeout_ms: 5000,
    });
    expect(res).toBeNull();
  });

  it("fill — ref and value both required", () => {
    const r1 = validateZodInput("fill", fillSchema, { ref: "3" });
    expect(r1).toContain("value: Required");
    const r2 = validateZodInput("fill", fillSchema, {
      ref: "3",
      value: "test",
    });
    expect(r2).toBeNull();
  });

  it("select_option — ref and option both required", () => {
    const r1 = validateZodInput("select_option", selectOptionSchema, {
      ref: "5",
    });
    expect(r1).not.toBeNull();
    const r2 = validateZodInput("select_option", selectOptionSchema, {
      ref: "5",
      option: "BUY",
    });
    expect(r2).toBeNull();
  });

  it("see — optional ref accepted, rejects unknown key", () => {
    expect(validateZodInput("see", seeSchema, {})).toBeNull();
    expect(validateZodInput("see", seeSchema, { ref: "7" })).toBeNull();
    expect(
      validateZodInput("see", seeSchema, { ref: "1", bogus: true }),
    ).not.toBeNull();
  });

  it("wait — validates range and rejects unknown key", () => {
    const r0 = validateZodInput("wait", waitSchema, { seconds: 0 });
    expect(r0).toContain("greater than or equal to 1");

    const r31 = validateZodInput("wait", waitSchema, { seconds: 31 });
    expect(r31).toContain("less than or equal to 30");

    const r5 = validateZodInput("wait", waitSchema, { seconds: 5 });
    expect(r5).toBeNull();

    const rBogus = validateZodInput("wait", waitSchema, {
      seconds: 5,
      bogus: true,
    });
    expect(rBogus).not.toBeNull();
  });

  it("get_field_details — requires source and accepts filter/offset/limit", () => {
    const r1 = validateZodInput("get_field_details", getFieldDetailsSchema, {});
    expect(r1).toContain("source: Required");

    const r2 = validateZodInput("get_field_details", getFieldDetailsSchema, {
      source: "orders",
      filter: "status",
      offset: 0,
      limit: 10,
    });
    expect(r2).toBeNull();
  });

  it("sample_field_values — requires source and field and accepts limit", () => {
    expect(
      validateZodInput("sample_field_values", sampleFieldValuesSchema, {
        source: "orders",
      }),
    ).not.toBeNull();
    expect(
      validateZodInput("sample_field_values", sampleFieldValuesSchema, {
        field: "status",
      }),
    ).not.toBeNull();
    expect(
      validateZodInput("sample_field_values", sampleFieldValuesSchema, {
        source: "orders",
        field: "status",
        limit: 5,
      }),
    ).toBeNull();
  });

  it("nested path is preserved", () => {
    const schema = z.object({
      config: z.object({
        rows: z.array(z.number()),
      }),
    });
    const res = validateZodInput("chart", schema, { config: { rows: ["x"] } });
    expect(res).toContain("config.rows.0: Expected number, received string");
  });

  it("union is expanded", () => {
    const schema = z.object({
      wait: z.union([z.literal(30), z.literal(120)]),
    });
    const res = validateZodInput("t", schema, { wait: 60 });
    expect(res).toContain("30");
    expect(res).toContain("120");
    expect(res).not.toBe("Invalid input for t: wait: Invalid input.");
  });

  it("multiple issues are joined with semicolon and space", () => {
    const schema = z.object({ a: z.string(), b: z.number() }).strict();
    const res = validateZodInput("t", schema, {});
    expect(res).toBe("Invalid input for t: a: Required; b: Required.");
  });

  it("duplicate lines are collapsed", () => {
    const schema = z.union([
      z.object({ a: z.string() }),
      z.object({ a: z.string() }),
    ]);
    const res = validateZodInput("t", schema, {});
    expect(res).toBe("Invalid input for t: a: Required.");
  });

  it("the message uses the shared schemaViolation builder", () => {
    const schema = z.object({ a: z.string(), b: z.number() }).strict();
    const res = validateZodInput("t", schema, {});
    expect(res).toBe(schemaViolation("t", "a: Required; b: Required"));
  });
});
