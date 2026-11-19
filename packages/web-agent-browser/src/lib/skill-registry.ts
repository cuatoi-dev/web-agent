import type { SkillDef, SkillRegistry } from "@cuatoi/web-agent-core";
import type {
  PanelSkillOwner,
  RelayFetchContext,
  SkillStorage,
  SkillsRequestMessage,
  SkillsResultMessage,
} from "./types";

export type { PanelSkillOwner, SkillStorage, SkillsRequestMessage, SkillsResultMessage } from "./types";

/** The one `chrome.storage.local` key both extension agents share. A skill
 *  saved on any site, or in the side panel, lands here. A skill with no
 *  `owner` is visible to every agent; one with `owner` only to that side panel
 *  agent. Exported because the options page reads the
 *  same key. */
export const SKILLS_KEY = "savedSkills";

/** Every `wa-skills-*` request type starts with this. `bridge.ts` uses it to
 *  decide whether a message is ours before looking at the rest. */
export const SKILLS_MESSAGE_PREFIX = "wa-skills-";

/** The reply type, sent once per request. */
export const SKILLS_RESULT_MESSAGE = "wa-skills-result";

/** How long the MAIN world waits for the ISOLATED world's reply. Same 2000 ms
 *  `askMainWorld` uses in the other direction (bridge.ts:195), and it resolves
 *  rather than rejects for the same reason: a pending promise at session start
 *  would hang the agent before its first turn. */
export const SKILLS_TIMEOUT_MS = 2000;

/** True when `value` is a plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The skill array stored under {@link SKILLS_KEY}, or `[]` when the key is
 *  absent or holds something that is not an array. A corrupt key must never
 *  stop a session from starting — the same rule core's own
 *  `LocalStorageSkillRegistry.list()` follows (skill-registry.ts:28-37). */
async function readAll(storage: SkillStorage): Promise<SkillDef[]> {
  const got = await storage.get(SKILLS_KEY);
  const stored: unknown = got[SKILLS_KEY];
  return Array.isArray(stored) ? (stored as SkillDef[]) : [];
}

/** True when `agentId` may see `skill`. A skill with no `owner` is
 *  shared. An owned skill is seen only by its owner, so an undefined
 *  `agentId` — the in-page bubble — sees shared skills only. */
function visible(skill: SkillDef, agentId: string | undefined): boolean {
  return skill.owner === undefined || skill.owner === agentId;
}

/** A copy of `skill` with no `owner` field: a shared skill. */
function withoutOwner(skill: SkillDef): SkillDef {
  const copy = { ...skill };
  delete copy.owner;
  return copy;
}

/**
 * The ISOLATED world's half of the forwarder: one request in, one reply out.
 *
 * Pure apart from the injected `storage`, so `bridge.ts` stays a thin wiring
 * layer and the whole switch is unit-testable with a fake. `bridge.ts` posts
 * whatever this returns.
 *
 * `msg.agentId` decides what the caller sees: shared skills plus
 * its own. A name stays unique across every agent, so a save for a name the
 * caller cannot see is refused with `error`, and a remove of it writes
 * nothing.
 */
export async function handleSkillsRequest(
  msg: SkillsRequestMessage,
  storage: SkillStorage,
): Promise<SkillsResultMessage> {
  const skills = await readAll(storage);
  if (msg.type === "wa-skills-list") {
    return { type: SKILLS_RESULT_MESSAGE, id: msg.id, result: skills.filter((s) => visible(s, msg.agentId)) };
  }
  if (msg.type === "wa-skills-get") {
    return {
      type: SKILLS_RESULT_MESSAGE,
      id: msg.id,
      result: skills.find((s) => s.name === msg.name && visible(s, msg.agentId)),
    };
  }
  if (msg.type === "wa-skills-save") {
    // A request with no agentId is the in-page path: it always stores a
    // shared skill, so a page cannot save one for a side panel agent.
    const skill = msg.agentId === undefined ? withoutOwner(msg.skill) : msg.skill;
    const same = skills.find((s) => s.name === skill.name);
    if (same && !visible(same, msg.agentId)) {
      return {
        type: SKILLS_RESULT_MESSAGE,
        id: msg.id,
        error: `A skill named "${skill.name}" belongs to another agent. Choose another name.`,
      };
    }
    // Name is the identity: the existing entry is dropped and the new one is
    // appended, so the stored array holds exactly one entry per name. One
    // `set` call.
    const without = skills.filter((s) => s.name !== skill.name);
    await storage.set({ [SKILLS_KEY]: [...without, skill] });
    return { type: SKILLS_RESULT_MESSAGE, id: msg.id, result: true };
  }
  const same = skills.find((s) => s.name === msg.name);
  if (same && visible(same, msg.agentId)) {
    await storage.set({ [SKILLS_KEY]: skills.filter((s) => s.name !== msg.name) });
  }
  return { type: SKILLS_RESULT_MESSAGE, id: msg.id, result: true };
}

/**
 * The bridge's entry point for a request a page posted.
 *
 * Every such request comes from the page's MAIN world — the in-page bubble or
 * any other script on the page — and never from a side panel agent, so
 * `agentId` is removed before the request is handled. A page that forges
 * `agentId` still sees shared skills only, saves shared skills only, and
 * cannot remove a side panel agent's private skill.
 */
