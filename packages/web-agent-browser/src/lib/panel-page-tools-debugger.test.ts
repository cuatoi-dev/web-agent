import { describe, it, expect, vi } from "vitest";
import type { ToolContext } from "@cuatoi/web-agent-core";
import { createPanelPageTools } from "./panel-page-tools";
import { testVfs } from "./test-vfs";
import { createDebuggerSession } from "./debugger-session";
import type { HelperWorlds } from "./types";

function toolCtx(): ToolContext {
  return { app: {}, signal: new AbortController().signal };
}

/** 131/002 — page_hover and page_click now call through the helper-world seam. */
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

function fakeDebuggerApi() {
  const api = {
    attach: vi.fn().mockResolvedValue(undefined),
    detach: vi.fn().mockResolvedValue(undefined),
    sendCommand: vi.fn((_tabId: number, method: string) =>
      Promise.resolve(method === "Runtime.evaluate" ? { result: { type: "string", value: "UA/1" } } : {}),
    ),
    tabUrl: vi.fn().mockResolvedValue("http://localhost:10040/checkout.html"),
    onDetach: vi.fn(),
    onEvent: vi.fn(),
  };
  return api;
}

describe("Debugger page tools (124/001)", () => {
  it("names and order: includes page_dialog, page_upload_file, start_debugging, stop_debugging, page_hover, page_press_key, page_emulate", () => {
    const tools = createPanelPageTools({ vfs: testVfs() });
    const names = tools.map((t) => t.name);
    const debuggerTools = names.slice(-9, -2);
    expect(debuggerTools).toEqual([
      "page_dialog",
      "page_upload_file",
      "start_debugging",
      "stop_debugging",
      "page_hover",
      "page_press_key",
      "page_emulate",
    ]);
  });

  it("attaches without asking the tab anything", async () => {
    const debuggerApi = fakeDebuggerApi();
    const debuggerSession = createDebuggerSession(debuggerApi);
    const tools = createPanelPageTools({ vfs: testVfs(), debuggerSession });
    const start = tools.find((t) => t.name === "start_debugging")!;

    const result = await start.execute({ tabId: 4 }, toolCtx());
    expect(result).toEqual({ content: "Debugging tab #4 (localhost:10040)." });
    expect(debuggerApi.attach).toHaveBeenCalledWith(4);
  });

  it("ok starts debugging tab", async () => {
    const onActivatedOrigin = vi.fn();
    const debuggerApi = fakeDebuggerApi();
    const debuggerSession = createDebuggerSession(debuggerApi);
    const tools = createPanelPageTools({ vfs: testVfs(), onActivatedOrigin, debuggerSession });
    const start = tools.find((t) => t.name === "start_debugging")!;

    const result = await start.execute({ tabId: 4 }, toolCtx());
    expect(result).toEqual({ content: "Debugging tab #4 (localhost:10040)." });
    expect(onActivatedOrigin).toHaveBeenCalledWith(4, "http://localhost:10040");
  });

  it("stop without start returns not being debugged", async () => {
    const debuggerSession = createDebuggerSession(fakeDebuggerApi());
    const tools = createPanelPageTools({ vfs: testVfs(), debuggerSession });
    const stop = tools.find((t) => t.name === "stop_debugging")!;

    const result = await stop.execute({ tabId: 4 }, toolCtx());
    expect(result).toEqual({ content: "Tab #4 is not being debugged." });
  });

  it("summaries produce expected strings", () => {
    const tools = createPanelPageTools({ vfs: testVfs() });
    const start = tools.find((t) => t.name === "start_debugging")!;
    const stop = tools.find((t) => t.name === "stop_debugging")!;

    expect(start.summarize?.({ tabId: 4 })).toBe("Start debugging tab #4");
    expect(stop.summarize?.({})).toBe("Stop debugging tab #(none)");
  });

  it("the side panel shares one session across agents", async () => {
    const call = vi.fn().mockResolvedValue({
      ok: true,
      value: { connected: true, name: "Apply", desc: 'button "Apply"', permission: "allow", disabled: false },
    });
    const centre = vi.fn().mockResolvedValue({ ok: true, x: 40, y: 50 });
    const helper = fakeHelper({ call, centre });
    const debuggerApi = fakeDebuggerApi();
    const debuggerSession = createDebuggerSession(debuggerApi);

    const agent1Tools = createPanelPageTools({ vfs: testVfs(), helper, debuggerSession });
    const agent2Tools = createPanelPageTools({ vfs: testVfs(), helper, debuggerSession });

    const start = agent1Tools.find((t) => t.name === "start_debugging")!;
    const pageClick = agent2Tools.find((t) => t.name === "page_click")!;

    await start.execute({ tabId: 1 }, toolCtx());
    // page_click from agent 2 does not return a gate error; it calls the shared helper.
    const result = await pageClick.execute({ tabId: 1, ref: "1" }, toolCtx());
    expect(result.isError).toBeFalsy();
    expect(call).toHaveBeenCalledWith(1, "1", "describe", ["1"]);
  });
});

