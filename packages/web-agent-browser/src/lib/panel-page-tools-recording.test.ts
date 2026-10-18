import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "@cuatoi/web-agent-core";
import { MemoryBackend, vfsTools } from "@cuatoi/web-agent-vfs";
import { createPanelPageTools } from "./panel-page-tools";
import { testVfs } from "./test-vfs";
import type { DebuggerSession } from "./debugger-tools.types";
import type { RecordingController, RecordingResult, RecordingState } from "./recorder.types";

function toolCtx(): ToolContext {
  return { app: {}, signal: new AbortController().signal };
}

/** 127/003 — stop_recording returns its report followed by the path it saved
 *  it at. These two read the two halves back apart. */
function reportOf(content: string): string {
  const i = content.lastIndexOf("\nSaved ");
  return i < 0 ? content : content.slice(0, i);
}

function savedPathOf(content: string): string {
  const i = content.lastIndexOf("\nSaved ");
  return i < 0 ? "" : content.slice(i + "\nSaved ".length);
}

const SAVED_PATH = /^\/tmp\/recordings\/\d{4}-\d{2}-\d{2}-\d{6}\.md$/;

function fakeDebuggerSession(gate: DebuggerSession["gate"] = () => ({ ok: true, state: {} as never })): DebuggerSession {
  return {
    gate,
    onMainFrameNavigated: () => {},
    onFrameNavigated: () => {},
    onChildAttached: () => {},
    onBindingCalled: () => {},
    onNavigatedWithinDocument: () => {},
    onDetached: () => {},
  } as unknown as DebuggerSession;
}

