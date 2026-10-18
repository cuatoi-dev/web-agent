import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "@cuatoi/web-agent-core";
import { createPanelPageTools } from "./panel-page-tools";
import type { DebuggerSession } from "./debugger-tools.types";
import type { RecordingController, RecordingResult, RecordingState } from "./recorder.types";

function toolCtx(): ToolContext {
  return { app: {}, signal: new AbortController().signal };
}

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
  });

  function getTools(overrides: Record<string, unknown> = {}) {
    const tools = createPanelPageTools({
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
    expect(res.content).toBe(expected);
    expect(res.isError).toBeUndefined();
    expect(res.content).not.toContain("[");
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
    expect(res.content).toContain("Recorded 1 step on localhost:10040:\nRecording stopped: debugging was canceled.\n1. click button \"Apply\"");
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
