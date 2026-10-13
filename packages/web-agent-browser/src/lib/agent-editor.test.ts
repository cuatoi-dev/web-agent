import { beforeAll, describe, expect, it, vi } from "vitest";
import { mountAgentEditor } from "./agent-editor";
import { BRAND_LOCKED_NOTE } from "./agent-cards";
import {
  ERR_DESCRIPTION,
  ERR_DISPLAY_NAME,
  ERR_INSTRUCTIONS,
  ERR_SKILLS,
  ERR_TOOLS,
} from "./agent-edit-rules";
import type { AgentBrand, BrandAgent } from "./types";
import type { AgentStorage } from "./agent-store.types";
import { AGENT_EDITS_KEY, USER_AGENTS_KEY } from "./agent-store";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});

function fakeStorage(initial: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = { ...initial };
  const calls: string[] = [];
  const set = vi.fn((items: Record<string, unknown>) => {
    calls.push(`set:${Object.keys(items).sort().join(",")}`);
    Object.assign(store, items);
    return Promise.resolve();
  });
  const get = vi.fn((keys: string | string[]) => {
    const list = Array.isArray(keys) ? keys : [keys];
    const out: Record<string, unknown> = {};
    for (const k of list) out[k] = store[k];
    return Promise.resolve(out);
  });
  const remove = vi.fn((keys: string | string[]) => {
    calls.push(`remove:${String(keys)}`);
    for (const k of Array.isArray(keys) ? keys : [keys]) delete store[k];
    return Promise.resolve();
  });
  return { store, calls, storage: { get, set, remove } as AgentStorage, get, set, remove };
}

const CT = {
  id: "checkout-tester", displayName: "Checkout tester", description: "d", instructions: "i",
  model: null, tools: "*", excludeTools: [], skills: "*", excludeSkills: [],
};

const flush = () => new Promise((r) => setTimeout(r, 0));

const CHROMAGENT: BrandAgent = {
  id: "chromagent",
  displayName: "Chromagent",
  description: "Your Personal Assistant",
  instructions: "You are Chromagent, a helpful personal assistant.\n",
  tools: "*",
  skills: "*",
  excludeSkills: ["playwright_script"],
};

const TESAGENT: BrandAgent = {
  id: "tesagent",
  displayName: "tesagent",
  description: "Test agent — website testing and Playwright scripts",
  instructions: "You are Tesagent, a test agent.\n",
  tools: "*",
  skills: "*",
};

function brand(options: { lockModel?: boolean } = {}): AgentBrand {
  return {
    agents: [CHROMAGENT, TESAGENT],
    defaultAgent: "chromagent",
    prompts: {},
    tools: {},
    skills: {},
    options,
    models: [
      {
        id: "anthropic-sonnet-stream",
        label: "Sonnet (stream)",
        endpoint: "https://x/api/anthropic",
        wireFormat: "anthropic",
        model: "sonnet",
        streaming: true,
      },
    ],
    skillDefs: [],
    hosts: [],
  } as unknown as AgentBrand;
}

