// 131/002 — the isolated world the ref tools call into, one per debugged tab's
// top frame. The context id is NOT proof the helper is installed: after a
// navigation Chrome hands back the SAME id with an empty world (measured
// 2026-09-19), so the cache is cleared on Page.frameNavigated for the main frame.
import { errorMessage, thrownFromDetails } from "./error-message";
import type { DebuggerSession } from "./debugger-tools.types";
import type { HelperWorlds, RefTarget } from "./debugger-helper-world.types";

export type { HelperWorlds, RefTarget } from "./debugger-helper-world.types";

export const HELPER_WORLD_NAME = "web-agent-helper";

export const INVALID_REF = (ref: string) =>
  `Invalid ref "${ref}". Take a new snapshot and pass a ref it prints.`;

export const STALE_REF = (ref: string) =>
  `Ref ${ref} is no longer on the page. Take a new snapshot.`;

export const SCOPE_MISSING = (ref: string) =>
  `Ref ${ref} is not on the page. Take a new snapshot.`;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function createHelperWorlds(session: DebuggerSession, loadSource?: () => Promise<string>): HelperWorlds {
  let sourcePromise: Promise<string> | undefined;
  const source = (): Promise<string> => {
    if (!sourcePromise) {
      sourcePromise = (
        loadSource ?? (async () => (await fetch(chrome.runtime.getURL("helper.js"))).text())
      )();
    }
    return sourcePromise;
  };

  // tabId → "<sessionId>|<frameId>" → executionContextId
  const contexts = new Map<number, Map<string, number>>();
  const frameKey = (at: { sessionId?: string; frameId: string }) => `${at.sessionId ?? ""}|${at.frameId}`;

  function parseRef(ref: string): { ok: true; frame: string; backendNodeId: number } | { ok: false; error: string } {
    // "23" or "f1:23". Anything else is an invalid ref, with today's text.
    const m = /^(?:f(\d+):)?(\d+)$/.exec(ref);
    if (!m) return { ok: false, error: INVALID_REF(ref) };
    const n = Number(m[2]);
    if (!Number.isInteger(n) || n <= 0) return { ok: false, error: INVALID_REF(ref) };
    return { ok: true, frame: m[1] === undefined ? "" : `f${m[1]}`, backendNodeId: n };
  }

  /** The plan's `resolve(tabId, ref)`. A live `f<k>` gives that child's
   *  session; a bare ref gives the top target, in the frame the snapshot
   *  recorded for it (the top frame when it recorded none). */
  function resolve(
    tabId: number,
    ref: string,
  ): { ok: true; at: RefTarget } | { ok: false; error: string } {
    const parsed = parseRef(ref);
    if (!parsed.ok) return parsed;
    if (parsed.frame !== "") {
      const k = Number(parsed.frame.slice(1));
      const child = session.frames.childByNumber(tabId, k);
      // The frame was removed from the page, so its refs are gone with it.
      if (!child) return { ok: false, error: STALE_REF(ref) };
      const known = session.frames.refFrame(tabId, ref);
      return {
        ok: true,
        at: {
          sessionId: child.sessionId,
          frameId: known?.frameId ?? child.targetId,
          backendNodeId: parsed.backendNodeId,
          refPrefix: `f${child.k}:`,
        },
      };
    }
    const known = session.frames.refFrame(tabId, ref);
    return {
      ok: true,
      at: {
        frameId: known?.frameId ?? session.state.get(tabId)?.topFrameId ?? "",
        backendNodeId: parsed.backendNodeId,
        refPrefix: "",
      },
    };
  }

  /** The helper's isolated world in ONE frame, installed on first use. The
   *  world is created in the frame's own session, so a cross-site iframe gets
   *  its own copy of the helper. */
  async function context(tabId: number, at: { sessionId?: string; frameId: string }): Promise<number> {
    let perTab = contexts.get(tabId);
    if (!perTab) {
      perTab = new Map<string, number>();
      contexts.set(tabId, perTab);
    }
    const key = frameKey(at);
    const cached = perTab.get(key);
    if (cached !== undefined) return cached;
    let frameId = at.frameId;
    if (frameId === "") {
      const ft = await session.send(tabId, "Page.getFrameTree", undefined, at.sessionId);
      frameId = isRecord(ft) && isRecord(ft.frameTree) && isRecord(ft.frameTree.frame)
        ? String(ft.frameTree.frame.id)
        : "";
    }
    const w = await session.send(
      tabId,
      "Page.createIsolatedWorld",
      { frameId, worldName: HELPER_WORLD_NAME, grantUniveralAccess: true },
      at.sessionId,
    );
    const executionContextId = isRecord(w) && typeof w.executionContextId === "number" ? w.executionContextId : 0;
    await session.send(
      tabId,
      "Runtime.evaluate",
      { expression: await source(), contextId: executionContextId, returnByValue: true },
      at.sessionId,
    );
    perTab.set(key, executionContextId);
    return executionContextId;
  }

  function exceptionError(result: unknown): string | undefined {
    if (isRecord(result) && isRecord(result.exceptionDetails)) {
      const { message } = thrownFromDetails(result.exceptionDetails);
      return message;
    }
    return undefined;
  }

  async function callOn<T>(
    tabId: number,
    at: { sessionId?: string; frameId: string },
    resolveObjectId: (ctx: number) => Promise<{ ok: true; objectId: string } | { ok: false; error: string }>,
    fn: string,
    args: unknown[],
  ): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
    const ctx = await context(tabId, at);
    const resolved = await resolveObjectId(ctx);
    if (!resolved.ok) return resolved;
    const { objectId } = resolved;
    try {
      let result: unknown;
      try {
        result = await session.send(
          tabId,
          "Runtime.callFunctionOn",
          {
            objectId,
            functionDeclaration: "function(fn, ...a) { return globalThis.__waHelper[fn](this, ...a) }",
            arguments: [{ value: fn }, ...args.map((value) => ({ value }))],
            returnByValue: true,
            awaitPromise: true,
          },
          at.sessionId,
        );
      } catch (err) {
        return { ok: false, error: errorMessage(err) };
      }
      const err = exceptionError(result);
      if (err !== undefined) return { ok: false, error: err };
      const value = isRecord(result) && isRecord(result.result) ? (result.result.value as T) : (undefined as T);
      return { ok: true, value };
    } finally {
      void session.send(tabId, "Runtime.releaseObject", { objectId }, at.sessionId).catch(() => {});
    }
  }

  async function call<T>(
    tabId: number,
    ref: string,
    fn: string,
    args: unknown[] = [],
  ): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
    const r = resolve(tabId, ref);
    if (!r.ok) return r;
    const { at } = r;
    return callOn<T>(
      tabId,
      at,
      async (ctx) => {
        let resolved: unknown;
        try {
          resolved = await session.send(
            tabId,
            "DOM.resolveNode",
            { backendNodeId: at.backendNodeId, executionContextId: ctx },
            at.sessionId,
          );
        } catch {
          return { ok: false, error: STALE_REF(ref) };
        }
        const objectId =
          isRecord(resolved) && isRecord(resolved.object) && typeof resolved.object.objectId === "string"
            ? resolved.object.objectId
            : undefined;
        if (objectId === undefined) return { ok: false, error: STALE_REF(ref) };
        return { ok: true, objectId };
      },
      fn,
      args,
    );
  }

  async function callOnDocument<T>(
    tabId: number,
    fn: string,
    args: unknown[] = [],
  ): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
    return callOn<T>(
      tabId,
      { frameId: session.state.get(tabId)?.topFrameId ?? "" },
      async (ctx) => {
        const evaluated = await session.send(tabId, "Runtime.evaluate", {
          expression: "document.documentElement",
          contextId: ctx,
        });
        const objectId =
          isRecord(evaluated) && isRecord(evaluated.result) && typeof evaluated.result.objectId === "string"
            ? evaluated.result.objectId
            : undefined;
        if (objectId === undefined) return { ok: false, error: "Could not resolve document.documentElement." };
        return { ok: true, objectId };
      },
      fn,
      args,
    );
  }

  /** How far a frame's own viewport sits inside the TOP frame's viewport.
   *
   *  One offset per out-of-process hop, and NONE for a same-process iframe.
   *  Both halves measured 2026-09-19:
   *   - cross-site: child centre (59.5, 70.5) + owner content origin (80, 150)
   *     = (139.5, 220.5), which clicked the child's button.
   *   - same-site: the owner's content box started at (80, 150) and the button
   *     INSIDE the frame already reported (128, 213), so its raw centre
   *     (178.4, 220.5) clicked it with no offset added.
   *  Playwright does the same — `crPage.js:_framePosition()` returns
   *  `{x: 0, y: 0}` for the main-frame session and `_sessionForFrame()` serves
   *  every same-process frame from it (playwright-core 1.58.2). */
  async function frameOffset(tabId: number, sessionId: string | undefined): Promise<{ x: number; y: number }> {
    let x = 0;
    let y = 0;
    let at = sessionId;
    // A tab cannot nest more frames than it has children; the bound also stops
    // a cycle if a parent link is ever wrong.
    for (let hops = 0; at !== undefined && hops < 32; hops++) {
      const child = session.frames.childBySession(tabId, at);
      if (!child) break;
      const parent = child.parentSessionId;
      const owner = await session.send(tabId, "DOM.getFrameOwner", { frameId: child.targetId }, parent).catch(() => undefined);
      const backendNodeId = isRecord(owner) && typeof owner.backendNodeId === "number" ? owner.backendNodeId : undefined;
      if (backendNodeId === undefined) break;
      const model = await session.send(tabId, "DOM.getBoxModel", { backendNodeId }, parent).catch(() => undefined);
      const content =
        isRecord(model) && isRecord(model.model) && Array.isArray(model.model.content)
          ? (model.model.content as number[])
          : undefined;
      if (content && content.length >= 2) {
        // The CONTENT box, not the border box: the child frame's viewport
        // starts inside the iframe's border and padding.
        x += content[0];
        y += content[1];
      }
      at = parent;
    }
    return { x, y };
  }

  /** The `<iframe>` selectors from the top page down to the ref's frame, each
   *  built by the helper INSIDE the frame that holds that `<iframe>` element,
   *  so `page.frameLocator(a).frameLocator(b)` reaches it. */
  async function frameChain(tabId: number, ref: string): Promise<string[]> {
    const r = resolve(tabId, ref);
    if (!r.ok) return [];
    return frameChainAt(tabId, r.at);
  }

  /** 131/004 — the same walk, from a frame rather than a ref. A recorded step
   *  has no ref, so the driver passes the frame the binding call came from. */
  async function frameChainAt(tabId: number, at: { sessionId?: string; frameId: string; refPrefix?: string }): Promise<string[]> {
    const refPrefix = at.refPrefix ?? prefixOfSession(tabId, at.sessionId);
    const top = session.state.get(tabId)?.topFrameId ?? "";
    // Walk UP, collecting one owner per hop, then reverse to top-down order.
    const up: string[] = [];
    let sessionId = at.sessionId;
    let frameId = at.frameId;
    for (let hops = 0; hops < 32; hops++) {
      if (sessionId === undefined && (frameId === top || frameId === "")) break;
      const child = sessionId === undefined ? undefined : session.frames.childBySession(tabId, sessionId);
      // For a same-process frame the owner is in the SAME session; for a child
      // target it is in the parent session.
      const ownerSession = child ? child.parentSessionId : sessionId;
      const ownedFrameId = child ? child.targetId : frameId;
      const owner = await session
        .send(tabId, "DOM.getFrameOwner", { frameId: ownedFrameId }, ownerSession)
        .catch(() => undefined);
      const backendNodeId = isRecord(owner) && typeof owner.backendNodeId === "number" ? owner.backendNodeId : undefined;
      if (backendNodeId === undefined) break;
      const ownerRef = `${child ? prefixOfSession(tabId, ownerSession) : refPrefix}${backendNodeId}`;
      const built = await call<{ selector: string }>(tabId, ownerRef, "iframeSelector", []);
      if (!built.ok || typeof built.value?.selector !== "string" || built.value.selector === "") break;
      up.push(built.value.selector);
      if (child) {
        sessionId = child.parentSessionId;
        frameId = sessionId === undefined ? top : "";
      } else {
        // A same-process iframe: its owner is in this session's parent frame,
        // which the next round resolves through its own frame id.
        frameId = await parentFrameId(tabId, sessionId, frameId);
        if (frameId === "") break;
      }
    }
    return up.reverse();
  }

  /** "" for the top target, "f<k>:" for a child session. */
  function prefixOfSession(tabId: number, sessionId: string | undefined): string {
    if (sessionId === undefined) return "";
    const child = session.frames.childBySession(tabId, sessionId);
    return child ? `f${child.k}:` : "";
  }

  /** The id of the frame that holds `frameId`'s `<iframe>` element, inside the
   *  same session. "" when `frameId` is that session's root frame. */
  async function parentFrameId(tabId: number, sessionId: string | undefined, frameId: string): Promise<string> {
    const ft = await session.send(tabId, "Page.getFrameTree", undefined, sessionId).catch(() => undefined);
    const root = isRecord(ft) && isRecord(ft.frameTree) ? ft.frameTree : undefined;
    if (!root) return "";
    const find = (node: Record<string, unknown>, parent: string): string => {
      const frame = isRecord(node.frame) ? node.frame : {};
      if (frame.id === frameId) return parent;
      const kids = Array.isArray(node.childFrames) ? node.childFrames : [];
      for (const kid of kids) {
        if (!isRecord(kid)) continue;
        const hit = find(kid, typeof frame.id === "string" ? frame.id : "");
        if (hit !== "") return hit;
      }
      return "";
    };
    return find(root, "");
  }

  async function centre(tabId: number, ref: string): Promise<{ ok: true; x: number; y: number } | { ok: false; error: string }> {
    const r = resolve(tabId, ref);
    if (!r.ok) return r;
    const { at } = r;
    try {
      await session.send(tabId, "DOM.scrollIntoViewIfNeeded", { backendNodeId: at.backendNodeId }, at.sessionId);
    } catch {
      return { ok: false, error: STALE_REF(ref) };
    }
    let model: unknown;
    try {
      model = await session.send(tabId, "DOM.getBoxModel", { backendNodeId: at.backendNodeId }, at.sessionId);
    } catch {
      return { ok: false, error: STALE_REF(ref) };
    }
    const content =
      isRecord(model) && isRecord(model.model) && Array.isArray(model.model.content)
        ? (model.model.content as number[])
        : undefined;
    if (!content || content.length < 8) return { ok: false, error: STALE_REF(ref) };
    const offset = await frameOffset(tabId, at.sessionId);
    return {
      ok: true,
      x: (content[0] + content[4]) / 2 + offset.x,
      y: (content[1] + content[5]) / 2 + offset.y,
    };
  }

  async function box(
    tabId: number,
    ref: string,
  ): Promise<
    | { ok: true; x: number; y: number; width: number; height: number; scrollX: number; scrollY: number }
    | { ok: false; error: string }
  > {
    const r = resolve(tabId, ref);
    if (!r.ok) return r;
    const { at } = r;
    let model: unknown;
    try {
      model = await session.send(tabId, "DOM.getBoxModel", { backendNodeId: at.backendNodeId }, at.sessionId);
    } catch {
      return { ok: false, error: STALE_REF(ref) };
    }
    const m = isRecord(model) && isRecord(model.model) ? model.model : undefined;
    const content = m && Array.isArray(m.content) ? (m.content as number[]) : undefined;
    if (!m || !content || content.length < 8) return { ok: false, error: STALE_REF(ref) };
    const metrics = await session.send(tabId, "Page.getLayoutMetrics").catch(() => undefined);
    const layout = isRecord(metrics) && isRecord(metrics.cssLayoutViewport) ? metrics.cssLayoutViewport : {};
    const scrollX = typeof layout.pageX === "number" ? layout.pageX : 0;
    const scrollY = typeof layout.pageY === "number" ? layout.pageY : 0;
    const offset = await frameOffset(tabId, at.sessionId);
    return {
      ok: true,
      x: content[0] + offset.x,
      y: content[1] + offset.y,
      width: typeof m.width === "number" ? m.width : 0,
      height: typeof m.height === "number" ? m.height : 0,
      scrollX,
      scrollY,
    };
  }

  function forget(tabId: number): void {
    contexts.delete(tabId);
  }

  /** One frame's world only — Chrome hands back the same context id for an
   *  empty world after that frame navigates (the 131/002 finding, per frame). */
  function forgetFrame(tabId: number, sessionId: string | undefined, frameId: string): void {
    contexts.get(tabId)?.delete(frameKey({ ...(sessionId === undefined ? {} : { sessionId }), frameId }));
  }

  session.onMainFrameNavigated(forget);
  session.onFrameNavigated((tabId, sessionId, frameId) => { forgetFrame(tabId, sessionId, frameId); });

  return { source, parseRef, resolve, frameChain, frameChainAt, call, callOnDocument, centre, box, forget, forgetFrame };
}
