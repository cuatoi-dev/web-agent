// 005 — the panel's half of a closed-root click: finds the node under the click
// through CDP and hands it to the recorder's isolated world. Every failure falls
// back to the host, and nothing here rejects.
import type { DebuggerSession } from "./debugger-tools.types";
import type { PendingClosedMessage } from "./recorder.types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** DOM.getNodeForLocation takes integers, in the document coordinates of the
 *  session's root frame (measured 2026-11-04). So a click's client coordinates
 *  need the root's scroll and, for a frame that is not the session's root, the
 *  frame owner's content box. That box is in root viewport coordinates and
 *  already includes outer frames, so only the clicked frame's owner counts. */
async function documentPoint(
  session: DebuggerSession,
  tabId: number,
  sessionId: string | undefined,
  contextId: number,
  point: { x: number; y: number },
): Promise<{ x: number; y: number }> {
  const metrics = await session.send(tabId, "Page.getLayoutMetrics", undefined, sessionId);
  const viewport = isRecord(metrics) && isRecord(metrics.cssLayoutViewport) ? metrics.cssLayoutViewport : {};
  let x = point.x + (typeof viewport.pageX === "number" ? viewport.pageX : 0);
  let y = point.y + (typeof viewport.pageY === "number" ? viewport.pageY : 0);
  const frameId = session.frames.contextById(tabId, sessionId, contextId)?.frameId;
  const rootId = sessionId === undefined ? session.state.get(tabId)?.topFrameId : session.frames.childBySession(tabId, sessionId)?.targetId;
  if (frameId !== undefined && frameId !== rootId) {
    const owner = await session.send(tabId, "DOM.getFrameOwner", { frameId }, sessionId);
    const backendNodeId = isRecord(owner) ? owner.backendNodeId : undefined;
    const box = await session.send(tabId, "DOM.getBoxModel", { backendNodeId }, sessionId);
    const content = isRecord(box) && isRecord(box.model) && Array.isArray(box.model.content) ? (box.model.content as number[]) : [];
    if (content.length < 2) throw new Error("the frame owner has no content box");
    x += content[0];
    y += content[1];
  }
  return { x: Math.floor(x), y: Math.floor(y) };
}

/** `stillArmed` is false once the recording stopped or changed: the recorder
 *  already forgot the click, and no further call is sent. */
export async function finishClosedClick(
  session: DebuggerSession,
  tabId: number,
  sessionId: string | undefined,
  contextId: number,
  message: PendingClosedMessage,
  stillArmed: () => boolean,
): Promise<void> {
  const s = message.seq;
  try {
    const { x, y } = await documentPoint(session, tabId, sessionId, contextId, message.pendingClosed);
    if (!stillArmed()) return;
    const found = await session.send(
      tabId,
      "DOM.getNodeForLocation",
      { x, y, includeUserAgentShadowDOM: false, ignorePointerEventsNone: true },
      sessionId,
    );
    if (!stillArmed()) return;
    const backendNodeId = isRecord(found) ? found.backendNodeId : undefined;
    const resolved = await session.send(tabId, "DOM.resolveNode", { backendNodeId, executionContextId: contextId }, sessionId);
    if (!stillArmed()) return;
    const objectId = isRecord(resolved) && isRecord(resolved.object) ? resolved.object.objectId : undefined;
    if (typeof objectId !== "string") throw new Error("DOM.resolveNode returned no object");
    await session.send(
      tabId,
      "Runtime.callFunctionOn",
      { objectId, functionDeclaration: `function () { globalThis.__waRec.finishClosed(this, ${s}); }` },
      sessionId,
    );
  } catch {
    if (!stillArmed()) return;
    await session
      .send(tabId, "Runtime.evaluate", { expression: `globalThis.__waRec && globalThis.__waRec.finishClosed(null, ${s})`, contextId }, sessionId)
      .catch(() => {});
  }
}
