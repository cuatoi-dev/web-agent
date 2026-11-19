import { describe, it, expect, vi } from "vitest";
import { createDebuggerSession } from "./debugger-session";

function fakeDebuggerApi() {
  let detachListener: (tabId: number, reason: string) => void = () => {};
  let eventListener: (tabId: number, method: string, params: unknown, sessionId?: string) => void = () => {};
  const api = {
    attach: vi.fn().mockResolvedValue(undefined),
    detach: vi.fn().mockResolvedValue(undefined),
    sendCommand: vi.fn((_tabId: number, method: string) => {
      if (method === "Runtime.evaluate") return Promise.resolve({ result: { type: "string", value: "UA/1" } });
      if (method === "Page.getFrameTree") return Promise.resolve({ frameTree: { frame: { id: "top-frame" } } });
      return Promise.resolve({});
    }),
    tabUrl: vi.fn().mockResolvedValue("http://localhost:10040/checkout.html"),
    onDetach: vi.fn((l: typeof detachListener) => {
      detachListener = l;
    }),
    onEvent: vi.fn((l: typeof eventListener) => {
      eventListener = l;
    }),
  };
  return {
    api,
    fireDetach: (t: number, r: string) => detachListener(t, r),
    fireEvent: (t: number, m: string, p: unknown, sessionId?: string) => eventListener(t, m, p, sessionId),
  };
}

