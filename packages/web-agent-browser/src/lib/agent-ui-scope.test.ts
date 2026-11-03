// 001 — the in-page DOM tools treat a site's own chat agent as page content and
// skip only the extension's own bubble. The selector is the one content.ts
// gives domTools, so this file pins the rule at its source.
import { describe, it, expect, beforeEach } from "vitest";
import { domTools } from "@cuatoi/web-agent-dom";
import type { ToolContext } from "@cuatoi/web-agent-core";
import { EXTENSION_UI_ATTR, EXTENSION_UI_SELECTOR } from "./constants";

const ctx = { app: { appName: "test" } } as unknown as ToolContext;

/** An element with an open shadow root, appended to the body. Mirrors
 *  cat-store: <cat-agent-widget> -> shadow root -> <web-agent-bubble> ->
 *  shadow root -> button. */
function shadowHost(tag: string, html: string): { host: HTMLElement; root: ShadowRoot } {
  const host = document.createElement(tag);
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = html;
  return { host, root };
}

async function snapshot(): Promise<string> {
  const [provider] = domTools({ agentUiSelector: EXTENSION_UI_SELECTOR });
  const defs = await provider.load();
  const tool = defs.find((d) => d.name === "snapshot_page");
  if (!tool) throw new Error("snapshot_page is missing from domTools");
  const out = await tool.execute({}, ctx);
  return out.content;
}

describe("in-page snapshot and agent UI", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("lists the launcher inside the site's own <web-agent-bubble>", async () => {
    const wrapper = document.createElement("div");
    wrapper.setAttribute("data-agent-ui", "true");
    const widget = shadowHost("cat-agent-widget", "");
    const siteBubble = shadowHost("web-agent-bubble", '<button aria-label="Open chat"><i>chat</i></button>');
    widget.root.appendChild(siteBubble.host);
    wrapper.appendChild(widget.host);
    document.body.appendChild(wrapper);

    const text = await snapshot();
    expect(text).toContain('"Open chat"');
  });

  it("lists nothing inside the extension's own bubble", async () => {
    document.body.innerHTML = '<main><button id="a">Alpha</button></main>';
    const own = shadowHost("web-agent-bubble", '<button aria-label="Session history">history</button>');
    own.host.setAttribute(EXTENSION_UI_ATTR, "true");
    document.body.appendChild(own.host);

    const text = await snapshot();
    expect(text).toContain('"Alpha"');
    expect(text).not.toContain('"Session history"');
  });
});
