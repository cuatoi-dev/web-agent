// The shapes for agent-store.ts: the storage seam, the stored edit/user-agent
// records, and the merged agent shape. Split into its own file (rather than
// types.ts) per `wa/types-in-types-file` — types.ts is already at the
// 500-line eslint cap.

import type { BrandAgent, AgentBrand } from "./types";

export type { AgentBrand };

/** A stored per-agent edit over a brand agent (`agentEdits.<id>` in
 *  `chrome.storage.local`). Every editable field is stored, not a diff — the
 *  card shows exactly what is stored, and reset is removing the record. */
export interface AgentEdit {
  description: string;
  instructions: string;
  /** A model.yml id; null = "Use the options page model". */
  model: string | null;
  tools: "*" | string[];
  /** Meaningful only when tools == "*". */
  excludeTools: string[];
  skills: "*" | string[];
  /** Meaningful only when skills == "*". */
  excludeSkills: string[];
}

/** A full agent record the user added (`userAgents` in
 *  `chrome.storage.local`). */
export interface UserAgent {
  id: string;
  displayName: string;
  description: string;
  instructions: string;
  model: string | null;
  tools: "*" | string[];
  excludeTools: string[];
  skills: "*" | string[];
  excludeSkills: string[];
}

/** A brand agent merged with any stored edit, or a stored user agent, in the
 *  shape the side panel and the Agents tab both read. */
export interface ListedAgent extends BrandAgent {
  origin: "brand" | "user";
  /** True only for a brand agent with a stored edit. */
  edited: boolean;
}

/** The two stored keys, read together and tolerantly. */
export interface AgentStore {
  edits: Record<string, AgentEdit>;
  users: UserAgent[];
}

/** The `chrome.storage.local` calls the agent store and editor need, as a
 *  narrow function type so a unit test can supply a fake without a chrome
 *  global — same approach as `SkillStorage` (`skill-registry.types.ts`). */
export interface AgentStorage {
  get(keys: string | string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  /** 121/004 — Delete agent removes `sidePanelAgent`. */
  remove(keys: string | string[]): Promise<void>;
}
