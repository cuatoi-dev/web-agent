import type { AgentBrand } from "./types";
import type {
  AgentEdit,
  UserAgent,
  ListedAgent,
  AgentStore,
  AgentStorage,
} from "./agent-store.types";

export const AGENT_EDITS_KEY = "agentEdits";
export const USER_AGENTS_KEY = "userAgents";
/** The side panel agent shown last (120/002). Read and written by
 *  `settings.ts`; removed by Delete agent (121/004). */
export const LAST_AGENT_KEY = "sidePanelAgent";

export const chromeAgentStorage: AgentStorage = {
  get: (keys) => chrome.storage.local.get(keys),
  set: (items) => chrome.storage.local.set(items),
  remove: (keys) => chrome.storage.local.remove(keys),
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads `agentEdits` and `userAgents` in one call, the same tolerance
 *  `skill-registry.ts:41-45` gives a corrupt key: a value of the wrong shape
 *  reads as empty rather than throwing. An entry in `userAgents` without a
 *  string `id` is skipped. */
export async function readAgentStore(
  storage: AgentStorage = chromeAgentStorage,
): Promise<AgentStore> {
  const got = await storage.get([AGENT_EDITS_KEY, USER_AGENTS_KEY]);
  const rawEdits = got[AGENT_EDITS_KEY];
  const rawUsers = got[USER_AGENTS_KEY];

  const edits: Record<string, AgentEdit> = {};
  if (isRecord(rawEdits)) {
    for (const [id, e] of Object.entries(rawEdits)) {
      if (isRecord(e)) {
        edits[id] = e as unknown as AgentEdit;
      }
    }
  }

  const users: UserAgent[] = [];
  if (Array.isArray(rawUsers)) {
    for (const u of rawUsers) {
      if (isRecord(u) && typeof u.id === "string" && u.id.length > 0) {
        users.push(u as unknown as UserAgent);
      }
    }
  }

  return { edits, users };
}

/** Brand agents, each replaced by its stored edit when one exists, plus any
 *  stored user agent whose id does not clash with a brand agent — the brand
 *  always wins an id clash. An edit whose id names no brand agent changes
 *  nothing (the brand dropped that agent; the edit is kept in storage). */
export function listAgents(
  brand: AgentBrand,
  edits: Record<string, AgentEdit>,
  users: UserAgent[],
): ListedAgent[] {
  const out: ListedAgent[] = [];
  for (const a of brand.agents) {
    const e = edits[a.id];
    if (e) {
      out.push({
        ...a,
        description: e.description,
        instructions: e.instructions,
        model: e.model ?? undefined,
        tools: e.tools,
        excludeTools: e.excludeTools,
        skills: e.skills,
        excludeSkills: e.excludeSkills,
        origin: "brand",
        edited: true,
      });
    } else {
      out.push({
        ...a,
        origin: "brand",
        edited: false,
      });
    }
  }

  const brandIds = new Set(brand.agents.map((a) => a.id));
  for (const u of users) {
    if (brandIds.has(u.id)) continue;
    out.push({
      ...u,
      model: u.model ?? undefined,
      origin: "user",
      edited: false,
    });
  }

  return out;
}

/** `brand` with `agents` replaced by the merged list. */
export function mergedBrand(brand: AgentBrand, store: AgentStore): AgentBrand {
  return {
    ...brand,
    agents: listAgents(brand, store.edits, store.users),
  };
}
