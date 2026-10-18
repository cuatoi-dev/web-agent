import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserPromptPayload } from "@cuatoi/web-agent-core";
import { readAttachmentChips } from "@cuatoi/web-agent-core";
import { createRecordingController } from "./recording-controller";
import { createWatchMeProvider } from "./watch-me-provider";
import type { DebuggerSession } from "./debugger-tools.types";
import type { DebuggerRecorder } from "./debugger-recorder.types";
import type { RecordedStep, RecordingApi } from "./recorder.types";

const TAB_INFO = { tabId: 7, host: "localhost:10040", url: "http://localhost:10040/checkout.html" };

/** A fake session (always gated ok, so `start(…, "button")` never needs to
 *  attach) and a fake recorder, driving the REAL controller's `start()`/
 *  `stop()` transitions — in particular `stop()`'s two back-to-back
 *  notifications (transient "stopped", then "idle") that the provider's
 *  agent-vs-user distinction depends on. */
function makeControllerHarness() {
  const tabRemovedListeners: ((tabId: number) => void)[] = [];
  const stepListeners: ((tabId: number, step: RecordedStep) => void)[] = [];
  const api: RecordingApi = {
    addTabRemovedListener: (l) => tabRemovedListeners.push(l),
    removeTabRemovedListener: () => {},
    tabUrl: vi.fn().mockResolvedValue(TAB_INFO.url),
  };
  const session = {
    gate: () => ({ ok: true, state: {} }),
    onMainFrameNavigated: () => {},
    onFrameNavigated: () => {},
    onChildAttached: () => {},
    onBindingCalled: () => {},
    onNavigatedWithinDocument: () => {},
    onDetached: () => {},
  } as unknown as DebuggerSession;
  const recorder: DebuggerRecorder = {
    install: vi.fn().mockResolvedValue(undefined),
    uninstall: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    onStep: (l) => stepListeners.push(l),
    onRoute: () => {},
  };
  const controller = createRecordingController({ api, session, recorder });
  const recordingId = () => {
    const s = controller.state();
    return s.kind === "recording" ? s.recordingId : "";
  };
  return {
    controller,
    step(seq: number, line: string, frameOrigin?: string, target?: RecordedStep["target"]) {
      stepListeners[0](TAB_INFO.tabId, {
        recordingId: recordingId(),
        seq,
        kind: "click",
        line,
        ...(frameOrigin !== undefined ? { frameOrigin } : {}),
        ...(target !== undefined ? { target } : {}),
      });
    },
    closeTab() {
      tabRemovedListeners[0](TAB_INFO.tabId);
    },
  };
}

