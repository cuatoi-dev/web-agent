import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { REC_RESUME_DELAY_MS } from "./constants";
import { createActionJournal } from "./action-journal";
import { createRecordingController, hostOf } from "./recording-controller";
import type { DebuggerGate, DebuggerSession, DebuggerToolText } from "./debugger-tools.types";
import type { DebuggerRecorder } from "./debugger-recorder.types";
import type { RecordedStep, RecordingApi } from "./recorder.types";

// No explicit interface return type: a method-shorthand interface signature
// (`install(tabId): Promise<void>`) makes eslint's unbound-method rule flag a
// bare `expect(recorder.install)` reference below. `satisfies` still checks
// assignability to the interface without widening the inferred property
// types to "method" style.
function fakeSession(overrides: Partial<DebuggerSession> = {}) {
  return {
    start: vi.fn().mockResolvedValue({ content: "Debugging tab #7 (x)." }),
    stop: vi.fn().mockResolvedValue("Stopped."),
    gate: vi.fn(() => ({ ok: false, error: "Debugging is not started on tab #7. Call start_debugging first." })),
    send: vi.fn().mockResolvedValue({}),
    frames: {} as DebuggerSession["frames"],
    onFrameNavigated: vi.fn(),
    realClick: vi.fn().mockResolvedValue(undefined),
    pressBackspace: vi.fn().mockResolvedValue(undefined),
    insertText: vi.fn().mockResolvedValue(undefined),
    resetEmulation: vi.fn().mockResolvedValue(undefined),
    detachAll: vi.fn(),
    tabUrl: vi.fn().mockResolvedValue("http://localhost:10040/checkout.html"),
    readConsole: vi.fn(() => ({ documentId: "", dropped: 0, total: 0, entries: [] })),
    state: new Map(),
    onMainFrameNavigated: vi.fn(),
    onChildAttached: vi.fn(),
    onBindingCalled: vi.fn(),
    onNavigatedWithinDocument: vi.fn(),
    onDetached: vi.fn(),
    ...overrides,
  } satisfies DebuggerSession;
}

function fakeRecorder(overrides: Partial<DebuggerRecorder> = {}) {
  return {
    install: vi.fn().mockResolvedValue(undefined),
    uninstall: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    onStep: vi.fn(),
    onRoute: vi.fn(),
    ...overrides,
  } satisfies DebuggerRecorder;
}

