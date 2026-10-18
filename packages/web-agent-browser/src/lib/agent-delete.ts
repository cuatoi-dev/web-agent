import type { AgentStorage } from "./agent-store.types";
import { LAST_AGENT_KEY, USER_AGENTS_KEY, isRecord, readAgentStore } from "./agent-store";
import { SKILLS_KEY } from "./skill-registry";

/** The side panel's session database for one agent: the namespace set at
 *  `sidepanel.ts:buildAgentPanel` (`sessionNamespace`) with the `web-agent-` prefix `IdbSessionStore` adds
 *  (`packages/web-agent-core/src/loop/session-store.ts:45`). */
export function sessionDatabaseName(id: string): string {
  return `web-agent-web-agent-extension-panel-${id}`;
}

/** The `savedSkills` array, or `[]` for a missing or corrupt key — the same
 *  tolerance as `saved-skills.ts:8-12`. */
async function readSkills(storage: AgentStorage): Promise<unknown[]> {
  const got = await storage.get(SKILLS_KEY);
  const stored: unknown = got[SKILLS_KEY];
  return Array.isArray(stored) ? (stored as unknown[]) : [];
}

const ownedBy = (s: unknown, id: string): boolean => isRecord(s) && s.owner === id;

/** How many saved skills have `owner === id`. */
export async function ownedSkillCount(storage: AgentStorage, id: string): Promise<number> {
  return (await readSkills(storage)).filter((s) => ownedBy(s, id)).length;
}

/** The design's confirmation text. "are" in both cases: the subject is
 *  "Its chat history and its … skill" (plan Notes). */
export function deleteMessage(displayName: string, n: number): string {
  const noun = n === 1 ? "private skill" : "private skills";
  return `Delete ${displayName}? Its chat history and its ${n} ${noun} are deleted too.`;
}

/** The design's confirmed branch: storage first, then the database delete,
 *  which is not awaited. One storage.set for both keys. */
export async function deleteAgent(
  storage: AgentStorage,
  id: string,
  deleteDatabase: (name: string) => void,
): Promise<void> {
  const store = await readAgentStore(storage);
  const skills = await readSkills(storage);
  await storage.set({
    [USER_AGENTS_KEY]: store.users.filter((u) => u.id !== id),
    [SKILLS_KEY]: skills.filter((s) => !ownedBy(s, id)),
  });
  const got = await storage.get(LAST_AGENT_KEY);
  if (got[LAST_AGENT_KEY] === id) await storage.remove(LAST_AGENT_KEY);
  deleteDatabase(sessionDatabaseName(id));
}
