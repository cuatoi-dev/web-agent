import { describe, it, expect } from "vitest";
import { createHelperWorlds } from "./debugger-helper-world";
import { fakeChrome } from "./test-screenshot-cdp";

const NODES = { 10: { x: 0, y: 0, width: 10, height: 10 } };

async function setup(selections = {}) {
  const chrome = await fakeChrome({ nodes: NODES, selections });
  const helper = createHelperWorlds(chrome.session, () => Promise.resolve("SOURCE"));
  return { ...chrome, helper };
}

describe("selectScreenshotTarget", () => {
  it("records the match as a top-frame ref and releases both remote objects", async () => {
    const t = await setup({ "css:a": { ok: true, count: 2, node: 10 } });
    const result = await t.helper.selectScreenshotTarget(1, "css", "a");
    expect(result).toEqual({ ok: true, ref: "10", count: 2 });
    expect(t.session.frames.refFrame(1, "10")?.frameId).toBe("TOP");
    expect(t.events.filter((e) => e.startsWith("release")).sort()).toEqual(["release el", "release sel1"]);
  });

  it("returns the page's error and still releases the selection", async () => {
    const t = await setup({ "xpath://x": { ok: false, error: "Invalid XPath: //x" } });
    expect(await t.helper.selectScreenshotTarget(1, "xpath", "//x")).toEqual({ ok: false, error: "Invalid XPath: //x" });
    expect(t.events).toContain("release sel1");
  });

  it("turns a rejected CDP call into an error result", async () => {
    const t = await setup({ "css:a": { ok: true, count: 1, node: 10 } });
    const original = t.api.sendCommand.getMockImplementation()!;
    t.api.sendCommand.mockImplementation((tab: number, method: string, params?: Record<string, unknown>, sid?: string) =>
      method === "DOM.describeNode" ? Promise.reject(new Error("describe failed")) : original(tab, method, params, sid),
    );
    expect(await t.helper.selectScreenshotTarget(1, "css", "a")).toEqual({ ok: false, error: "describe failed" });
    expect(t.events).toEqual(expect.arrayContaining(["release sel1", "release el"]));
  });
});

describe("highlightScreenshotRef", () => {
  it("returns the invalid-ref error unchanged", async () => {
    const t = await setup();
    const result = await t.helper.highlightScreenshotRef(1, "abc");
    expect(result).toEqual({ ok: false, error: 'Invalid ref "abc". Take a new snapshot and pass a ref it prints.' });
  });

  it("sends the saved outline back on restore, even when the node can no longer be resolved", async () => {
    const t = await setup();
    const result = await t.helper.highlightScreenshotRef(1, "10");
    if (!result.ok) throw new Error(result.error);
    Reflect.deleteProperty(NODES, 10);
    const restoreCall = () => t.calls.find((c) => String(c.params?.functionDeclaration).includes("screenshotRestore"));
    await result.handle.restore();
    expect(restoreCall()?.params?.arguments).toEqual([
      { value: { declarations: [{ name: "outline-offset", value: "7px", priority: "important" }] } },
    ]);
    NODES[10] = { x: 0, y: 0, width: 10, height: 10 };
  });

  it("restores and releases once, however many times restore is called", async () => {
    const t = await setup();
    const result = await t.helper.highlightScreenshotRef(1, "10");
    if (!result.ok) throw new Error(result.error);
    await result.handle.restore();
    await result.handle.restore();
    expect(t.events.filter((e) => e === "outline-off 10")).toHaveLength(1);
    expect(t.events.filter((e) => e === "release n10")).toHaveLength(1);
  });

  it("releases the retained object when restore fails", async () => {
    const chrome = await fakeChrome({ nodes: { 10: { ...NODES[10], restoreFails: true } } });
    const helper = createHelperWorlds(chrome.session, () => Promise.resolve("SOURCE"));
    const result = await helper.highlightScreenshotRef(1, "10");
    if (!result.ok) throw new Error(result.error);
    await expect(result.handle.restore()).rejects.toThrow("restore failed for 10");
    expect(chrome.events).toContain("release n10");
  });

  it("does not release a handle it returns", async () => {
    const t = await setup();
    await t.helper.highlightScreenshotRef(1, "10");
    expect(t.events).not.toContain("release n10");
  });
});
