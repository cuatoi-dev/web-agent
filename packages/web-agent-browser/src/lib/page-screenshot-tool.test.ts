import { describe, it, expect, vi } from "vitest";
import type { ToolContext } from "@cuatoi/web-agent-core";
import {
  createPageScreenshotTool,
  screenshotReachesModel,
} from "./page-screenshot-tool";
import { createDebuggerSession } from "./debugger-session";
import type { HelperWorlds } from "./types";

function toolCtx(): ToolContext {
  return { app: {}, signal: new AbortController().signal };
}

/** 131/002 — page_screenshot's `ref` branch goes through the helper-world
 *  seam (describe + box). */
function fakeHelper(overrides: Partial<HelperWorlds> = {}): HelperWorlds {
  return {
    source: vi.fn().mockResolvedValue(""),
    parseRef: (ref: string) => ({ ok: true, frame: "", backendNodeId: Number(ref) }),
    resolve: (_tabId: number, ref: string) => ({
      ok: true as const,
      at: { frameId: "top", backendNodeId: Number(ref), refPrefix: "" },
    }),
    frameChain: vi.fn().mockResolvedValue([]),
    frameChainAt: vi.fn().mockResolvedValue([]),
    call: vi.fn().mockRejectedValue(new Error("call not stubbed")),
    callOnDocument: vi.fn().mockRejectedValue(new Error("callOnDocument not stubbed")),
    centre: vi.fn().mockRejectedValue(new Error("centre not stubbed")),
    box: vi.fn().mockRejectedValue(new Error("box not stubbed")),
    forget: vi.fn(),
    forgetFrame: vi.fn(),
    ...overrides,
  };
}

/** A started debugger session whose CDP `sendCommand` calls are answered by
 *  `impl`, keyed by method name. */
async function startedSession(impl: (method: string) => unknown) {
  const api = {
    attach: vi.fn().mockResolvedValue(undefined),
    detach: vi.fn().mockResolvedValue(undefined),
    sendCommand: vi.fn((_tabId: number, method: string) => {
      if (method === "Runtime.evaluate") return Promise.resolve({ result: { type: "string", value: "UA/1" } });
      return Promise.resolve(impl(method));
    }),
    tabUrl: vi.fn().mockResolvedValue("http://localhost:10040/checkout.html"),
    onDetach: vi.fn(),
    onEvent: vi.fn(),
  };
  const session = createDebuggerSession(api);
  await session.start(1);
  return { api, session };
}


describe("screenshotReachesModel", () => {
  it("screenshotReachesModel({}) is false", () => {
    expect(screenshotReachesModel({})).toBe(false);
  });

  it("screenshotReachesModel({ endpointType: 'gemini', model: 'gemini-flash-lite-latest' }) is true", () => {
    expect(
      screenshotReachesModel({ endpointType: "gemini", model: "gemini-flash-lite-latest" }),
    ).toBe(true);
  });

  it("screenshotReachesModel({ endpointType: 'anthropic', model: 'sonnet' }) is true", () => {
    expect(
      screenshotReachesModel({ endpointType: "anthropic", model: "sonnet" }),
    ).toBe(true);
  });

  it("screenshotReachesModel({ endpointType: 'anthropic', model: 'text-only-model' }) is false", () => {
    expect(
      screenshotReachesModel({ endpointType: "anthropic", model: "text-only-model" }),
    ).toBe(false);
  });

  it("screenshotReachesModel({ endpointType: 'anthropic', model: 'text-only-model', imageInput: true }) is true", () => {
    expect(
      screenshotReachesModel({ endpointType: "anthropic", model: "text-only-model", imageInput: true }),
    ).toBe(true);
  });

  it("screenshotReachesModel({ endpointType: 'gemini', model: 'gemini-flash-lite-latest', imageInput: false }) is false", () => {
    expect(
      screenshotReachesModel({
        endpointType: "gemini",
        model: "gemini-flash-lite-latest",
        imageInput: false,
      }),
    ).toBe(false);
  });
});