describe("page_hover (124/002)", () => {
  it("gate check: error when debugging not started", async () => {
    const debuggerSession = createDebuggerSession(fakeDebuggerApi());
    const tools = createPanelPageTools({ vfs: testVfs(), debuggerSession });
    const pageHover = tools.find((t) => t.name === "page_hover")!;

    const result = await pageHover.execute({ tabId: 4, ref: "1" }, toolCtx());
    expect(result).toEqual({
      content: "Debugging is not started on tab #4. Call start_debugging first.",
      isError: true,
    });
  });

  it("dispatches Input.dispatchMouseEvent at the element center and returns Hovered text", async () => {
    const debuggerApi = fakeDebuggerApi();
    const debuggerSession = createDebuggerSession(debuggerApi);
    await debuggerSession.start(1);

    const call = vi.fn((_tabId: number, _ref: string, fn: string) => {
      if (fn === "describe") {
        return Promise.resolve({ ok: true, value: { connected: true, name: "Cart (2)", desc: 'link "Cart (2)"', permission: "allow", disabled: false } });
      }
      if (fn === "target") {
        return Promise.resolve({
          ok: true,
          value: { role: "link", name: "Cart (2)", label: '[3] link "Cart (2)"', isPassword: false },
        });
      }
      throw new Error(`unexpected helper call: ${fn}`);
    });
    const centre = vi.fn().mockResolvedValue({ ok: true, x: 40, y: 50 });
    const tools = createPanelPageTools({ vfs: testVfs(), helper: fakeHelper({ call, centre }), debuggerSession });
    const pageHover = tools.find((t) => t.name === "page_hover")!;

    const result = await pageHover.execute({ tabId: 1, ref: "3" }, toolCtx());
    expect(result).toEqual({ content: 'Hovered [3] link "Cart (2)".' });
    expect(debuggerApi.sendCommand).toHaveBeenCalledWith(1, "Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: 40,
      y: 50,
    });
  });
});

