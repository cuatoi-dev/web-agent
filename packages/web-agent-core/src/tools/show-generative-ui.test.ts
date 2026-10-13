import { describe, it, expect } from "vitest";
import { runShowGenerativeUi, SHOW_GENERATIVE_UI_SCHEMA } from "./show-generative-ui.js";
import { validateJsonSchemaInput } from "./validate-json-schema.js";

describe("SHOW_GENERATIVE_UI_SCHEMA", () => {
  it("accepts valid buttons input", async () => {
    const result = await validateJsonSchemaInput("show_generative_ui", SHOW_GENERATIVE_UI_SCHEMA, {
      type: "buttons",
      options: [{ label: "Yes", prompt: "yes please" }],
    });
    expect(result).toBeNull();
  });

  it("accepts valid form input", async () => {
    const result = await validateJsonSchemaInput("show_generative_ui", SHOW_GENERATIVE_UI_SCHEMA, {
      type: "form",
      id: "f1",
      fields: [{ kind: "text", name: "email", label: "Email" }],
    });
    expect(result).toBeNull();
  });

  it("rejects unknown keys via strict mode", async () => {
    const result = await validateJsonSchemaInput("show_generative_ui", SHOW_GENERATIVE_UI_SCHEMA, {
      type: "buttons",
      options: [],
      extra: "bad",
    });
    expect(result).not.toBeNull();
  });
});

describe("runShowGenerativeUi", () => {
  it("valid buttons block — returns block with type buttons and ui rendered content", async () => {
    const outcome = await runShowGenerativeUi({
      type: "buttons",
      options: [{ label: "Yes", prompt: "yes please" }],
    });
    expect(outcome.content).toBe("ui rendered");
    expect(outcome.isError).toBeFalsy();
    expect(outcome.block?.type).toBe("buttons");
  });

  it("valid form block — returns block with type form", async () => {
    const outcome = await runShowGenerativeUi({
      type: "form",
      id: "f1",
      fields: [{ kind: "text", name: "email", label: "Email" }],
    });
    expect(outcome.content).toBe("ui rendered");
    expect(outcome.isError).toBeFalsy();
    expect(outcome.block?.type).toBe("form");
  });

  it("invalid type (chart) — returns isError with precise error", async () => {
    const outcome = await runShowGenerativeUi({ type: "chart", spec: {} });
    expect(outcome.isError).toBe(true);
    expect(outcome.content).toMatch(/anyOf|type|options|id/i);
  });

  it("buttons missing options — returns error containing options", async () => {
    const outcome = await runShowGenerativeUi({ type: "buttons" });
    expect(outcome.isError).toBe(true);
    expect(outcome.content).toContain("options");
  });

  it("form field with bad kind — returns error containing fields or kind", async () => {
    const outcome = await runShowGenerativeUi({ type: "form", id: "f", fields: [{ kind: "slider", name: "x", label: "X" }] });
    expect(outcome.isError).toBe(true);
    expect(outcome.content).toMatch(/fields|kind/);
  });

  it("buttons over max (7) — returns error mentioning limit", async () => {
    const options = Array.from({ length: 7 }, (_, i) => ({
      label: `Option ${i}`,
      prompt: `pick ${i}`,
    }));
    const outcome = await runShowGenerativeUi({ type: "buttons", options });
    expect(outcome.isError).toBe(true);
    expect(outcome.content).toMatch(/options|max|limit/);
  });
});
