import { describe, expect, it, vi } from "vitest";
import {
  addAgent,
  draftFromAgent,
  editFromDraft,
  emptyDraft,
  equalsBrand,
  ERR_DESCRIPTION,
  ERR_DISPLAY_NAME,
  ERR_INSTRUCTIONS,
  ERR_SKILLS,
  ERR_TOOLS,
  makeId,
  resetAgent,
  sameList,
  sameSet,
  saveAgent,
  takenIds,
  validateDraft,
} from "./agent-edit-rules";
import type { AgentEdit, AgentStorage, ListedAgent, UserAgent } from "./agent-store.types";
import type { AgentBrand, BrandAgent } from "./types";
import { AGENT_EDITS_KEY, USER_AGENTS_KEY } from "./agent-store";

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

const TESAGENT: BrandAgent = {
  id: "tesagent",
  displayName: "tesagent",
  description: "Test agent — website testing and Playwright scripts",
  // Ends with a newline, as in brand.json from YAML block scalar (|)
  instructions: "You are Tesagent, a test agent.\n",
  tools: "*",
  skills: "*",
};

const listed: ListedAgent = {
  ...TESAGENT,
  origin: "brand",
  edited: false,
};

const brand = {
  agents: [TESAGENT],
  defaultAgent: "tesagent",
  prompts: {},
  tools: {},
  skills: {},
  options: {},
  models: [],
  skillDefs: [],
  hosts: [],
} as unknown as AgentBrand;

const CT = {
  id: "checkout-tester", displayName: "Checkout tester", description: "d", instructions: "i",
  model: null, tools: "*", excludeTools: [], skills: "*", excludeSkills: [],
};

const validDraft = () => draftFromAgent(listed);