describe("pageScreenshot tool (124/002, debugger-backed)", () => {
  it("E1: tabId is abc", async () => {
    const tool = createPageScreenshotTool();
    const result = await tool.execute({ tabId: "abc" }, toolCtx());

    expect(result.content).toBe("Invalid tabId: abc. Call read_tabs and pass the ID it reports.");
    expect(result.isError).toBe(true);
  });

  it("E2: no debuggerSession returns the not-started error", async () => {
    const tool = createPageScreenshotTool({});
    const result = await tool.execute({ tabId: 7 }, toolCtx());

    expect(result).toEqual({
      content: "Debugging is not started on tab #7. Call start_debugging first.",
      isError: true,
    });
  });

  it("E3: gate check — debugging not started on the session", async () => {
    const { session } = await startedSession(() => ({}));
    await session.stop(1);
    const tool = createPageScreenshotTool({ debuggerSession: session });
    const result = await tool.execute({ tabId: 1 }, toolCtx());

    expect(result).toEqual({
      content: "Debugging is not started on tab #1. Call start_debugging first.",
      isError: true,
    });
  });

  it("E4: fullPage and ref together return the not-both error", async () => {
    const { session } = await startedSession(() => ({}));
    const tool = createPageScreenshotTool({ debuggerSession: session });
    const result = await tool.execute({ tabId: 1, fullPage: true, ref: "1" }, toolCtx());

    expect(result).toEqual({ content: "Use fullPage or ref, not both.", isError: true });
  });

  it("E5: ref capture clips to the element box and reports its size", async () => {
    const { api, session } = await startedSession((method) =>
      method === "Page.captureScreenshot" ? { data: "elementdata" } : {},
    );
    const call = vi.fn().mockResolvedValue({
      ok: true,
      value: { connected: true, name: "Apply", desc: 'button "Apply"', permission: "allow", disabled: false },
    });
    const box = vi.fn().mockResolvedValue({ ok: true, x: 40, y: 60, width: 50, height: 60, scrollX: 5, scrollY: 10 });
    const tool = createPageScreenshotTool({ debuggerSession: session, helper: fakeHelper({ call, box }) });
    const result = await tool.execute({ tabId: 1, ref: "4" }, toolCtx());

    expect(api.sendCommand).toHaveBeenCalledWith(1, "Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      clip: { x: 45, y: 70, width: 50, height: 60, scale: 1 },
    });
    expect(result.content).toBe('Screenshot of [4] button "Apply", 50 × 60.');
    expect(result.images).toEqual([{ dataUrl: "data:image/png;base64,elementdata", mediaType: "image/png" }]);
  });

  it("E6: fullPage capture uses the content size from Page.getLayoutMetrics", async () => {
    const { api, session } = await startedSession((method) => {
      if (method === "Page.getLayoutMetrics") return { cssContentSize: { width: 1200, height: 4000 } };
      if (method === "Page.captureScreenshot") return { data: "fulldata" };
      return {};
    });
    const tool = createPageScreenshotTool({ debuggerSession: session });
    const result = await tool.execute({ tabId: 1, fullPage: true }, toolCtx());

    expect(api.sendCommand).toHaveBeenCalledWith(1, "Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: 1200, height: 4000, scale: 1 },
    });
    expect(result.content).toBe("Full-page screenshot, 1200 × 4000.");
    expect(result.images).toEqual([{ dataUrl: "data:image/png;base64,fulldata", mediaType: "image/png" }]);
  });

  it("E7: viewport capture (no fullPage or ref) takes no clip", async () => {
    const { api, session } = await startedSession((method) => {
      if (method === "Page.getLayoutMetrics") {
        return { cssVisualViewport: { clientWidth: 1280, clientHeight: 720 } };
      }
      if (method === "Page.captureScreenshot") return { data: "viewportdata" };
      return {};
    });
    const tool = createPageScreenshotTool({ debuggerSession: session });
    const result = await tool.execute({ tabId: 1 }, toolCtx());

    expect(api.sendCommand).toHaveBeenCalledWith(1, "Page.captureScreenshot", { format: "png" });
    expect(result.content).toBe("Viewport screenshot, 1280 × 720.");
    expect(result.images).toEqual([{ dataUrl: "data:image/png;base64,viewportdata", mediaType: "image/png" }]);
  });

  it("E8: an empty capture payload is discarded", async () => {
    const { session } = await startedSession((method) => (method === "Page.captureScreenshot" ? { data: "" } : {}));
    const tool = createPageScreenshotTool({ debuggerSession: session });
    const result = await tool.execute({ tabId: 1 }, toolCtx());

    expect(result).toEqual({
      content:
        "The screenshot came back empty and was discarded, so no image was sent. The tab may be mid-navigation; try again.",
      isError: true,
    });
  });

  it("E9: summarize returns Screenshot tab #7", () => {
    const tool = createPageScreenshotTool();
    expect(tool.summarize?.({ tabId: 7 })).toBe("Screenshot tab #7");
  });

  it("E10: summarize reports fullPage and ref forms", () => {
    const tool = createPageScreenshotTool();
    expect(tool.summarize?.({ tabId: 7, fullPage: true })).toBe("Full-page screenshot tab #7");
    expect(tool.summarize?.({ tabId: 7, ref: "3" })).toBe("Screenshot [3] in tab #7");
  });
});