describe("page_press_key (124/002)", () => {
  async function pressTool(): Promise<{ tool: ReturnType<typeof createPanelPageTools>[number]; api: ReturnType<typeof fakeDebuggerApi> }> {
    const api = fakeDebuggerApi();
    const debuggerSession = createDebuggerSession(api);
    await debuggerSession.start(1);
    const tools = createPanelPageTools({ vfs: testVfs(), debuggerSession });
    return { tool: tools.find((t) => t.name === "page_press_key")!, api };
  }

  it("gate check: error when debugging not started", async () => {
    const debuggerSession = createDebuggerSession(fakeDebuggerApi());
    const tools = createPanelPageTools({ vfs: testVfs(), debuggerSession });
    const pagePressKey = tools.find((t) => t.name === "page_press_key")!;

    const result = await pagePressKey.execute({ tabId: 4, key: "Enter" }, toolCtx());
    expect(result).toEqual({
      content: "Debugging is not started on tab #4. Call start_debugging first.",
      isError: true,
    });
  });

  it.each([
    ["Enter", "Enter", "Enter", 13, "\r"],
    ["Escape", "Escape", "Escape", 27, undefined],
    ["Tab", "Tab", "Tab", 9, undefined],
    ["Backspace", "Backspace", "Backspace", 8, undefined],
    ["Delete", "Delete", "Delete", 46, undefined],
    ["ArrowUp", "ArrowUp", "ArrowUp", 38, undefined],
    ["ArrowDown", "ArrowDown", "ArrowDown", 40, undefined],
    ["Space", " ", "Space", 32, " "],
    ["F1", "F1", "F1", 112, undefined],
    ["F12", "F12", "F12", 123, undefined],
  ] as const)("maps named key %s to key=%s code=%s vk=%s", async (input, key, code, vk, text) => {
    const { tool, api } = await pressTool();
    const result = await tool.execute({ tabId: 1, key: input }, toolCtx());
    expect(result).toEqual({ content: `Pressed ${input}.` });
    expect(api.sendCommand).toHaveBeenCalledWith(1, "Input.dispatchKeyEvent", {
      type: text !== undefined ? "keyDown" : "rawKeyDown",
      key,
      code,
      windowsVirtualKeyCode: vk,
      modifiers: 0,
      ...(text !== undefined ? { text } : {}),
    });
    expect(api.sendCommand).toHaveBeenCalledWith(1, "Input.dispatchKeyEvent", {
      type: "keyUp",
      key,
      code,
      windowsVirtualKeyCode: vk,
      modifiers: 0,
    });
  });

  it("maps a lowercase letter to a synthesized KeyX code and text", async () => {
    const { tool, api } = await pressTool();
    const result = await tool.execute({ tabId: 1, key: "a" }, toolCtx());
    expect(result).toEqual({ content: "Pressed a." });
    expect(api.sendCommand).toHaveBeenCalledWith(1, "Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "a",
      code: "KeyA",
      windowsVirtualKeyCode: 65,
      modifiers: 0,
      text: "a",
    });
  });

  it("maps a digit to a synthesized DigitX code and text", async () => {
    const { tool, api } = await pressTool();
    const result = await tool.execute({ tabId: 1, key: "5" }, toolCtx());
    expect(result).toEqual({ content: "Pressed 5." });
    expect(api.sendCommand).toHaveBeenCalledWith(1, "Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "5",
      code: "Digit5",
      windowsVirtualKeyCode: 53,
      modifiers: 0,
      text: "5",
    });
  });

  it("Control+a masks modifiers to 2 and drops text", async () => {
    const { tool, api } = await pressTool();
    const result = await tool.execute({ tabId: 1, key: "a", modifiers: ["Control"] }, toolCtx());
    expect(result).toEqual({ content: "Pressed Control+a." });
    expect(api.sendCommand).toHaveBeenCalledWith(1, "Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      key: "a",
      code: "KeyA",
      windowsVirtualKeyCode: 65,
      modifiers: 2,
    });
  });

  it("combines Shift+Alt into mask 9", async () => {
    const { tool, api } = await pressTool();
    await tool.execute({ tabId: 1, key: "Tab", modifiers: ["Shift", "Alt"] }, toolCtx());
    expect(api.sendCommand).toHaveBeenCalledWith(1, "Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      key: "Tab",
      code: "Tab",
      windowsVirtualKeyCode: 9,
      modifiers: 9,
    });
  });

  it("unknown key name returns the unknown-key error", async () => {
    const { tool } = await pressTool();
    const result = await tool.execute({ tabId: 1, key: "Nope" }, toolCtx());
    expect(result).toEqual({
      content: 'Unknown key "Nope". Use a Playwright key name such as Enter, Escape, Tab, ArrowDown, or one character.',
      isError: true,
    });
  });

  it("unknown modifier name returns the unknown-modifier error", async () => {
    const { tool } = await pressTool();
    const result = await tool.execute({ tabId: 1, key: "a", modifiers: ["BadMod"] }, toolCtx());
    expect(result).toEqual({
      content: 'Unknown modifier "BadMod". Use Alt, Control, Meta or Shift.',
      isError: true,
    });
  });
});

