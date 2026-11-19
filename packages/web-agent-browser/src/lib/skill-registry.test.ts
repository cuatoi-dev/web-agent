import { describe, it, expect, vi } from "vitest";
import { skillTools, type ToolContext } from "@cuatoi/web-agent-core";
import {
  extensionSkillRegistry,
  forwardedSkillRegistry,
  handlePageSkillsRequest,
  handleSkillsRequest,
  SKILLS_KEY,
  SKILLS_MESSAGE_PREFIX,
  SKILLS_RESULT_MESSAGE,
} from "./skill-registry";
import type { SkillStorage, SkillsRequestMessage } from "./types";

function fakeStorage(initial: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = { ...initial };
  const set = vi.fn((items: Record<string, unknown>) => {
    Object.assign(store, items);
    return Promise.resolve();
  });
  const get = vi.fn((key: string) => Promise.resolve({ [key]: store[key] }));
  return { store, storage: { get, set } as SkillStorage, get, set };
}

const SKILL_A = { name: "pirate_speak", description: "Answer like a pirate", definition: "Say arr." };
const SKILL_B = { name: "panel_note", description: "A note", definition: "Note text." };
const PANEL_OWNER = { agentId: "tesagent", displayName: "tesagent" };
const OWNED = { ...SKILL_A, name: "login_smoke", owner: "tesagent" };
const OWNER_ERROR = 'A skill named "login_smoke" belongs to another agent. Choose another name.';

describe("handleSkillsRequest", () => {
  it("1a: wa-skills-list on an empty store resolves [] and never writes", async () => {
    const { storage, set } = fakeStorage();
    const reply = await handleSkillsRequest({ type: "wa-skills-list", id: "x" }, storage);
    expect(reply).toEqual({ type: "wa-skills-result", id: "x", result: [] });
    expect(set).not.toHaveBeenCalled();
  });

  it("1b: wa-skills-list on a corrupt key resolves [] without throwing", async () => {
    for (const bad of ["broken", null, {}]) {
      const { storage } = fakeStorage({ [SKILLS_KEY]: bad });
      const reply = await handleSkillsRequest({ type: "wa-skills-list", id: "x" }, storage);
      expect(reply.result).toEqual([]);
    }
  });

  it("1c: wa-skills-get for a stored name returns that skill", async () => {
    const { storage } = fakeStorage({ [SKILLS_KEY]: [SKILL_A] });
    const reply = await handleSkillsRequest({ type: "wa-skills-get", id: "x", name: "pirate_speak" }, storage);
    expect(reply.result).toEqual(SKILL_A);
  });

  it("1d: wa-skills-get for an unknown name returns undefined", async () => {
    const { storage } = fakeStorage({ [SKILLS_KEY]: [SKILL_A] });
    const reply = await handleSkillsRequest({ type: "wa-skills-get", id: "x", name: "nope" }, storage);
    expect(reply.result).toBeUndefined();
  });

  it("1e: wa-skills-save of a new skill writes once and appends", async () => {
    const { storage, set } = fakeStorage({ [SKILLS_KEY]: [SKILL_A] });
    const reply = await handleSkillsRequest({ type: "wa-skills-save", id: "x", skill: SKILL_B }, storage);
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith({ [SKILLS_KEY]: [SKILL_A, SKILL_B] });
    expect(reply.result).toBe(true);
  });

  it("1f: wa-skills-save of an existing name replaces it, appended last, one write", async () => {
    const updated = { ...SKILL_A, description: "New description" };
    const { storage, set } = fakeStorage({ [SKILLS_KEY]: [SKILL_A, SKILL_B] });
    await handleSkillsRequest({ type: "wa-skills-save", id: "x", skill: updated }, storage);
    expect(set).toHaveBeenCalledTimes(1);
    const written = set.mock.calls[0][0][SKILLS_KEY] as (typeof SKILL_A)[];
    expect(written).toHaveLength(2);
    expect(written.filter((s) => s.name === "pirate_speak")).toHaveLength(1);
    expect(written[written.length - 1]).toEqual(updated);
  });

  it("1g: wa-skills-remove of a stored name drops it, keeps order of the rest", async () => {
    const { storage } = fakeStorage({ [SKILLS_KEY]: [SKILL_A, SKILL_B] });
    const reply = await handleSkillsRequest({ type: "wa-skills-remove", id: "x", name: "pirate_speak" }, storage);
    expect(reply.result).toBe(true);
    const stored = await handleSkillsRequest({ type: "wa-skills-list", id: "y" }, storage);
    expect(stored.result).toEqual([SKILL_B]);
  });

  it("1h: wa-skills-remove of an unknown name writes nothing", async () => {
    const { storage, set } = fakeStorage({ [SKILLS_KEY]: [SKILL_A] });
    await handleSkillsRequest({ type: "wa-skills-remove", id: "x", name: "nope" }, storage);
    expect(set).not.toHaveBeenCalled();
  });

  it("1i: the reply always echoes the request id", async () => {
    const { storage } = fakeStorage({ [SKILLS_KEY]: [SKILL_A] });
    const requests: SkillsRequestMessage[] = [
      { type: "wa-skills-list", id: "id-1" },
      { type: "wa-skills-get", id: "id-2", name: "pirate_speak" },
      { type: "wa-skills-save", id: "id-3", skill: SKILL_B },
      { type: "wa-skills-remove", id: "id-4", name: "panel_note" },
    ];
    for (const req of requests) {
      const reply = await handleSkillsRequest(req, storage);
      expect(reply.id).toBe(req.id);
    }
  });
});

