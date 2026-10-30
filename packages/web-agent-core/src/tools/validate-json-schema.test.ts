import { describe, it, expect } from "vitest";
import { validateJsonSchemaInput } from "./validate-json-schema.js";

describe("validateJsonSchemaInput", () => {
  const SCHEMA = {
    type: "object",
    properties: {
      customer: { type: "string" },
      total: { type: "number" },
    },
    additionalProperties: false,
  } as const;

  it("returns null for valid input", async () => {
    await expect(
      validateJsonSchemaInput("t", SCHEMA, { customer: "Ann" }),
    ).resolves.toBeNull();
  });

  it("returns the design's message shape for invalid input", async () => {
    await expect(
      validateJsonSchemaInput("t", SCHEMA, { total: "twelve" }),
    ).resolves.toBe("Invalid input for t: data/total must be number.");
  });

  it("reuses the compiled validator for the same schema object", async () => {
    const schemaRef = {
      type: "object",
      properties: { a: { type: "number" } },
    } as const;
    const res1 = await validateJsonSchemaInput("t", schemaRef, { a: 1 });
    const res2 = await validateJsonSchemaInput("t", schemaRef, { a: "one" });
    expect(res1).toBeNull();
    expect(res2).toBe("Invalid input for t: data/a must be number.");
  });

  /** ajv's default `inlineRefs: true` expands a repeated `$ref` in place; on a
   *  three-level filter schema that is an exponential expansion. The compile
   *  step hoists a repeated object into `$defs` on a COPY, so the caller's
   *  schema stays exactly as written — `wrapExecutor` and `validateDataQuery`
   *  share it by identity. */
  it("hoists a repeated subschema at compile time without touching the caller's schema", async () => {
    const shared = {
      type: "object",
      properties: { n: { type: "number" } },
      required: ["n"],
      additionalProperties: false,
    };
    const schema = {
      type: "object" as const,
      properties: { a: shared, b: shared, c: shared },
      additionalProperties: false,
    };
    await expect(
      validateJsonSchemaInput("t", schema, { a: { n: 1 }, b: { n: 2 }, c: { n: 3 } }),
    ).resolves.toBeNull();
    await expect(
      validateJsonSchemaInput("t", schema, { a: { n: "one" }, b: { n: 2 }, c: { n: 3 } }),
    ).resolves.toBe("Invalid input for t: data/a/n must be number.");
    expect("$defs" in schema).toBe(false);
    expect(schema.properties.a).toBe(shared);
  });

  /** ajv is constructed with `meta: false, validateSchema: false`, so no
   *  meta-schema is ever compiled. A schema that names its own `$schema` must
   *  still validate normally — the keyword is ignored, not rejected. */
  it("validates a schema that names its own $schema", async () => {
    const schema = {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: { n: { type: "number" } },
      required: ["n"],
    } as const;
    await expect(validateJsonSchemaInput("t", schema, { n: 2 })).resolves.toBeNull();
    await expect(validateJsonSchemaInput("t", schema, { n: "two" })).resolves.toBe(
      "Invalid input for t: data/n must be number.",
    );
    await expect(validateJsonSchemaInput("t", schema, {})).resolves.toBe(
      "Invalid input for t: data must have required property 'n'.",
    );
  });

  it("unknown format keywords do not fail validation", async () => {
    const formatSchema = {
      type: "object",
      properties: { e: { type: "string", format: "email" } },
    } as const;
    await expect(
      validateJsonSchemaInput("t", formatSchema, { e: "nope" }),
    ).resolves.toBeNull();
  });
});
