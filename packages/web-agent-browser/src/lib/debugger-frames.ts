// The per-tab frame registry. It holds no chrome API of its own: the
// session feeds it events and reads it back, so it is a plain object in tests.
import type { ChildTarget, DebuggerFrames, TabFrames } from "./debugger-frames.types";

export type { ChildTarget, DebuggerFrames, FrameContext, RefFrame } from "./debugger-frames.types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** "http://pay.test" for a URL, "" for anything unparseable (about:blank). */
export function originOf(url: unknown): string {
  if (typeof url !== "string" || url === "") return "";
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

/** One key per (session, context) pair; "" stands for the top target. */
const ctxKey = (sessionId: string | undefined, contextId: number) => `${sessionId ?? ""}|${contextId}`;

export function createDebuggerFrames(): DebuggerFrames {
  const tabs = new Map<number, TabFrames>();
  const of = (tabId: number): TabFrames => {
    let t = tabs.get(tabId);
    if (!t) {
      t = { nextK: 1, children: new Map(), contexts: new Map(), refs: new Map() };
      tabs.set(tabId, t);
    }
    return t;
  };

  return {
    applyEvent(tabId, sessionId, method, params) {
      const t = of(tabId);
      if (method === "Target.attachedToTarget") {
        const info = isRecord(params.targetInfo) ? params.targetInfo : {};
        // Auto-attach also reports workers and other related targets; only an
        // iframe target is a frame the tools can act in.
        if (info.type !== "iframe") return undefined;
        const childSessionId = typeof params.sessionId === "string" ? params.sessionId : "";
        if (childSessionId === "" || t.children.has(childSessionId)) return undefined;
        const child: ChildTarget = {
          k: t.nextK++,
          sessionId: childSessionId,
          targetId: typeof info.targetId === "string" ? info.targetId : "",
          origin: originOf(info.url),
          ...(sessionId === undefined ? {} : { parentSessionId: sessionId }),
        };
        t.children.set(childSessionId, child);
        return child;
      }
      if (method === "Target.detachedFromTarget") {
        const gone = typeof params.sessionId === "string" ? params.sessionId : "";
        t.children.delete(gone);
        for (const key of [...t.contexts.keys()]) {
          if (key.startsWith(`${gone}|`)) t.contexts.delete(key);
        }
        return undefined;
      }
      if (method === "Runtime.executionContextCreated") {
        const c = isRecord(params.context) ? params.context : {};
        const aux = isRecord(c.auxData) ? c.auxData : {};
        const contextId = typeof c.id === "number" ? c.id : 0;
        if (contextId === 0) return undefined;
        t.contexts.set(ctxKey(sessionId, contextId), {
          contextId,
          frameId: typeof aux.frameId === "string" ? aux.frameId : "",
          origin: typeof c.origin === "string" ? c.origin : "",
          isDefault: aux.isDefault === true,
          name: typeof c.name === "string" ? c.name : "",
          ...(sessionId === undefined ? {} : { sessionId }),
        });
        if (sessionId !== undefined && aux.isDefault === true && typeof c.origin === "string" && c.origin !== "") {
          const child = t.children.get(sessionId);
          if (child && child.targetId === aux.frameId) child.origin = c.origin;
        }
        return undefined;
      }
      if (method === "Runtime.executionContextDestroyed") {
        const id = typeof params.executionContextId === "number" ? params.executionContextId : 0;
        t.contexts.delete(ctxKey(sessionId, id));
        return undefined;
      }
      if (method === "Runtime.executionContextsCleared") {
        const prefix = `${sessionId ?? ""}|`;
        for (const key of [...t.contexts.keys()]) {
          if (key.startsWith(prefix)) t.contexts.delete(key);
        }
      }
      return undefined;
    },
    children: (tabId) => [...of(tabId).children.values()].sort((a, b) => a.k - b.k),
    childBySession: (tabId, sessionId) => of(tabId).children.get(sessionId),
    childByNumber: (tabId, k) => [...of(tabId).children.values()].find((c) => c.k === k),
    childByFrameId: (tabId, frameId) => [...of(tabId).children.values()].find((c) => c.targetId === frameId),
    defaultContext: (tabId, sessionId, frameId) =>
      [...of(tabId).contexts.entries()]
        .filter(([key]) => key.startsWith(`${sessionId ?? ""}|`))
        .map(([, c]) => c)
        .find((c) => c.isDefault && c.frameId === frameId),
    contextById: (tabId, sessionId, contextId) => of(tabId).contexts.get(ctxKey(sessionId, contextId)),
    contextsNamed: (tabId, name) =>
      [...of(tabId).contexts.values()]
        .filter((c) => c.name === name)
        .map((c) => ({ ...(c.sessionId === undefined ? {} : { sessionId: c.sessionId }), contextId: c.contextId })),
    rememberRefs(tabId, entries) {
      const t = of(tabId);
      for (const e of entries) {
        t.refs.set(e.ref, { ...(e.sessionId === undefined ? {} : { sessionId: e.sessionId }), frameId: e.frameId });
      }
    },
    refFrame: (tabId, ref) => of(tabId).refs.get(ref),
    forgetRefs: (tabId) => { of(tabId).refs.clear(); },
    forget: (tabId) => { tabs.delete(tabId); },
  };
}