describe("extensionSkillRegistry", () => {
  it("2a: list() on an empty store returns []", async () => {
    const { storage } = fakeStorage();
    expect(await extensionSkillRegistry(PANEL_OWNER, storage).list()).toEqual([]);
  });

  it("2b: save() then list() returns the saved skill", async () => {
    const { storage } = fakeStorage();
    const reg = extensionSkillRegistry(PANEL_OWNER, storage);
    await reg.save!(SKILL_A);
    expect(await reg.list()).toEqual([SKILL_A]);
  });

  it("2c: save() twice with the same name keeps length 1 with the new definition", async () => {
    const { storage } = fakeStorage();
    const reg = extensionSkillRegistry(PANEL_OWNER, storage);
    await reg.save!(SKILL_A);
    await reg.save!({ ...SKILL_A, definition: "New def." });
    const list = await reg.list();
    expect(list).toHaveLength(1);
    expect(list[0].definition).toBe("New def.");
  });

  it("2d: get(name) after save returns the skill; get of an unknown name returns undefined", async () => {
    const { storage } = fakeStorage();
    const reg = extensionSkillRegistry(PANEL_OWNER, storage);
    await reg.save!(SKILL_A);
    expect(await reg.get("pirate_speak")).toEqual(SKILL_A);
    expect(await reg.get("nope")).toBeUndefined();
  });

  it("2e: remove(name) then get(name) is undefined and list() no longer contains it", async () => {
    const { storage } = fakeStorage();
    const reg = extensionSkillRegistry(PANEL_OWNER, storage);
    await reg.save!(SKILL_A);
    await reg.remove!("pirate_speak");
    expect(await reg.get("pirate_speak")).toBeUndefined();
    expect(await reg.list()).toEqual([]);
  });

  it("2f: satisfies core's writable-registry gate (builders.ts:180)", () => {
    const reg = extensionSkillRegistry(PANEL_OWNER, fakeStorage().storage);
    expect(typeof reg.save).toBe("function");
    expect(typeof reg.remove).toBe("function");
    expect(reg.supportsOwner).toBe(true);
    expect(reg.ownerLabel).toBe("tesagent");
  });
});