export function handlePageSkillsRequest(
  msg: SkillsRequestMessage,
  storage: SkillStorage,
): Promise<SkillsResultMessage> {
  const request = { ...msg };
  delete request.agentId;
  return handleSkillsRequest(request, storage);
}

/** The `chrome.storage.local` binding, written out rather than passed directly:
 *  `LocalStorageArea.get` is overloaded (callback and promise forms), and a
 *  two-line adapter type-checks without depending on which overload TypeScript
 *  picks. The arrows read `chrome` only when called, so importing this module
 *  in a jsdom unit test with no chrome global is safe. Exported because the
 *  options page binds the same storage area. */
export const chromeSkillStorage: SkillStorage = {
  get: (key) => chrome.storage.local.get(key),
  set: (items) => chrome.storage.local.set(items),
};

/**
 * The side panel's registry for one agent. An extension page reaches
 * `chrome.storage.local` directly, exactly as `settings.ts:21,46` already
 * does, so it needs no forwarder.
 *
 * Every call carries the agent's id, so the agent sees shared
 * skills plus its own. `supportsOwner` makes core's create_skill offer
 * `shared`; `shared: false` stores the skill with `owner: agentId`, anything
 * else stores it with no owner. A refused save throws, and create_skill turns
 * the throw into its tool error.
 */
export function extensionSkillRegistry(
  owner: PanelSkillOwner,
  storage: SkillStorage = chromeSkillStorage,
): SkillRegistry {
  const { agentId, displayName } = owner;
  return {
    supportsOwner: true,
    ownerLabel: displayName,
    async list() {
      const reply = await handleSkillsRequest({ type: "wa-skills-list", id: "panel", agentId }, storage);
      return Array.isArray(reply.result) ? reply.result : [];
    },
    async get(name: string) {
      const reply = await handleSkillsRequest({ type: "wa-skills-get", id: "panel", name, agentId }, storage);
      return isRecord(reply.result) && !Array.isArray(reply.result) ? (reply.result as SkillDef) : undefined;
    },
    async save(skill: SkillDef, options?: { shared?: boolean }) {
      const stored = options?.shared === false ? { ...skill, owner: agentId } : withoutOwner(skill);
      const reply = await handleSkillsRequest({ type: "wa-skills-save", id: "panel", agentId, skill: stored }, storage);
      if (reply.error !== undefined) throw new Error(reply.error);
    },
    async remove(name: string) {
      await handleSkillsRequest({ type: "wa-skills-remove", id: "panel", name, agentId }, storage);
    },
  };
}

/**
 * The in-page registry, for the MAIN world.
 *
 * The MAIN world has no `chrome.*`, so every call is posted to the ISOLATED
 * world and waits for the reply carrying the same `id`. This is the mirror of
 * `askMainWorld` (bridge.ts:191-212), which posts the other way.
 *
 * `ctx` defaults to `window` and is the same three-method seam `relay-fetch.ts`
 * uses, so a unit test drives both ends with no browser worlds.
 */
export function forwardedSkillRegistry(
  ctx: RelayFetchContext = window,
  timeoutMs: number = SKILLS_TIMEOUT_MS,
): SkillRegistry {
  let counter = 0;

  /** Post one request and resolve with its reply. On timeout it resolves
   *  `undefined` rather than rejecting: a hung promise here blocks the session
   *  from starting, and core already treats a failing registry as "no skills"
   *  (skill-registry.ts:92-106). The listener is always removed, on both the
   *  reply path and the timeout path, so no request leaks one. */
  function ask(request: SkillsRequestMessage): Promise<SkillsResultMessage | undefined> {
    return new Promise((resolve) => {
      const done = (reply: SkillsResultMessage | undefined) => {
        clearTimeout(timer);
        ctx.removeEventListener("message", onReply);
        resolve(reply);
      };
      const onReply = (event: MessageEvent) => {
        const data: unknown = event.data;
        if (!isRecord(data) || data.type !== SKILLS_RESULT_MESSAGE || data.id !== request.id) return;
        done(data as unknown as SkillsResultMessage);
      };
      const timer = setTimeout(() => done(undefined), timeoutMs);
      ctx.addEventListener("message", onReply);
      ctx.postMessage(request, "*");
    });
  }

  /** Same id shape `relay-fetch.ts:14` uses. `crypto.randomUUID` is
   *  deliberately not used: it needs a secure context, and this content script
   *  runs on plain `http://` pages too. */
  const nextId = () => `wa-skill-${++counter}-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

  // No supportsOwner and no agentId: the bubble has no `shared`
  // input and sees shared skills only.
  return {
    async list() {
      const result = (await ask({ type: "wa-skills-list", id: nextId() }))?.result;
      return Array.isArray(result) ? result : [];
    },
    async get(name: string) {
      const result = (await ask({ type: "wa-skills-get", id: nextId(), name }))?.result;
      return isRecord(result) && !Array.isArray(result) ? (result as SkillDef) : undefined;
    },
    async save(skill: SkillDef) {
      // Only an explicit refusal throws; a timeout still resolves, as above.
      const reply = await ask({ type: "wa-skills-save", id: nextId(), skill });
      if (reply?.error !== undefined) throw new Error(reply.error);
    },
    async remove(name: string) {
      await ask({ type: "wa-skills-remove", id: nextId(), name });
    },
  };
}
