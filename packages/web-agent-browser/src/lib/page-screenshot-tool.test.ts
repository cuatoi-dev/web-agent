import { describe, it, expect, vi, afterEach } from "vitest";
import type { ToolContext } from "@cuatoi/web-agent-core";
import type { VfsHandle } from "@cuatoi/web-agent-vfs";
import { MemoryBackend, vfsTools } from "@cuatoi/web-agent-vfs";
import {
  createPageScreenshotTool,
  screenshotReachesModel,
} from "./page-screenshot-tool";
import { testVfs } from "./test-vfs";
import { createDebuggerSession } from "./debugger-session";
import type { HelperWorlds } from "./types";

function toolCtx(): ToolContext {
  return { app: {}, signal: new AbortController().signal };
}

/** page_screenshot's `ref` branch goes through the helper-world
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
    selectScreenshotTarget: vi.fn().mockRejectedValue(new Error("selectScreenshotTarget not stubbed")),
    highlightScreenshotRef: vi.fn().mockRejectedValue(new Error("highlightScreenshotRef not stubbed")),
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

/** A capture payload that atob accepts, so the tool really saves
 *  bytes rather than failing to decode its own fake. */
const CAPTURE = btoa("png-bytes-not-a-real-png");
const CAPTURE_URL = `data:image/png;base64,${CAPTURE}`;

/** A read-only mount, the shape an attached read-only folder has: get and
 *  list, no set. */
function readOnlyVfs(): VfsHandle {
  const vfs = testVfs();
  vfs.mount(
    "/share/photos",
    {
      get: () => Promise.resolve(undefined),
      list: () => Promise.resolve([]),
    },
    { external: true },
  );
  return vfs;
}

/** A /tmp whose storage rejects, the way a full quota area does. */
function rejectingVfs(): VfsHandle {
  const tmp = MemoryBackend();
  tmp.set = () => Promise.reject(new Error("the storage for /tmp is full."));
  return vfsTools({ tmp, home: MemoryBackend(), shared: MemoryBackend() }).vfs;
}

