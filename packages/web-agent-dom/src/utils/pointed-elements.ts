import type { PointedElementSnapshot } from "./types.js";

// Re-exported so importers of this module keep their existing import path.
export type { PointedElementSnapshot } from "./types.js";

/** Format focused per-element snapshots into a numbered
 *  "# Pointed elements" block appended to an outgoing user message. Each
 *  item's own top line already carries "[ref] role "name" …" from
 *  DomAdapter#walkFromRoot's normal line format — reusing that syntax (rather
 *  than the idea's illustrative "role "name" → ref" arrow notation) keeps it
 *  consistent with the snapshot_page format the agent already parses. */
export function buildPointedElementsBlock(snapshots: PointedElementSnapshot[]): string {
  const body = snapshots
    .map((s, i) => {
      const lines = s.text.split("\n");
      return lines.map((line, li) => (li === 0 ? `${i + 1}. ${line}` : `   ${line}`)).join("\n");
    })
    .join("\n");
  return `# Pointed elements (the user clicked these)\n${body}`;
}