describe("page_emulate (124/002)", () => {
  async function emulateTool(): Promise<{ tool: ReturnType<typeof createPanelPageTools>[number]; api: ReturnType<typeof fakeDebuggerApi> }> {
    const api = fakeDebuggerApi();
    const debuggerSession = createDebuggerSession(api);
    await debuggerSession.start(1);
    const tools = createPanelPageTools({ vfs: testVfs(), debuggerSession });
    return { tool: tools.find((t) => t.name === "page_emulate")!, api };
  }

  it("gate check: error when debugging not started", async () => {
    const debuggerSession = createDebuggerSession(fakeDebuggerApi());
    const tools = createPanelPageTools({ vfs: testVfs(), debuggerSession });
    const pageEmulate = tools.find((t) => t.name === "page_emulate")!;

    const result = await pageEmulate.execute({ tabId: 4, preset: "iPhone 15" }, toolCtx());
    expect(result).toEqual({
      content: "Debugging is not started on tab #4. Call start_debugging first.",
      isError: true,
    });
  });

  it("iPhone 15 preset sets metrics, touch and userAgent overrides", async () => {
    const { tool, api } = await emulateTool();
    const result = await tool.execute({ tabId: 1, preset: "iPhone 15" }, toolCtx());
    expect(result).toEqual({ content: "Emulating iPhone 15 (393 × 659, scale 3, mobile, touch)." });
    expect(api.sendCommand).toHaveBeenCalledWith(1, "Emulation.setDeviceMetricsOverride", {
      width: 393,
      height: 659,
      deviceScaleFactor: 3,
      mobile: true,
    });
    expect(api.sendCommand).toHaveBeenCalledWith(1, "Emulation.setTouchEmulationEnabled", {
      enabled: true,
      maxTouchPoints: 5,
      configuration: "mobile",
    });
    expect(api.sendCommand).toHaveBeenCalledWith(
      1,
      "Emulation.setUserAgentOverride",
      expect.objectContaining({ userAgent: expect.stringContaining("iPhone") }),
    );
  });

  it("iPad Mini landscape preset applies its own metrics", async () => {
    const { tool, api } = await emulateTool();
    const result = await tool.execute({ tabId: 1, preset: "iPad Mini landscape" }, toolCtx());
    expect(result).toEqual({ content: "Emulating iPad Mini landscape (1024 × 768, scale 2, mobile, touch)." });
    expect(api.sendCommand).toHaveBeenCalledWith(1, "Emulation.setDeviceMetricsOverride", {
      width: 1024,
      height: 768,
      deviceScaleFactor: 2,
      mobile: true,
    });
  });

  it("Desktop Chrome preset is not mobile and has no touch", async () => {
    const { tool, api } = await emulateTool();
    const result = await tool.execute({ tabId: 1, preset: "Desktop Chrome" }, toolCtx());
    expect(result).toEqual({ content: "Emulating Desktop Chrome (1280 × 720, scale 1, desktop, no touch)." });
    expect(api.sendCommand).toHaveBeenCalledWith(1, "Emulation.setTouchEmulationEnabled", {
      enabled: false,
      maxTouchPoints: 1,
      configuration: "desktop",
    });
  });

  it("custom dimensions override metrics without a userAgent call", async () => {
    const { tool, api } = await emulateTool();
    const result = await tool.execute(
      { tabId: 1, width: 800, height: 600, scale: 2, mobile: false, touch: true },
      toolCtx(),
    );
    expect(result).toEqual({ content: "Emulating a custom device (800 × 600, scale 2, desktop, touch)." });
    expect(api.sendCommand).toHaveBeenCalledWith(1, "Emulation.setDeviceMetricsOverride", {
      width: 800,
      height: 600,
      deviceScaleFactor: 2,
      mobile: false,
    });
    expect(api.sendCommand).not.toHaveBeenCalledWith(1, "Emulation.setUserAgentOverride", expect.anything());
  });

  it("unknown preset returns the preset error listing the three names", async () => {
    const { tool } = await emulateTool();
    const result = await tool.execute({ tabId: 1, preset: "UnknownDevice" }, toolCtx());
    expect(result).toEqual({
      content: 'Unknown preset "UnknownDevice". Use iPhone 15, iPad Mini landscape or Desktop Chrome.',
      isError: true,
    });
  });

  it("out-of-range custom dimensions return the bounds error", async () => {
    const { tool } = await emulateTool();
    const result = await tool.execute(
      { tabId: 1, width: 5000, height: 600, scale: 2, mobile: false, touch: true },
      toolCtx(),
    );
    expect(result).toEqual({
      content: "Width and height must be 1 to 4096, and scale 0 to 4.",
      isError: true,
    });
  });

  it("mixing preset with custom fields returns the form error", async () => {
    const { tool } = await emulateTool();
    const result = await tool.execute({ tabId: 1, preset: "iPhone 15", width: 800 }, toolCtx());
    expect(result).toEqual({
      content: "Pass preset, or width, height, scale, mobile and touch, or reset: true.",
      isError: true,
    });
  });

  it("reset: true calls resetEmulation and returns confirmation", async () => {
    const { tool, api } = await emulateTool();
    await tool.execute({ tabId: 1, preset: "iPhone 15" }, toolCtx());
    const result = await tool.execute({ tabId: 1, reset: true }, toolCtx());
    expect(result).toEqual({ content: "Emulation was reset." });
    expect(api.sendCommand).toHaveBeenCalledWith(1, "Emulation.clearDeviceMetricsOverride", undefined);
    expect(api.sendCommand).toHaveBeenCalledWith(1, "Emulation.setUserAgentOverride", { userAgent: "UA/1" });
  });
});