async function setupEditor(overrides?: {
  initialStore?: Record<string, unknown>;
  brandOptions?: { lockModel?: boolean };
}) {
  const el = document.createElement("div");
  const addButton = document.createElement("button");
  addButton.disabled = true;
  document.body.textContent = "";
  document.body.append(addButton, el);
  const { store, calls, storage, get, set, remove } = fakeStorage(overrides?.initialStore);
  const b = brand(overrides?.brandOptions);
  const deleteDatabase = vi.fn();
  const onAgentDeleted = vi.fn(() => Promise.resolve());
  await mountAgentEditor({ container: el, brand: b, storage, addButton, deleteDatabase, onAgentDeleted });
  const card = (id: string) => el.querySelector<HTMLElement>(`[data-agent-id="${id}"]`)!;
  const byId = (id: string) => document.getElementById(id);
  const chips = (id: string) =>
    [...document.querySelectorAll<HTMLElement>(`#${id}-box .chip`)].map((c) => c.dataset.name ?? "");
  const type = (id: string, value: string) => {
    const input = byId(id) as HTMLInputElement | HTMLTextAreaElement;
    input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  return { el, store, calls, storage, get, set, remove, brand: b, card, byId, chips, type, addButton, deleteDatabase, onAgentDeleted };
}

describe("agent-editor", () => {
  it("E1 open tesagent", async () => {
    const { card, byId, chips } = await setupEditor();
    card("tesagent").querySelector<HTMLButtonElement>(".card-edit-btn")!.click();
    const tesagentCard = card("tesagent");

    expect(tesagentCard.classList.contains("editing")).toBe(true);
    const editBtn = tesagentCard.querySelector<HTMLButtonElement>(".card-edit-btn")!;
    expect(editBtn.textContent).toBe("Editing");
    expect(editBtn.disabled).toBe(true);
    expect(tesagentCard.querySelector(".card-title .d")!.textContent).toBe(BRAND_LOCKED_NOTE);
    expect(tesagentCard.querySelector(".facts")).toBeNull();
    expect(byId("edit-tesagent-displayName")).toBeNull();

    const descInput = byId("edit-tesagent-description") as HTMLInputElement;
    expect(descInput.value).toBe(TESAGENT.description);
    const instInput = byId("edit-tesagent-instructions") as HTMLTextAreaElement;
    expect(instInput.value).toBe(TESAGENT.instructions);

    const modelSelect = byId("edit-tesagent-model") as HTMLSelectElement;
    expect(modelSelect.value).toBe("");
    expect(modelSelect.options[0].textContent).toBe("Use the options page model");

    expect(chips("edit-tesagent-skills")).toEqual(["*"]);
    expect(chips("edit-tesagent-tools")).toEqual(["*"]);

    const chromCard = card("chromagent");
    expect(chromCard.classList.contains("dim")).toBe(true);
    expect(chromCard.querySelector<HTMLButtonElement>(".card-edit-btn")!.disabled).toBe(true);

    const actions = tesagentCard.querySelectorAll(".actions button");
    expect(actions.length).toBe(3);
    expect(actions[0].textContent).toBe("Reset to brand default");
    expect(actions[1].textContent).toBe("Cancel");
    expect(actions[2].textContent).toBe("Save agent");
  });

  it("E2 one card at a time", async () => {
    const { card, byId } = await setupEditor();
    card("tesagent").querySelector<HTMLButtonElement>(".card-edit-btn")!.click();
    const chromEditBtn = card("chromagent").querySelector<HTMLButtonElement>(".card-edit-btn")!;
    chromEditBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(byId("edit-chromagent-description")).toBeNull();
    expect(card("tesagent").classList.contains("editing")).toBe(true);
  });

  it("E3 Chromagent exclude state", async () => {
    const { card, byId, chips } = await setupEditor();
    card("chromagent").querySelector<HTMLButtonElement>(".card-edit-btn")!.click();

    expect(chips("edit-chromagent-exclude-skills")).toEqual(["playwright_script"]);
    expect(byId("edit-chromagent-exclude-skills-box")!.getAttribute("aria-disabled")).toBe("false");
  });

  it("E4 single skill disables and empties; saved", async () => {
    const { card, byId, chips, store, set } = await setupEditor();
    card("chromagent").querySelector<HTMLButtonElement>(".card-edit-btn")!.click();

    byId("edit-chromagent-skills-box")!.click();
    const opt = document.querySelector<HTMLElement>(
      '#edit-chromagent-skills-list [role="option"][data-name="tab_management"]',
    )!;
    opt.click();

    expect(byId("edit-chromagent-exclude-skills-box")!.getAttribute("aria-disabled")).toBe("true");
    expect(chips("edit-chromagent-exclude-skills")).toEqual([]);

    card("chromagent").querySelector<HTMLButtonElement>(".save-btn")!.click();
    await flush();

    expect(set).toHaveBeenCalledTimes(1);
    const edits = store[AGENT_EDITS_KEY] as Record<string, { skills: unknown; excludeSkills: unknown }>;
    expect(edits.chromagent.skills).toEqual(["tab_management"]);
    expect(edits.chromagent.excludeSkills).toEqual([]);
  });

  it("E5 All again enables", async () => {
    const { card, byId, chips } = await setupEditor();
    card("chromagent").querySelector<HTMLButtonElement>(".card-edit-btn")!.click();

    byId("edit-chromagent-skills-box")!.click();
    document.querySelector<HTMLElement>('#edit-chromagent-skills-list [role="option"][data-name="tab_management"]')!.click();
    document.querySelector<HTMLElement>('#edit-chromagent-skills-list [role="option"][data-name="*"]')!.click();

    expect(byId("edit-chromagent-exclude-skills-box")!.getAttribute("aria-disabled")).toBe("false");
    expect(chips("edit-chromagent-exclude-skills")).toEqual([]);
  });

  it("E6 All except one", async () => {
    const { card, byId, store } = await setupEditor();
    card("tesagent").querySelector<HTMLButtonElement>(".card-edit-btn")!.click();

    byId("edit-tesagent-exclude-tools-box")!.click();
    document.querySelector<HTMLElement>('#edit-tesagent-exclude-tools-list [role="option"][data-name="page_eval"]')!.click();

    card("tesagent").querySelector<HTMLButtonElement>(".save-btn")!.click();
    await flush();

    const edits = store[AGENT_EDITS_KEY] as Record<string, { tools: unknown; excludeTools: unknown }>;
    expect(edits.tesagent.tools).toBe("*");
    expect(edits.tesagent.excludeTools).toEqual(["page_eval"]);

    const tesagentCard = card("tesagent");
    expect(tesagentCard.querySelector(".facts")!.textContent).toContain("Tools All except 1");
    const pills = [...tesagentCard.querySelectorAll(".pill")].map((p) => p.textContent);
    expect(pills).toContain("Edited");
  });

  it("E7 description + model", async () => {
    const { card, byId, store } = await setupEditor();
    card("tesagent").querySelector<HTMLButtonElement>(".card-edit-btn")!.click();

    const descInput = byId("edit-tesagent-description") as HTMLInputElement;
    descInput.value = "Custom tesagent tester";
    descInput.dispatchEvent(new Event("input", { bubbles: true }));

    const modelSelect = byId("edit-tesagent-model") as HTMLSelectElement;
    modelSelect.value = "anthropic-sonnet-stream";
    modelSelect.dispatchEvent(new Event("change", { bubbles: true }));

    card("tesagent").querySelector<HTMLButtonElement>(".save-btn")!.click();
    await flush();

    const tesagentCard = card("tesagent");
    expect(tesagentCard.querySelector(".edit-body")).toBeNull();
    const pills = [...tesagentCard.querySelectorAll(".pill")].map((p) => p.textContent);
    expect(pills).toContain("Edited");
    expect(tesagentCard.querySelector(".d")!.textContent).toBe("Custom tesagent tester");
    expect(tesagentCard.querySelector(".facts")!.textContent).toContain("Model Sonnet (stream)");

    const edits = store[AGENT_EDITS_KEY] as Record<string, { model: unknown }>;
    expect(edits.tesagent.model).toBe("anthropic-sonnet-stream");
    expect(card("chromagent").querySelector<HTMLButtonElement>(".card-edit-btn")!.disabled).toBe(false);
  });

  it("E8 Cancel", async () => {
    const { card, byId, set } = await setupEditor();
    card("tesagent").querySelector<HTMLButtonElement>(".card-edit-btn")!.click();

    const descInput = byId("edit-tesagent-description") as HTMLInputElement;
    descInput.value = "Unsaved change";
    descInput.dispatchEvent(new Event("input", { bubbles: true }));

    card("tesagent").querySelector<HTMLButtonElement>(".cancel-btn")!.click();
    await flush();

    expect(set).not.toHaveBeenCalled();
    const tesagentCard = card("tesagent");
    expect(tesagentCard.querySelector(".edit-body")).toBeNull();
    expect(tesagentCard.querySelector(".d")!.textContent).toBe(TESAGENT.description);
  });

  it("E9 equal to brand", async () => {
    // (a) Save unchanged
    const { card, set } = await setupEditor();
    card("tesagent").querySelector<HTMLButtonElement>(".card-edit-btn")!.click();
    card("tesagent").querySelector<HTMLButtonElement>(".save-btn")!.click();
    await flush();

    expect(set).toHaveBeenCalledWith({ [AGENT_EDITS_KEY]: {} });
    const pills = [...card("tesagent").querySelectorAll(".pill")].map((p) => p.textContent);
    expect(pills).not.toContain("Edited");

    // (b) Seed with prior edit, revert to brand
    const setupB = await setupEditor({
      initialStore: {
        [AGENT_EDITS_KEY]: {
          tesagent: {
            description: "X",
            instructions: TESAGENT.instructions.trim(),
            model: null,
            tools: "*",
            excludeTools: [],
            skills: "*",
            excludeSkills: [],
          },
        },
      },
    });
    setupB.card("tesagent").querySelector<HTMLButtonElement>(".card-edit-btn")!.click();
    const descInput = setupB.byId("edit-tesagent-description") as HTMLInputElement;
    descInput.value = TESAGENT.description;
    descInput.dispatchEvent(new Event("input", { bubbles: true }));

    setupB.card("tesagent").querySelector<HTMLButtonElement>(".save-btn")!.click();
    await flush();

    const edits = setupB.store[AGENT_EDITS_KEY] as Record<string, unknown>;
    expect(edits.tesagent).toBeUndefined();
    const pillsB = [...setupB.card("tesagent").querySelectorAll(".pill")].map((p) => p.textContent);
    expect(pillsB).not.toContain("Edited");
  });

  it("E10 empty instructions", async () => {
    const { card, byId, set } = await setupEditor();
    card("tesagent").querySelector<HTMLButtonElement>(".card-edit-btn")!.click();

    const inst = byId("edit-tesagent-instructions") as HTMLTextAreaElement;
    inst.value = "";
    inst.dispatchEvent(new Event("input", { bubbles: true }));

    card("tesagent").querySelector<HTMLButtonElement>(".save-btn")!.click();
    await flush();

    const err = byId("edit-tesagent-instructions-error")!;
    expect(err.textContent).toBe(ERR_INSTRUCTIONS);
    expect(err.hidden).toBe(false);
    expect(err.getAttribute("role")).toBe("alert");
    expect(document.activeElement).toBe(inst);
    expect(inst.getAttribute("aria-invalid")).toBe("true");
    expect(card("tesagent").querySelector(".edit-body")).not.toBeNull();
    expect(set).not.toHaveBeenCalled();
  });

  it("E11 empty description", async () => {
    const { card, byId } = await setupEditor();
    card("tesagent").querySelector<HTMLButtonElement>(".card-edit-btn")!.click();

    const desc = byId("edit-tesagent-description") as HTMLInputElement;
    desc.value = "  ";
    desc.dispatchEvent(new Event("input", { bubbles: true }));

    card("tesagent").querySelector<HTMLButtonElement>(".save-btn")!.click();
    await flush();

    const err = byId("edit-tesagent-description-error")!;
    expect(err.textContent).toBe(ERR_DESCRIPTION);
    expect(document.activeElement).toBe(desc);
  });

  it("E12 empty tools and skills", async () => {
    const { card, byId, set } = await setupEditor();
    card("tesagent").querySelector<HTMLButtonElement>(".card-edit-btn")!.click();

    const toolX = byId("edit-tesagent-tools-box")!.querySelector<HTMLButtonElement>(".chip .x")!;
    toolX.click();

    const skillX = byId("edit-tesagent-skills-box")!.querySelector<HTMLButtonElement>(".chip .x")!;
    skillX.click();

    card("tesagent").querySelector<HTMLButtonElement>(".save-btn")!.click();
    await flush();

    const skillErr = byId("edit-tesagent-skills-error")!;
    expect(skillErr.textContent).toBe(ERR_SKILLS);
    expect(skillErr.getAttribute("role")).toBe("alert");

    const toolErr = byId("edit-tesagent-tools-error")!;
    expect(toolErr.textContent).toBe(ERR_TOOLS);
    expect(toolErr.getAttribute("role")).toBeNull();

    expect(document.activeElement).toBe(byId("edit-tesagent-skills-box"));
    expect(set).not.toHaveBeenCalled();

    // Fix skills, save again: skills error hidden, tools error now alert
    byId("edit-tesagent-skills-box")!.click();
    document.querySelector<HTMLElement>('#edit-tesagent-skills-list [role="option"][data-name="*"]')!.click();

    card("tesagent").querySelector<HTMLButtonElement>(".save-btn")!.click();
    await flush();

    expect(skillErr.hidden).toBe(true);
    expect(toolErr.getAttribute("role")).toBe("alert");
  });

  it("E13 Reset", async () => {
    const { card, set } = await setupEditor({
      initialStore: {
        [AGENT_EDITS_KEY]: {
          tesagent: {
            description: "Custom",
            instructions: "i",
            model: null,
            tools: "*",
            excludeTools: [],
            skills: "*",
            excludeSkills: [],
          },
        },
      },
    });

    const pillsBefore = [...card("tesagent").querySelectorAll(".pill")].map((p) => p.textContent);
    expect(pillsBefore).toContain("Edited");

    card("tesagent").querySelector<HTMLButtonElement>(".card-edit-btn")!.click();
    card("tesagent").querySelector<HTMLButtonElement>(".reset-btn")!.click();
    await flush();

    expect(set).toHaveBeenCalledWith({ [AGENT_EDITS_KEY]: {} });
    const pillsAfter = [...card("tesagent").querySelectorAll(".pill")].map((p) => p.textContent);
    expect(pillsAfter).not.toContain("Edited");
    expect(card("tesagent").querySelector(".d")!.textContent).toBe(TESAGENT.description);
  });

  it("E14 lockModel", async () => {
    const locked = await setupEditor({ brandOptions: { lockModel: true } });
    locked.card("tesagent").querySelector<HTMLButtonElement>(".card-edit-btn")!.click();
    const modelTesagent = locked.byId("edit-tesagent-model") as HTMLSelectElement;
    expect(modelTesagent.disabled).toBe(true);

    locked.card("tesagent").querySelector<HTMLButtonElement>(".cancel-btn")!.click();
    locked.card("chromagent").querySelector<HTMLButtonElement>(".card-edit-btn")!.click();
    const modelChrom = locked.byId("edit-chromagent-model") as HTMLSelectElement;
    expect(modelChrom.disabled).toBe(true);

    const unlocked = await setupEditor();
    unlocked.card("tesagent").querySelector<HTMLButtonElement>(".card-edit-btn")!.click();
    const modelUnlocked = unlocked.byId("edit-tesagent-model") as HTMLSelectElement;
    expect(modelUnlocked.disabled).toBe(false);
  });

  it("E15 user agent", async () => {
    const analyst: Record<string, unknown> = {
      id: "analyst",
      displayName: "Data Analyst",
      description: "d",
      instructions: "i",
      model: null,
      tools: "*",
      excludeTools: [],
      skills: "*",
      excludeSkills: [],
    };
    const { card, byId, store } = await setupEditor({
      initialStore: { [USER_AGENTS_KEY]: [analyst] },
    });

    card("analyst").querySelector<HTMLButtonElement>(".card-edit-btn")!.click();
    const analystCard = card("analyst");

    const nameInput = byId("edit-analyst-displayName") as HTMLInputElement;
    expect(nameInput.value).toBe("Data Analyst");
    expect(analystCard.querySelector(".reset-btn")).toBeNull();
    expect(analystCard.querySelector(".d")!.textContent).not.toBe(BRAND_LOCKED_NOTE);

    nameInput.value = "";
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));

    analystCard.querySelector<HTMLButtonElement>(".save-btn")!.click();
    await flush();

    const nameErr = byId("edit-analyst-displayName-error")!;
    expect(nameErr.textContent).toBe(ERR_DISPLAY_NAME);
    expect(nameErr.getAttribute("role")).toBe("alert");

    nameInput.value = "Analyst 2";
    nameInput.dispatchEvent(new Event("input", { bubbles: true }));

    analystCard.querySelector<HTMLButtonElement>(".save-btn")!.click();
    await flush();

    const users = store[USER_AGENTS_KEY] as Array<{ id: string; displayName: string }>;
    expect(users[0].id).toBe("analyst");
    expect(users[0].displayName).toBe("Analyst 2");
    expect(card("analyst").querySelector(".card-title .n")!.textContent).toContain("Analyst 2");
  });

  it("E16 Add agent opens the new card first; hint follows the name", async () => {
    const { el, card, byId, chips, type, addButton } = await setupEditor();
    expect(addButton.disabled).toBe(false);
    addButton.click();
    const cards = el.querySelectorAll<HTMLElement>(".card");
    expect(cards.length).toBe(3);
    expect(cards[0].dataset.agentId).toBe("_new");
    const c = card("_new");
    expect(c.classList.contains("editing")).toBe(true);
    expect(c.querySelector(".card-title .n")!.textContent).toContain("New agent");
    expect([...c.querySelectorAll(".pill")].map((p) => p.textContent)).toEqual(["Added by you"]);
    expect(c.querySelector(".card-title .d")!.textContent).toBe("Fill in the fields, then save.");
    expect((byId("edit-_new-displayName") as HTMLInputElement).value).toBe("");
    expect((byId("edit-_new-model") as HTMLSelectElement).value).toBe("");
    expect(chips("edit-_new-tools")).toEqual(["*"]);
    expect(chips("edit-_new-skills")).toEqual(["*"]);
    expect([...c.querySelectorAll(".actions button")].map((b) => b.textContent)).toEqual(["Cancel", "Save agent"]);
    expect(card("tesagent").classList.contains("dim")).toBe(true);
    expect(card("chromagent").classList.contains("dim")).toBe(true);
    expect(addButton.disabled).toBe(true);
    expect(byId("edit-_new-id-hint")!.textContent).toBe("Id: agent");
    type("edit-_new-displayName", "Checkout tester");
    expect(byId("edit-_new-id-hint")!.textContent).toBe("Id: checkout-tester");
    type("edit-_new-displayName", "Tesagent");
    expect(byId("edit-_new-id-hint")!.textContent).toBe("Id: tesagent-2");
  });

  it("E16b a second Add agent click while a card is open does nothing", async () => {
    const { el, card, addButton } = await setupEditor();
    card("tesagent").querySelector<HTMLButtonElement>(".card-edit-btn")!.click();
    addButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(el.querySelector('[data-agent-id="_new"]')).toBeNull();
  });

  it("E17 blank save shows the three messages and writes nothing", async () => {
    const { card, byId, set, addButton } = await setupEditor();
    addButton.click();
    card("_new").querySelector<HTMLButtonElement>(".save-btn")!.click();
    await flush();
    expect(byId("edit-_new-displayName-error")!.textContent).toBe(ERR_DISPLAY_NAME);
    expect(byId("edit-_new-displayName-error")!.getAttribute("role")).toBe("alert");
    expect(byId("edit-_new-description-error")!.textContent).toBe(ERR_DESCRIPTION);
    expect(byId("edit-_new-instructions-error")!.textContent).toBe(ERR_INSTRUCTIONS);
    expect(document.activeElement).toBe(byId("edit-_new-displayName"));
    expect(set).not.toHaveBeenCalled();
  });

  it("E18 Cancel removes the new card and writes nothing", async () => {
    const { el, card, type, set, addButton } = await setupEditor();
    addButton.click();
    type("edit-_new-displayName", "Not saved");
    card("_new").querySelector<HTMLButtonElement>(".cancel-btn")!.click();
    await flush();
    expect(el.querySelector('[data-agent-id="_new"]')).toBeNull();
    expect(el.querySelectorAll(".card").length).toBe(2);
    expect(addButton.disabled).toBe(false);
    expect(set).not.toHaveBeenCalled();
  });

  it("E19 Save stores checkout-tester and shows a collapsed card", async () => {
    const { card, byId, type, store, set, addButton } = await setupEditor();
    addButton.click();
    type("edit-_new-displayName", "Checkout tester");
    type("edit-_new-description", "Walks checkout");
    type("edit-_new-instructions", "You test checkout flows.");
    byId("edit-_new-tools-box")!.click();
    document.querySelector<HTMLElement>('#edit-_new-tools-list [role="option"][data-name="read_tabs"]')!.click();
    document.querySelector<HTMLElement>('#edit-_new-tools-list [role="option"][data-name="page_eval"]')!.click();
    card("_new").querySelector<HTMLButtonElement>(".save-btn")!.click();
    await flush();
    expect(set).toHaveBeenCalledTimes(1);
    const users = store[USER_AGENTS_KEY] as { id: string; tools: unknown }[];
    expect(users.map((u) => u.id)).toEqual(["checkout-tester"]);
    expect(users[0].tools).toEqual(["read_tabs", "page_eval"]);
    const c = card("checkout-tester");
    expect(c.querySelector(".edit-body")).toBeNull();
    expect(c.querySelector(".card-title .n")!.textContent).toContain("Checkout tester");
    expect([...c.querySelectorAll(".pill")].map((p) => p.textContent)).toEqual(["Added by you"]);
    expect(c.querySelector(".facts")!.textContent).toContain("Tools 2 selected");
    expect(addButton.disabled).toBe(false);
  });

  it("E20 Delete agent shows on a saved user agent only", async () => {
    const { card, addButton } = await setupEditor({ initialStore: { [USER_AGENTS_KEY]: [CT] } });
    card("tesagent").querySelector<HTMLButtonElement>(".card-edit-btn")!.click();
    expect(card("tesagent").querySelector(".delete-btn")).toBeNull();
    card("tesagent").querySelector<HTMLButtonElement>(".cancel-btn")!.click();
    card("checkout-tester").querySelector<HTMLButtonElement>(".card-edit-btn")!.click();
    const del = card("checkout-tester").querySelector<HTMLButtonElement>(".actions .row .delete-btn")!;
    expect(del.textContent).toBe("Delete agent");
    expect(del.parentElement).toBe(card("checkout-tester").querySelector(".actions")!.firstElementChild);
    card("checkout-tester").querySelector<HTMLButtonElement>(".cancel-btn")!.click();
    addButton.click();
    expect(card("_new").querySelector(".delete-btn")).toBeNull();
  });

  it("E21 the dialog names the count; Cancel stores nothing and keeps the card open", async () => {
    const { card, set, remove, deleteDatabase } = await setupEditor({
      initialStore: { [USER_AGENTS_KEY]: [CT], savedSkills: [{ name: "a", owner: "checkout-tester" }, { name: "b" }] },
    });
    card("checkout-tester").querySelector<HTMLButtonElement>(".card-edit-btn")!.click();
    card("checkout-tester").querySelector<HTMLButtonElement>(".delete-btn")!.click();
    await flush();
    const dialog = document.getElementById("delete-agent-dialog") as HTMLDialogElement;
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector("p")!.textContent).toBe("Delete Checkout tester? Its chat history and its 1 private skill are deleted too.");
    dialog.querySelector<HTMLButtonElement>(".dialog-cancel-btn")!.click();
    await flush();
    expect(document.getElementById("delete-agent-dialog")).toBeNull();
    expect(card("checkout-tester").querySelector(".edit-body")).not.toBeNull();
    expect(set).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(deleteDatabase).not.toHaveBeenCalled();
  });

  it("E22 confirm deletes, repaints, calls deleteDatabase and onAgentDeleted", async () => {
    const { el, store, card, deleteDatabase, onAgentDeleted, addButton } = await setupEditor({
      initialStore: {
        [USER_AGENTS_KEY]: [CT],
        savedSkills: [{ name: "a", owner: "checkout-tester" }, { name: "b" }],
        sidePanelAgent: "checkout-tester",
      },
    });
    card("checkout-tester").querySelector<HTMLButtonElement>(".card-edit-btn")!.click();
    card("checkout-tester").querySelector<HTMLButtonElement>(".delete-btn")!.click();
    await flush();
    document.querySelector<HTMLButtonElement>("#delete-agent-dialog .dialog-delete-btn")!.click();
    await flush();
    await flush();
    expect(document.getElementById("delete-agent-dialog")).toBeNull();
    expect(el.querySelector('[data-agent-id="checkout-tester"]')).toBeNull();
    expect(store[USER_AGENTS_KEY]).toEqual([]);
    expect(store.savedSkills).toEqual([{ name: "b" }]);
    expect("sidePanelAgent" in store).toBe(false);
    expect(deleteDatabase).toHaveBeenCalledWith("web-agent-web-agent-extension-panel-checkout-tester");
    expect(onAgentDeleted).toHaveBeenCalledTimes(1);
    expect(addButton.disabled).toBe(false);
  });
});