describe("panel-page-tools-recording", () => {
  let controller: RecordingController;
  let debuggerSession: DebuggerSession;
  let currentState: RecordingState;
  let vfs: ReturnType<typeof testVfs>;

  beforeEach(() => {
    currentState = { kind: "idle" };
    controller = {
      state: () => currentState,
      tabInfo: vi.fn().mockResolvedValue({ host: "localhost:10040", url: "http://localhost:10040/checkout.html" }),
      start: vi.fn().mockResolvedValue({ ok: true }),
      stop: vi.fn().mockResolvedValue({ error: "Nothing is being recorded." }),
      pause: vi.fn().mockResolvedValue(undefined),
      resume: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn().mockReturnValue(() => {}),
    };
    debuggerSession = fakeDebuggerSession();
    vfs = testVfs();
  });

  function getTools(overrides: Record<string, unknown> = {}) {
    const tools = createPanelPageTools({
      vfs,
      recording: controller,
      debuggerSession,
      ...overrides,
    });
    const startTool = tools.find((t) => t.name === "start_recording")!;
    const stopTool = tools.find((t) => t.name === "stop_recording")!;
    return { startTool, stopTool, tools };
  }

  it("U-T1: start_recording with confirmInteraction resolving true", async () => {
    const confirmInteraction = vi.fn().mockResolvedValue(true);
    const { startTool } = getTools({ confirmInteraction });

    const res = await startTool.execute({ tabId: 7 }, toolCtx());
    expect(confirmInteraction).toHaveBeenCalledTimes(1);
    expect(confirmInteraction).toHaveBeenCalledWith({
      action: "record",
      summary: "Watch you on localhost:10040 and record your clicks and typing",
    });
    expect(res).toEqual({
      content: "Recording on localhost:10040. Steps appear when the user stops or the page navigates.",
    });
    expect(controller.start).toHaveBeenCalledWith(7, { host: "localhost:10040", url: "http://localhost:10040/checkout.html" }, "tool");
  });

  it("U-T2: start_recording with confirmInteraction resolving false", async () => {
    const confirmInteraction = vi.fn().mockResolvedValue(false);
    const { startTool } = getTools({ confirmInteraction });

    const res = await startTool.execute({ tabId: 7 }, toolCtx());
    expect(res).toEqual({
      content: "Recording on localhost:10040 was not confirmed by the user; not started.",
      isError: true,
    });
    expect(controller.start).not.toHaveBeenCalled();
  });

  it("U-T3: start_recording when controller is already recording", async () => {
    vi.mocked(controller.start).mockResolvedValue({ ok: false, error: "Already recording on localhost:10040." });
    const { startTool } = getTools();

    const res = await startTool.execute({ tabId: 7 }, toolCtx());
    expect(res).toEqual({
      content: "Already recording on localhost:10040.",
      isError: true,
    });
  });

  it("U-T4: start_recording when tabInfo rejects", async () => {
    vi.mocked(controller.tabInfo).mockRejectedValue(new Error("tab closed"));
    const { startTool } = getTools();

    const res = await startTool.execute({ tabId: 7 }, toolCtx());
    expect(res.content).toMatch(/^start_recording could not read tab #7: /);
    expect(res.isError).toBe(true);
  });

  it("U-T5: start_recording with no confirmInteraction in options", async () => {
    const { startTool } = getTools({ confirmInteraction: undefined });

    const res = await startTool.execute({ tabId: 7 }, toolCtx());
    expect(res).toEqual({
      content: "Recording on localhost:10040. Steps appear when the user stops or the page navigates.",
    });
    expect(controller.start).toHaveBeenCalledTimes(1);
  });

  it("U-T6: stop_recording on a debugged tab with three steps", async () => {
    const recordingResult: RecordingResult = {
      host: "localhost:10040",
      url: "http://localhost:10040/checkout.html",
      steps: [
        { recordingId: "r", seq: 0, kind: "click", line: 'click button "Apply"' },
        { recordingId: "r", seq: 1, kind: "click", line: 'click button "Pay"', frameOrigin: "http://pay.test" },
        { recordingId: "r", seq: 2, kind: "check", line: 'check checkbox "Gift"' },
      ],
    };
    vi.mocked(controller.stop).mockResolvedValue(recordingResult);
    const { stopTool } = getTools();

    const res = await stopTool.execute({ tabId: 7 }, toolCtx());
    const expected =
      'Recorded 3 steps on localhost:10040:\n1. click button "Apply"\n2. (frame http://pay.test) click button "Pay"\n3. check checkbox "Gift"';
    expect(reportOf(res.content)).toBe(expected);
    expect(savedPathOf(res.content)).toMatch(SAVED_PATH);
    expect(await vfs.get(savedPathOf(res.content))).toMatchObject({ content: expected, encoding: "utf8" });
    expect(res.isError).toBeUndefined();
    expect(res.content).not.toContain("[");
  });

  it("U-T6b: stop_recording prints locator lines under element steps", async () => {
    const recordingResult: RecordingResult = {
      host: "localhost:10040",
      url: "http://localhost:10040/checkout.html",
      steps: [
        {
          recordingId: "r",
          seq: 0,
          kind: "click",
          line: 'click button "Pay"',
          frameOrigin: "http://pay.test",
          frames: ["#payment"],
          locators: { role: "button", name: "Pay", roleMatches: 1, id: "pay", css: "#pay", xpath: "//*[@id='pay']" },
        },
        { recordingId: "r", seq: 1, kind: "scroll", line: "scroll down 400 px" },
        {
          recordingId: "r",
          seq: 2,
          kind: "fill",
          line: 'fill textbox "Password" <password>',
          masked: true,
          locators: { role: "textbox", name: "Password", roleMatches: 1, id: "password", nameAttr: "password", css: "#password", xpath: "//*[@id='password']" },
        },
      ],
    };
    vi.mocked(controller.stop).mockResolvedValue(recordingResult);
    const { stopTool } = getTools();

    const res = await stopTool.execute({ tabId: 7 }, toolCtx());
    const expected =
      'Recorded 3 steps on localhost:10040:\n' +
      '1. (frame http://pay.test) click button "Pay"\n' +
      '  role+name: button "Pay" (matches 1)\n' +
      '  id: pay\n' +
      '  data-testid: —\n' +
      '  name: —\n' +
      '  css: #pay\n' +
      "  xpath: //*[@id='pay']\n" +
      '  frames: #payment\n' +
      '2. scroll down 400 px\n' +
      '3. fill textbox "Password" <password>\n' +
      '  role+name: textbox "Password" (matches 1)\n' +
      '  id: password\n' +
      '  data-testid: —\n' +
      '  name: password\n' +
      '  css: #password\n' +
      "  xpath: //*[@id='password']";
    expect(reportOf(res.content)).toBe(expected);
    expect(await vfs.get(savedPathOf(res.content))).toMatchObject({ content: expected });
    expect(res.content).not.toMatch(/getBy|\.nth\(/);
  });

  it("U-T7: stop_recording with a note", async () => {
    const recordingResult: RecordingResult = {
      host: "localhost:10040",
      url: "http://localhost:10040/checkout.html",
      note: "Recording stopped: debugging was canceled.",
      steps: [{ recordingId: "r", seq: 0, kind: "click", line: 'click button "Apply"' }],
    };
    vi.mocked(controller.stop).mockResolvedValue(recordingResult);
    const { stopTool } = getTools();

    const res = await stopTool.execute({ tabId: 7 }, toolCtx());
    const body = 'Recorded 1 step on localhost:10040:\nRecording stopped: debugging was canceled.\n1. click button "Apply"';
    expect(res.content).toContain(body);
    expect(await vfs.get(savedPathOf(res.content))).toMatchObject({ content: body });
  });

  it("U-T8: stop_recording with one step (singular)", async () => {
    const recordingResult: RecordingResult = {
      host: "localhost:10040",
      url: "http://localhost:10040/checkout.html",
      steps: [{ recordingId: "r", seq: 0, kind: "click", line: 'click button "Apply"' }],
    };
    vi.mocked(controller.stop).mockResolvedValue(recordingResult);
    const { stopTool } = getTools();

    const res = await stopTool.execute({ tabId: 7 }, toolCtx());
    expect(res.content.startsWith("Recorded 1 step on localhost:10040:")).toBe(true);
    expect(savedPathOf(res.content)).toMatch(SAVED_PATH);
    expect((await vfs.get(savedPathOf(res.content)))?.content).toBe(reportOf(res.content));
  });

  it("U-T10: stop_recording when controller is idle and the tab is not gated returns the gate error", async () => {
    debuggerSession = fakeDebuggerSession(() => ({ ok: false, error: "Debugging is not started on tab #7. Call start_debugging first." }));
    const { stopTool } = getTools();

    const res = await stopTool.execute({ tabId: 7 }, toolCtx());
    expect(res).toEqual({ content: "Debugging is not started on tab #7. Call start_debugging first.", isError: true });
    expect(controller.stop).not.toHaveBeenCalled();
  });

  it("U-T11: stop_recording when the recording is idle but the tab is gated calls stop() as normal", async () => {
    vi.mocked(controller.stop).mockResolvedValue({ error: "Nothing is being recorded." });
    const { stopTool } = getTools();

    const res = await stopTool.execute({ tabId: 7 }, toolCtx());
    expect(res).toEqual({ content: "Nothing is being recorded.", isError: true });
  });

  it("U-T12: stop_recording with a stopped recording on a closed tab returns the report WITHOUT calling gate", async () => {
    currentState = {
      kind: "stopped",
      host: "localhost:10040",
      url: "http://localhost:10040/checkout.html",
      steps: [{ recordingId: "r", seq: 0, kind: "click", line: 'click button "Apply"' }],
    };
    const gate = vi.fn((): ReturnType<DebuggerSession["gate"]> => ({ ok: false, error: "Debugging is not started on tab #7. Call start_debugging first." }));
    debuggerSession = fakeDebuggerSession(gate);
    const recordingResult: RecordingResult = {
      host: "localhost:10040",
      url: "http://localhost:10040/checkout.html",
      steps: [{ recordingId: "r", seq: 0, kind: "click", line: 'click button "Apply"' }],
    };
    vi.mocked(controller.stop).mockResolvedValue(recordingResult);
    const { stopTool } = getTools();

    const res = await stopTool.execute({ tabId: 7 }, toolCtx());
    expect(res.isError).toBeUndefined();
    expect(gate).not.toHaveBeenCalled();
    expect(reportOf(res.content)).toBe('Recorded 1 step on localhost:10040:\n1. click button "Apply"');
    expect(await vfs.get(savedPathOf(res.content))).toMatchObject({
      content: 'Recorded 1 step on localhost:10040:\n1. click button "Apply"',
    });
  });

  it("U-T13: start_recording passes a controller error straight through", async () => {
    vi.mocked(controller.start).mockResolvedValue({ ok: false, error: "Debugging is not started on tab #7. Call start_debugging first." });
    const { startTool } = getTools();

    const res = await startTool.execute({ tabId: 7 }, toolCtx());
    expect(res).toEqual({ content: "Debugging is not started on tab #7. Call start_debugging first.", isError: true });
  });

  it("U-T14: createPanelPageTools({}) ends with page_emulate, start_recording, stop_recording", () => {
    const { tools } = getTools();
    const names = tools.map((t) => t.name);
    const lastThree = names.slice(-3);
    expect(lastThree).toEqual(["page_emulate", "start_recording", "stop_recording"]);
  });

  it("both descriptions read as the plan requires", () => {
    const { startTool, stopTool } = getTools();
    expect(startTool.description).toContain("start_debugging");
    expect(stopTool.description).not.toContain("navigated");
  });
});

describe("panel-page-tools-recording — the saved report (127/003)", () => {
  let controller: RecordingController;

  beforeEach(() => {
    controller = {
      state: () => ({ kind: "idle" }),
      tabInfo: vi.fn().mockResolvedValue({ host: "localhost:10040", url: "http://localhost:10040/checkout.html" }),
      start: vi.fn().mockResolvedValue({ ok: true }),
      stop: vi.fn().mockResolvedValue({ error: "Nothing is being recorded." }),
      pause: vi.fn().mockResolvedValue(undefined),
      resume: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn().mockReturnValue(() => {}),
    };
  });

  function stopToolFor(vfs: ReturnType<typeof testVfs>) {
    const tools = createPanelPageTools({
      vfs,
      recording: controller,
      debuggerSession: fakeDebuggerSession(),
    });
    return tools.find((t) => t.name === "stop_recording")!;
  }

  it("a recording with no steps still saves its report", async () => {
    const vfs = testVfs();
    vi.mocked(controller.stop).mockResolvedValue({
      host: "localhost:10040",
      url: "http://localhost:10040/checkout.html",
      steps: [],
    });
    const res = await stopToolFor(vfs).execute({ tabId: 7 }, toolCtx());

    expect(reportOf(res.content)).toBe("Recorded 0 steps on localhost:10040:");
    expect((await vfs.get(savedPathOf(res.content)))?.content).toBe("Recorded 0 steps on localhost:10040:");
  });

  it("a gate failure saves nothing", async () => {
    const vfs = testVfs();
    const denied = fakeDebuggerSession(() => ({ ok: false, error: "Debugging is not started on tab #7. Call start_debugging first." }));
    const tools = createPanelPageTools({ vfs, recording: controller, debuggerSession: denied });
    const res = await tools.find((t) => t.name === "stop_recording")!.execute({ tabId: 7 }, toolCtx());

    expect(res.isError).toBe(true);
    expect(await vfs.list("/")).toEqual([]);
  });

  it("an idle recording saves nothing", async () => {
    const vfs = testVfs();
    vi.mocked(controller.stop).mockResolvedValue({ error: "Nothing is being recorded." });
    const res = await stopToolFor(vfs).execute({ tabId: 7 }, toolCtx());

    expect(res.isError).toBe(true);
    expect(await vfs.list("/")).toEqual([]);
  });

  it("storage that rejects fails the whole call and stores nothing", async () => {
    const tmp = MemoryBackend();
    tmp.set = () => Promise.reject(new Error("the storage for /tmp is full."));
    const vfs = vfsTools({ tmp, home: MemoryBackend(), shared: MemoryBackend() }).vfs;
    vi.mocked(controller.stop).mockResolvedValue({
      host: "localhost:10040",
      url: "http://localhost:10040/checkout.html",
      steps: [{ recordingId: "r", seq: 0, kind: "click", line: 'click button "Apply"' }],
    });
    const res = await stopToolFor(vfs).execute({ tabId: 7 }, toolCtx());

    expect(res).toEqual({ content: "the storage for /tmp is full.", isError: true });
    expect(res.content).not.toContain("Saved ");
    expect(await vfs.list("/")).toEqual([]);
  });
});
