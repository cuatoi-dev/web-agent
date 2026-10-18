import { describe, it, expect } from "vitest";
import type { ToolContext } from "@cuatoi/web-agent-core";
import { createPageScreenshotTool } from "./page-screenshot-tool";
import { createHelperWorlds } from "./debugger-helper-world";
import { fakeChrome, SHOT } from "./test-screenshot-cdp";
import type { FakeChromeOptions } from "./test-screenshot-cdp.types";
import { testVfs } from "./test-vfs";

const ctx = (): ToolContext => ({ app: {}, signal: new AbortController().signal });

async function setup(options: FakeChromeOptions) {
  const chrome = await fakeChrome(options);
  const vfs = testVfs();
  const helper = createHelperWorlds(chrome.session, () => Promise.resolve("SOURCE"));
  const tool = createPageScreenshotTool({ vfs, debuggerSession: chrome.session, helper });
  const run = (input: Record<string, unknown>) => tool.execute({ tabId: 1, save_to: "/tmp/s.png", ...input }, ctx());
  return { ...chrome, vfs, tool, run };
}

const NODES = {
  10: { x: 100, y: 50, width: 80, height: 30 },
  11: { x: 100, y: 3000, width: 80, height: 30 },
  12: { x: 0, y: 600, width: 50, height: 20 },
  13: { x: 700, y: 500, width: 200, height: 40 },
};

describe("page_screenshot — target exclusivity", () => {
  const pairs: [string, Record<string, unknown>][] = [
    ["ref+css", { ref: "10", css: "a" }],
    ["ref+xpath", { ref: "10", xpath: "//a" }],
    ["ref+fullPage", { ref: "10", fullPage: true }],
    ["css+xpath", { css: "a", xpath: "//a" }],
    ["css+fullPage", { css: "a", fullPage: true }],
    ["xpath+fullPage", { xpath: "//a", fullPage: true }],
  ];
  it.each(pairs)("%s returns the conflict error and captures nothing", async (_name, input) => {
    const t = await setup({ nodes: NODES });
    const result = await t.run(input);
    expect(result).toEqual({ content: "Use only one of ref, css, xpath or fullPage.", isError: true });
    expect(t.events).toEqual([]);
    expect(await t.vfs.get("/tmp/s.png")).toBeUndefined();
  });

  it("treats fullPage:false as no target", async () => {
    const t = await setup({ nodes: NODES, selections: { "css:a": { ok: true, count: 1, node: 10 } } });
    const result = await t.run({ css: "a", fullPage: false });
    expect(result.isError).toBeUndefined();
  });

  it("accepts highlight arrays and rejects non-string entries in the schema", async () => {
    const t = await setup({ nodes: NODES });
    const schema = t.tool.inputSchema as { safeParse(v: unknown): { success: boolean } };
    expect(schema.safeParse({ tabId: 1, highlight: ["1", "f1:2"] }).success).toBe(true);
    expect(schema.safeParse({ tabId: 1, highlight: [1] }).success).toBe(false);
  });
});

describe("page_screenshot — css and xpath targets", () => {
  it("clips to the first match like a ref, names the selector and reports the count before Saved", async () => {
    const t = await setup({
      nodes: NODES,
      scrollX: 5,
      scrollY: 20,
      selections: { "css:.card": { ok: true, count: 3, node: 10 } },
    });
    const result = await t.run({ css: ".card" });
    expect(t.calls.find((c) => c.method === "Page.captureScreenshot")?.params).toEqual({
      format: "png",
      captureBeyondViewport: true,
      clip: { x: 105, y: 70, width: 80, height: 30, scale: 1 },
    });
    expect(result.content?.split("\n")).toEqual([
      "Screenshot of CSS .card, 80 × 30.",
      "3 elements match; captured the first.",
      "Saved /tmp/s.png",
    ]);
    expect((await t.vfs.get("/tmp/s.png"))?.content).toBe(SHOT);
    expect(result.images).toHaveLength(1);
  });

  it("adds no count line for a single xpath match", async () => {
    const t = await setup({ nodes: NODES, selections: { "xpath://a": { ok: true, count: 1, node: 10 } } });
    const result = await t.run({ xpath: "//a" });
    expect(result.content).toBe("Screenshot of XPath //a, 80 × 30.\nSaved /tmp/s.png");
  });

  it("passes quotes and backticks to the page as arguments, never as source", async () => {
    const t = await setup({ nodes: NODES });
    const hostile = "a[title=\"`${x}'\"]";
    await t.run({ css: hostile });
    const call = t.calls.find((c) => String(c.params?.functionDeclaration).includes("screenshotSelect"));
    expect(call?.params?.arguments).toEqual([{ value: "css" }, { value: hostile }]);
    expect(String(call?.params?.functionDeclaration)).not.toContain(hostile);
  });

  it("returns the page error and saves nothing", async () => {
    const t = await setup({ nodes: NODES, selections: { "css:[": { ok: false, error: "Invalid CSS selector: [" } } });
    const result = await t.run({ css: "[" });
    expect(result).toEqual({ content: "Invalid CSS selector: [", isError: true });
    expect(t.events.filter((e) => e === "capture")).toEqual([]);
    expect(await t.vfs.get("/tmp/s.png")).toBeUndefined();
  });

  it("releases the selection and element objects", async () => {
    const t = await setup({ nodes: NODES, selections: { "css:a": { ok: true, count: 1, node: 10 } } });
    await t.run({ css: "a" });
    expect(t.events).toEqual(expect.arrayContaining(["release sel1", "release el"]));
  });
});

