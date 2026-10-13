import type { MockResponse } from "@cuatoi/web-agent-core";
import type { ProviderCallOptions } from "@cuatoi/web-agent-core";

/**
 * Self-contained mock script for the cat-store add-to-cart tool loop.
 * Single-step sequence: add_to_cart → final text.
 * State-driven on tool-results in opts.messages — not call-index.
 * Self-contained (no closures) so .toString() injection into the browser works.
 */
export const catAddToCartScript: (opts: ProviderCallOptions) => MockResponse = function catAddToCartScript(opts: ProviderCallOptions): MockResponse {
  const seen = new Set<string>();
  for (const msg of opts.messages) {
    if (msg.role === "tool" && Array.isArray(msg.content)) {
      for (const part of msg.content as Array<{ type: string; toolName: string }>) {
        if (part.type === "tool-result") seen.add(part.toolName);
      }
    }
  }

  if (!seen.has("add_to_cart")) {
    return {
      toolCalls: [{ id: "call_add_to_cart", name: "add_to_cart", input: { productId: "p01", qty: 3 } }],
    };
  }
  return {
    text: "Added 3 to your cart.",
    finishReason: "stop",
  };
};
