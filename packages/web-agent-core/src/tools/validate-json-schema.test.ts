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
