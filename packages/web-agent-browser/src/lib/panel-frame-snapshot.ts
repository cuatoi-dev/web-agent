// Collects one AxFrame per frame of a debugged tab: the top frame,
// every same-process iframe in `Page.getFrameTree`, and every auto-attached
// cross-site iframe target, recursively.
import type { DebuggerSession } from "./debugger-tools.types";
import type { AxFrame, AxNode } from "./ax-snapshot.types";
import type { FrameNode } from "./panel-frame-snapshot.types";
import { originOf } from "./debugger-frames";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Page.getFrameTree → a plain tree. Same-process frames only; a cross-site
 *  iframe is absent (measured 2026-09-19, ./temp/cdp-frame-probe.log). */
function readFrameTree(reply: unknown): FrameNode | undefined {
  const node = (raw: unknown): FrameNode | undefined => {
    if (!isRecord(raw) || !isRecord(raw.frame)) return undefined;
    const id = typeof raw.frame.id === "string" ? raw.frame.id : "";
    const url = typeof raw.frame.url === "string" ? raw.frame.url : "";
    const kids = Array.isArray(raw.childFrames) ? raw.childFrames : [];
    return { id, url, children: kids.map(node).filter((k): k is FrameNode => k !== undefined) };
  };
  return isRecord(reply) ? node(reply.frameTree) : undefined;
}

export async function collectAxFrames(session: DebuggerSession, tabId: number): Promise<AxFrame[]> {
  const out: AxFrame[] = [];

  const axNodes = async (sessionId: string | undefined, frameId: string | undefined): Promise<AxNode[] | undefined> => {
    try {
      const tree = await session.send(
        tabId,
        "Accessibility.getFullAXTree",
        frameId === undefined ? undefined : { frameId },
        sessionId,
      );
      return isRecord(tree) && Array.isArray(tree.nodes) ? (tree.nodes as AxNode[]) : undefined;
    } catch {
      return undefined;
    }
  };

  const ownerOf = async (
    parentSessionId: string | undefined,
    frameId: string,
  ): Promise<number | undefined> => {
    const owner = await session
      .send(tabId, "DOM.getFrameOwner", { frameId }, parentSessionId)
      .catch(() => undefined);
    return isRecord(owner) && typeof owner.backendNodeId === "number" ? owner.backendNodeId : undefined;
  };

  /** One target: its root frame, its same-process descendants, then every
   *  child target attached under it. */
  const visit = async (
    sessionId: string | undefined,
    refPrefix: string,
    rootOwner: AxFrame["owner"],
    rootOrigin: string,
  ): Promise<void> => {
    const ft = await session.send(tabId, "Page.getFrameTree", undefined, sessionId).catch(() => undefined);
    const tree = readFrameTree(ft);
    const rootNodes = await axNodes(sessionId, undefined);
    out.push({
      refPrefix,
      ...(sessionId === undefined ? {} : { sessionId }),
      frameId: tree?.id ?? "",
      origin: rootOrigin || originOf(tree?.url),
      nodes: rootNodes ?? [],
      ...(rootNodes === undefined || rootNodes.length === 0 ? { unavailable: true } : {}),
      ...(rootOwner ? { owner: rootOwner } : {}),
    });

    const walk = async (node: FrameNode): Promise<void> => {
      for (const kid of node.children) {
        const backendNodeId = await ownerOf(sessionId, kid.id);
        const nodes = await axNodes(sessionId, kid.id);
        out.push({
          refPrefix,
          ...(sessionId === undefined ? {} : { sessionId }),
          frameId: kid.id,
          origin: originOf(kid.url),
          nodes: nodes ?? [],
          ...(nodes === undefined || nodes.length === 0 ? { unavailable: true } : {}),
          ...(backendNodeId === undefined ? {} : { owner: { refPrefix, backendNodeId } }),
        });
        await walk(kid);
      }
    };
    if (tree) await walk(tree);

    for (const child of session.frames.children(tabId)) {
      if (child.parentSessionId !== sessionId) continue;
      const backendNodeId = await ownerOf(sessionId, child.targetId);
      await visit(
        child.sessionId,
        `f${child.k}:`,
        backendNodeId === undefined ? undefined : { refPrefix, backendNodeId },
        child.origin,
      );
    }
  };

  await visit(undefined, "", undefined, "");
  return out;
}