describe("watch-me-provider", () => {
  let harness: ReturnType<typeof makeControllerHarness>;
  let getActiveTab: ReturnType<typeof vi.fn>;
  let onNotify: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    harness = makeControllerHarness();
    getActiveTab = vi.fn().mockResolvedValue(TAB_INFO);
    onNotify = vi.fn();
  });

  function makeProvider() {
    return createWatchMeProvider({
      controller: harness.controller,
      getActiveTab,
      onNotify,
    });
  }

  it("U-W1: id, icon and label", () => {
    const p = makeProvider();
    expect(p.id).toBe("watch-me");
    expect(p.icon).toBe("fiber_manual_record");
    expect(p.label).toBe("Watch me: record what you do on this tab");
  });

  it("U-W3: view() is {} (idle, always enabled) — no disabled/tooltip state exists", () => {
    const p = makeProvider();
    expect(p.view?.()).toEqual({});
  });

  it("U-W4: pick() starts the controller on the active tab, with \"button\" as the third argument", async () => {
    const startSpy = vi.spyOn(harness.controller, "start");
    const p = makeProvider();
    await p.pick();
    expect(harness.controller.state()).toMatchObject({ kind: "recording", tabId: TAB_INFO.tabId, host: TAB_INFO.host });
    expect(startSpy).toHaveBeenCalledWith(TAB_INFO.tabId, { host: TAB_INFO.host, url: TAB_INFO.url }, "button");
  });

  it("U-W5: pick() with no active tab notifies an error and does not start", async () => {
    getActiveTab.mockResolvedValue(null);
    const p = makeProvider();
    await p.pick();
    expect(onNotify).toHaveBeenCalledWith("No active tab found to record.", "error");
    expect(harness.controller.state().kind).toBe("idle");
  });

  it("pick() when the start fails notifies the controller's error text", async () => {
    const failingSession = {
      gate: () => ({ ok: false, error: "Debugging is not started on tab #7. Call start_debugging first." }),
      onMainFrameNavigated: () => {},
      onFrameNavigated: () => {},
      onChildAttached: () => {},
      onBindingCalled: () => {},
      onNavigatedWithinDocument: () => {},
      onDetached: () => {},
    } as unknown as DebuggerSession;
    const attach = vi.fn().mockResolvedValue({ content: "no chrome:// pages", isError: true });
    (failingSession as unknown as { start: typeof attach }).start = attach;
    const controller = createRecordingController({
      session: failingSession,
      recorder: { install: vi.fn(), uninstall: vi.fn(), pause: vi.fn(), resume: vi.fn(), onStep: () => {}, onRoute: () => {} },
    });
    const p = createWatchMeProvider({ controller, getActiveTab, onNotify });

    await p.pick();
    expect(onNotify).toHaveBeenCalledWith("Watch me could not start: no chrome:// pages", "error");
  });

  it("U-W6: view() returns the Stop icon and label while recording", async () => {
    const p = makeProvider();
    await p.pick();
    expect(p.view?.()).toEqual({ icon: "stop", label: "Stop recording" });
  });

  it("U-W7: slot() renders the live dot and steps in order while recording, frame-origin steps prefixed", async () => {
    const p = makeProvider();
    await p.pick();
    harness.step(0, 'click button "Apply"');
    harness.step(1, 'click button "Pay"', "http://pay.test");

    const root = p.slot?.();
    expect(root).not.toBeNull();
    expect(root!.querySelector(".wa-watch-me-live")).not.toBeNull();
    expect(root!.textContent).toContain(`Recording on ${TAB_INFO.host} · 2 steps`);
    const items = [...root!.querySelectorAll("li")].map((li) => li.textContent);
    expect(items).toEqual(['click button "Apply"', '(frame http://pay.test) click button "Pay"']);
  });

  it("U-W8: pick() stops recording — hasPending() true, header, remove button and steps render", async () => {
    const p = makeProvider();
    await p.pick();
    harness.step(0, 'click button "Apply"');
    await p.pick();

    expect(p.hasPending()).toBe(true);
    const root = p.slot?.();
    expect(root!.textContent).toContain(`Recorded 1 step on ${TAB_INFO.host}`);
    expect(root!.querySelector('button[aria-label="Remove recording"]')).not.toBeNull();
    expect([...root!.querySelectorAll("li")].map((li) => li.textContent)).toEqual(['click button "Apply"']);
  });

  it("U-W9: a tab-close ends the recording externally — the stopped card shows with its note", async () => {
    const p = makeProvider();
    await p.pick();
    harness.step(0, 'click button "Apply"');
    harness.closeTab(); // nobody calls stop() — the controller settles at "stopped" and stays there

    expect(p.hasPending()).toBe(true);
    const root = p.slot?.();
    expect(root!.textContent).toContain("Recording stopped: the tab closed.");
  });

  it("Fix round 1 (124/006): an agent-started recording ended by a closed tab is shown in the slot but is NOT pending — the agent, not the composer, owns it", async () => {
    const p = makeProvider();
    // The agent's start_recording tool calls the shared controller directly,
    // never through this provider's pick() — recorder.mock.spec.ts M7's setup.
    await harness.controller.start(TAB_INFO.tabId, { host: TAB_INFO.host, url: TAB_INFO.url }, "tool");
    harness.step(0, 'click button "Apply"');
    harness.closeTab(); // nobody calls stop() — the controller settles at "stopped" and stays there

    // Still visible in the slot (currentState() reads the controller
    // directly), but not something the composer should silently attach.
    const root = p.slot?.();
    expect(root!.textContent).toContain("Recording stopped: the tab closed.");
    expect(p.hasPending()).toBe(false);

    const payload = { parts: [] } as unknown as UserPromptPayload;
    expect(p.onUserPrompt(payload)).toBeUndefined();
    // The agent's own stop_recording tool must still find it, untouched.
    expect(harness.controller.state().kind).toBe("stopped");
  });

  it("U-W10: hasPending() is false while idle or recording", async () => {
    const p = makeProvider();
    expect(p.hasPending()).toBe(false);
    await p.pick();
    expect(p.hasPending()).toBe(false);
  });

  it("U-W11: the remove button clears the stopped recording and consumes the controller", async () => {
    const p = makeProvider();
    await p.pick();
    harness.step(0, 'click button "Apply"');
    await p.pick(); // stop

    const root = p.slot?.();
    root!.querySelector<HTMLButtonElement>('button[aria-label="Remove recording"]')!.click();

    expect(p.hasPending()).toBe(false);
    expect(harness.controller.state().kind).toBe("idle");
  });

  it("U-W12: onUserPrompt() prepends the formatted steps, adds the chip, and resets to idle", async () => {
    const p = makeProvider();
    await p.pick();
    harness.step(0, 'click button "Apply"');
    harness.step(1, 'fill textbox "Coupon" "SAVE10"');
    await p.pick(); // stop

    const payload = { parts: [{ type: "text", text: "Turn this into a test" }] } as UserPromptPayload;
    const result = p.onUserPrompt(payload);
    expect(result).not.toBeUndefined();
    const r = result as { parts: unknown[]; meta: Record<string, unknown> };

    const textPart = r.parts[0] as { type: string; text: string };
    expect(textPart.type).toBe("text");
    expect(textPart.text).toBe(
      `# Recorded steps on ${TAB_INFO.url}\n1. click button "Apply"\n2. fill textbox "Coupon" "SAVE10"`,
    );
    expect(r.parts[1]).toEqual(payload.parts[0]);
    expect(readAttachmentChips(r.meta)).toEqual([{ providerId: "watch-me", label: "Recording · 2 steps" }]);

    expect(p.hasPending()).toBe(false);
    expect(harness.controller.state().kind).toBe("idle");
  });

  it("002: onUserPrompt() lists every step in order, bare", async () => {
    const p = makeProvider();
    await p.pick();
    harness.step(0, 'click button "Apply"', undefined, {
      role: "button",
      name: "Apply",
      label: 'button "Apply"',
      isPassword: false,
    });
    harness.step(1, 'click custom "Special"');
    harness.step(2, 'click button "Pay"', undefined, {
      role: "button",
      name: "Pay",
      label: 'button "Pay"',
      isPassword: false,
    });
    await p.pick(); // user presses Stop

    // The panel's own list shows each step line.
    const root = p.slot?.();
    expect([...root!.querySelectorAll("li")].map((li) => li.textContent)).toEqual([
      'click button "Apply"',
      'click custom "Special"',
      'click button "Pay"',
    ]);

    const payload = { parts: [{ type: "text", text: "Export it" }] } as UserPromptPayload;
    const result = p.onUserPrompt(payload);
    expect(result).not.toBeUndefined();
    const r = result as { parts: { type: string; text: string }[] };
    expect(r.parts[0].text).toBe(
      `# Recorded steps on ${TAB_INFO.url}` +
        '\n1. click button "Apply"' +
        '\n2. click custom "Special"' +
        '\n3. click button "Pay"',
    );
  });

  it("004: onUserPrompt() sets userDisplayText to only the typed text, leaving the model parts and chip unchanged", async () => {
    const p = makeProvider();
    await p.pick();
    harness.step(0, 'click button "Apply"');
    harness.step(1, 'fill textbox "Coupon" "SAVE10"');
    await p.pick(); // user presses Stop

    const payload = { parts: [{ type: "text", text: "Export these steps as a test" }] } as UserPromptPayload;
    const result = p.onUserPrompt(payload);
    expect(result).not.toBeUndefined();
    const r = result as { parts: { type: string; text: string }[]; userDisplayText: string; meta: Record<string, unknown> };

    // The bubble shows only the typed text — no `Recorded steps` heading or list.
    expect(r.userDisplayText).toBe("Export these steps as a test");

    // The model-facing parts are unchanged: steps text first, then the payload's.
    expect(r.parts[0].text).toBe(
      `# Recorded steps on ${TAB_INFO.url}\n1. click button "Apply"\n2. fill textbox "Coupon" "SAVE10"`,
    );
    expect(r.parts[1]).toEqual(payload.parts[0]);

    // The chip is unchanged.
    expect(readAttachmentChips(r.meta)).toEqual([{ providerId: "watch-me", label: "Recording · 2 steps" }]);
  });

  it("U-W13: onUserPrompt() does nothing while idle or recording", async () => {
    const p = makeProvider();
    const payload = { parts: [] } as unknown as UserPromptPayload;
    expect(p.onUserPrompt(payload)).toBeUndefined();

    await p.pick();
    expect(p.onUserPrompt(payload)).toBeUndefined();
  });

  it("the provider object has no refreshView member", () => {
    const p = makeProvider();
    expect((p as unknown as { refreshView?: unknown }).refreshView).toBeUndefined();
  });

  it("U-W15: an agent-triggered stop_recording (controller.stop() called directly) returns the composer to idle, not stopped", async () => {
    const p = makeProvider();
    await p.pick(); // user starts via the composer
    harness.step(0, 'click button "Apply"');

    // The agent's own stop_recording tool calls the SAME shared controller
    // directly — never through this provider's pick().
    const res = await harness.controller.stop();
    expect("error" in res).toBe(false);

    expect(p.hasPending()).toBe(false);
    expect(p.view?.()).toEqual({});
  });

  it("U-W16: a user-triggered Stop via pick() leaves the composer showing the stopped recording", async () => {
    const p = makeProvider();
    await p.pick();
    harness.step(0, 'click button "Apply"');
    await p.pick(); // user presses Stop

    expect(p.hasPending()).toBe(true);
  });

  it("U-W17: dispose() clears listeners and removes the slot element", async () => {
    const p = makeProvider();
    const root = p.slot?.();
    document.body.appendChild(root!);
    const listener = vi.fn();
    p.subscribe?.(listener);

    p.dispose?.();

    expect(root!.isConnected).toBe(false);
    await p.pick();
    expect(listener).not.toHaveBeenCalled();
  });
});
