import { describe, it, expect } from "vitest";
import { catAddToCartScript } from "./mock-scripts";
import type { ProviderCallOptions } from "@cuatoi/web-agent-core";

function makeOpts(messages: ProviderCallOptions["messages"]): ProviderCallOptions {
  return { messages, model: "mock" };
}

function toolResultMsg(toolName: string): ProviderCallOptions["messages"][number] {
  return {
    role: "tool",
    content: [{ type: "tool-result", toolCallId: `call_${toolName}`, toolName, output: "ok" }],
  };
}

describe("catAddToCartScript", () => {
  it("no tool-results → add_to_cart", () => {
    const result = catAddToCartScript(makeOpts([{ role: "user", content: "add 3 p01" }]));
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].name).toBe("add_to_cart");
    expect(result.toolCalls![0].input).toEqual({ productId: "p01", qty: 3 });
    expect(result.text).toBeUndefined();
  });

  it("add_to_cart seen → final text, no toolCalls", () => {
    const result = catAddToCartScript(
      makeOpts([
        { role: "user", content: "add 3 p01" },
        toolResultMsg("add_to_cart"),
      ])
    );
    expect(result.toolCalls).toBeUndefined();
    expect(result.text).toContain("Added 3");
    expect(result.finishReason).toBe("stop");
  });

  it("idempotent: same messages → same result", () => {
    const opts = makeOpts([{ role: "user", content: "add 3 p01" }]);
    const r1 = catAddToCartScript(opts);
    const r2 = catAddToCartScript(opts);
    expect(r1).toEqual(r2);
  });
});
