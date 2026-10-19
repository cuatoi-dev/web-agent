// The controller's state read-out and its listener plumbing: `getState()`, the
// two notify paths, `abort()` and the attachment-provider view. Moved out of
// `controller.ts` unchanged — each former closure variable is now read from the
// `SessionRuntime` the caller passes in.
import type { SessionMessage, SessionEvent, SessionState } from "./controller.types.js";
import type { AttachmentProvider } from "./attachments/types.js";
import type { SessionRuntime } from "./controller-runtime.types.js";
import { buildSessionMessages } from "./controller-messages.js";

export function getState(st: SessionRuntime): SessionState {
  const journal = st.cm.journal;
  const audit = st.cm.audit;
  const inProgressTurnId = st.running ? st.cm.activeTurnId : undefined;
  const cmVersion = st.cm.version;

  const canCompact = st.cm.hasCompactableTurns();
  const compactionsKey = st.compactionRows.map((r) => `${r.id}:${r.status}:${r.afterTurnId}`).join(";");
  const stateKey = `${cmVersion}|${inProgressTurnId ?? ""}|${st.running}|${st.compacting}|${canCompact}|${st.error ?? ""}|${st.activeSessionId}|${st.toolBlocksVersion}|${compactionsKey}`;

  let messages: SessionMessage[];

  if (st.cachedStateMessages !== null && stateKey === st.cachedStateKey) {
    messages = st.cachedStateMessages;
  } else {
    messages = buildSessionMessages({
      journal,
      audit,
      inProgressTurnId,
      compactionRows: st.compactionRows,
      turnCache: st.turnCache,
      toolBlocks: st.toolBlocks,
      toolBlocksVersion: st.toolBlocksVersion,
      running: st.running,
    });

    st.cachedStateMessages = messages;
    st.cachedStateKey = stateKey;
  }

  const cmUsage = st.cm.getUsage();
  if (!st.cachedContextWindow || st.cachedContextWindowUsage !== cmUsage) {
    st.cachedContextWindow = {
      used: cmUsage.tokens,
      total: cmUsage.max,
      percent: cmUsage.percent,
    };
    st.cachedContextWindowUsage = cmUsage;
  }

  return {
    messages,
    sessions: st.sessions,
    activeSessionId: st.activeSessionId,
    running: st.running,
    compacting: st.compacting,
    canCompact,
    error: st.error,
    usage: st.usage,
    contextWindow: st.cachedContextWindow,
    queuedMessages: st.queuedMessages.map((q) => ({
      ...q,
      images: q.images ? [...q.images] : undefined,
    })),
    model: st.agentConfig.model,
    inProgressTurnId,
  };
}

export function notifyListeners(st: SessionRuntime) {
  const s = getState(st);
  for (const listener of st.listeners) {
    try {
      listener(s);
    } catch (err) {
      console.error("Listener error:", err);
    }
  }
}

export function emitEvent(st: SessionRuntime, e: SessionEvent) {
  for (const l of st.eventListeners) {
    try {
      l(e);
    } catch (err) {
      console.error("Event listener error:", err);
    }
  }
}

export function abort(st: SessionRuntime) {
  if (st.controller) {
    st.controller.abort();
  }
  st.compactionAbort?.abort();
  st.running = false;
  notifyListeners(st);
}

/** Attachment providers from both the host's static config AND any loaded
 *  `ToolProvider`s (006) — e.g. a DOM package registering its point-at-elements
 *  picker. Re-reads `st` on every call, so it stays correct whether
 *  `loadedProviders` has populated yet. */
export function effectiveAttachmentProviders(st: SessionRuntime): AttachmentProvider[] {
  return [
    ...st.loadedProviders.flatMap((p) => p.attachmentProviders ?? []),
    ...(st.currentConfig.attachmentProviders ?? []),
  ];
}
