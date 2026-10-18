// 124/006 — the composer's Watch me control. Built on the AttachmentProvider
// seam (`view()`/`slot()`/`subscribe()`), driven by task 005's recording
// controller — the same instance the `start_recording`/`stop_recording` tools
// share, so the agent and the user watch (and can stop) the same recording.
import type { AttachmentChip, MessagePart } from "@cuatoi/web-agent-core";
import { attachmentChipsMeta } from "@cuatoi/web-agent-core";
import type { RecordedStep } from "./recorder.types";
import { stepLocatorLines } from "./locator-format";
import type { WatchMeProvider, WatchMeProviderOptions, WatchMeProviderState } from "./watch-me-provider.types";

const SLOT_STYLES = `
  .wa-watch-me-slot {
    background: var(--wa-input-background-color, #ffffff);
    border: 1px solid var(--wa-border-color, #c8cfd5);
    border-radius: var(--wa-border-radius-l, 8px);
    padding: var(--wa-padding-m, 8px) var(--wa-padding-l, 12px);
    margin-bottom: var(--wa-padding-m, 8px);
    display: grid;
    gap: var(--wa-padding-xs, 2px);
    font-size: 12.5px;
    color: var(--wa-text-color, #182835);
  }
  .wa-watch-me-hd {
    display: flex;
    align-items: center;
    gap: var(--wa-padding-s, 4px);
    font-weight: 600;
  }
  .wa-watch-me-live {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--wa-action-color-error, #d93025);
    flex: none;
  }
  @media (prefers-reduced-motion: no-preference) {
    .wa-watch-me-live { animation: wa-watch-me-blink 1.2s steps(2, jump-none) infinite; }
  }
  @keyframes wa-watch-me-blink { 50% { opacity: 0.25; } }
  .wa-watch-me-steps {
    margin: 0;
    padding-left: var(--wa-padding-xl, 20px);
    display: grid;
    gap: var(--wa-padding-xs, 1px);
    color: var(--wa-label-color, #666666);
    font-family: monospace;
    font-size: 11.5px;
  }
  .wa-watch-me-remove {
    margin-left: auto;
    border: none;
    background: none;
    color: var(--wa-label-color, #666666);
    font: inherit;
    cursor: pointer;
    padding: 0;
  }
  .wa-watch-me-note {
    font-size: 12px;
    color: var(--wa-label-color, #666666);
  }
`;

