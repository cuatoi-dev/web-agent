// 131/004 — installs the recorder in every frame of a debugged tab and turns
// Runtime.bindingCalled into a RecordedStep with its frame chain. Split out of
// recording-controller.ts, which owns the step list and the state machine.
import { errorMessage } from "./error-message";
import type { DebuggerSession } from "./debugger-tools.types";
import type { HelperWorlds } from "./debugger-helper-world.types";
import { finishClosedClick } from "./debugger-recorder-closed";
import type { PendingClosedMessage, RecordedStep } from "./recorder.types";
import type { DebuggerRecorder } from "./debugger-recorder.types";

export const RECORDER_WORLD_NAME = "web-agent-recorder";
export const RECORDER_BINDING = "__waRecStep";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function createDebuggerRecorder(
  session: DebuggerSession,
  helper: HelperWorlds,
  loadSource?: () => Promise<string>,
): DebuggerRecorder {
  let sourcePromise: Promise<string> | undefined;
  const source = (): Promise<string> => {
    if (!sourcePromise) {
      sourcePromise = (
        loadSource ?? (async () => (await fetch(chrome.runtime.getURL("recorder.js"))).text())
      )();
    }
    return sourcePromise;
  };

  // tabId → { recordingId, scripts: sessionId("" for top) → ScriptIdentifier }
  const armed = new Map<number, { recordingId: string; scripts: Map<string, string> }>();
  const stepListeners: ((tabId: number, step: RecordedStep) => void)[] = [];
  const routeListeners: ((tabId: number, path: string, seq: number) => void)[] = [];

  // Every installed recorder script keeps its OWN `seq` counter starting at 0
  // — a fresh page realm shares no memory with the last one, whether that is
  // a different frame (an iframe's script is a separate instance from the top
  // page's) or the same frame after a full navigation (runImmediately reruns
  // the script from scratch in the new document). Two contexts reporting the
  // same LOCAL number would collide in the controller's upsert-by-seq step
  // list, silently overwriting an earlier step. Each (session, context) is
  // given its own STRIDE-sized, non-overlapping BAND the first time it is
  // seen, and every step from it is rebased into that band before it reaches
  // the controller — so seq stays a stable, tab-wide ordering key. A single
  // document would need upward of a million of its own steps to run into the
  // next band.
  const SEQ_STRIDE = 1_000_000;
  const seqBases = new Map<number, Map<string, number>>();
  const nextSeqBandIndex = new Map<number, number>();
  // The highest RAW (un-rebased) local seq seen so far in each band, so a
  // route step (which has no local seq of its own — Page.navigatedWithinDocument
  // carries no step count) can be inserted between two real steps of the SAME
  // band instead of being pushed into a band of its own, which would sort it
  // after every step of that document regardless of when it actually
  // happened — measured 2026-09-20 running this task's own mock e2e: an SPA
  // route raised between two same-document clicks landed after both.
  const lastLocalSeq = new Map<number, Map<string, number>>();
  // How many route steps have been raised since the last real step in that
  // same band — so two route changes with no click between them still get
  // distinct, increasing seqs instead of colliding on the same fraction.
  const routeCountSinceStep = new Map<number, Map<string, number>>();

  function seqBaseFor(tabId: number, key: string): number {
    let tabBases = seqBases.get(tabId);
    if (!tabBases) {
      tabBases = new Map();
      seqBases.set(tabId, tabBases);
    }
    let base = tabBases.get(key);
    if (base === undefined) {
      const index = nextSeqBandIndex.get(tabId) ?? 0;
      nextSeqBandIndex.set(tabId, index + 1);
      base = index * SEQ_STRIDE;
      tabBases.set(key, base);
    }
    return base;
  }

  /** The top target's CURRENT recorder-world context — same-document
   *  navigation reuses it, so this is also the band a route step belongs in. */
  function topContextKey(tabId: number): string | undefined {
    const ctx = session.frames.contextsNamed(tabId, RECORDER_WORLD_NAME).find((c) => c.sessionId === undefined);
    return ctx ? `|${ctx.contextId}` : undefined;
  }

  /** The bundle text plus the one call that starts it in this document. */
  async function sourceFor(recordingId: string): Promise<string> {
    return `${await source()}\n;globalThis.__waRec.start(${JSON.stringify(recordingId)});`;
  }

  /** Arms ONE session (the top target when `sessionId` is undefined). */
  async function armSession(tabId: number, sessionId: string | undefined, recordingId: string): Promise<void> {
    const state = armed.get(tabId);
    if (!state || state.recordingId !== recordingId) return;
    try {
      await session.send(tabId, "Runtime.addBinding", {
        name: RECORDER_BINDING,
        executionContextName: RECORDER_WORLD_NAME,
      }, sessionId);
      const added = await session.send(tabId, "Page.addScriptToEvaluateOnNewDocument", {
        source: await sourceFor(recordingId),
        worldName: RECORDER_WORLD_NAME,
        // Installs it in the frames already loaded, AND again in each new
        // document (verified against the protocol, 2026-09-20).
        runImmediately: true,
      }, sessionId);
      const identifier = isRecord(added) && typeof added.identifier === "string" ? added.identifier : "";
      if (identifier !== "") state.scripts.set(sessionId ?? "", identifier);
    } catch (err) {
      // A frame that detached mid-arm must not fail the recording — the same
      // rule debugger-session.ts:162-172 applies to enableChild.
      console.warn(`[web-agent] recorder could not arm a frame: ${errorMessage(err)}`);
    }
  }

  // Every recorder context of the tab, for pause/resume.
  function recorderContexts(tabId: number): { sessionId?: string; contextId: number }[] {
    return session.frames.contextsNamed(tabId, RECORDER_WORLD_NAME);
  }

  async function evaluateInEvery(tabId: number, expression: string): Promise<void> {
    for (const c of recorderContexts(tabId)) {
      await session
        .send(tabId, "Runtime.evaluate", { expression, contextId: c.contextId }, c.sessionId)
        .catch(() => {});
    }
  }

  // A child target that attaches DURING a recording is armed too, so an iframe
  // added mid-recording records from its first click.
  session.onChildAttached((tabId, sessionId) => {
    const state = armed.get(tabId);
    if (state) void armSession(tabId, sessionId, state.recordingId);
  });

  session.onBindingCalled((tabId, sessionId, name, payload, executionContextId) => {
    if (name !== RECORDER_BINDING) return;
    const state = armed.get(tabId);
    if (!state) return;
    let message: RecordedStep | PendingClosedMessage;
    try {
      message = JSON.parse(payload) as RecordedStep | PendingClosedMessage;
    } catch {
      return;
    }
    if (message.recordingId !== state.recordingId) return;
    // Rebase synchronously, in binding-call arrival order — never inside the
    // async frame-chain lookup below, which would let two steps race and
    // assign bases out of order.
    const key = `${sessionId ?? ""}|${executionContextId}`;
    const base = seqBaseFor(tabId, key);
    let tabLocalSeqs = lastLocalSeq.get(tabId);
    if (!tabLocalSeqs) {
      tabLocalSeqs = new Map();
      lastLocalSeq.set(tabId, tabLocalSeqs);
    }
    // A closed-root step arrives after later steps (005). It must not move the
    // highest seq back, or the next route step would sort before those steps.
    const seen = tabLocalSeqs.get(key);
    if (seen === undefined || message.seq >= seen) {
      tabLocalSeqs.set(key, message.seq);
      routeCountSinceStep.get(tabId)?.set(key, 0);
    }
    // A reservation is not a step: it never reaches the list. Its seq stays
    // local, because the page's recorder knows only local numbers.
    if ("pendingClosed" in message) {
      const { recordingId } = message;
      void finishClosedClick(session, tabId, sessionId, executionContextId, message, () => armed.get(tabId)?.recordingId === recordingId);
      return;
    }
    const step = message;
    step.seq = base + step.seq;
    void (async () => {
      const at = frameOf(tabId, sessionId, executionContextId);
      const top = session.state.get(tabId)?.topFrameId ?? "";
      if (at && (sessionId !== undefined || (at.frameId !== "" && at.frameId !== top))) {
        const frames = await helper.frameChainAt(tabId, {
          ...(sessionId === undefined ? {} : { sessionId }),
          frameId: at.frameId,
        });
        if (frames.length > 0) step.frames = frames;
        if (at.origin !== "") step.frameOrigin = at.origin;
      }
      for (const l of stepListeners) l(tabId, step);
    })();
  });

  session.onNavigatedWithinDocument((tabId, frameId, url) => {
    if (!armed.has(tabId)) return;
    if (frameId !== (session.state.get(tabId)?.topFrameId ?? "")) return;
    let path = url;
    try {
      const u = new URL(url);
      path = u.pathname + u.search + u.hash;
    } catch {
      // An unparsable URL is reported as-is.
    }
    // Same-document navigation never changes the top target's recorder
    // context, so the route step belongs in that context's OWN band, placed
    // just after the last real step seen there — sorting after it but before
    // whatever the page records next, however the two race to arrive. Two
    // route changes with no click between them still get distinct seqs.
    const key = topContextKey(tabId) ?? `route-fallback|${tabId}`;
    const base = seqBaseFor(tabId, key);
    const lastLocal = lastLocalSeq.get(tabId)?.get(key) ?? -1;
    let tabRouteCounts = routeCountSinceStep.get(tabId);
    if (!tabRouteCounts) {
      tabRouteCounts = new Map();
      routeCountSinceStep.set(tabId, tabRouteCounts);
    }
    const n = tabRouteCounts.get(key) ?? 0;
    tabRouteCounts.set(key, n + 1);
    const seq = base + lastLocal + 1e-6 * (n + 1);
    for (const l of routeListeners) l(tabId, path, seq);
  });

  /** The frame a binding call came from. A child session IS the frame; the top
   *  target needs the execution context to say which of its frames it was.
   *
   *  The ORIGIN never comes from the recorder context itself: an isolated
   *  world reports `origin: ""` (measured 2026-09-20, 7 of 8 contexts). It
   *  comes from that frame's DEFAULT context, which carries the real origin. */
  function frameOf(
    tabId: number,
    sessionId: string | undefined,
    contextId: number,
  ): { frameId: string; origin: string } | undefined {
    if (sessionId !== undefined) {
      const child = session.frames.childBySession(tabId, sessionId);
      return child ? { frameId: child.targetId, origin: child.origin } : undefined;
    }
    const ctx = session.frames.contextById(tabId, undefined, contextId);
    if (!ctx) return undefined;
    const main = session.frames.defaultContext(tabId, undefined, ctx.frameId);
    return { frameId: ctx.frameId, origin: main?.origin ?? "" };
  }

  return {
    async install(tabId, recordingId) {
      armed.set(tabId, { recordingId, scripts: new Map() });
      seqBases.delete(tabId);
      nextSeqBandIndex.delete(tabId);
      lastLocalSeq.delete(tabId);
      routeCountSinceStep.delete(tabId);
      await armSession(tabId, undefined, recordingId);
      for (const child of session.frames.children(tabId)) {
        await armSession(tabId, child.sessionId, recordingId);
      }
    },
    async uninstall(tabId) {
      const state = armed.get(tabId);
      armed.delete(tabId);
      seqBases.delete(tabId);
      nextSeqBandIndex.delete(tabId);
      lastLocalSeq.delete(tabId);
      routeCountSinceStep.delete(tabId);
      if (!state) return;
      await evaluateInEvery(tabId, "globalThis.__waRec && globalThis.__waRec.stop()");
      for (const [key, identifier] of state.scripts) {
        const sessionId = key === "" ? undefined : key;
        await session
          .send(tabId, "Page.removeScriptToEvaluateOnNewDocument", { identifier }, sessionId)
          .catch(() => {});
        await session
          .send(tabId, "Runtime.removeBinding", { name: RECORDER_BINDING }, sessionId)
          .catch(() => {});
      }
    },
    pause: (tabId) => evaluateInEvery(tabId, "globalThis.__waRec && globalThis.__waRec.pause()"),
    resume: (tabId) => evaluateInEvery(tabId, "globalThis.__waRec && globalThis.__waRec.resume()"),
    onStep: (l) => { stepListeners.push(l); },
    onRoute: (l) => { routeListeners.push(l); },
  };
}