/** The path the result says it saved at, and the base64 stored there. */
async function savedPng(vfs: VfsHandle, content: string | undefined): Promise<{ path: string; base64: string }> {
  const line = (content ?? "").split("\n").find((l) => l.startsWith("Saved "));
  if (!line) throw new Error(`no Saved line in: ${content}`);
  const path = line.slice("Saved ".length);
  const file = await vfs.get(path);
  if (!file) throw new Error(`nothing stored at ${path}`);
  return { path, base64: file.content };
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

describe("pageScreenshot tool, debugger-backed", () => {
  it("E1: tabId is abc", async () => {
    const tool = createPageScreenshotTool({ vfs: testVfs() });
    const result = await tool.execute({ tabId: "abc" }, toolCtx());

    expect(result.content).toBe("Invalid tabId: abc. Call read_tabs and pass the ID it reports.");
    expect(result.isError).toBe(true);
  });

  it("E2: no debuggerSession returns the not-started error", async () => {
    const tool = createPageScreenshotTool({ vfs: testVfs() });
    const result = await tool.execute({ tabId: 7 }, toolCtx());

    expect(result).toEqual({
      content: "Debugging is not started on tab #7. Call start_debugging first.",
      isError: true,
    });
  });

  it("E3: gate check — debugging not started on the session", async () => {
    const { session } = await startedSession(() => ({}));
    await session.stop(1);
    const tool = createPageScreenshotTool({ vfs: testVfs(), debuggerSession: session });
    const result = await tool.execute({ tabId: 1 }, toolCtx());

    expect(result).toEqual({
      content: "Debugging is not started on tab #1. Call start_debugging first.",
      isError: true,
    });
  });

  it("E4: fullPage and ref together return the not-both error", async () => {
    const { session } = await startedSession(() => ({}));
    const tool = createPageScreenshotTool({ vfs: testVfs(), debuggerSession: session });
    const result = await tool.execute({ tabId: 1, fullPage: true, ref: "1" }, toolCtx());

    expect(result).toEqual({ content: "Use only one of ref, css, xpath or fullPage.", isError: true });
  });

  it("E5: ref capture clips to the element box and reports its size", async () => {
    const { api, session } = await startedSession((method) =>
      method === "Page.captureScreenshot" ? { data: CAPTURE } : {},
    );
    const call = vi.fn().mockResolvedValue({
      ok: true,
      value: { connected: true, name: "Apply", desc: 'button "Apply"', permission: "allow", disabled: false },
    });
    const box = vi.fn().mockResolvedValue({ ok: true, x: 40, y: 60, width: 50, height: 60, scrollX: 5, scrollY: 10 });
    const vfs = testVfs();
    const tool = createPageScreenshotTool({ vfs, debuggerSession: session, helper: fakeHelper({ call, box }) });
    const result = await tool.execute({ tabId: 1, ref: "4" }, toolCtx());

    expect(api.sendCommand).toHaveBeenCalledWith(1, "Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      clip: { x: 45, y: 70, width: 50, height: 60, scale: 1 },
    });
    expect(result.content?.split("\n")[0]).toBe('Screenshot of [4] button "Apply", 50 × 60.');
    expect(result.images).toEqual([{ dataUrl: CAPTURE_URL, mediaType: "image/png" }]);
    const saved = await savedPng(vfs, result.content);
    expect(saved.path).toMatch(/^\/tmp\/screenshots\/\d{4}-\d{2}-\d{2}-\d{6}-tab1\.png$/);
    expect(saved.base64).toBe(CAPTURE);
  });

  it("E6: fullPage capture uses the content size from Page.getLayoutMetrics", async () => {
    const { api, session } = await startedSession((method) => {
      if (method === "Page.getLayoutMetrics") return { cssContentSize: { width: 1200, height: 4000 } };
      if (method === "Page.captureScreenshot") return { data: CAPTURE };
      return {};
    });
    const vfs = testVfs();
    const tool = createPageScreenshotTool({ vfs, debuggerSession: session });
    const result = await tool.execute({ tabId: 1, fullPage: true }, toolCtx());

    expect(api.sendCommand).toHaveBeenCalledWith(1, "Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      clip: { x: 0, y: 0, width: 1200, height: 4000, scale: 1 },
    });
    expect(result.content?.split("\n")[0]).toBe("Full-page screenshot, 1200 × 4000.");
    expect(result.images).toEqual([{ dataUrl: CAPTURE_URL, mediaType: "image/png" }]);
    expect((await savedPng(vfs, result.content)).base64).toBe(CAPTURE);
  });

  it("E7: viewport capture (no fullPage or ref) takes no clip", async () => {
    const { api, session } = await startedSession((method) => {
      if (method === "Page.getLayoutMetrics") {
        return { cssVisualViewport: { clientWidth: 1280, clientHeight: 720 } };
      }
      if (method === "Page.captureScreenshot") return { data: CAPTURE };
      return {};
    });
    const vfs = testVfs();
    const tool = createPageScreenshotTool({ vfs, debuggerSession: session });
    const result = await tool.execute({ tabId: 1 }, toolCtx());

    expect(api.sendCommand).toHaveBeenCalledWith(1, "Page.captureScreenshot", { format: "png" });
    expect(result.content?.split("\n")[0]).toBe("Viewport screenshot, 1280 × 720.");
    expect(result.images).toEqual([{ dataUrl: CAPTURE_URL, mediaType: "image/png" }]);
    expect((await savedPng(vfs, result.content)).base64).toBe(CAPTURE);
  });

  it("E8: an empty capture payload is discarded", async () => {
    const { session } = await startedSession((method) => (method === "Page.captureScreenshot" ? { data: "" } : {}));
    const vfs = testVfs();
    const tool = createPageScreenshotTool({ vfs, debuggerSession: session });
    const result = await tool.execute({ tabId: 1 }, toolCtx());

    expect(result).toEqual({
      content:
        "The screenshot came back empty and was discarded, so no image was sent. The tab may be mid-navigation; try again.",
      isError: true,
    });
    expect(await vfs.list("/")).toEqual([]);
  });

  it("E9: summarize returns Screenshot tab #7", () => {
    const tool = createPageScreenshotTool({ vfs: testVfs() });
    expect(tool.summarize?.({ tabId: 7 })).toBe("Screenshot tab #7");
  });

  it("E10: summarize reports fullPage and ref forms", () => {
    const tool = createPageScreenshotTool({ vfs: testVfs() });
    expect(tool.summarize?.({ tabId: 7, fullPage: true })).toBe("Full-page screenshot tab #7");
    expect(tool.summarize?.({ tabId: 7, ref: "3" })).toBe("Screenshot [3] in tab #7");
  });
});

