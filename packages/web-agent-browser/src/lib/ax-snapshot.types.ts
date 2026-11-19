// The shapes for ax-snapshot.ts: one CDP accessibility-tree node,
// and renderAxSnapshot's input/output. Split out to satisfy
// wa/types-in-types-file.

export interface AxNode {
  nodeId: string;
  ignored?: boolean;
  role?: { type: string; value: string };
  name?: { value?: string };
  value?: { value?: unknown };
  properties?: { name: string; value: { value: unknown } }[];
  childIds?: string[];
  parentId?: string;
  backendDOMNodeId?: number;
}

/** One frame's accessibility tree, plus what the printer needs to
 *  place it under its `<iframe>` line. */
export interface AxFrame {
  /** "" for the tab's top target, "f<k>:" for auto-attached child k. Every
   *  ref printed from this frame's nodes carries it. */
  refPrefix: string;
  /** The CDP session the nodes belong to; absent = the tab's top target. */
  sessionId?: string;
  frameId: string;
  /** e.g. "http://pay.test"; "" for the top frame. */
  origin: string;
  /** Accessibility.getFullAXTree nodes; empty when the tree could not be read. */
  nodes: AxNode[];
  /** True when getFullAXTree failed or returned nothing for this frame. */
  unavailable?: boolean;
  /** The `<iframe>` element that hosts this frame. Absent for the top frame. */
  owner?: {
    /** The refPrefix of the frame the `<iframe>` element itself lives in. */
    refPrefix: string;
    backendNodeId: number;
  };
}

export interface AxSnapshotInput {
  /** The top frame first; order otherwise does not matter. */
  frames: AxFrame[];
  /** The `scope` ref exactly as the agent passed it ("23" or "f1:23"). */
  scopeRef?: string;
  includeText?: string;
}

export type AxSnapshotResult =
  | {
      kind: "ok";
      text: string;
      /** Every ref the walk visited, before include_text filtering, so the
       *  caller can record which frame each ref came from. */
      refs: { ref: string; sessionId?: string; frameId: string }[];
    }
  | { kind: "scope-missing" };
