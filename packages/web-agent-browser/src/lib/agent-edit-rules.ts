import type { AgentBrand, BrandAgent } from "./types";
import type { AgentEdit, AgentStorage, AgentStore, ListedAgent, UserAgent } from "./agent-store.types";
import type { AgentDraft, AgentDraftErrors } from "./agent-editor.types";
import type { MultiSelectValue } from "./multi-select.types";
import { AGENT_EDITS_KEY, USER_AGENTS_KEY, isRecord, readAgentStore } from "./agent-store";

export const ERR_DISPLAY_NAME = "Enter a display name.";
export const ERR_DESCRIPTION = "Enter a description.";
export const ERR_INSTRUCTIONS = "Enter the system instructions.";
export const ERR_SKILLS = "Choose at least one skill or All skills (*)";
export const ERR_TOOLS = "Choose at least one tool or All tools (*)";

const copy = (v: MultiSelectValue): MultiSelectValue => (v === "*" ? "*" : [...v]);

/** The design's onEdit draft. Copies every list so typing never changes the store. */
export function draftFromAgent(a: ListedAgent): AgentDraft {
  return {
    displayName: a.displayName,
    description: a.description,
    instructions: a.instructions,
    model: a.model ?? null,
    tools: copy(a.tools),
    excludeTools: [...(a.excludeTools ?? [])],
    skills: copy(a.skills),
    excludeSkills: [...(a.excludeSkills ?? [])],
  };
}

/** The design's validate(draft, origin). No rule on the exclude fields. */
export function validateDraft(d: AgentDraft, origin: "brand" | "user"): AgentDraftErrors {
  const errs: AgentDraftErrors = {};
  if (origin === "user" && d.displayName.trim() === "") errs.displayName = ERR_DISPLAY_NAME;
  if (d.description.trim() === "") errs.description = ERR_DESCRIPTION;
  if (d.instructions.trim() === "") errs.instructions = ERR_INSTRUCTIONS;
  if (d.skills !== "*" && d.skills.length === 0) errs.skills = ERR_SKILLS;
  if (d.tools !== "*" && d.tools.length === 0) errs.tools = ERR_TOOLS;
  return errs;
}

export function sameSet(x: string[], y: string[]): boolean {
  return x.length === y.length && x.every((n) => y.includes(n));
}

export function sameList(x: MultiSelectValue, y: MultiSelectValue): boolean {
  if (x === "*" || y === "*") return x === y;
  return sameSet(x, y);
}

/** b = the agent as brand.json holds it, never the merged one. */
export function equalsBrand(edit: AgentEdit, b: BrandAgent): boolean {
  return (
    // Trimmed on both sides: editFromDraft trims, and brand.json keeps the
    // trailing newline of the YAML `|` block (dist/brand.json: chromagent and
    // tesagent instructions both end with "\n").
    edit.description === b.description.trim() &&
    edit.instructions === b.instructions.trim() &&
    edit.model === (b.model ?? null) &&
    sameList(edit.tools, b.tools) &&
    sameSet(edit.excludeTools, b.excludeTools ?? []) &&
    sameList(edit.skills, b.skills) &&
    sameSet(edit.excludeSkills, b.excludeSkills ?? [])
  );
}

export function editFromDraft(d: AgentDraft): AgentEdit {
  return {
    description: d.description.trim(),
    instructions: d.instructions.trim(),
    model: d.model,
    tools: d.tools,
    excludeTools: d.excludeTools,
    skills: d.skills,
    excludeSkills: d.excludeSkills,
  };
}

/** The design's onSave write: exactly one storage.set. The raw key is read,
 *  not readAgentStore's cleaned copy, so every other stored entry is written
 *  back exactly as it was. */
export async function saveAgent(
  storage: AgentStorage,
  brand: AgentBrand,
  agent: ListedAgent,
  draft: AgentDraft,
): Promise<void> {
  if (agent.origin === "brand") {
    const edit = editFromDraft(draft);
    const got = await storage.get(AGENT_EDITS_KEY);
    const raw = got[AGENT_EDITS_KEY];
    const edits: Record<string, unknown> = isRecord(raw) ? { ...raw } : {};
    const brandAgent = brand.agents.find((b) => b.id === agent.id);
    if (brandAgent !== undefined && equalsBrand(edit, brandAgent)) {
      delete edits[agent.id];
    } else {
      edits[agent.id] = edit;
    }
    await storage.set({ [AGENT_EDITS_KEY]: edits });
    return;
  }

  const got = await storage.get(USER_AGENTS_KEY);
  const raw = got[USER_AGENTS_KEY];
  const users: unknown[] = Array.isArray(raw) ? [...(raw as unknown[])] : [];
  const index = users.findIndex((u) => isRecord(u) && u.id === agent.id);
  // The card came from this key, so the entry exists; nothing to replace otherwise.
  if (index === -1) return;
  const record: UserAgent = {
    id: agent.id, // the id never changes
    displayName: draft.displayName.trim(),
    ...editFromDraft(draft),
  };
  users[index] = record;
  await storage.set({ [USER_AGENTS_KEY]: users });
}

/** The design's onReset write. */
export async function resetAgent(storage: AgentStorage, id: string): Promise<void> {
  const got = await storage.get(AGENT_EDITS_KEY);
  const raw = got[AGENT_EDITS_KEY];
  const edits: Record<string, unknown> = isRecord(raw) ? { ...raw } : {};
  delete edits[id];
  await storage.set({ [AGENT_EDITS_KEY]: edits });
}

/** The design's onAdd draft. */
export function emptyDraft(): AgentDraft {
  return {
    displayName: "",
    description: "",
    instructions: "",
    model: null,
    tools: "*",
    excludeTools: [],
    skills: "*",
    excludeSkills: [],
  };
}

/** The design's takenIds(store): brand agent ids and stored user agent ids. */
export function takenIds(brand: AgentBrand, store: AgentStore): Set<string> {
  return new Set([...brand.agents.map((a) => a.id), ...store.users.map((u) => u.id)]);
}

/** The design's makeId(name, taken). Only `[a-z0-9-]` survives, so a name
 *  with no ASCII letter or digit becomes `agent`. */
export function makeId(name: string, taken: ReadonlySet<string>): string {
  let base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (base === "") base = "agent";
  let id = base;
  let n = 2;
  while (taken.has(id)) {
    id = `${base}-${n}`;
    n = n + 1;
  }
  return id;
}

/** The design's onSave for NEW: the store is read again, because another
 *  options page tab may have added an agent since this one painted. Exactly
 *  one storage.set. Returns the new id. */
export async function addAgent(
  storage: AgentStorage,
  brand: AgentBrand,
  draft: AgentDraft,
): Promise<string> {
  const store = await readAgentStore(storage);
  const displayName = draft.displayName.trim();
  const id = makeId(displayName, takenIds(brand, store));
  const record: UserAgent = { id, displayName, ...editFromDraft(draft) };
  await storage.set({ [USER_AGENTS_KEY]: [...store.users, record] });
  return id;
}
