// The shapes for skill-registry.ts: the storage seam, the MAIN<->ISOLATED
// wa-skills-* protocol, and the side panel's per-agent owner (120/004). Split
// out of types.ts on 2026-09-16 to stay under that file's 500-line cap
// (eslint.config.mjs max-lines); imports nothing, mirroring
// page-screenshot-tool.types.ts.

import type { SkillDef } from "@cuatoi/web-agent-core";

/** The two `chrome.storage.local` calls the ISOLATED-world registry needs, as
 *  narrow function types so a unit test can supply a fake without a chrome
 *  global — same approach as `panel-toggle.ts` `QueryTabs`/`SendToTab`. */
export interface SkillStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

/** MAIN -> ISOLATED. One registry call, replied to via the same `id`.
 *  `agentId` is the side panel agent asking (120/004); absent = the in-page
 *  bubble, which sees and saves shared skills only — `bridge.ts` strips it
 *  from a page's request. */
export type SkillsRequestMessage =
  | { type: "wa-skills-list"; id: string; agentId?: string }
  | { type: "wa-skills-get"; id: string; name: string; agentId?: string }
  | { type: "wa-skills-save"; id: string; skill: SkillDef; agentId?: string }
  | { type: "wa-skills-remove"; id: string; name: string; agentId?: string };

/** ISOLATED -> MAIN. `result` is the skill array for `list`, the found skill
 *  (or `undefined`) for `get`, `true` for `save`/`remove`. `error` (120/004)
 *  marks a refused request. */
export interface SkillsResultMessage {
  type: "wa-skills-result";
  id: string;
  result?: SkillDef[] | SkillDef | true;
  error?: string;
}

/** The side panel agent a registry belongs to (120/004); shown in the
 *  create_skill confirm summary via `displayName`. */
export interface PanelSkillOwner {
  agentId: string;
  displayName: string;
}
