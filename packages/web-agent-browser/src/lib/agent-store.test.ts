import { describe, it, expect, vi } from "vitest";
import {
  readAgentStore,
  listAgents,
  mergedBrand,
  AGENT_EDITS_KEY,
  USER_AGENTS_KEY,
} from "./agent-store";
import type { AgentStorage, AgentEdit, UserAgent } from "./agent-store.types";
import type { AgentBrand } from "./types";

function fakeStorage(initial: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = { ...initial };
  const set = vi.fn((items: Record<string, unknown>) => {
    Object.assign(store, items);
    return Promise.resolve();
  });
  const get = vi.fn((keys: string | string[]) => {
    const list = Array.isArray(keys) ? keys : [keys];
    const out: Record<string, unknown> = {};
    for (const k of list) out[k] = store[k];
    return Promise.resolve(out);
  });
  return { store, storage: { get, set } as AgentStorage, get, set };
}

const CHROMAGENT = {
  id: "chromagent",
  displayName: "Chromagent",
  description: "Your Personal Assistant",
  instructions: "Chromagent instructions.",
  tools: "*" as const,
  skills: "*" as const,
  excludeSkills: ["test_plan"],
};

const TESAGENT = {
  id: "tesagent",
  displayName: "tesagent",
  description: "Test agent",
  instructions: "tesagent instructions.",
  tools: "*" as const,
  skills: "*" as const,
};

function brand(): AgentBrand {
  return {
    agents: [CHROMAGENT, TESAGENT],
    defaultAgent: "chromagent",
    prompts: {},
    tools: {},
    skills: {},
    options: {},
    models: [
      { id: "anthropic-sonnet-stream", label: "Sonnet (stream)", endpoint: "https://x/api/anthropic", wireFormat: "anthropic", model: "sonnet", streaming: true },
    ],
    skillDefs: [],
    hosts: [],
  } as unknown as AgentBrand;
}

const TESAGENT_EDIT: AgentEdit = {
  description: "Custom tesagent tester",
  instructions: "Custom tesagent instructions.",
  model: "anthropic-sonnet-stream",
  tools: ["read_tabs", "page_eval"],
  excludeTools: [],
  skills: "*",
  excludeSkills: [],
};

const USER_AGENT: UserAgent = {
  id: "analyst",
  displayName: "Data Analyst",
  description: "Analyzes table data",
  instructions: "You analyze tables.",
  model: null,
  tools: "*",
  excludeTools: [],
  skills: "*",
  excludeSkills: [],
};

describe("readAgentStore", () => {
  it("U1: empty storage returns empty edits and users", async () => {
    const { storage } = fakeStorage();
    const store = await readAgentStore(storage);
    expect(store).toEqual({ edits: {}, users: [] });
  });

  it("U2: tolerates corrupt non-record edits and non-array users", async () => {
    for (const badEdits of ["broken", null, ["x"]]) {
      for (const badUsers of ["broken", null, {}]) {
        const { storage } = fakeStorage({ [AGENT_EDITS_KEY]: badEdits, [USER_AGENTS_KEY]: badUsers });
        const store = await readAgentStore(storage);
        expect(store).toEqual({ edits: {}, users: [] });
      }
    }
  });

  it("U3: filters out user agent entries missing a string id", async () => {
    const { storage } = fakeStorage({
      [USER_AGENTS_KEY]: [USER_AGENT, { ...USER_AGENT, id: "" }, { ...USER_AGENT, id: 5 }, { displayName: "no id" }],
    });
    const store = await readAgentStore(storage);
    expect(store.users).toEqual([USER_AGENT]);
  });

  it("reads both keys in one storage.get call", async () => {
    const { storage, get } = fakeStorage({ [AGENT_EDITS_KEY]: { tesagent: TESAGENT_EDIT } });
    await readAgentStore(storage);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith([AGENT_EDITS_KEY, USER_AGENTS_KEY]);
  });
});

describe("listAgents", () => {
  it("U4: with no stored edits, returns brand agents with origin brand and edited false", () => {
    const out = listAgents(brand(), {}, []);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: "chromagent", origin: "brand", edited: false });
    expect(out[1]).toMatchObject({ id: "tesagent", origin: "brand", edited: false });
  });

  it("U5: keeps chromagent excludeSkills intact", () => {
    const out = listAgents(brand(), {}, []);
    expect(out[0].excludeSkills).toEqual(["test_plan"]);
  });

  it("U6: applies a stored edit, replacing all editable fields and setting edited true", () => {
    const out = listAgents(brand(), { tesagent: TESAGENT_EDIT }, []);
    const d = out.find((a) => a.id === "tesagent");
    expect(d).toMatchObject({
      description: TESAGENT_EDIT.description,
      instructions: TESAGENT_EDIT.instructions,
      model: "anthropic-sonnet-stream",
      tools: TESAGENT_EDIT.tools,
      excludeTools: TESAGENT_EDIT.excludeTools,
      skills: TESAGENT_EDIT.skills,
      excludeSkills: TESAGENT_EDIT.excludeSkills,
      origin: "brand",
      edited: true,
    });
  });

  it("U7: maps a stored model of null to undefined", () => {
    const out = listAgents(brand(), { tesagent: { ...TESAGENT_EDIT, model: null } }, []);
    expect(out.find((a) => a.id === "tesagent")?.model).toBeUndefined();
  });

  it("U8: appends a user agent with origin user and edited false", () => {
    const out = listAgents(brand(), {}, [USER_AGENT]);
    expect(out).toHaveLength(3);
    expect(out[2]).toMatchObject({ id: "analyst", displayName: "Data Analyst", origin: "user", edited: false });
  });

  it("U9: skips a user agent whose id clashes with a brand agent; the brand agent is kept", () => {
    const clash: UserAgent = { ...USER_AGENT, id: "tesagent", displayName: "Fake tesagent" };
    const out = listAgents(brand(), {}, [clash]);
    expect(out).toHaveLength(2);
    const d = out.find((a) => a.id === "tesagent");
    expect(d?.displayName).toBe("tesagent");
    expect(d?.origin).toBe("brand");
  });

  it("U10: ignores a stored edit for an id not present in the brand", () => {
    const out = listAgents(brand(), { gone: TESAGENT_EDIT }, []);
    expect(out).toEqual(listAgents(brand(), {}, []));
  });
});

describe("mergedBrand", () => {
  it("U11: returns a brand copy with agents set to listAgents' result", () => {
    const b = brand();
    const merged = mergedBrand(b, { edits: { tesagent: TESAGENT_EDIT }, users: [USER_AGENT] });
    expect(merged).not.toBe(b);
    expect(merged.defaultAgent).toBe(b.defaultAgent);
    expect(merged.agents).toEqual(listAgents(b, { tesagent: TESAGENT_EDIT }, [USER_AGENT]));
  });
});
