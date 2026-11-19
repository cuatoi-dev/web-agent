// tool-provider.test.ts — vitest + jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("html-to-image", () => ({
  toPng: vi.fn(() => Promise.resolve("data:image/png;base64,AAA=")),
}));
vi.mock("@cuatoi/web-agent-core", async (orig) => ({
  ...(await orig<typeof import("@cuatoi/web-agent-core")>()),
  downscaleToolImage: vi.fn((u: string) => Promise.resolve(u)),
}));

import type { ToolContext } from "@cuatoi/web-agent-core";
import { domTools } from "./tool-provider.js";

function mockCtx(overrides?: Partial<ToolContext>): ToolContext {
  const ac = new AbortController();
  return {
    app: { appName: "test" },
    signal: ac.signal,
    ...overrides,
  };
}

function setupHtml(html: string) {
  document.body.innerHTML = html;
}

describe("domTools", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("returns a single ToolProvider named 'dom'", () => {
    const providers = domTools();
    expect(providers).toHaveLength(1);
    expect(providers[0].name).toBe("dom");
    expect(providers[0].required).toBe(true);
  });

  it("load() returns snapshot_page, query_state, click, fill, select_option, wait_for, see", async () => {
    const [provider] = domTools();
    const defs = await provider.load();
    const names = defs.map((d) => d.name).sort();
    expect(names).toEqual(
      ["click", "fill", "query_state", "select_option", "snapshot_page", "wait_for", "see"].sort(),
    );
  });

  it("images: false omits the see tool", async () => {
    const [provider] = domTools({ images: false });
    const defs = await provider.load();
    expect(defs.map((d) => d.name)).not.toContain("see");
  });

  it("exposes the point-at-elements picker on attachmentProviders", () => {
    const [provider] = domTools();
    expect(provider.attachmentProviders).toHaveLength(1);
    expect(provider.attachmentProviders?.[0].id).toBe("picker");
  });

  it("agentUiSelector excludes the agent's own drawer from a snapshot", async () => {
    setupHtml('<button id="a">A</button><div data-agent-ui><button id="b">B</button></div>');
    const [provider] = domTools({ agentUiSelector: "[data-agent-ui]" });
    const defs = await provider.load();
    const snapshot = defs.find((d) => d.name === "snapshot_page")!;
    const out = await snapshot.execute({}, mockCtx());
    expect(out.content).toContain('"A"');
    expect(out.content).not.toContain('"B"');
  });

  it("custom agentUiSelector excludes a different drawer instead", async () => {
    setupHtml('<button id="a">A</button><div data-custom-ui><button id="b">B</button></div>');
    const [provider] = domTools({ agentUiSelector: "[data-custom-ui]" });
    const defs = await provider.load();
    const snapshot = defs.find((d) => d.name === "snapshot_page")!;
    const out = await snapshot.execute({}, mockCtx());
    expect(out.content).toContain('"A"');
    expect(out.content).not.toContain('"B"');
  });

  it("snapshotMaxChars truncates a snapshot at the given size", async () => {
    const items = Array.from({ length: 200 }, (_, i) => `<button id="b${i}">Button number ${i}</button>`).join("");
    setupHtml(`<main>${items}</main>`);
    const [defaultProvider] = domTools();
    const [smallProvider] = domTools({ snapshotMaxChars: 200 });
    const defaultOut = await (await defaultProvider.load())
      .find((d) => d.name === "snapshot_page")!
      .execute({}, mockCtx());
    const smallOut = await (await smallProvider.load())
      .find((d) => d.name === "snapshot_page")!
      .execute({}, mockCtx());
    expect(smallOut.content.length).toBeLessThan(defaultOut.content.length);
    expect(smallOut.content).toContain("TRUNCATED");
  });

  it("query_state's promptSnippet includes the state-shape summary", async () => {
    const [provider] = domTools({ getState: () => ({ cart: { items: 3 }, user: null }) });
    const defs = await provider.load();
    const queryState = defs.find((d) => d.name === "query_state")!;
    expect(queryState.promptSnippet).toContain("State shape summary:");
    expect(queryState.promptSnippet).toContain("cart");
  });

  it("query_state reads from the configured getState", async () => {
    const [provider] = domTools({ getState: () => ({ cart: { items: 3 } }) });
    const defs = await provider.load();
    const queryState = defs.find((d) => d.name === "query_state")!;
    const out = await queryState.execute({ path: "$.cart.items" }, mockCtx());
    expect(out.content).toContain("3");
  });

  it("click executes against the package's own DomAdapter", async () => {
    setupHtml('<button id="btn">Click me</button>');
    const [provider] = domTools();
    const defs = await provider.load();
    await defs.find((d) => d.name === "snapshot_page")!.execute({}, mockCtx());
    const click = defs.find((d) => d.name === "click")!;
    const out = await click.execute({ ref: "1" }, mockCtx());
    expect(out.content).toContain("Clicked");
  });

function stubRect(el: Element, width: number, height: number): void {
  (el as HTMLElement).getBoundingClientRect = () =>
    ({ x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, width, height,
       toJSON: () => ({}) });
}

  it("see returns an image payload through the generic tool-image path", async () => {
    setupHtml("<main><p>Hello</p></main>");
    const [provider] = domTools();
    const defs = await provider.load();
    const see = defs.find((d) => d.name === "see")!;
    const out = await see.execute({}, mockCtx());
    expect(out.content).toBe(
      "Screenshot captured. A screenshot has been added as a user image message for visual analysis.",
    );
    expect(out.images).toEqual([{ dataUrl: "data:image/png;base64,AAA=", mediaType: "image/png" }]);
    // The field must be the generic name, no screenshot-named field left.
    expect((out as Record<string, unknown>)._screenshot).toBeUndefined();
  });

  it("see appends warning to content when scoped element is hidden but still returns image", async () => {
    setupHtml("<div id='x'><button id='btn'>Buy now</button></div>");
    const btn = document.getElementById("btn")!;
    stubRect(btn, 60, 22);

    const [provider] = domTools();
    const defs = await provider.load();
    await defs.find((d) => d.name === "snapshot_page")!.execute({}, mockCtx());
    btn.style.visibility = "hidden";
    const see = defs.find((d) => d.name === "see")!;
    const out = await see.execute({ ref: "1" }, mockCtx());

    expect(out.content).toBe(
      'Screenshot captured. A screenshot has been added as a user image message for visual analysis. Warning: ref 1 ("Buy now") is hidden, so this screenshot may not contain the element. Treat what you see as the surrounding page, not as the element.',
    );
    expect(out.images?.[0]?.dataUrl).toBe("data:image/png;base64,AAA=");
  });

  it("pickerAttachmentProvider receives the same DomAdapter as the tools", async () => {
    setupHtml('<button id="btn">Click me</button>');
    const [provider] = domTools();
    const defs = await provider.load();
    await defs.find((d) => d.name === "snapshot_page")!.execute({}, mockCtx());

    const btn = document.getElementById("btn")!;
    const picker = provider.attachmentProviders![0];
    void picker.pick();
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    const res = await picker.onUserPrompt({ parts: [{ type: "text", text: "Prose" }] });
    expect(res).toBeDefined();
    expect(res!.parts[1].text).toContain("button \"Click me\"");
  });

  // The "ask"-tier confirm gate moved here from lit's onPreTool hook —
  // the DOM package is the only layer left that knows the ref's permission.
  describe("confirmInteraction", () => {
    it("is not consulted, and the click runs, for an allow-tier ref", async () => {
      setupHtml('<button id="btn">Add</button>');
      const confirmInteraction = vi.fn(() => Promise.resolve(true));
      const [provider] = domTools({ confirmInteraction });
      const defs = await provider.load();
      await defs.find((d) => d.name === "snapshot_page")!.execute({}, mockCtx());
      const out = await defs.find((d) => d.name === "click")!.execute({ ref: "1" }, mockCtx());
      expect(confirmInteraction).not.toHaveBeenCalled();
      expect(out.content).toContain("Clicked");
    });

    it("is consulted for an ask-tier ref; accept lets click run", async () => {
      setupHtml('<button id="btn" data-agent-permission="ask" data-agent-permission-reason="destructive">Remove item</button>');
      const confirmInteraction = vi.fn(() => Promise.resolve(true));
      const [provider] = domTools({ confirmInteraction });
      const defs = await provider.load();
      await defs.find((d) => d.name === "snapshot_page")!.execute({}, mockCtx());
      const out = await defs.find((d) => d.name === "click")!.execute({ ref: "1" }, mockCtx());
      expect(confirmInteraction).toHaveBeenCalledWith(
        expect.objectContaining({ action: "click", ref: "1", name: "Remove item", reason: "destructive" }),
      );
      expect(out.content).toContain("Clicked");
    });

    it("reject stops the click and returns a not-confirmed message", async () => {
      setupHtml('<button id="btn" data-agent-permission="ask">Remove item</button>');
      const confirmInteraction = vi.fn(() => Promise.resolve(false));
      const [provider] = domTools({ confirmInteraction });
      const defs = await provider.load();
      await defs.find((d) => d.name === "snapshot_page")!.execute({}, mockCtx());
      const out = await defs.find((d) => d.name === "click")!.execute({ ref: "1" }, mockCtx());
      expect(out.content).toBe(
        'Action "click" on [1] "Remove item" was not confirmed by the user; not performed.',
      );
    });

    it("without confirmInteraction, an ask-tier click still runs (no gate wired)", async () => {
      setupHtml('<button id="btn" data-agent-permission="ask">Remove item</button>');
      const [provider] = domTools();
      const defs = await provider.load();
      await defs.find((d) => d.name === "snapshot_page")!.execute({}, mockCtx());
      const out = await defs.find((d) => d.name === "click")!.execute({ ref: "1" }, mockCtx());
      expect(out.content).toContain("Clicked");
    });

    it("a block-tier ref is still refused by the adapter itself, confirmInteraction or not", async () => {
      setupHtml('<button id="btn" data-agent-permission="block">Delete account</button>');
      const confirmInteraction = vi.fn(() => Promise.resolve(true));
      const [provider] = domTools({ confirmInteraction });
      const defs = await provider.load();
      await defs.find((d) => d.name === "snapshot_page")!.execute({}, mockCtx());
      const out = await defs.find((d) => d.name === "click")!.execute({ ref: "1" }, mockCtx());
      expect(confirmInteraction).not.toHaveBeenCalled();
      expect(out.content).toContain("Blocked by interaction policy");
    });
  });
});