describe("page_screenshot — highlight", () => {
  it("outlines before the capture, restores right after it, and saves after the restore", async () => {
    const t = await setup({ nodes: NODES, selections: { "css:a": { ok: true, count: 1, node: 10 } } });
    const result = await t.run({ css: "a", highlight: ["11"] });
    const order = t.events.filter((e) => /^(outline|capture)/.test(e));
    expect(order).toEqual(["outline-on 11", "capture", "outline-off 11"]);
    expect(result.content?.split("\n").pop()).toBe("Saved /tmp/s.png");
  });

  it("does not touch the page when highlight is absent or empty", async () => {
    const t = await setup({ nodes: NODES });
    await t.run({ highlight: [] });
    expect(t.events.filter((e) => /^(outline|scroll)/.test(e))).toEqual([]);
  });

  it("scrolls the first highlight into view only in viewport mode", async () => {
    const viewport = await setup({ nodes: NODES });
    await viewport.run({ highlight: ["10", "12"] });
    expect(viewport.events.filter((e) => e.startsWith("scroll"))).toEqual(["scroll 10"]);

    const full = await setup({ nodes: NODES });
    await full.run({ fullPage: true, highlight: ["10"] });
    expect(full.events.filter((e) => e.startsWith("scroll"))).toEqual([]);

    const element = await setup({ nodes: NODES, selections: { "css:a": { ok: true, count: 1, node: 12 } } });
    await element.run({ css: "a", highlight: ["10"] });
    expect(element.events.filter((e) => e.startsWith("scroll"))).toEqual([]);
  });

  it("restores a duplicated ref once", async () => {
    const t = await setup({ nodes: NODES });
    await t.run({ highlight: ["10", "10"] });
    expect(t.events.filter((e) => e === "outline-on 10")).toHaveLength(1);
    expect(t.events.filter((e) => e === "outline-off 10")).toHaveLength(1);
  });

  it("warns for a highlight outside a viewport capture, before the Saved line", async () => {
    const t = await setup({ nodes: NODES, viewport: { width: 800, height: 600 } });
    const result = await t.run({ highlight: ["10", "11"] });
    expect(result.content?.split("\n")).toEqual([
      "Viewport screenshot, 800 × 600.",
      "Highlighted element 11 is outside the screenshot.",
      "Saved /tmp/s.png",
    ]);
  });

  it("counts edge contact as outside and a partial overlap as inside", async () => {
    const t = await setup({ nodes: NODES, viewport: { width: 800, height: 600 } });
    const result = await t.run({ highlight: ["10", "12", "13"] });
    // 12 starts at y=600, exactly where the viewport ends: no area. 13 sticks out of the right edge.
    expect(result.content).toContain("Highlighted element 12 is outside the screenshot.");
    expect(result.content).not.toContain("Highlighted element 13");
    expect(result.content).not.toContain("Highlighted element 10 ");
  });

  it("uses the scroll offset: a page-coordinate box is inside a scrolled viewport", async () => {
    const t = await setup({ nodes: { 10: { x: 100, y: 50, width: 80, height: 30 } }, scrollY: 2000 });
    const result = await t.run({ highlight: ["10"] });
    // The box is viewport-relative (y=50) and the viewport sits at pageY 2000, so both are in page space.
    expect(result.content).not.toContain("outside");
  });

  it("warns when an element capture does not contain the highlight", async () => {
    const t = await setup({ nodes: NODES, selections: { "css:a": { ok: true, count: 1, node: 10 } } });
    const result = await t.run({ css: "a", highlight: ["11"] });
    expect(result.content).toContain("Highlighted element 11 is outside the screenshot.");
  });

  it("returns the stale-ref error, restores earlier outlines and captures nothing", async () => {
    const t = await setup({ nodes: NODES });
    const result = await t.run({ highlight: ["10", "99"] });
    expect(result).toEqual({ content: "Ref 99 is no longer on the page. Take a new snapshot.", isError: true });
    expect(t.events.filter((e) => /^(outline|capture)/.test(e))).toEqual(["outline-on 10", "outline-off 10"]);
    expect(await t.vfs.get("/tmp/s.png")).toBeUndefined();
  });

  it("treats a disconnected node as stale", async () => {
    const t = await setup({ nodes: { ...NODES, 10: { ...NODES[10], connected: false } } });
    const result = await t.run({ highlight: ["10"] });
    expect(result.isError).toBe(true);
    expect(result.content).toBe("Ref 10 is no longer on the page. Take a new snapshot.");
    expect(t.events).not.toContain("outline-on 10");
  });
});

