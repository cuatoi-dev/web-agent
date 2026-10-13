import { describe, it, expect } from "vitest";
import { sampleGreetingTool, sampleQuickReplyTool } from "./sample-tools.js";
import { validateJsonSchemaInput } from "./validate-json-schema.js";
import type { ToolContext, JsonSchemaObject } from "./build-tools.js";

function mockCtx(): ToolContext {
  const ac = new AbortController();
  return {
    app: { appName: "test" },
    signal: ac.signal,
  };
}

describe("sampleGreetingTool", () => {
  it("returns a greeting for a valid name", async () => {
    const outcome = await sampleGreetingTool.execute({ name: "Ada" }, mockCtx());
    expect(outcome.content).toBe("Hello, Ada! (from the sample_greeting reference tool)");
    expect(outcome.isError).toBeFalsy();
    expect(outcome.block).toBeUndefined();
  });

  it("schema requires name and is strict", async () => {
    const schema = sampleGreetingTool.inputSchema as JsonSchemaObject;
    expect(await validateJsonSchemaInput("sample_greeting", schema, {})).not.toBeNull();
    expect(await validateJsonSchemaInput("sample_greeting", schema, { name: "x", extra: 1 })).not.toBeNull();
    expect(await validateJsonSchemaInput("sample_greeting", schema, { name: "x" })).toBeNull();
  });
});

describe("sampleQuickReplyTool", () => {
  it("emits a buttons block from choices", async () => {
    const outcome = await sampleQuickReplyTool.execute(
      { question: "Pick one", choices: ["A", "B"] },
      mockCtx()
    );
    expect(outcome.block?.type).toBe("buttons");
    expect(outcome.block).toEqual({
      type: "buttons",
      options: [
        { label: "A", prompt: "A" },
        { label: "B", prompt: "B" },
      ],
    });
    expect(outcome.content).toContain("2 choice(s)");
    expect(outcome.isError).toBeFalsy();
  });

  it("schema enforces 1..6 choices", async () => {
    const schema = sampleQuickReplyTool.inputSchema as JsonSchemaObject;
    expect(
      await validateJsonSchemaInput("sample_quick_reply", schema, { question: "q", choices: [] }),
    ).not.toBeNull();
    expect(
      await validateJsonSchemaInput("sample_quick_reply", schema, {
        question: "q",
        choices: ["1", "2", "3", "4", "5", "6", "7"],
      }),
    ).not.toBeNull();
    expect(
      await validateJsonSchemaInput("sample_quick_reply", schema, { question: "q", choices: ["1", "2", "3"] }),
    ).toBeNull();
  });
});
