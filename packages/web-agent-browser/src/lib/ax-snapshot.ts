// 131/002 — Accessibility.getFullAXTree turned into the page_snapshot text.
// CDP returns a FLAT node array with string `childIds`, not a tree (measured
// 2026-09-19), so the walk starts by indexing the nodes by id.
import { SNAPSHOT_MAX_CHARS } from "./constants";
import type { AxFrame, AxNode, AxSnapshotInput, AxSnapshotResult } from "./ax-snapshot.types";

export type { AxFrame, AxNode, AxSnapshotInput, AxSnapshotResult } from "./ax-snapshot.types";

/** The properties the plan prints, in the plan's order. */
const SHOWN_PROPERTIES = ["level", "checked", "disabled", "expanded", "selected", "pressed", "required"] as const;

/** Roles whose current value is printed after ": ". `<select multiple>` is
 *  role `listbox` (measured 2026-09-19), so it is in the list too. */
const VALUE_ROLES = new Set(["textbox", "searchbox", "combobox", "spinbutton", "slider", "listbox"]);

/** Flattened away: their children are printed at the parent's depth. */
const FLATTENED_ROLES = new Set(["generic", "none", "presentation"]);

function roleOf(node: AxNode): string {
  return node.role?.value ?? "";
}

function nameOf(node: AxNode): string {
  return node.name?.value ?? "";
}

function propertyBrackets(node: AxNode): string {
  if (!node.properties) return "";
  let out = "";
  for (const shown of SHOWN_PROPERTIES) {
    const prop = node.properties.find((p) => p.name === shown);
    if (!prop) continue;
    const v = prop.value.value;
    if (v === false || v === "false") continue;
    out += v === true ? ` [${shown}]` : ` [${shown}=${String(v)}]`;
  }
  return out;
}