describe("page_screenshot — cleanup on failure", () => {
  it("restores when the capture rejects", async () => {
    const t = await setup({ nodes: NODES, captureFails: true });
    const result = await t.run({ highlight: ["10"] });
    expect(result).toEqual({ content: "capture failed", isError: true });
    expect(t.events.filter((e) => /^(outline|capture)/.test(e))).toEqual(["outline-on 10", "capture", "outline-off 10"]);
    expect(await t.vfs.get("/tmp/s.png")).toBeUndefined();
  });

  it("restores when the capture comes back empty", async () => {
    const t = await setup({ nodes: NODES, captureEmpty: true });
    const result = await t.run({ highlight: ["10"] });
    expect(result.isError).toBe(true);
    expect(t.events).toContain("outline-off 10");
  });

  it("restores when measuring a highlight fails", async () => {
    const t = await setup({ nodes: NODES });
    // Node 10 resolves, then its box fails: remove it from the model's reach by deleting after resolve.
    const original = t.api.sendCommand.getMockImplementation();
    t.api.sendCommand.mockImplementation((tabId: number, method: string, params?: Record<string, unknown>, sessionId?: string) =>
      method === "DOM.getBoxModel" ? Promise.reject(new Error("gone")) : original!(tabId, method, params, sessionId),
    );
    const result = await t.run({ highlight: ["10"] });
    expect(result.isError).toBe(true);
    expect(t.events).toContain("outline-off 10");
  });

  it("restores when the scroll fails", async () => {
    const t = await setup({ nodes: NODES });
    const original = t.api.sendCommand.getMockImplementation();
    t.api.sendCommand.mockImplementation((tabId: number, method: string, params?: Record<string, unknown>, sessionId?: string) =>
      String((params?.functionDeclaration as string | undefined) ?? "").includes("screenshotScroll")
        ? Promise.reject(new Error("scroll failed"))
        : original!(tabId, method, params, sessionId),
    );
    const result = await t.run({ highlight: ["10"] });
    expect(result).toEqual({ content: "scroll failed", isError: true });
    expect(t.events).toContain("outline-off 10");
  });

  it("attempts every restore when one rejects, then fails the call without saving", async () => {
    const t = await setup({ nodes: { ...NODES, 11: { ...NODES[11], restoreFails: true } } });
    const result = await t.run({ highlight: ["10", "11", "12"] });
    expect(result.isError).toBe(true);
    expect(result.content).toBe("Outline cleanup failed: restore failed for 11");
    expect(result.images).toBeUndefined();
    expect(t.events.filter((e) => e.startsWith("outline-off")).sort()).toEqual(["outline-off 10", "outline-off 11", "outline-off 12"]);
    expect(await t.vfs.get("/tmp/s.png")).toBeUndefined();
  });

  it("keeps the primary error and appends the cleanup failure", async () => {
    const t = await setup({ nodes: { ...NODES, 10: { ...NODES[10], restoreFails: true } }, captureFails: true });
    const result = await t.run({ highlight: ["10"] });
    expect(result.content).toBe("capture failed\nOutline cleanup failed: restore failed for 10");
  });

  it("restores before a failing save and sends no image", async () => {
    const failing = await setup({ nodes: NODES });
    const failTool = createPageScreenshotTool({
      vfs: { ...failing.vfs, write: () => Promise.reject(new Error("disk full")) },
      debuggerSession: failing.session,
      helper: createHelperWorlds(failing.session, () => Promise.resolve("SOURCE")),
    });
    const failed = await failTool.execute({ tabId: 1, highlight: ["10"], save_to: "/tmp/x.png" }, ctx());
    expect(failed).toEqual({ content: "disk full", isError: true });
    expect(failing.events.indexOf("outline-off 10")).toBeGreaterThan(failing.events.indexOf("capture"));
  });
});