export function createWatchMeProvider(options: WatchMeProviderOptions): WatchMeProvider {
  const { controller, getActiveTab, onNotify } = options;
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const l of listeners) l();
  };

  // Holds the recording the composer is waiting to send, distinct from the
  // controller's own state: `controller.stop()` always resets the controller
  // to idle once it hands the result back, whether the caller was this
  // provider's `pick()` (the user pressed Stop) or the agent's own
  // `stop_recording` tool. Only the FIRST case should leave the composer
  // showing the stopped card — the design's "if the agent calls
  // stop_recording, it goes to the tool result and the composer returns to
  // idle." The controller gives no way to tell the two callers apart, so the
  // subscribe handler below captures a "stopped" notification tentatively and
  // clears it again on the "idle" notification that follows a `stop()` call.
  // `pick()` then re-asserts it, from `controller.stop()`'s own return value,
  // strictly after both of those notifications have already fired — the only
  // path left standing. A recording ended by navigation or a closed tab never
  // gets that idle follow-up (nothing calls `stop()` to consume it), so the
  // tentative capture simply stays — but only when `startedHere` below says
  // this composer is the one who started it (fix round 1: see that flag).
  let stoppedState: Extract<WatchMeProviderState, { kind: "stopped" }> | null = null;

  // Fix round 1 (124/006) — true only while the CURRENT (or most recently
  // stopped) recording was started by THIS provider's own `pick()`, not the
  // agent's start_recording tool. A `stop()`-driven completion (whichever of
  // the two started it) always resolves through the paired "stopped" then
  // "idle" notifications below and clears `stoppedState` unconditionally
  // either way — see the "idle" branch. This flag matters only for the other
  // path: a recording that ends by navigation or a closed tab (`finish()`
  // inside the controller, with no matching `stop()` call and so no "idle"
  // follow-up). The composer must only auto-attach that as a pending
  // recording (`hasPending()` / `onUserPrompt` below) when it is the one who
  // started it — an agent-started recording ended that way is still shown
  // live/stopped in the slot (`currentState()` reads the controller
  // directly either way) but stays the agent's to fetch with
  // `stop_recording`. Before this flag existed, sending ANY chat message
  // while such a recording sat "stopped" ran `onUserPrompt` first (the
  // composer prepares the outgoing message before the model — and therefore
  // any of its tool calls — ever runs), which cleared the controller before
  // the agent's own `stop_recording` tool got to it —
  // recorder.mock.spec.ts M6/M7 ("Nothing is being recorded." / a
  // not-activated error from the now-stale tab).
  let startedHere = false;

  controller.subscribe(() => {
    const cState = controller.state();
    if (cState.kind === "stopped" && startedHere) {
      stoppedState = {
        kind: "stopped",
        host: cState.host,
        url: cState.url,
        steps: [...cState.steps],
        ...(cState.note ? { note: cState.note } : {}),
      };
    } else if (cState.kind === "idle") {
      stoppedState = null;
      startedHere = false;
    }
    renderSlot();
    notify();
  });

  const styleEl = document.createElement("style");
  styleEl.textContent = SLOT_STYLES;

  const body = document.createElement("div");

  const root = document.createElement("div");
  root.className = "wa-watch-me-slot";
  root.setAttribute("data-attachment-slot", "watch-me");
  root.setAttribute("role", "status");
  root.style.display = "none";
  root.appendChild(styleEl);
  root.appendChild(body);

  function currentState(): WatchMeProviderState {
    if (stoppedState) return stoppedState;
    const cState = controller.state();
    if (cState.kind === "recording") {
      return { kind: "recording", host: cState.host, url: cState.url, steps: cState.steps };
    }
    if (cState.kind === "stopped") {
      return { kind: "stopped", host: cState.host, url: cState.url, steps: cState.steps, ...(cState.note ? { note: cState.note } : {}) };
    }
    return { kind: "idle" };
  }

  function stepLine(step: RecordedStep): string {
    return `${step.frameOrigin === undefined ? "" : `(frame ${step.frameOrigin}) `}${step.line}`;
  }

  function renderSlot(): void {
    const s = currentState();
    body.innerHTML = "";
    if (s.kind === "idle") {
      root.style.display = "none";
      return;
    }
    root.style.display = "grid";

    if (s.kind === "recording") {
      const count = s.steps.length;
      const hd = document.createElement("div");
      hd.className = "wa-watch-me-hd";
      const dot = document.createElement("span");
      dot.className = "wa-watch-me-live";
      dot.setAttribute("aria-hidden", "true");
      hd.appendChild(dot);
      hd.appendChild(document.createTextNode(`Recording on ${s.host} · ${count} ${count === 1 ? "step" : "steps"}`));
      body.appendChild(hd);

      const ol = document.createElement("ol");
      ol.className = "wa-watch-me-steps";
      for (const step of s.steps) {
        const li = document.createElement("li");
        li.textContent = stepLine(step);
        ol.appendChild(li);
      }
      body.appendChild(ol);
      return;
    }

    // s.kind === "stopped"
    const count = s.steps.length;
    const hd = document.createElement("div");
    hd.className = "wa-watch-me-hd";
    hd.appendChild(document.createTextNode(`Recorded ${count} ${count === 1 ? "step" : "steps"} on ${s.host}`));

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "wa-watch-me-remove";
    removeBtn.setAttribute("aria-label", "Remove recording");
    removeBtn.textContent = "✕";
    removeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      clearRecording();
    });
    hd.appendChild(removeBtn);
    body.appendChild(hd);

    if (s.note) {
      const noteDiv = document.createElement("div");
      noteDiv.className = "wa-watch-me-note";
      noteDiv.textContent = s.note;
      body.appendChild(noteDiv);
    }

    const ol = document.createElement("ol");
    ol.className = "wa-watch-me-steps";
    for (const step of s.steps) {
      const li = document.createElement("li");
      li.textContent = stepLine(step);
      ol.appendChild(li);
    }
    body.appendChild(ol);
  }

  function clearRecording(): void {
    stoppedState = null;
    if (controller.state().kind === "stopped") {
      void controller.stop();
    }
    renderSlot();
    notify();
  }

  return {
    id: "watch-me",
    label: "Watch me: record what you do on this tab",
    icon: "fiber_manual_record",
    view() {
      const s = currentState();
      if (s.kind === "recording") {
        return { icon: "stop", label: "Stop recording" };
      }
      return {};
    },
    async pick() {
      const s = currentState();
      if (s.kind === "recording") {
        const res = await controller.stop();
        if (!("error" in res)) {
          stoppedState = { kind: "stopped", host: res.host, url: res.url, steps: [...res.steps], ...(res.note ? { note: res.note } : {}) };
        }
        renderSlot();
        notify();
        return;
      }
      const tab = await getActiveTab();
      if (!tab) {
        onNotify?.("No active tab found to record.", "error");
        return;
      }
      const startRes = await controller.start(tab.tabId, { host: tab.host, url: tab.url }, "button");
      if (!startRes.ok) {
        onNotify?.(startRes.error, "error");
        return;
      }
      // Fix round 1 (124/006) — recorded only once the start actually
      // succeeded, so a failed start never leaves a stale claim of ownership
      // over whatever the agent's own start_recording tool records next.
      startedHere = true;
      stoppedState = null;
      renderSlot();
      notify();
    },
    hasPending() {
      // Fix round 1 (124/006) — `stoppedState`, not `currentState()`: the
      // latter falls through to the controller's own state, which stays
      // "stopped" for an agent-started recording ended by navigation or a
      // closed tab too (see `startedHere` above). Only `stoppedState` is
      // ever set for that case, and only when this composer started it.
      return stoppedState !== null;
    },
    slot() {
      renderSlot();
      return root;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onUserPrompt(payload) {
      // Fix round 1 (124/006) — reads `stoppedState` directly, for the same
      // reason `hasPending()` above does.
      if (!stoppedState) return;
      const taken = stoppedState;
      const n = taken.steps.length;
      const chips: AttachmentChip[] = [
        {
          providerId: "watch-me",
          label: `Recording · ${n} ${n === 1 ? "step" : "steps"}`,
        },
      ];
      const header = `# Recorded steps on ${taken.url}\n`;
      const note = taken.note ? `${taken.note}\n` : "";
      // 127/002 — the agent gets each step's locator lines; the panel list does not.
      const lines = taken.steps
        .map((step, i) => [`${i + 1}. ${stepLine(step)}`, ...stepLocatorLines(step)].join("\n"))
        .join("\n");
      const stepsText = `${header}${note}${lines}`;
      const textPart: MessagePart = { type: "text", text: stepsText };
      const typed = payload.parts
        .filter((p): p is Extract<MessagePart, { type: "text" }> => p.type === "text")
        .map((p) => p.text)
        .join("\n");

      clearRecording();

      return {
        parts: [textPart, ...payload.parts],
        userDisplayText: typed,
        meta: attachmentChipsMeta(chips),
      };
    },
    dispose() {
      listeners.clear();
      root.remove();
    },
  };
}