describe("agent-edit-rules", () => {
  it("R1 draftFromAgent", () => {
    const d = draftFromAgent(listed);
    expect(d.model).toBeNull();
    expect(d.excludeTools).toEqual([]);
    expect(d.excludeSkills).toEqual([]);
    expect(d.tools).toBe("*");

    const withTools: ListedAgent = {
      ...listed,
      tools: ["a"],
    };
    const dTools = draftFromAgent(withTools);
    expect(dTools.tools).toEqual(["a"]);
    expect(dTools.tools).not.toBe(withTools.tools);
  });

  it("R2 validateDraft", () => {
    expect(validateDraft(validDraft(), "brand")).toEqual({});

    const emptyDesc = { ...validDraft(), description: "  " };
    expect(validateDraft(emptyDesc, "brand")).toEqual({ description: ERR_DESCRIPTION });

    const emptyInst = { ...validDraft(), instructions: "" };
    expect(validateDraft(emptyInst, "brand")).toEqual({ instructions: ERR_INSTRUCTIONS });

    const emptySkills = { ...validDraft(), skills: [] };
    expect(validateDraft(emptySkills, "brand")).toEqual({ skills: ERR_SKILLS });

    const emptyTools = { ...validDraft(), tools: [] };
    expect(validateDraft(emptyTools, "brand")).toEqual({ tools: ERR_TOOLS });

    const emptyNameBrand = { ...validDraft(), displayName: "" };
    expect(validateDraft(emptyNameBrand, "brand")).toEqual({});

    const emptyNameUser = { ...validDraft(), displayName: "" };
    expect(validateDraft(emptyNameUser, "user")).toEqual({ displayName: ERR_DISPLAY_NAME });

    const fullExcludes = {
      ...validDraft(),
      excludeTools: ["read_tabs", "open_tab"],
      excludeSkills: ["tab_management"],
    };
    expect(validateDraft(fullExcludes, "brand")).toEqual({});
  });

  it("R3 sameSet / sameList", () => {
    expect(sameSet(["a", "b"], ["b", "a"])).toBe(true);
    expect(sameSet(["a"], ["a", "b"])).toBe(false);
    expect(sameList("*", "*")).toBe(true);
    expect(sameList("*", [])).toBe(false);
    expect(sameList(["a", "b"], ["b", "a"])).toBe(true);
  });

  it("R4 equalsBrand", () => {
    expect(equalsBrand(editFromDraft(validDraft()), TESAGENT)).toBe(true);

    const withModel = { ...validDraft(), model: "anthropic-sonnet" };
    expect(equalsBrand(editFromDraft(withModel), TESAGENT)).toBe(false);

    const emptyTools = { ...validDraft(), tools: [] };
    expect(equalsBrand(editFromDraft(emptyTools), TESAGENT)).toBe(false);

    const spacesDesc = { ...validDraft(), description: `  ${TESAGENT.description}  ` };
    expect(equalsBrand(editFromDraft(spacesDesc), TESAGENT)).toBe(true);

    const tesWithModel: BrandAgent = { ...TESAGENT, model: "anthropic-sonnet" };
    const draftBrandModel = { ...validDraft(), model: "brand:anthropic-sonnet" };
    expect(equalsBrand(editFromDraft(draftBrandModel), tesWithModel)).toBe(true);
    const draftRawModel = { ...validDraft(), model: "anthropic-sonnet" };
    expect(equalsBrand(editFromDraft(draftRawModel), tesWithModel)).toBe(false);
  });

  it("Correction 2: brand agent whose instructions end in a newline, saved unchanged, stores no edit", async () => {
    const brandWithNewline: BrandAgent = {
      id: "agent_nl",
      displayName: "Agent Newline",
      description: "Desc",
      instructions: "Line 1\nLine 2\n",
      tools: "*",
      skills: "*",
    };
    const agentListed: ListedAgent = {
      ...brandWithNewline,
      origin: "brand",
      edited: false,
    };
    const b = {
      agents: [brandWithNewline],
      defaultAgent: "agent_nl",
      prompts: {},
      tools: {},
      skills: {},
      options: {},
      models: [],
      skillDefs: [],
      hosts: [],
    } as unknown as AgentBrand;

    // The draft has trimmed or untrimmed instructions; editFromDraft trims it.
    const draft = draftFromAgent(agentListed);
    const edit = editFromDraft(draft);
    expect(equalsBrand(edit, brandWithNewline)).toBe(true);

    const { storage, set } = fakeStorage({
      [AGENT_EDITS_KEY]: { agent_nl: { description: "prior edit" } },
    });
    await saveAgent(storage, b, agentListed, draft);
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith({ [AGENT_EDITS_KEY]: {} });
  });

  it("R5 saveAgent brand, differs", async () => {
    const existingEdit: AgentEdit = {
      description: "c",
      instructions: "ci",
      model: null,
      tools: "*",
      excludeTools: [],
      skills: "*",
      excludeSkills: [],
    };
    const { storage, set } = fakeStorage({
      [AGENT_EDITS_KEY]: { chromagent: existingEdit },
    });

    const draft = { ...validDraft(), description: "  New  " };
    await saveAgent(storage, brand, listed, draft);

    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith({
      [AGENT_EDITS_KEY]: {
        chromagent: existingEdit,
        tesagent: {
          description: "New",
          instructions: TESAGENT.instructions.trim(),
          model: null,
          tools: "*",
          excludeTools: [],
          skills: "*",
          excludeSkills: [],
        },
      },
    });
  });

  it("R6 saveAgent brand, equal", async () => {
    const { storage, set } = fakeStorage({
      [AGENT_EDITS_KEY]: {
        tesagent: { description: "old" },
        chromagent: { description: "c" },
      },
    });
    await saveAgent(storage, brand, listed, validDraft());
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith({
      [AGENT_EDITS_KEY]: { chromagent: { description: "c" } },
    });
  });

  it("R7 saveAgent user", async () => {
    const analyst: UserAgent = {
      id: "analyst",
      displayName: "Data Analyst",
      description: "ad",
      instructions: "ai",
      model: null,
      tools: "*",
      excludeTools: [],
      skills: "*",
      excludeSkills: [],
    };
    const other: UserAgent = {
      id: "other",
      displayName: "Other",
      description: "od",
      instructions: "oi",
      model: null,
      tools: "*",
      excludeTools: [],
      skills: "*",
      excludeSkills: [],
    };
    const { storage, set } = fakeStorage({
      [USER_AGENTS_KEY]: [analyst, other],
    });

    const agent: ListedAgent = {
      ...analyst,
      origin: "user",
      edited: false,
    };
    const draft = {
      ...draftFromAgent(agent),
      displayName: " Analyst 2 ",
      tools: ["read_tabs"],
    };

    await saveAgent(storage, brand, agent, draft);
    expect(set).toHaveBeenCalledTimes(1);
    const savedUsers = set.mock.calls[0][0][USER_AGENTS_KEY] as UserAgent[];
    expect(savedUsers[0]).toEqual({
      id: "analyst",
      displayName: "Analyst 2",
      description: "ad",
      instructions: "ai",
      model: null,
      tools: ["read_tabs"],
      excludeTools: [],
      skills: "*",
      excludeSkills: [],
    });
    expect(savedUsers[1]).toBe(other);
  });

  it("R8 saveAgent user not found", async () => {
    const { storage, set } = fakeStorage({ [USER_AGENTS_KEY]: [] });
    const userAgent: ListedAgent = {
      id: "missing",
      displayName: "Missing",
      description: "d",
      instructions: "i",
      tools: "*",
      skills: "*",
      origin: "user",
      edited: false,
    };
    await saveAgent(storage, brand, userAgent, draftFromAgent(userAgent));
    expect(set).not.toHaveBeenCalled();
  });

  it("R9 corrupt key", async () => {
    const { storage, set } = fakeStorage({ [AGENT_EDITS_KEY]: "broken" });
    const draft = { ...validDraft(), description: "New description" };
    await saveAgent(storage, brand, listed, draft);
    expect(set).toHaveBeenCalledWith({
      [AGENT_EDITS_KEY]: {
        tesagent: {
          description: "New description",
          instructions: TESAGENT.instructions.trim(),
          model: null,
          tools: "*",
          excludeTools: [],
          skills: "*",
          excludeSkills: [],
        },
      },
    });
  });

  it("R10 resetAgent", async () => {
    const { storage, set } = fakeStorage({
      [AGENT_EDITS_KEY]: {
        tesagent: { description: "d" },
        chromagent: { description: "c" },
      },
    });
    await resetAgent(storage, "tesagent");
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith({
      [AGENT_EDITS_KEY]: { chromagent: { description: "c" } },
    });
  });

  it("R11 makeId examples", () => {
    const brandIds = new Set(["chromagent", "tesagent"]);
    expect(makeId("Checkout tester", brandIds)).toBe("checkout-tester");
    expect(makeId("Checkout tester", new Set([...brandIds, "checkout-tester"]))).toBe("checkout-tester-2");
    expect(makeId("Checkout tester", new Set([...brandIds, "checkout-tester", "checkout-tester-2"]))).toBe("checkout-tester-3");
    expect(makeId("Tesagent", brandIds)).toBe("tesagent-2");
    expect(makeId("Été QA!", brandIds)).toBe("t-qa");
    expect(makeId("!!!", brandIds)).toBe("agent");
    expect(makeId("", brandIds)).toBe("agent");
    expect(makeId("  --A  b--  ", brandIds)).toBe("a-b");
  });

  it("R12 takenIds joins brand and user ids", () => {
    const b = { agents: [{ id: "chromagent" }, { id: "tesagent" }] } as unknown as AgentBrand;
    const ids = takenIds(b, { edits: {}, users: [CT as UserAgent] });
    expect([...ids].sort()).toEqual(["checkout-tester", "chromagent", "tesagent"]);
  });

  it("R13 addAgent stores one trimmed record with a free id, in one set", async () => {
    const { store, storage, set } = fakeStorage({ userAgents: [CT] });
    const b = { agents: [{ id: "chromagent" }, { id: "tesagent" }] } as unknown as AgentBrand;
    const draft = { ...emptyDraft(), displayName: "  Checkout tester ", description: " D ", instructions: " I ", tools: ["read_tabs", "page_eval"] };
    const id = await addAgent(storage, b, draft);
    expect(id).toBe("checkout-tester-2");
    expect(set).toHaveBeenCalledTimes(1);
    expect(store.userAgents).toEqual([
      CT,
      { id: "checkout-tester-2", displayName: "Checkout tester", description: "D", instructions: "I", model: null,
        tools: ["read_tabs", "page_eval"], excludeTools: [], skills: "*", excludeSkills: [] },
    ]);
    const second = await addAgent(storage, b, { ...emptyDraft(), displayName: "Tesagent", description: "d", instructions: "i" });
    expect(second).toBe("tesagent-2");
  });

  it("R14 emptyDraft defaults", () => {
    expect(emptyDraft()).toEqual({ displayName: "", description: "", instructions: "", model: null,
      tools: "*", excludeTools: [], skills: "*", excludeSkills: [] });
  });
});