export function renderAxSnapshot(input: AxSnapshotInput): AxSnapshotResult {
  // Node ids are unique per FRAME, so every lookup carries its frame.
  const byFrame = new Map(input.frames.map((f) => [f.refPrefix + f.frameId, new Map(f.nodes.map((n) => [n.nodeId, n]))]));
  // An owner's "<refPrefix>|<backendNodeId>" → the frame it hosts.
  const ownerIndex = new Map<string, AxFrame>();
  for (const f of input.frames) {
    if (f.owner) ownerIndex.set(`${f.owner.refPrefix}|${f.owner.backendNodeId}`, f);
  }
  const printed = new Set<AxFrame>();
  const refs: { ref: string; sessionId?: string; frameId: string }[] = [];

  const lines: string[] = [];
  const lineParent: number[] = [];
  const lineNode: AxNode[] = [];

  const frameIdOf = (f: AxFrame) => ({ ...(f.sessionId === undefined ? {} : { sessionId: f.sessionId }), frameId: f.frameId });
  const rootOf = (f: AxFrame) => f.nodes.find((n) => n.parentId === undefined) ?? f.nodes[0];

  function print(frame: AxFrame, node: AxNode, depth: number, parentLineIndex: number, ancestorName: string): void {
    const role = roleOf(node);
    const name = nameOf(node);
    const backend = node.backendDOMNodeId;

    // 131/003 — an <iframe> element: print the frame line, then its own tree
    // one level deeper. Checked FIRST, because an iframe node can be ignored
    // or flattened by the rules below and the frame must still show.
    const child = backend === undefined ? undefined : ownerIndex.get(`${frame.refPrefix}|${backend}`);
    const isFrameOwner = role === "Iframe" || role === "IframePresentational";
    if (child || isFrameOwner) {
      const ref = backend === undefined ? "" : `${frame.refPrefix}${backend}`;
      if (backend !== undefined) refs.push({ ref, ...frameIdOf(frame) });
      let line = "  ".repeat(depth) + "- iframe" + (name ? ` "${name}"` : "");
      if (child) line += ` · ${child.origin}`;
      if (!child || child.unavailable) line += " (content not available)";
      if (ref !== "") line += ` [ref=${ref}]`;
      const myLineIndex = lines.length;
      lines.push(line);
      lineParent.push(parentLineIndex);
      lineNode.push(node);
      if (child && !child.unavailable) {
        printed.add(child);
        const root = rootOf(child);
        if (root) print(child, root, depth + 1, myLineIndex, "");
      }
      return;
    }

    const byId = byFrame.get(frame.refPrefix + frame.frameId);

    if (node.ignored === true || (FLATTENED_ROLES.has(role) && name === "") || role === "InlineTextBox") {
      for (const cid of node.childIds ?? []) {
        const childNode = byId?.get(cid);
        if (childNode) print(frame, childNode, depth, parentLineIndex, ancestorName);
      }
      return;
    }

    if (role === "StaticText" && name === ancestorName) return;

    let line = "  ".repeat(depth) + "- " + role + (name ? ` "${name}"` : "");
    line += propertyBrackets(node);
    // A StaticText node's backendDOMNodeId can point at the raw DOM Text
    // node (e.g. the text inside a standalone <label>), not an Element — CDP
    // resolves it, but it has no getAttribute and can never be clicked or
    // filled. Never offer a ref for plain text (measured 2026-09-19).
    if (node.backendDOMNodeId !== undefined && role !== "StaticText") {
      const ref = `${frame.refPrefix}${node.backendDOMNodeId}`;
      line += ` [ref=${ref}]`;
      refs.push({ ref, ...frameIdOf(frame) });
    }
    const value = node.value?.value;
    if (VALUE_ROLES.has(role) && typeof value === "string" && value !== "") line += `: ${value}`;

    const myLineIndex = lines.length;
    lines.push(line);
    lineParent.push(parentLineIndex);
    lineNode.push(node);

    for (const cid of node.childIds ?? []) {
      const childNode = byId?.get(cid);
      if (childNode) print(frame, childNode, depth + 1, myLineIndex, name || ancestorName);
    }
  }

  const top = input.frames[0];
  if (!top) return { kind: "scope-missing" };
  if (input.scopeRef === undefined) {
    const root = rootOf(top);
    if (root) print(top, root, 0, -1, "");
  } else {
    // "f1:23" → child frame f1, node 23. A scope ref whose frame is not in
    // this snapshot is the same failure as a scope ref that is not on the page.
    const m = /^(f\d+:)?(\d+)$/.exec(input.scopeRef);
    if (!m) return { kind: "scope-missing" };
    const prefix = m[1] ?? "";
    const backend = Number(m[2]);
    const frame = input.frames.find((f) => f.refPrefix === prefix && f.nodes.some((n) => n.backendDOMNodeId === backend));
    const node = frame?.nodes.find((n) => n.backendDOMNodeId === backend);
    if (!frame || !node) return { kind: "scope-missing" };
    print(frame, node, 0, -1, "");
  }

  // A frame whose <iframe> element was not printed (it was not in its parent's
  // tree at all) still gets its content, at the end and at depth 0, so the
  // snapshot never silently drops a frame.
  if (input.scopeRef === undefined) {
    for (const f of input.frames) {
      if (f === top || printed.has(f) || f.unavailable) continue;
      const root = rootOf(f);
      if (!root) continue;
      const myLineIndex = lines.length;
      lines.push(`- iframe · ${f.origin}`);
      lineParent.push(-1);
      lineNode.push(root);
      print(f, root, 1, myLineIndex, "");
    }
  }

  let keepIndices: Set<number> | undefined;
  if (input.includeText) {
    const needle = input.includeText.toLowerCase();
    const matches = (v: unknown) => typeof v === "string" && v.toLowerCase().includes(needle);
    keepIndices = new Set<number>();
    for (let i = 0; i < lineNode.length; i++) {
      const node = lineNode[i];
      if (matches(nameOf(node)) || matches(node.value?.value)) {
        let idx: number | undefined = i;
        while (idx !== undefined && idx >= 0 && !keepIndices.has(idx)) {
          keepIndices.add(idx);
          idx = lineParent[idx] >= 0 ? lineParent[idx] : undefined;
        }
      }
    }
  }

  const kept = keepIndices ? lines.filter((_, i) => keepIndices.has(i)) : lines;

  let text = kept.join("\n");
  if (text.length > SNAPSHOT_MAX_CHARS) {
    const note = "\n(Snapshot cut at 12,000 characters. Pass scope with a ref, or include_text, to see more.)";
    let out = "";
    for (const line of kept) {
      const next = out === "" ? line : `${out}\n${line}`;
      if (next.length + note.length > SNAPSHOT_MAX_CHARS) break;
      out = next;
    }
    text = out + note;
  }

  if (text.length === 0) return { kind: "ok", text: "The page has no accessible content.", refs };
  return { kind: "ok", text, refs };
}
