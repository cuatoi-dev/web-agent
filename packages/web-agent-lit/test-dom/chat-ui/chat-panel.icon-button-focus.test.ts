// Keyboard focus ring on the default icon button. The panel installs the
// registry stylesheet as a real `<style>`; this spec reads the rule back from
// that element's CSSOM, not from source text.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AgentChatPanel } from "../../src/chat-ui/chat-panel.js";

if (!customElements.get("agent-chat-panel")) {
  customElements.define("agent-chat-panel", AgentChatPanel);
}

describe("AgentChatPanel — icon button keyboard focus ring", () => {
  let element: AgentChatPanel;

  beforeEach(() => {
    element = document.createElement("agent-chat-panel");
    // A real in-memory session; no turn runs, so no network client is reached.
    element.model = "test-model";
    document.body.appendChild(element);
  });

  afterEach(() => {
    element.remove();
  });

  it("the installed registry <style> has a .wa-icon-btn:focus-visible rule with a visible outline", async () => {
    await element.updateComplete;
    const style = element.querySelector<HTMLStyleElement>('style[data-wa-styles="registry"]');
    expect(style).not.toBeNull();
    const rules = Array.from(style!.sheet?.cssRules ?? []) as CSSStyleRule[];
    const rule = rules.find((r) => r.selectorText === ".wa-icon-btn:focus-visible");
    expect(rule).toBeDefined();
    const outline = rule!.style.getPropertyValue("outline");
    expect(outline).not.toBe("");
    expect(outline).not.toMatch(/\bnone\b/);
  });
});