describe("recording-controller", () => {
  let tabRemovedListeners: ((tabId: number) => void)[];
  let api: RecordingApi;

  beforeEach(() => {
    tabRemovedListeners = [];
    api = {
      addTabRemovedListener: (l) => tabRemovedListeners.push(l),
      removeTabRemovedListener: (l) => {
        tabRemovedListeners = tabRemovedListeners.filter((x) => x !== l);
      },
      tabUrl: vi.fn().mockResolvedValue("http://localhost:10040/checkout.html"),
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("start(tabId, info, \"tool\") on an ungated tab returns the gate error and installs nothing", async () => {
    const session = fakeSession();
    const recorder = fakeRecorder();
    const c = createRecordingController({ api, session, recorder });

    const res = await c.start(7, { host: "localhost:10040", url: "http://localhost:10040/checkout.html" }, "tool");
    expect(res).toEqual({ ok: false, error: "Debugging is not started on tab #7. Call start_debugging first." });
    expect(recorder.install).not.toHaveBeenCalled();
  });

  it("start(…, \"button\") on an ungated tab attaches, then installs, and returns ok", async () => {
    const session = fakeSession();
    const recorder = fakeRecorder();
    const c = createRecordingController({ api, session, recorder });

    const res = await c.start(7, { host: "localhost:10040", url: "http://localhost:10040/checkout.html" }, "button");
    expect(res).toEqual({ ok: true });
    expect(session.start).toHaveBeenCalledWith(7);
    expect(recorder.install).toHaveBeenCalledWith(7, expect.any(String));
  });

  it("start(…, \"button\") when session.start errors returns the Watch me error and installs nothing", async () => {
    const session = fakeSession({
      start: vi.fn().mockResolvedValue({ content: "no chrome:// pages", isError: true } satisfies DebuggerToolText),
    });
    const recorder = fakeRecorder();
    const c = createRecordingController({ api, session, recorder });

    const res = await c.start(7, { host: "x", url: "http://x" }, "button");
    expect(res).toEqual({ ok: false, error: "Watch me could not start: no chrome:// pages" });
    expect(recorder.install).not.toHaveBeenCalled();
  });

  it("start twice returns Already recording", async () => {
    const session = fakeSession({ gate: vi.fn(() => ({ ok: true, state: {} as never }) satisfies DebuggerGate) });
    const recorder = fakeRecorder();
    const c = createRecordingController({ api, session, recorder });

    await c.start(7, { host: "localhost:10040", url: "http://x" }, "tool");
    const second = await c.start(7, { host: "localhost:10040", url: "http://x" }, "tool");
    expect(second).toEqual({ ok: false, error: "Already recording on localhost:10040." });
  });

  it("a step arriving for another tab is ignored", async () => {
    const stepListeners: ((tabId: number, step: RecordedStep) => void)[] = [];
    const session = fakeSession({ gate: vi.fn(() => ({ ok: true, state: {} as never }) satisfies DebuggerGate) });
    const recorder = fakeRecorder({ onStep: (l) => stepListeners.push(l) });
    const c = createRecordingController({ api, session, recorder });
    await c.start(7, { host: "x", url: "http://x" }, "tool");

    stepListeners[0](99, { recordingId: "r", seq: 0, kind: "click", line: "other tab" });

    const res = await c.stop();
    if ("error" in res) throw new Error("expected recording result");
    expect(res.steps).toHaveLength(0);
  });

  it("a step with a stale recordingId is ignored", async () => {
    const stepListeners: ((tabId: number, step: RecordedStep) => void)[] = [];
    const session = fakeSession({ gate: vi.fn(() => ({ ok: true, state: {} as never }) satisfies DebuggerGate) });
    const recorder = fakeRecorder({ onStep: (l) => stepListeners.push(l) });
    const c = createRecordingController({ api, session, recorder });
    await c.start(7, { host: "x", url: "http://x" }, "tool");

    stepListeners[0](7, { recordingId: "stale", seq: 0, kind: "click", line: "stale" });

    const res = await c.stop();
    if ("error" in res) throw new Error("expected recording result");
    expect(res.steps).toHaveLength(0);
  });

  it("two steps with the same seq: the list holds one entry, the later one", async () => {
    const stepListeners: ((tabId: number, step: RecordedStep) => void)[] = [];
    const session = fakeSession({ gate: vi.fn(() => ({ ok: true, state: {} as never }) satisfies DebuggerGate) });
    const recorder = fakeRecorder({ onStep: (l) => stepListeners.push(l) });
    const c = createRecordingController({ api, session, recorder });
    await c.start(7, { host: "x", url: "http://x" }, "tool");
    const recordingId = c.state().kind === "recording" ? c.state().recordingId : "";

    stepListeners[0](7, { recordingId, seq: 1, kind: "fill", line: "first" });
    stepListeners[0](7, { recordingId, seq: 1, kind: "fill", line: "second" });

    const res = await c.stop();
    if ("error" in res) throw new Error("expected recording result");
    expect(res.steps).toHaveLength(1);
    expect(res.steps[0].line).toBe("second");
  });

  it("steps arriving out of order are sorted by seq", async () => {
    const stepListeners: ((tabId: number, step: RecordedStep) => void)[] = [];
    const session = fakeSession({ gate: vi.fn(() => ({ ok: true, state: {} as never }) satisfies DebuggerGate) });
    const recorder = fakeRecorder({ onStep: (l) => stepListeners.push(l) });
    const c = createRecordingController({ api, session, recorder });
    await c.start(7, { host: "x", url: "http://x" }, "tool");
    const recordingId = c.state().kind === "recording" ? c.state().recordingId : "";

    stepListeners[0](7, { recordingId, seq: 2, kind: "click", line: "two" });
    stepListeners[0](7, { recordingId, seq: 0, kind: "click", line: "zero" });

    const res = await c.stop();
    if ("error" in res) throw new Error("expected recording result");
    expect(res.steps.map((s) => s.seq)).toEqual([0, 2]);
  });

  it("a full navigation produces no note and the state stays recording", async () => {
    const session = fakeSession({ gate: vi.fn(() => ({ ok: true, state: {} as never }) satisfies DebuggerGate) });
    const recorder = fakeRecorder();
    const c = createRecordingController({ api, session, recorder });
    await c.start(7, { host: "x", url: "http://x" }, "tool");

    // No onTabUpdated handler exists any more: nothing to fire. The state
    // simply stays "recording" across whatever navigation happens.
    expect(c.state().kind).toBe("recording");
  });

  it("onDetached(tabId, \"canceled_by_user\") ends the recording, keeping the steps", async () => {
    const detachedListeners: ((tabId: number, reason: string) => void)[] = [];
    const session = fakeSession({
      gate: vi.fn(() => ({ ok: true, state: {} as never }) satisfies DebuggerGate),
      onDetached: (l) => detachedListeners.push(l),
    });
    const stepListeners: ((tabId: number, step: RecordedStep) => void)[] = [];
    const recorder = fakeRecorder({ onStep: (l) => stepListeners.push(l) });
    const c = createRecordingController({ api, session, recorder });
    await c.start(7, { host: "x", url: "http://x" }, "tool");
    const recordingId = c.state().kind === "recording" ? c.state().recordingId : "";
    stepListeners[0](7, { recordingId, seq: 0, kind: "click", line: "click Apply" });

    detachedListeners[0](7, "canceled_by_user");

    expect(c.state()).toMatchObject({ kind: "stopped", note: "Recording stopped: debugging was canceled." });
    if (c.state().kind === "stopped") expect(c.state()).toMatchObject({ steps: [expect.objectContaining({ line: "click Apply" })] });
  });

  it("onDetached(tabId, \"target_closed\") ends the recording with the tab-closed note", async () => {
    const detachedListeners: ((tabId: number, reason: string) => void)[] = [];
    const session = fakeSession({
      gate: vi.fn(() => ({ ok: true, state: {} as never }) satisfies DebuggerGate),
      onDetached: (l) => detachedListeners.push(l),
    });
    const recorder = fakeRecorder();
    const c = createRecordingController({ api, session, recorder });
    await c.start(7, { host: "x", url: "http://x" }, "tool");

    detachedListeners[0](7, "target_closed");

    expect(c.state()).toMatchObject({ kind: "stopped", note: "Recording stopped: the tab closed." });
  });

  it("onRoute(tabId, path, seq) appends a route step at the given seq", async () => {
    const routeListeners: ((tabId: number, path: string, seq: number) => void)[] = [];
    const stepListeners: ((tabId: number, step: RecordedStep) => void)[] = [];
    const session = fakeSession({ gate: vi.fn(() => ({ ok: true, state: {} as never }) satisfies DebuggerGate) });
    const recorder = fakeRecorder({
      onStep: (l) => stepListeners.push(l),
      onRoute: (l) => routeListeners.push(l),
    });
    const c = createRecordingController({ api, session, recorder });
    await c.start(7, { host: "x", url: "http://x" }, "tool");
    const recordingId = c.state().kind === "recording" ? c.state().recordingId : "";
    stepListeners[0](7, { recordingId, seq: 0, kind: "click", line: "click Apply" });

    // The driver, not the controller, assigns the seq — pre-empting any
    // collision with a step whose own delivery is still in flight.
    routeListeners[0](7, "/cart", 1_000_000);

    const res = await c.stop();
    if ("error" in res) throw new Error("expected recording result");
    const route = res.steps.find((s) => s.kind === "route");
    expect(route).toMatchObject({ line: "route to /cart", path: "/cart", seq: 1_000_000 });
  });

  it("two onRoute calls with the same path record one route step", async () => {
    const routeListeners: ((tabId: number, path: string, seq: number) => void)[] = [];
    const session = fakeSession({ gate: vi.fn(() => ({ ok: true, state: {} as never }) satisfies DebuggerGate) });
    const recorder = fakeRecorder({ onRoute: (l) => routeListeners.push(l) });
    const c = createRecordingController({ api, session, recorder });
    await c.start(7, { host: "x", url: "http://x" }, "tool");

    routeListeners[0](7, "/#/store", 0.000001);
    routeListeners[0](7, "/#/store", 0.000002);

    const res = await c.stop();
    if ("error" in res) throw new Error("expected recording result");
    const routes = res.steps.filter((s) => s.kind === "route");
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({ line: "route to /#/store", path: "/#/store", seq: 0.000001 });
  });

  it("onRoute with paths A, B, A records three route steps: A, B, A", async () => {
    const routeListeners: ((tabId: number, path: string, seq: number) => void)[] = [];
    const session = fakeSession({ gate: vi.fn(() => ({ ok: true, state: {} as never }) satisfies DebuggerGate) });
    const recorder = fakeRecorder({ onRoute: (l) => routeListeners.push(l) });
    const c = createRecordingController({ api, session, recorder });
    await c.start(7, { host: "x", url: "http://x" }, "tool");

    routeListeners[0](7, "/#/store", 0.000001);
    routeListeners[0](7, "/#/cart", 0.000002);
    routeListeners[0](7, "/#/store", 0.000003);

    const res = await c.stop();
    if ("error" in res) throw new Error("expected recording result");
    expect(res.steps.filter((s) => s.kind === "route").map((s) => s.path)).toEqual(["/#/store", "/#/cart", "/#/store"]);
  });

  it("a route step with the previous route step's path is skipped even with a click between them", async () => {
    const routeListeners: ((tabId: number, path: string, seq: number) => void)[] = [];
    const stepListeners: ((tabId: number, step: RecordedStep) => void)[] = [];
    const session = fakeSession({ gate: vi.fn(() => ({ ok: true, state: {} as never }) satisfies DebuggerGate) });
    const recorder = fakeRecorder({
      onStep: (l) => stepListeners.push(l),
      onRoute: (l) => routeListeners.push(l),
    });
    const c = createRecordingController({ api, session, recorder });
    await c.start(7, { host: "x", url: "http://x" }, "tool");
    const recordingId = c.state().kind === "recording" ? c.state().recordingId : "";

    routeListeners[0](7, "/#/store", 0.000001);
    stepListeners[0](7, { recordingId, seq: 1, kind: "click", line: 'click link "Store"' });
    routeListeners[0](7, "/#/store", 1.000001);

    const res = await c.stop();
    if ("error" in res) throw new Error("expected recording result");
    expect(res.steps.map((s) => s.kind)).toEqual(["route", "click"]);
    expect(res.steps[0]).toMatchObject({ path: "/#/store", seq: 0.000001 });
  });

  it("stop() calls recorder.uninstall and returns journalIds / unjournaled", async () => {
    const stepListeners: ((tabId: number, step: RecordedStep) => void)[] = [];
    const session = fakeSession({ gate: vi.fn(() => ({ ok: true, state: {} as never }) satisfies DebuggerGate) });
    const recorder = fakeRecorder({ onStep: (l) => stepListeners.push(l) });
    const journal = createActionJournal();
    const c = createRecordingController({ api, session, recorder, journal });
    await c.start(7, { host: "x", url: "http://x" }, "tool");
    const recordingId = c.state().kind === "recording" ? c.state().recordingId : "";
    stepListeners[0](7, {
      recordingId,
      seq: 0,
      kind: "click",
      line: 'click button "Apply"',
      target: { role: "button", name: "Apply", label: 'button "Apply"', locator: "getByRole('button', { name: 'Apply' })", isPassword: false },
    });
    stepListeners[0](7, {
      recordingId,
      seq: 1,
      kind: "click",
      line: 'click custom "Special"',
      target: { role: "custom", name: "Special", label: 'custom "Special"', isPassword: false },
    });

    const res = await c.stop();
    if ("error" in res) throw new Error("expected recording result");
    expect(recorder.uninstall).toHaveBeenCalledWith(7);
    expect(res.journalIds).toEqual([1]);
    expect(res.stepJournalIds).toEqual({ 0: 1 });
    expect(res.unjournaled).toEqual(['custom "Special"']);
  });

  it("keeps the step index for each journal id across an unjournaled hole", async () => {
    const stepListeners: ((tabId: number, step: RecordedStep) => void)[] = [];
    const session = fakeSession({ gate: vi.fn(() => ({ ok: true, state: {} as never }) satisfies DebuggerGate) });
    const recorder = fakeRecorder({ onStep: (l) => stepListeners.push(l) });
    const journal = createActionJournal();
    const c = createRecordingController({ api, session, recorder, journal });
    await c.start(7, { host: "x", url: "http://x" }, "tool");
    const recordingId = c.state().kind === "recording" ? c.state().recordingId : "";

    stepListeners[0](7, {
      recordingId,
      seq: 0,
      kind: "click",
      line: 'click button "Apply"',
      target: { role: "button", name: "Apply", label: 'button "Apply"', locator: "getByRole('button', { name: 'Apply' })", isPassword: false },
    });
    stepListeners[0](7, {
      recordingId,
      seq: 1,
      kind: "click",
      line: 'click custom "Special"',
      target: { role: "custom", name: "Special", label: 'custom "Special"', isPassword: false },
    });
    stepListeners[0](7, {
      recordingId,
      seq: 2,
      kind: "click",
      line: 'click button "Pay"',
      target: { role: "button", name: "Pay", label: 'button "Pay"', locator: "getByRole('button', { name: 'Pay' })", isPassword: false },
    });

    const res = await c.stop();
    if ("error" in res) throw new Error("expected recording result");
    expect(res.journalIds).toEqual([1, 2]);
    expect(res.stepJournalIds).toEqual({ 0: 1, 2: 2 });
    expect(res.unjournaled).toEqual(['custom "Special"']);
  });

  it("pause / resume call through to the recorder only while a recording is live on that tab", async () => {
    vi.useFakeTimers();
    const session = fakeSession({ gate: vi.fn(() => ({ ok: true, state: {} as never }) satisfies DebuggerGate) });
    const recorder = fakeRecorder();
    const c = createRecordingController({ api, session, recorder });
    await c.start(7, { host: "x", url: "http://x" }, "tool");

    await c.pause(7);
    expect(recorder.pause).toHaveBeenCalledWith(7);

    let resumed = false;
    const resumePromise = c.resume(7).then(() => {
      resumed = true;
    });
    expect(resumed).toBe(false);
    expect(recorder.resume).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(REC_RESUME_DELAY_MS);
    await resumePromise;
    expect(resumed).toBe(true);
    expect(recorder.resume).toHaveBeenCalledWith(7);
  });

  it("pause on another tab, or when idle, calls nothing", async () => {
    const session = fakeSession({ gate: vi.fn(() => ({ ok: true, state: {} as never }) satisfies DebuggerGate) });
    const recorder = fakeRecorder();
    const c = createRecordingController({ api, session, recorder });

    await c.pause(7);
    expect(recorder.pause).not.toHaveBeenCalled();

    await c.start(7, { host: "x", url: "http://x" }, "tool");
    vi.mocked(recorder.pause).mockClear();

    await c.pause(99);
    expect(recorder.pause).not.toHaveBeenCalled();
  });

  it("stop() twice", async () => {
    const session = fakeSession({ gate: vi.fn(() => ({ ok: true, state: {} as never }) satisfies DebuggerGate) });
    const recorder = fakeRecorder();
    const c = createRecordingController({ api, session, recorder });
    await c.start(7, { host: "x", url: "http://x" }, "tool");

    await c.stop();
    const second = await c.stop();
    expect(second).toEqual({ error: "Nothing is being recorded." });
  });

  it("stop() when idle", async () => {
    const c = createRecordingController({ api });
    expect(await c.stop()).toEqual({ error: "Nothing is being recorded." });
  });

  it("tabInfo / hostOf", async () => {
    const c = createRecordingController({ api });
    expect(hostOf("http://localhost:10040/checkout.html")).toBe("localhost:10040");
    expect(hostOf("not-a-url")).toBe("not-a-url");

    const info = await c.tabInfo(7);
    expect(info).toEqual({ host: "localhost:10040", url: "http://localhost:10040/checkout.html" });
  });

  it("tab-removed fires and ends the recording", async () => {
    const session = fakeSession({ gate: vi.fn(() => ({ ok: true, state: {} as never }) satisfies DebuggerGate) });
    const recorder = fakeRecorder();
    const c = createRecordingController({ api, session, recorder });
    await c.start(7, { host: "x", url: "http://x" }, "tool");

    tabRemovedListeners[0](7);

    expect(c.state()).toMatchObject({ kind: "stopped", note: "Recording stopped: the tab closed." });
  });

  it("subscribe fires on start()", async () => {
    const session = fakeSession({ gate: vi.fn(() => ({ ok: true, state: {} as never }) satisfies DebuggerGate) });
    const recorder = fakeRecorder();
    const c = createRecordingController({ api, session, recorder });
    const listener = vi.fn();
    c.subscribe(listener);

    await c.start(7, { host: "x", url: "http://x" }, "tool");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("an unsubscribed listener receives no further notifications", async () => {
    const session = fakeSession({ gate: vi.fn(() => ({ ok: true, state: {} as never }) satisfies DebuggerGate) });
    const recorder = fakeRecorder();
    const c = createRecordingController({ api, session, recorder });
    const listener = vi.fn();
    const unsubscribe = c.subscribe(listener);
    unsubscribe();

    await c.start(7, { host: "x", url: "http://x" }, "tool");
    expect(listener).not.toHaveBeenCalled();
  });
});