describe("page_screenshot saving", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  async function viewportSession() {
    return startedSession((method) => {
      if (method === "Page.getLayoutMetrics") {
        return { cssVisualViewport: { clientWidth: 1280, clientHeight: 720 } };
      }
      if (method === "Page.captureScreenshot") return { data: CAPTURE };
      return {};
    });
  }

  it("S1: the default path carries the local timestamp and the tab id, and the stored bytes are the captured bytes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 0, 2, 3, 4, 5));
    const { session } = await viewportSession();
    const vfs = testVfs();
    const tool = createPageScreenshotTool({ vfs, debuggerSession: session });

    const result = await tool.execute({ tabId: 1 }, toolCtx());

    expect(result.content).toBe(
      "Viewport screenshot, 1280 × 720.\nSaved /tmp/screenshots/2026-01-02-030405-tab1.png",
    );
    expect(result.images).toEqual([{ dataUrl: CAPTURE_URL, mediaType: "image/png" }]);
    const saved = await vfs.get("/tmp/screenshots/2026-01-02-030405-tab1.png");
    expect(saved).toMatchObject({ encoding: "base64", mimeType: "image/png", content: CAPTURE });
    expect(atob(saved!.content)).toBe(atob(CAPTURE));
  });

  it("S2: save_to puts the PNG at the supplied path", async () => {
    const { session } = await viewportSession();
    const vfs = testVfs();
    const tool = createPageScreenshotTool({ vfs, debuggerSession: session });

    const result = await tool.execute({ tabId: 1, save_to: "/home/agent/x.png" }, toolCtx());

    expect(result.content).toContain("\nSaved /home/agent/x.png");
    expect(await vfs.get("/home/agent/x.png")).toMatchObject({ encoding: "base64", content: CAPTURE });
  });

  it("S3: two captures in the same second overwrite the same default path", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 0, 2, 3, 4, 5));
    const { session } = await viewportSession();
    const vfs = testVfs();
    const tool = createPageScreenshotTool({ vfs, debuggerSession: session });

    await tool.execute({ tabId: 1 }, toolCtx());
    await tool.execute({ tabId: 1 }, toolCtx());

    expect(await vfs.list("/tmp/screenshots")).toHaveLength(1);
  });

  it("S4: a complete PNG data URL from the capture is saved as its payload", async () => {
    const { session } = await startedSession((method) =>
      method === "Page.captureScreenshot" ? { data: CAPTURE_URL } : {},
    );
    const vfs = testVfs();
    const tool = createPageScreenshotTool({ vfs, debuggerSession: session });

    const result = await tool.execute({ tabId: 1, save_to: "/home/agent/full.png" }, toolCtx());

    expect(result.images).toEqual([{ dataUrl: CAPTURE_URL, mediaType: "image/png" }]);
    expect((await vfs.get("/home/agent/full.png"))?.content).toBe(CAPTURE);
  });

  it("S5: save_to on a read-only mount fails the call and sends no image", async () => {
    const { session } = await viewportSession();
    const vfs = readOnlyVfs();
    const tool = createPageScreenshotTool({ vfs, debuggerSession: session });

    const result = await tool.execute({ tabId: 1, save_to: "/share/photos/x.png" }, toolCtx());

    expect(result.isError).toBe(true);
    expect(result.images).toBeUndefined();
    expect(result.content).toContain("/share/photos/x.png is read-only.");
    expect(result.content).not.toContain("Saved ");
    expect(await vfs.get("/share/photos/x.png")).toBeUndefined();
  });

  it("S6: a path outside every mount fails the call and sends no image", async () => {
    const { session } = await viewportSession();
    const vfs = testVfs();
    const tool = createPageScreenshotTool({ vfs, debuggerSession: session });

    const result = await tool.execute({ tabId: 1, save_to: "/outside/x.png" }, toolCtx());

    expect(result).toEqual({ content: "No mount for /outside/x.png", isError: true });
    expect(result.images).toBeUndefined();
  });

  it("S7: storage that rejects fails the call and sends no image", async () => {
    const { session } = await viewportSession();
    const vfs = rejectingVfs();
    const tool = createPageScreenshotTool({ vfs, debuggerSession: session });

    const result = await tool.execute({ tabId: 1 }, toolCtx());

    expect(result).toEqual({ content: "the storage for /tmp is full.", isError: true });
    expect(result.images).toBeUndefined();
  });

  it("S8: a capture payload that is not base64 fails the call and saves nothing", async () => {
    const { session } = await startedSession((method) =>
      method === "Page.captureScreenshot" ? { data: "not base64 %%%" } : {},
    );
    const vfs = testVfs();
    const tool = createPageScreenshotTool({ vfs, debuggerSession: session });

    const result = await tool.execute({ tabId: 1 }, toolCtx());

    expect(result.isError).toBe(true);
    expect(result.images).toBeUndefined();
    expect(await vfs.list("/")).toEqual([]);
  });

  it("S9: an invalid tabId and a fullPage+ref clash both save nothing", async () => {
    const { session } = await viewportSession();
    const vfs = testVfs();
    const tool = createPageScreenshotTool({ vfs, debuggerSession: session });

    await tool.execute({ tabId: "abc" }, toolCtx());
    await tool.execute({ tabId: 1, fullPage: true, ref: "1" }, toolCtx());

    expect(await vfs.list("/")).toEqual([]);
  });
});