/** Links a fake `RelayFetchContext` to a real `handleSkillsRequest`, so
 *  `forwardedSkillRegistry` is proved against the ISOLATED-world handler
 *  rather than against a hand-written expectation. */
function linkedContext(storage: SkillStorage) {
  const listeners = new Set<(e: MessageEvent) => void>();
  const posted: unknown[] = [];
  const ctx = {
    postMessage: (message: unknown) => {
      posted.push(message);
      void (async () => {
        const reply = await handleSkillsRequest(message as SkillsRequestMessage, storage);
        for (const l of [...listeners]) l({ data: reply } as MessageEvent);
      })();
    },
    addEventListener: (_t: string, l: (e: MessageEvent) => void) => {
      listeners.add(l);
    },
    removeEventListener: (_t: string, l: (e: MessageEvent) => void) => {
      listeners.delete(l);
    },
  };
  return { ctx, posted, listeners };
}

describe("forwardedSkillRegistry", () => {
  it("3a: list() round trip resolves the fake storage's array", async () => {
    const { storage } = fakeStorage({ [SKILLS_KEY]: [SKILL_A] });
    const { ctx } = linkedContext(storage);
    expect(await forwardedSkillRegistry(ctx).list()).toEqual([SKILL_A]);
  });

  it("3b: save() then list() through the link; storage.set called once", async () => {
    const { storage, set } = fakeStorage();
    const { ctx } = linkedContext(storage);
    const reg = forwardedSkillRegistry(ctx);
    await reg.save!(SKILL_A);
    expect(set).toHaveBeenCalledTimes(1);
    expect(await reg.list()).toEqual([SKILL_A]);
  });

  it("3c: get(name) round trip; unknown name resolves undefined", async () => {
    const { storage } = fakeStorage({ [SKILLS_KEY]: [SKILL_A] });
    const { ctx } = linkedContext(storage);
    const reg = forwardedSkillRegistry(ctx);
    expect(await reg.get("pirate_speak")).toEqual(SKILL_A);
    expect(await reg.get("nope")).toBeUndefined();
  });

  it("3d: remove(name) round trip removes it from list()", async () => {
    const { storage } = fakeStorage({ [SKILLS_KEY]: [SKILL_A] });
    const { ctx } = linkedContext(storage);
    const reg = forwardedSkillRegistry(ctx);
    await reg.remove!("pirate_speak");
    expect(await reg.list()).toEqual([]);
  });

  it("3e: the listener does not leak across sequential calls", async () => {
    const { storage } = fakeStorage();
    const { ctx, listeners } = linkedContext(storage);
    const reg = forwardedSkillRegistry(ctx);
    for (let i = 0; i < 5; i++) await reg.list();
    expect(listeners.size).toBe(0);
  });

  it("3f: a reply is never treated as a request — bridge.ts's exact guard", () => {
    const isRequest = (type: string) => type.startsWith(SKILLS_MESSAGE_PREFIX) && type !== SKILLS_RESULT_MESSAGE;
    expect(isRequest("wa-skills-result")).toBe(false);
    expect(isRequest("wa-skills-list")).toBe(true);
    expect(isRequest("wa-skills-get")).toBe(true);
    expect(isRequest("wa-skills-save")).toBe(true);
    expect(isRequest("wa-skills-remove")).toBe(true);
  });

  it("3g: timeout resolves, never rejects, for all four methods", async () => {
    const deadCtx = {
      postMessage: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    const reg = forwardedSkillRegistry(deadCtx, 20);
    await expect(reg.list()).resolves.toEqual([]);
    await expect(reg.get("x")).resolves.toBeUndefined();
    await expect(reg.save!(SKILL_A)).resolves.toBeUndefined();
    await expect(reg.remove!("x")).resolves.toBeUndefined();
  });

  it("3h: the timeout still removes its listener", async () => {
    const listeners = new Set<(e: MessageEvent) => void>();
    const ctx = {
      postMessage: () => {},
      addEventListener: (_t: string, l: (e: MessageEvent) => void) => listeners.add(l),
      removeEventListener: (_t: string, l: (e: MessageEvent) => void) => listeners.delete(l),
    };
    const reg = forwardedSkillRegistry(ctx, 20);
    await reg.list();
    expect(listeners.size).toBe(0);
  });

  it("3i: replies for other ids are ignored; the call resolves with the right one", async () => {
    const listeners = new Set<(e: MessageEvent) => void>();
    const posted: SkillsRequestMessage[] = [];
    const ctx = {
      postMessage: (message: unknown) => {
        posted.push(message as SkillsRequestMessage);
      },
      addEventListener: (_t: string, l: (e: MessageEvent) => void) => listeners.add(l),
      removeEventListener: (_t: string, l: (e: MessageEvent) => void) => listeners.delete(l),
    };
    const reg = forwardedSkillRegistry(ctx, 2000);
    const promise = reg.list();
    // Wait a tick for postMessage to be called.
    await Promise.resolve();
    const req = posted[0];
    for (const l of [...listeners]) {
      l({ data: { type: "wa-skills-result", id: "wrong-id", result: [SKILL_B] } } as MessageEvent);
    }
    for (const l of [...listeners]) {
      l({ data: { type: "wa-skills-result", id: req.id, result: [SKILL_A] } } as MessageEvent);
    }
    expect(await promise).toEqual([SKILL_A]);
  });

  it("3j: ids are unique across many requests", async () => {
    const posted: SkillsRequestMessage[] = [];
    const ctx = {
      postMessage: (message: unknown) => {
        posted.push(message as SkillsRequestMessage);
      },
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    const reg = forwardedSkillRegistry(ctx, 20);
    for (let i = 0; i < 50; i++) void reg.list();
    await new Promise((r) => setTimeout(r, 30));
    const ids = posted.map((r) => r.id);
    expect(new Set(ids).size).toBe(50);
  });
});

describe("handleSkillsRequest — owners", () => {
  it("4a: list with agentId chromagent sees shared skills only", async () => {
    const { storage } = fakeStorage({ [SKILLS_KEY]: [SKILL_A, OWNED] });
    const reply = await handleSkillsRequest({ type: "wa-skills-list", id: "x", agentId: "chromagent" }, storage);
    expect(reply.result).toEqual([SKILL_A]);
  });

  it("4b: list with agentId tesagent sees shared plus its own", async () => {
    const { storage } = fakeStorage({ [SKILLS_KEY]: [SKILL_A, OWNED] });
    const reply = await handleSkillsRequest({ type: "wa-skills-list", id: "x", agentId: "tesagent" }, storage);
    expect(reply.result).toEqual([SKILL_A, OWNED]);
  });

  it("4c: list with no agentId sees shared skills only", async () => {
    const { storage } = fakeStorage({ [SKILLS_KEY]: [SKILL_A, OWNED] });
    const reply = await handleSkillsRequest({ type: "wa-skills-list", id: "x" }, storage);
    expect(reply.result).toEqual([SKILL_A]);
  });

  it("4d: get login_smoke resolves for its owner only", async () => {
    const { storage } = fakeStorage({ [SKILLS_KEY]: [SKILL_A, OWNED] });
    const other = await handleSkillsRequest(
      { type: "wa-skills-get", id: "x", name: "login_smoke", agentId: "chromagent" },
      storage,
    );
    expect(other.result).toBeUndefined();
    const owner = await handleSkillsRequest(
      { type: "wa-skills-get", id: "x", name: "login_smoke", agentId: "tesagent" },
      storage,
    );
    expect(owner.result).toEqual(OWNED);
  });

  it("4e: save with no agentId strips owner from the skill", async () => {
    const { storage, set } = fakeStorage({ [SKILLS_KEY]: [] });
    await handleSkillsRequest(
      { type: "wa-skills-save", id: "x", skill: { ...SKILL_B, owner: "tesagent" } },
      storage,
    );
    expect(set).toHaveBeenCalledWith({ [SKILLS_KEY]: [SKILL_B] });
    const written = set.mock.calls[0][0][SKILLS_KEY] as Record<string, unknown>[];
    expect(Object.keys(written[0])).not.toContain("owner");
  });

  it("4f: a save for a name another agent owns is refused", async () => {
    const { storage, set } = fakeStorage({ [SKILLS_KEY]: [OWNED] });
    const reply = await handleSkillsRequest(
      { type: "wa-skills-save", id: "x", skill: { ...SKILL_A, name: "login_smoke" }, agentId: "chromagent" },
      storage,
    );
    expect(reply).toEqual({ type: "wa-skills-result", id: "x", error: OWNER_ERROR });
    expect(set).not.toHaveBeenCalled();
  });

  it("4g: a save for a name another agent owns is refused with no agentId too", async () => {
    const { storage, set } = fakeStorage({ [SKILLS_KEY]: [OWNED] });
    const reply = await handleSkillsRequest(
      { type: "wa-skills-save", id: "x", skill: { ...SKILL_A, name: "login_smoke" } },
      storage,
    );
    expect(reply).toEqual({ type: "wa-skills-result", id: "x", error: OWNER_ERROR });
    expect(set).not.toHaveBeenCalled();
  });

  it("4h: the owner overwrites its own private skill", async () => {
    const { storage, set } = fakeStorage({ [SKILLS_KEY]: [OWNED] });
    const reply = await handleSkillsRequest(
      { type: "wa-skills-save", id: "x", skill: { ...SKILL_A, name: "login_smoke" }, agentId: "tesagent" },
      storage,
    );
    expect(reply.result).toBe(true);
    expect(set).toHaveBeenCalledWith({ [SKILLS_KEY]: [{ ...SKILL_A, name: "login_smoke" }] });
  });

  it("4i: another agent can save a shared name as its own private skill", async () => {
    const { storage, set } = fakeStorage({ [SKILLS_KEY]: [SKILL_A] });
    const reply = await handleSkillsRequest(
      { type: "wa-skills-save", id: "x", skill: { ...SKILL_A, owner: "tesagent" }, agentId: "tesagent" },
      storage,
    );
    expect(reply.result).toBe(true);
    expect(set).toHaveBeenCalledWith({ [SKILLS_KEY]: [{ ...SKILL_A, owner: "tesagent" }] });
  });

  it("4j: a remove of another agent's private skill writes nothing", async () => {
    const { storage, set } = fakeStorage({ [SKILLS_KEY]: [OWNED] });
    const reply = await handleSkillsRequest(
      { type: "wa-skills-remove", id: "x", name: "login_smoke", agentId: "chromagent" },
      storage,
    );
    expect(reply.result).toBe(true);
    expect(set).not.toHaveBeenCalled();
  });

  it("4k: the owner removes its own private skill", async () => {
    const { storage, set } = fakeStorage({ [SKILLS_KEY]: [OWNED, SKILL_B] });
    await handleSkillsRequest({ type: "wa-skills-remove", id: "x", name: "login_smoke", agentId: "tesagent" }, storage);
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith({ [SKILLS_KEY]: [SKILL_B] });
  });
});

describe("handlePageSkillsRequest — forged agentId", () => {
  function seeded() {
    return fakeStorage({ [SKILLS_KEY]: [SKILL_A, OWNED] });
  }

  it("5a: list with a forged agentId sees shared skills only", async () => {
    const { storage } = seeded();
    const reply = await handlePageSkillsRequest({ type: "wa-skills-list", id: "x", agentId: "tesagent" }, storage);
    expect(reply.result).toEqual([SKILL_A]);
  });

  it("5b: get with a forged agentId does not resolve a private skill", async () => {
    const { storage } = seeded();
    const reply = await handlePageSkillsRequest(
      { type: "wa-skills-get", id: "x", name: "login_smoke", agentId: "tesagent" },
      storage,
    );
    expect(reply.result).toBeUndefined();
  });

  it("5c: save with a forged agentId stores a shared skill", async () => {
    const { storage, set } = seeded();
    const reply = await handlePageSkillsRequest(
      { type: "wa-skills-save", id: "x", skill: { ...SKILL_B, owner: "tesagent" }, agentId: "tesagent" },
      storage,
    );
    expect(reply.result).toBe(true);
    const written = set.mock.calls[0][0][SKILLS_KEY] as Record<string, unknown>[];
    const panelNote = written.find((s) => s.name === "panel_note");
    expect(panelNote).toBeDefined();
    expect(Object.keys(panelNote ?? {})).not.toContain("owner");
  });

  it("5d: a forged agentId cannot save over another agent's private skill", async () => {
    const { storage, set } = seeded();
    const reply = await handlePageSkillsRequest(
      { type: "wa-skills-save", id: "x", skill: { ...SKILL_B, name: "login_smoke" }, agentId: "tesagent" },
      storage,
    );
    expect(reply.error).toBe(OWNER_ERROR);
    expect(set).not.toHaveBeenCalled();
  });

  it("5e: a forged agentId cannot remove another agent's private skill", async () => {
    const { storage, set } = seeded();
    const reply = await handlePageSkillsRequest(
      { type: "wa-skills-remove", id: "x", name: "login_smoke", agentId: "tesagent" },
      storage,
    );
    expect(reply.result).toBe(true);
    expect(set).not.toHaveBeenCalled();
  });
});

describe("extensionSkillRegistry — owners", () => {
  it("6a: save with shared: false stores the owner; another agent's registry does not see it", async () => {
    const { storage } = fakeStorage({ [SKILLS_KEY]: [] });
    const reg = extensionSkillRegistry(PANEL_OWNER, storage);
    await reg.save!(SKILL_B, { shared: false });
    expect(await reg.list()).toEqual([{ ...SKILL_B, owner: "tesagent" }]);

    const other = extensionSkillRegistry({ agentId: "chromagent", displayName: "Chromagent" }, storage);
    expect(await other.list()).toEqual([]);
    expect(await other.get("panel_note")).toBeUndefined();
  });

  it("6b: save with no options, or shared: true, stores no owner", async () => {
    const { storage } = fakeStorage({ [SKILLS_KEY]: [] });
    const reg = extensionSkillRegistry(PANEL_OWNER, storage);
    await reg.save!({ ...SKILL_B, owner: "tesagent" });
    let stored = await reg.get("panel_note");
    expect(stored && "owner" in stored).toBe(false);

    await reg.save!({ ...SKILL_B, owner: "tesagent" }, { shared: true });
    stored = await reg.get("panel_note");
    expect(stored && "owner" in stored).toBe(false);
  });

  it("6c: a save for a name another agent owns throws; remove of it is a no-op", async () => {
    const { storage } = fakeStorage({ [SKILLS_KEY]: [OWNED] });
    const reg = extensionSkillRegistry({ agentId: "chromagent", displayName: "Chromagent" }, storage);
    await expect(reg.save!({ ...SKILL_A, name: "login_smoke" })).rejects.toThrow(OWNER_ERROR);
    expect(await storage.get(SKILLS_KEY)).toEqual({ [SKILLS_KEY]: [OWNED] });
    await reg.remove!("login_smoke");
    expect(await storage.get(SKILLS_KEY)).toEqual({ [SKILLS_KEY]: [OWNED] });
  });
});

describe("forwardedSkillRegistry — owners", () => {
  it("7a: the bubble's registry sees shared skills only and reports no supportsOwner", async () => {
    const { storage } = fakeStorage({ [SKILLS_KEY]: [SKILL_A, OWNED] });
    const { ctx } = linkedContext(storage);
    const reg = forwardedSkillRegistry(ctx);
    expect(await reg.list()).toEqual([SKILL_A]);
    expect(await reg.get("login_smoke")).toBeUndefined();
    expect(reg.supportsOwner).toBeUndefined();
  });

  it("7b: a save for a name an agent owns rejects and writes nothing", async () => {
    const { storage, set } = fakeStorage({ [SKILLS_KEY]: [OWNED] });
    const { ctx } = linkedContext(storage);
    const reg = forwardedSkillRegistry(ctx);
    await expect(reg.save!({ ...SKILL_A, name: "login_smoke" })).rejects.toThrow(OWNER_ERROR);
    expect(set).not.toHaveBeenCalled();
  });

  it("7c: a save carrying an owner is stored shared", async () => {
    const { storage } = fakeStorage({ [SKILLS_KEY]: [] });
    const { ctx } = linkedContext(storage);
    const reg = forwardedSkillRegistry(ctx);
    await reg.save!({ ...SKILL_B, owner: "tesagent" });
    const stored = await reg.get("panel_note");
    expect(stored && "owner" in stored).toBe(false);
  });
});

describe("create_skill over the real extension registry", () => {
  it("8a: tesagent saves a private skill through the real registry", async () => {
    const { storage } = fakeStorage({ [SKILLS_KEY]: [] });
    const reg = extensionSkillRegistry(PANEL_OWNER, storage);
    const confirmInteraction = vi.fn().mockResolvedValue(true);
    const ctx: ToolContext = {
      app: { appName: "t" },
      signal: new AbortController().signal,
      skillRegistry: reg,
      skills: [],
      confirmInteraction,
    };
    const defs = skillTools(ctx);
    const createDef = defs.find((d) => d.name === "create_skill")!;
    const schema = createDef.inputSchema as { properties: Record<string, unknown> };
    expect(schema.properties.shared).toBeDefined();

    const r = await createDef.execute(
      { name: "login_smoke", description: "d", definition: "def", shared: false },
      ctx,
    );

    expect(r.isError).toBeUndefined();
    expect(await storage.get(SKILLS_KEY)).toEqual({
      [SKILLS_KEY]: [{ name: "login_smoke", description: "d", definition: "def", owner: "tesagent" }],
    });
    expect(confirmInteraction.mock.calls[0][0].summary).toBe('Create skill "login_smoke" for tesagent only');
  });

  it("8b: Chromagent's create_skill for a name tesagent owns fails through the real registry", async () => {
    const { storage } = fakeStorage({ [SKILLS_KEY]: [OWNED] });
    const reg = extensionSkillRegistry({ agentId: "chromagent", displayName: "Chromagent" }, storage);
    const ctx: ToolContext = {
      app: { appName: "t" },
      signal: new AbortController().signal,
      skillRegistry: reg,
      skills: [],
      confirmInteraction: vi.fn().mockResolvedValue(true),
    };
    const defs = skillTools(ctx);
    const createDef = defs.find((d) => d.name === "create_skill")!;

    const r = await createDef.execute({ name: "login_smoke", description: "d", definition: "def" }, ctx);

    expect(r.content).toBe(`Failed to save skill "login_smoke": ${OWNER_ERROR}`);
    expect(r.isError).toBe(true);
    expect(await storage.get(SKILLS_KEY)).toEqual({ [SKILLS_KEY]: [OWNED] });
  });

  it("8c: the in-page bubble's create_skill schema has no shared", () => {
    const { storage } = fakeStorage();
    const { ctx: relayCtx } = linkedContext(storage);
    const reg = forwardedSkillRegistry(relayCtx);
    const ctx: ToolContext = {
      app: { appName: "t" },
      signal: new AbortController().signal,
      skillRegistry: reg,
      skills: [],
    };
    const defs = skillTools(ctx);
    const createDef = defs.find((d) => d.name === "create_skill")!;
    const schema = createDef.inputSchema as { properties: Record<string, unknown> };
    expect(Object.keys(schema.properties)).not.toContain("shared");
  });
});