describe("DebuggerSession", () => {
  it("start attaches and records state", async () => {
    const { api } = fakeDebuggerApi();
    const session = createDebuggerSession(api);

    const result = await session.start(1);
    expect(result).toEqual({ content: "Debugging tab #1 (localhost:10040)." });
    expect(result.isError).toBeUndefined();
    expect(api.attach).toHaveBeenCalledWith(1);
    expect(api.sendCommand).toHaveBeenNthCalledWith(1, 1, "Page.enable");
    expect(api.sendCommand).toHaveBeenNthCalledWith(2, 1, "Page.getFrameTree");
    expect(api.sendCommand).toHaveBeenNthCalledWith(3, 1, "Network.enable");
    expect(api.sendCommand).toHaveBeenNthCalledWith(4, 1, "Runtime.enable");
    expect(api.sendCommand).toHaveBeenNthCalledWith(5, 1, "DOM.enable");
    expect(api.sendCommand).toHaveBeenNthCalledWith(6, 1, "Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
    });
    expect(api.sendCommand).toHaveBeenNthCalledWith(7, 1, "Runtime.evaluate", {
      expression: "navigator.userAgent",
      returnByValue: true,
    });
    const state = session.state.get(1)!;
    expect(state.consoleDocumentId).toEqual(expect.any(String));
    expect(state.consoleDocumentId.length).toBeGreaterThan(0);
    expect(state).toEqual({
      status: "debugging",
      host: "localhost:10040",
      topFrameId: "top-frame",
      dialogs: [],
      dialogPlan: null,
      lastDialog: null,
      emulation: null,
      originalUserAgent: "UA/1",
      network: [],
      nextSeq: 1,
      console: [],
      consoleDropped: 0,
      consoleDocumentId: state.consoleDocumentId,
    });
  });

  it("already being debugged", async () => {
    const { api } = fakeDebuggerApi();
    const session = createDebuggerSession(api);
    await session.start(1);

    const second = await session.start(1);
    expect(second).toEqual({ content: "Tab #1 is already being debugged." });
    expect(api.attach).toHaveBeenCalledTimes(1);
  });

  it("recovers our own attach", async () => {
    const { api } = fakeDebuggerApi();
    api.attach
      .mockRejectedValueOnce(new Error("Another debugger is already attached to the tab with id: 1."))
      .mockResolvedValueOnce(undefined);
    const session = createDebuggerSession(api);

    const result = await session.start(1);
    expect(result).toEqual({ content: "Debugging tab #1 (localhost:10040)." });
    expect(api.attach.mock.invocationCallOrder[0]).toBeLessThan(api.detach.mock.invocationCallOrder[0]);
    expect(api.detach.mock.invocationCallOrder[0]).toBeLessThan(api.attach.mock.invocationCallOrder[1]);
  });

  it("recovery attach fails", async () => {
    const { api } = fakeDebuggerApi();
    api.attach
      .mockRejectedValueOnce(new Error("Another debugger is already attached to the tab with id: 1."))
      .mockRejectedValueOnce(new Error("Cannot access a chrome:// URL"));
    const session = createDebuggerSession(api);

    const result = await session.start(1);
    expect(result).toEqual({
      content: "start_debugging could not attach to tab #1: Cannot access a chrome:// URL.",
      isError: true,
    });
    expect(session.state.has(1)).toBe(false);
  });

  it("other attach error", async () => {
    const { api } = fakeDebuggerApi();
    api.attach.mockRejectedValueOnce(new Error("Cannot attach to this target."));
    const session = createDebuggerSession(api);

    const result = await session.start(1);
    expect(result).toEqual({
      content: "start_debugging could not attach to tab #1: Cannot attach to this target.",
      isError: true,
    });
    expect(api.detach).not.toHaveBeenCalled();
  });

  it("enable fails after attach", async () => {
    const { api } = fakeDebuggerApi();
    api.sendCommand.mockRejectedValueOnce(new Error("boom"));
    const session = createDebuggerSession(api);

    const result = await session.start(1);
    expect(result).toEqual({
      content: "start_debugging could not attach to tab #1: boom.",
      isError: true,
    });
    expect(api.detach).toHaveBeenCalledWith(1);
    expect(session.state.has(1)).toBe(false);
  });

  it("an unknown tab is reported before anything is attached", async () => {
    const { api } = fakeDebuggerApi();
    api.tabUrl.mockRejectedValueOnce(new Error("No tab with id: 1."));
    const session = createDebuggerSession(api);

    const result = await session.start(1);
    expect(result).toEqual({
      content: "No tab with ID 1. Call read_tabs and pass the ID it reports.",
      isError: true,
    });
    expect(api.attach).not.toHaveBeenCalled();
  });

  it("gate reports not started then ok", async () => {
    const { api } = fakeDebuggerApi();
    const session = createDebuggerSession(api);

    expect(session.gate(1)).toEqual({
      ok: false,
      error: "Debugging is not started on tab #1. Call start_debugging first.",
    });

    await session.start(1);
    const g = session.gate(1);
    expect(g.ok).toBe(true);
    if (g.ok) {
      expect(g.state.status).toBe("debugging");
    }
  });

  it("Cancel on Chrome bar reports canceled and allows start again", async () => {
    const { api, fireDetach } = fakeDebuggerApi();
    const session = createDebuggerSession(api);
    await session.start(1);

    fireDetach(1, "canceled_by_user");
    expect(session.gate(1)).toEqual({
      ok: false,
      error: "Debugging stopped on tab #1: the user pressed Cancel on Chrome's bar. Call start_debugging to continue.",
    });

    const restart = await session.start(1);
    expect(restart).toEqual({ content: "Debugging tab #1 (localhost:10040)." });
    expect(session.gate(1).ok).toBe(true);
    expect(api.attach).toHaveBeenCalledTimes(2);
  });

  it("target closed deletes state", async () => {
    const { api, fireDetach } = fakeDebuggerApi();
    const session = createDebuggerSession(api);
    await session.start(1);

    fireDetach(1, "target_closed");
    expect(session.state.has(1)).toBe(false);
  });

  it("detach for an unknown tab is ignored", () => {
    const { api, fireDetach } = fakeDebuggerApi();
    const session = createDebuggerSession(api);
    // ensure listeners attached
    session.gate(2);
    // trigger listeners via start on tab 1
    void session.start(1);

    expect(() => fireDetach(2, "canceled_by_user")).not.toThrow();
    expect(session.state.has(2)).toBe(false);
  });

  it("stop debugging and repeat", async () => {
    const { api } = fakeDebuggerApi();
    const session = createDebuggerSession(api);
    await session.start(1);

    const stop1 = await session.stop(1);
    expect(stop1).toBe("Stopped debugging tab #1. Emulation was reset.");
    expect(api.detach).toHaveBeenCalledWith(1);
    expect(session.state.has(1)).toBe(false);

    const stop2 = await session.stop(1);
    expect(stop2).toBe("Tab #1 is not being debugged.");

    // start then Cancel then stop
    await session.start(2);
    session.state.get(2)!.status = "canceled";
    const stopCanceled = await session.stop(2);
    expect(stopCanceled).toBe("Tab #2 is not being debugged.");

    // detach rejecting inside stop still returns the stop line
    await session.start(3);
    api.detach.mockRejectedValueOnce(new Error("detach failed"));
    const stopError = await session.stop(3);
    expect(stopError).toBe("Stopped debugging tab #3. Emulation was reset.");
  });

  it("resetEmulation clears metrics, touch, and restores userAgent when a preset was applied", async () => {
    const { api } = fakeDebuggerApi();
    const session = createDebuggerSession(api);
    await session.start(1);
    session.state.get(1)!.emulation = { preset: "iPhone 15" };

    await session.resetEmulation(1);

    expect(api.sendCommand).toHaveBeenCalledWith(1, "Emulation.clearDeviceMetricsOverride", undefined);
    expect(api.sendCommand).toHaveBeenCalledWith(1, "Emulation.setTouchEmulationEnabled", { enabled: false });
    expect(api.sendCommand).toHaveBeenCalledWith(1, "Emulation.setUserAgentOverride", { userAgent: "UA/1" });
    expect(session.state.get(1)!.emulation).toBeNull();
  });

  it("resetEmulation skips the userAgent restore when no preset was applied", async () => {
    const { api } = fakeDebuggerApi();
    const session = createDebuggerSession(api);
    await session.start(1);
    session.state.get(1)!.emulation = { width: 800, height: 600, scale: 1, mobile: false, touch: false };

    await session.resetEmulation(1);

    expect(api.sendCommand).not.toHaveBeenCalledWith(1, "Emulation.setUserAgentOverride", expect.anything());
    expect(session.state.get(1)!.emulation).toBeNull();
  });

  it("stop resets emulation before detaching", async () => {
    const { api } = fakeDebuggerApi();
    const session = createDebuggerSession(api);
    await session.start(1);
    session.state.get(1)!.emulation = { preset: "iPhone 15" };

    await session.stop(1);

    const clearIndex = api.sendCommand.mock.calls.findIndex((c) => c[1] === "Emulation.clearDeviceMetricsOverride");
    expect(clearIndex).toBeGreaterThanOrEqual(0);
    const clearOrder = api.sendCommand.mock.invocationCallOrder[clearIndex];
    const detachOrder = api.detach.mock.invocationCallOrder[0];
    expect(clearOrder).toBeLessThan(detachOrder);
  });

  it("dialog with no plan is dismissed and recorded", async () => {
    const { api, fireEvent } = fakeDebuggerApi();
    const session = createDebuggerSession(api);
    await session.start(1);

    fireEvent(1, "Page.javascriptDialogOpening", { type: "confirm", message: "Remove the coupon?" });
    expect(api.sendCommand).toHaveBeenCalledWith(1, "Page.handleJavaScriptDialog", { accept: false });
    const s = session.state.get(1)!;
    expect(s.lastDialog).toBe('confirm "Remove the coupon?" → dismissed (no answer was set)');
    expect(s.dialogs).toEqual(['confirm "Remove the coupon?" → dismissed (no answer was set)']);
  });

  it("dialog with a plan executes plan and clears it", async () => {
    const { api, fireEvent } = fakeDebuggerApi();
    const session = createDebuggerSession(api);
    await session.start(1);

    session.state.get(1)!.dialogPlan = { accept: true, promptText: "hi" };
    fireEvent(1, "Page.javascriptDialogOpening", { type: "prompt", message: "Gift message?" });
    expect(api.sendCommand).toHaveBeenCalledWith(1, "Page.handleJavaScriptDialog", { accept: true, promptText: "hi" });
    const s = session.state.get(1)!;
    expect(s.lastDialog).toBe('prompt "Gift message?" → accepted');
    expect(s.dialogPlan).toBeNull();
  });

  it("handle rejection is caught and not an unhandled rejection", async () => {
    const { api, fireEvent } = fakeDebuggerApi();
    api.sendCommand.mockImplementation((_tabId: number, method: string) => {
      if (method === "Page.handleJavaScriptDialog") {
        return Promise.reject(new Error('{"code":-32602,"message":"No dialog is showing"}'));
      }
      return Promise.resolve({});
    });
    const session = createDebuggerSession(api);
    await session.start(1);

    const spy = vi.fn();
    process.on("unhandledRejection", spy);
    fireEvent(1, "Page.javascriptDialogOpening", { type: "alert", message: "Boom" });
    await new Promise((r) => setTimeout(r, 10));
    process.off("unhandledRejection", spy);

    expect(spy).not.toHaveBeenCalled();
    expect(session.state.get(1)!.dialogs.length).toBe(1);
  });

  it("dialogs list is capped at 50", async () => {
    const { api, fireEvent } = fakeDebuggerApi();
    const session = createDebuggerSession(api);
    await session.start(1);

    for (let i = 0; i <= 50; i++) {
      fireEvent(1, "Page.javascriptDialogOpening", { type: "alert", message: `m${i}` });
    }
    const dialogs = session.state.get(1)!.dialogs;
    expect(dialogs.length).toBe(50);
    expect(dialogs[0]).toContain('"m1"');
    expect(dialogs[49]).toContain('"m50"');
  });

  it("events ignored when not debugging or different method", async () => {
    const { api, fireEvent } = fakeDebuggerApi();
    const session = createDebuggerSession(api);
    await session.start(1);

    // tab 3 has no state
    fireEvent(3, "Page.javascriptDialogOpening", { type: "alert", message: "Tab 3" });
    expect(api.sendCommand).not.toHaveBeenCalledWith(3, "Page.handleJavaScriptDialog", expect.anything());

    // tab 1 is canceled
    session.state.get(1)!.status = "canceled";
    api.sendCommand.mockClear();
    fireEvent(1, "Page.javascriptDialogOpening", { type: "alert", message: "Tab 1" });
    expect(api.sendCommand).not.toHaveBeenCalled();

    // different method
    fireEvent(1, "Page.loadEventFired", {});
    expect(session.state.get(1)!.dialogs.length).toBe(0);
  });

  it("network events are recorded while debugging", async () => {
    const { api, fireEvent } = fakeDebuggerApi();
    const session = createDebuggerSession(api);
    await session.start(1);
    fireEvent(1, "Network.requestWillBeSent", {
      requestId: "r1",
      timestamp: 1,
      type: "Document",
      request: { method: "GET", url: "http://localhost:10040/checkout.html", headers: {} },
    });
    expect(session.state.get(1)!.network).toHaveLength(1);
    expect(session.state.get(1)!.network[0].seq).toBe(1);
  });

  it("network events are ignored for an unknown or canceled tab", async () => {
    const { api, fireEvent } = fakeDebuggerApi();
    const session = createDebuggerSession(api);
    await session.start(1);
    fireEvent(3, "Network.requestWillBeSent", {
      requestId: "r1",
      timestamp: 1,
      type: "Document",
      request: { method: "GET", url: "http://localhost:10040/checkout.html", headers: {} },
    });
    expect(session.state.get(3)).toBeUndefined();

    session.state.get(1)!.status = "canceled";
    fireEvent(1, "Network.requestWillBeSent", {
      requestId: "r2",
      timestamp: 2,
      type: "Document",
      request: { method: "GET", url: "http://localhost:10040/checkout.html", headers: {} },
    });
    expect(session.state.get(1)!.network).toHaveLength(0);
  });

  it("tabUrl delegates to the api", async () => {
    const { api } = fakeDebuggerApi();
    const session = createDebuggerSession(api);
    const url = await session.tabUrl(7);
    expect(url).toBe("http://localhost:10040/checkout.html");
    expect(api.tabUrl).toHaveBeenCalledWith(7);
  });

  it("listeners registered once across multiple starts", async () => {
    const { api } = fakeDebuggerApi();
    const session = createDebuggerSession(api);
    await session.start(1);
    await session.start(2);

    expect(api.onDetach).toHaveBeenCalledTimes(1);
    expect(api.onEvent).toHaveBeenCalledTimes(1);
  });

  it("realClick, pressBackspace, and insertText dispatch CDP commands", async () => {
    const { api } = fakeDebuggerApi();
    const session = createDebuggerSession(api);

    await session.realClick(1, 10, 20);
    expect(api.sendCommand).toHaveBeenNthCalledWith(1, 1, "Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: 10,
      y: 20,
    });
    expect(api.sendCommand).toHaveBeenNthCalledWith(2, 1, "Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: 10,
      y: 20,
      button: "left",
      clickCount: 1,
    });
    expect(api.sendCommand).toHaveBeenNthCalledWith(3, 1, "Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: 10,
      y: 20,
      button: "left",
      clickCount: 1,
    });

    api.sendCommand.mockClear();
    await session.pressBackspace(1);
    expect(api.sendCommand).toHaveBeenNthCalledWith(1, 1, "Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Backspace",
      code: "Backspace",
      windowsVirtualKeyCode: 8,
    });
    expect(api.sendCommand).toHaveBeenNthCalledWith(2, 1, "Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Backspace",
      code: "Backspace",
      windowsVirtualKeyCode: 8,
    });

    api.sendCommand.mockClear();
    await session.insertText(1, "SAVE10");
    expect(api.sendCommand).toHaveBeenCalledWith(1, "Input.insertText", { text: "SAVE10" });
  });

  it("detachAll detaches only debugging tabs and clears state", async () => {
    const { api } = fakeDebuggerApi();
    const session = createDebuggerSession(api);
    await session.start(1);
    await session.start(2);
    session.state.get(2)!.status = "canceled";

    api.detach.mockRejectedValueOnce(new Error("detach error ignored"));
    expect(() => session.detachAll()).not.toThrow();
    expect(api.detach).toHaveBeenCalledWith(1);
    expect(api.detach).not.toHaveBeenCalledWith(2);
    expect(session.state.size).toBe(0);
  });

  it("no chrome at construction with default API", () => {
    expect(() => createDebuggerSession()).not.toThrow();
  });

  it("a console event replayed during Runtime.enable is kept", async () => {
    const { api, fireEvent } = fakeDebuggerApi();
    api.sendCommand.mockImplementation((tabId: number, method: string) => {
      if (method === "Runtime.enable") {
        fireEvent(tabId, "Runtime.consoleAPICalled", {
          type: "log",
          args: [{ type: "string", value: "early" }],
        });
        return Promise.resolve({});
      }
      if (method === "Runtime.evaluate") {
        return Promise.resolve({ result: { type: "string", value: "UA/1" } });
      }
      return Promise.resolve({});
    });
    const session = createDebuggerSession(api);

    await session.start(1);

    expect(session.readConsole(1).entries).toEqual([expect.objectContaining({ level: "log", text: "early" })]);
  });

  describe("the console buffer", () => {
    it("maps every CDP type to a level", async () => {
      const { api, fireEvent } = fakeDebuggerApi();
      const session = createDebuggerSession(api);
      await session.start(1);

      const cases: [string, string][] = [
        ["log", "log"],
        ["info", "info"],
        ["warning", "warn"],
        ["error", "error"],
        ["assert", "error"],
        ["debug", "log"],
        ["table", "log"],
      ];
      for (const [type] of cases) {
        fireEvent(1, "Runtime.consoleAPICalled", { type, args: [{ type: "string", value: type }] });
      }
      const levels = session.readConsole(1, { limit: 200 }).entries.map((e) => e.level);
      expect(levels).toEqual(cases.map(([, level]) => level));
    });

    it("renders primitives and previews", async () => {
      const { api, fireEvent } = fakeDebuggerApi();
      const session = createDebuggerSession(api);
      await session.start(1);

      fireEvent(1, "Runtime.consoleAPICalled", { type: "log", args: [{ type: "string", value: "x" }] });
      fireEvent(1, "Runtime.consoleAPICalled", { type: "log", args: [{ type: "number", value: 42 }] });
      fireEvent(1, "Runtime.consoleAPICalled", { type: "log", args: [{ type: "undefined" }] });
      fireEvent(1, "Runtime.consoleAPICalled", { type: "log", args: [{ subtype: "null", value: null }] });
      fireEvent(1, "Runtime.consoleAPICalled", {
        type: "log",
        args: [
          {
            type: "object",
            className: "Object",
            description: "Object",
            preview: {
              properties: [
                { name: "a", type: "number", value: "1" },
                { name: "b", type: "string", value: "two" },
              ],
              overflow: false,
            },
          },
        ],
      });
      fireEvent(1, "Runtime.consoleAPICalled", {
        type: "log",
        args: [
          {
            type: "object",
            subtype: "array",
            description: "Array(3)",
            preview: {
              subtype: "array",
              properties: [
                { name: "0", value: "1" },
                { name: "1", value: "2" },
                { name: "2", value: "3" },
              ],
              overflow: false,
            },
          },
        ],
      });
      fireEvent(1, "Runtime.consoleAPICalled", {
        type: "log",
        args: [
          {
            type: "object",
            className: "Object",
            description: "Object",
            preview: { properties: [{ name: "a", type: "number", value: "1" }], overflow: true },
          },
        ],
      });

      const texts = session.readConsole(1, { limit: 200 }).entries.map((e) => e.text);
      expect(texts[0]).toBe("x");
      expect(texts[1]).toBe("42");
      expect(texts[2]).toBe("undefined");
      expect(texts[3]).toBe("null");
      expect(texts[4]).toBe("Object {a: 1, b: two}");
      expect(texts[5]).toBe("Array(3) [1, 2, 3]");
      expect(texts[6].endsWith(", …}")).toBe(true);
    });

    it("records an exception at level error, from its description", async () => {
      const { api, fireEvent } = fakeDebuggerApi();
      const session = createDebuggerSession(api);
      await session.start(1);

      fireEvent(1, "Runtime.exceptionThrown", {
        exceptionDetails: { exception: { description: "RangeError: x\n at y" } },
      });

      const entries = session.readConsole(1).entries;
      expect(entries).toHaveLength(1);
      expect(entries[0].level).toBe("error");
      expect(entries[0].text.startsWith("RangeError: x")).toBe(true);
    });

    it("falls back to exceptionDetails.text", async () => {
      const { api, fireEvent } = fakeDebuggerApi();
      const session = createDebuggerSession(api);
      await session.start(1);

      fireEvent(1, "Runtime.exceptionThrown", { exceptionDetails: { text: "Uncaught" } });

      const entries = session.readConsole(1).entries;
      expect(entries[0].text).toBe("Uncaught");
    });

    it("cuts an entry at 2000 characters", async () => {
      const { api, fireEvent } = fakeDebuggerApi();
      const session = createDebuggerSession(api);
      await session.start(1);

      const long = "y".repeat(3000);
      fireEvent(1, "Runtime.consoleAPICalled", { type: "log", args: [{ type: "string", value: long }] });

      const entries = session.readConsole(1).entries;
      expect(entries[0].text.length).toBe(2000);
    });

    it("drops the oldest past 200", async () => {
      const { api, fireEvent } = fakeDebuggerApi();
      const session = createDebuggerSession(api);
      await session.start(1);

      for (let i = 0; i < 205; i++) {
        fireEvent(1, "Runtime.consoleAPICalled", { type: "log", args: [{ type: "string", value: `m${i}` }] });
      }
      const reply = session.readConsole(1, { limit: 200 });
      expect(reply.dropped).toBe(5);
      expect(reply.entries).toHaveLength(200);
      expect(reply.entries[0].text).toBe("m5");
    });

    it("a main-frame navigation resets the buffer and the document id", async () => {
      const { api, fireEvent } = fakeDebuggerApi();
      const session = createDebuggerSession(api);
      await session.start(1);

      fireEvent(1, "Runtime.consoleAPICalled", { type: "log", args: [{ type: "string", value: "before" }] });
      const before = session.readConsole(1);
      expect(before.entries).toHaveLength(1);

      fireEvent(1, "Page.frameNavigated", { frame: { url: "http://localhost:10040/next.html" } });

      const after = session.readConsole(1);
      expect(after.entries).toHaveLength(0);
      expect(after.documentId).not.toBe(before.documentId);
    });

    it("readConsole on an unknown tab is empty", () => {
      const { api } = fakeDebuggerApi();
      const session = createDebuggerSession(api);
      expect(session.readConsole(99)).toEqual({ documentId: "", dropped: 0, total: 0, entries: [] });
    });
  });

  describe("frames", () => {
    const attach = (
      fireEvent: (t: number, m: string, p: unknown, sessionId?: string) => void,
      sessionId: string,
      targetId: string,
      url: string,
      tabId = 1,
    ) => fireEvent(tabId, "Target.attachedToTarget", { sessionId, targetInfo: { type: "iframe", targetId, url } });
    const flush = () => new Promise((r) => setTimeout(r, 0));

    it("sets auto-attach and records the top frame id on start", async () => {
      const { api } = fakeDebuggerApi();
      const session = createDebuggerSession(api);
      await session.start(1);

      expect(api.sendCommand).toHaveBeenCalledWith(1, "Target.setAutoAttach", {
        autoAttach: true,
        waitForDebuggerOnStart: false,
        flatten: true,
      });
      expect(session.state.get(1)!.topFrameId).toBe("top-frame");
    });

    it("enables Runtime, Page and DOM on a newly attached iframe target", async () => {
      const { api, fireEvent } = fakeDebuggerApi();
      const session = createDebuggerSession(api);
      await session.start(1);
      api.sendCommand.mockClear();

      attach(fireEvent, "S1", "F1", "http://pay.test/");
      await flush();

      expect(api.sendCommand).toHaveBeenCalledWith(1, "Runtime.enable", undefined, "S1");
      expect(api.sendCommand).toHaveBeenCalledWith(1, "Page.enable", undefined, "S1");
      expect(api.sendCommand).toHaveBeenCalledWith(1, "DOM.enable", undefined, "S1");
      expect(api.sendCommand).toHaveBeenCalledWith(1, "DOM.getDocument", { depth: 1 }, "S1");
      expect(api.sendCommand).toHaveBeenCalledWith(
        1,
        "Target.setAutoAttach",
        { autoAttach: true, waitForDebuggerOnStart: false, flatten: true },
        "S1",
      );
      expect(session.frames.childBySession(1, "S1")?.origin).toBe("http://pay.test");
    });

    it("prefixes a console entry from a child session", async () => {
      const { api, fireEvent } = fakeDebuggerApi();
      const session = createDebuggerSession(api);
      await session.start(1);
      attach(fireEvent, "S1", "F1", "http://pay.test/");
      await flush();

      fireEvent(1, "Runtime.consoleAPICalled", { type: "log", args: [{ type: "string", value: "hello" }] }, "S1");

      expect(session.readConsole(1).entries[0].text).toBe("(frame http://pay.test) hello");
    });

    it("prefixes a console entry from a same-site frame by frame id", async () => {
      const { api, fireEvent } = fakeDebuggerApi();
      const session = createDebuggerSession(api);
      await session.start(1);

      fireEvent(1, "Runtime.executionContextCreated", {
        context: { id: 42, origin: "http://localhost:10040", auxData: { isDefault: true, frameId: "same-site-frame" } },
      });
      fireEvent(1, "Runtime.consoleAPICalled", { type: "log", args: [{ type: "string", value: "hi" }], executionContextId: 42 });

      expect(session.readConsole(1).entries[0].text).toBe("(frame http://localhost:10040) hi");
    });

    it("does not prefix a top-frame entry", async () => {
      const { api, fireEvent } = fakeDebuggerApi();
      const session = createDebuggerSession(api);
      await session.start(1);

      fireEvent(1, "Runtime.executionContextCreated", {
        context: { id: 1, origin: "http://localhost:10040", auxData: { isDefault: true, frameId: "top-frame" } },
      });
      fireEvent(1, "Runtime.consoleAPICalled", { type: "log", args: [{ type: "string", value: "hi" }], executionContextId: 1 });

      expect(session.readConsole(1).entries[0].text).toBe("hi");
    });

    it("does not prefix an entry whose context is unknown", async () => {
      const { api, fireEvent } = fakeDebuggerApi();
      const session = createDebuggerSession(api);
      await session.start(1);

      fireEvent(1, "Runtime.consoleAPICalled", { type: "log", args: [{ type: "string", value: "hi" }], executionContextId: 999 });

      expect(session.readConsole(1).entries[0].text).toBe("hi");
    });

    it("does not clear the console when an iframe navigates", async () => {
      const { api, fireEvent } = fakeDebuggerApi();
      const session = createDebuggerSession(api);
      await session.start(1);
      attach(fireEvent, "S1", "F1", "http://pay.test/");
      await flush();

      fireEvent(1, "Runtime.consoleAPICalled", { type: "log", args: [{ type: "string", value: "before" }] });
      const before = session.readConsole(1);

      fireEvent(1, "Page.frameNavigated", { frame: { id: "same-site-frame", url: "http://localhost:10040/x.html", parentId: "top-frame" } });
      fireEvent(1, "Page.frameNavigated", { frame: { id: "F1", url: "http://pay.test/next" } }, "S1");

      const after = session.readConsole(1);
      expect(after.entries).toHaveLength(before.entries.length);
      expect(after.documentId).toBe(before.documentId);
    });

    it("notifies onFrameNavigated for every frame", async () => {
      const { api, fireEvent } = fakeDebuggerApi();
      const session = createDebuggerSession(api);
      await session.start(1);
      const calls: [number, string | undefined, string, boolean][] = [];
      session.onFrameNavigated((tabId, sessionId, frameId, isMain) => calls.push([tabId, sessionId, frameId, isMain]));

      fireEvent(1, "Page.frameNavigated", { frame: { id: "top-frame", url: "http://localhost:10040/next.html" } });
      fireEvent(1, "Page.frameNavigated", { frame: { id: "F1", url: "http://pay.test/next" } }, "S1");

      expect(calls).toEqual([
        [1, undefined, "top-frame", true],
        [1, "S1", "F1", true],
      ]);
    });

    it("forgets a tab's frames on stop and on target_closed", async () => {
      const { api, fireEvent, fireDetach } = fakeDebuggerApi();
      const session = createDebuggerSession(api);
      await session.start(1);
      attach(fireEvent, "S1", "F1", "http://pay.test/");
      await flush();
      expect(session.frames.childBySession(1, "S1")).toBeDefined();

      await session.stop(1);
      expect(session.frames.childBySession(1, "S1")).toBeUndefined();

      await session.start(2);
      attach(fireEvent, "S2", "F2", "http://pay.test/", 2);
      await flush();
      expect(session.frames.childBySession(2, "S2")).toBeDefined();
      fireDetach(2, "target_closed");
      expect(session.frames.childBySession(2, "S2")).toBeUndefined();
    });
  });
});
