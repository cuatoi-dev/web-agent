import { describe, it, expect, vi } from "vitest";
import { summary, renderAgents, BRAND_LOCKED_NOTE, NEW_AGENT_ID, NEW_AGENT_TITLE, NEW_AGENT_NOTE } from "./agent-cards";
import type { AgentStore } from "./agent-store.types";
import type { AgentBrand } from "./types";

function container(): HTMLDivElement {
  const el = document.createElement("div");
  document.body.append(el);
  return el;
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
      { id: "anthropic-sonnet", label: "Sonnet", endpoint: "https://x/api/anthropic", wireFormat: "anthropic", model: "sonnet" },
    ],
    skillDefs: [],
    hosts: [],
  } as unknown as AgentBrand;
}

const EMPTY_STORE: AgentStore = { edits: {}, users: [] };

function cards(el: HTMLElement): HTMLElement[] {
  return [...el.querySelectorAll<HTMLElement>(".card")];
}

function pills(card: HTMLElement): string[] {
  return [...card.querySelectorAll(".pill")].map((p) => p.textContent ?? "");
}

describe("summary", () => {
  it("C1: returns All when the list is * and exclude is empty", () => {
    expect(summary("*", [])).toBe("All");
    expect(summary("*", undefined)).toBe("All");
  });

  it("C2: returns All except N when the list is * and exclude has items", () => {
    expect(summary("*", ["test_plan"])).toBe("All except 1");
    expect(summary("*", ["a", "b"])).toBe("All except 2");
  });

  it("C3: returns N selected when the list is an array", () => {
    expect(summary(["read_tabs", "page_eval"])).toBe("2 selected");
    expect(summary([])).toBe("0 selected");
  });
});

describe("renderAgents", () => {
  it("C4: orders the brand default agent first, then the rest by display name", () => {
    const el = container();
    renderAgents(el, brand(), EMPTY_STORE);
    const names = cards(el).map((c) => c.querySelector(".n")?.childNodes[0]?.textContent);
    expect(names).toEqual(["Chromagent", "tesagent"]);
  });

  it("C5: shows the Default tag only for the brand's default agent", () => {
    const el = container();
    renderAgents(el, brand(), EMPTY_STORE);
    const [chromagentCard, tesagentCard] = cards(el);
    expect(chromagentCard.querySelector(".pill.def")?.textContent).toBe("Default");
    expect(tesagentCard.querySelector(".pill.def")).toBeNull();
  });

  it("C6: shows From brand vs Added by you based on origin", () => {
    const el = container();
    const store: AgentStore = {
      edits: {},
      users: [{ id: "analyst", displayName: "Data Analyst", description: "d", instructions: "i", model: null, tools: "*", excludeTools: [], skills: "*", excludeSkills: [] }],
    };
    renderAgents(el, brand(), store);
    // orderAgents: default first, then the rest by displayName — "Data
    // Analyst" sorts before "tesagent".
    const [chromagentCard, userCard, tesagentCard] = cards(el);
    expect(pills(chromagentCard)).toContain("From brand");
    expect(pills(tesagentCard)).toContain("From brand");
    expect(pills(userCard)).toContain("Added by you");
    expect(pills(userCard)).not.toContain("From brand");
    expect(userCard.querySelector(".pill.def")).toBeNull();
  });

  it("C7: shows the Edited tag only when the agent has a stored edit", () => {
    const el = container();
    const store: AgentStore = {
      edits: {
        tesagent: {
          description: "Custom tesagent tester",
          instructions: "Custom instructions.",
          model: "anthropic-sonnet",
          tools: ["read_tabs", "page_eval"],
          excludeTools: [],
          skills: "*",
          excludeSkills: [],
        },
      },
      users: [],
    };
    renderAgents(el, brand(), store);
    const [chromagentCard, tesagentCard] = cards(el);
    expect(pills(chromagentCard)).not.toContain("Edited");
    expect(pills(tesagentCard)).toContain("Edited");
    expect(tesagentCard.querySelector(".d")?.textContent).toBe("Custom tesagent tester");
    expect(tesagentCard.querySelector(".facts")?.textContent).toContain("Model Sonnet");
    expect(tesagentCard.querySelector(".facts")?.textContent).toContain("Tools 2 selected");
  });

  it("C8: resolves the brand model label and falls back to Options page model", () => {
    const el = container();
    renderAgents(el, brand(), EMPTY_STORE);
    const [chromagentCard] = cards(el);
    expect(chromagentCard.querySelector(".facts")?.textContent).toContain("Model Options page model");
    expect(chromagentCard.querySelector(".facts")?.textContent).toContain("Tools All");
    expect(chromagentCard.querySelector(".facts")?.textContent).toContain("Skills All except 1");

    const el2 = container();
    const unknownModelStore: AgentStore = {
      edits: {
        tesagent: {
          description: "d",
          instructions: "i",
          model: "not-a-real-model-id",
          tools: "*",
          excludeTools: [],
          skills: "*",
          excludeSkills: [],
        },
      },
      users: [],
    };
    renderAgents(el2, brand(), unknownModelStore);
    const [, tesagentCard] = cards(el2);
    expect(tesagentCard.querySelector(".facts")?.textContent).toContain("Model Options page model");
  });

  it("C9: Add agent and every card's Edit button are disabled", () => {
    const el = container();
    renderAgents(el, brand(), EMPTY_STORE);
    for (const card of cards(el)) {
      const editBtn = card.querySelector<HTMLButtonElement>(".card-edit-btn");
      expect(editBtn?.disabled).toBe(true);
      expect(editBtn?.textContent).toBe("Edit");
    }
  });

  it("C10: sets text via textContent, not innerHTML — a <script> in a name renders as text", () => {
    const el = container();
    const store: AgentStore = {
      edits: {},
      users: [{
        id: "hacker",
        displayName: '<script>window.__hacked__=true</script>',
        description: "d",
        instructions: "i",
        model: null,
        tools: "*",
        excludeTools: [],
        skills: "*",
        excludeSkills: [],
      }],
    };
    renderAgents(el, brand(), store);
    expect(el.querySelectorAll("script")).toHaveLength(0);
    expect(el.textContent).toContain("<script>window.__hacked__=true</script>");
  });

  it("clears previous content on a re-render", () => {
    const el = container();
    renderAgents(el, brand(), EMPTY_STORE);
    renderAgents(el, brand(), EMPTY_STORE);
    expect(cards(el)).toHaveLength(2);
  });

  it("C12: editingId NEW_AGENT_ID paints the new card first and dims the rest", () => {
    const el = container();
    const onEdit = vi.fn();
    const body = document.createElement("div");
    body.className = "edit-body";
    const editBody = vi.fn(() => body);
    renderAgents(el, brand(), EMPTY_STORE, { editingId: NEW_AGENT_ID, onEdit, editBody });
    const [first, c2, d2] = cards(el);
    expect(cards(el)).toHaveLength(3);
    expect(first.getAttribute("data-agent-id")).toBe(NEW_AGENT_ID);
    expect(first.classList.contains("editing")).toBe(true);
    expect(first.querySelector(".card-title .n")!.textContent).toContain(NEW_AGENT_TITLE);
    expect([...first.querySelectorAll(".pill")].map((p) => p.textContent)).toEqual(["Added by you"]);
    expect(first.querySelector(".card-title .d")!.textContent).toBe(NEW_AGENT_NOTE);
    expect(first.querySelector(".card-edit-btn")!.textContent).toBe("Editing");
    expect(first.querySelector(".edit-body")).toBe(body);
    expect(editBody).toHaveBeenCalledWith(expect.objectContaining({ id: NEW_AGENT_ID, origin: "user" }));
    for (const c of [c2, d2]) {
      expect(c.classList.contains("dim")).toBe(true);
      expect(c.querySelector<HTMLButtonElement>(".card-edit-btn")!.disabled).toBe(true);
    }
  });

  it("C11: with a view, Edit is enabled while no card is open, and opens a card", () => {
    const el = container();
    const onEdit = vi.fn();
    const body = document.createElement("div");
    body.className = "edit-body";
    renderAgents(el, brand(), EMPTY_STORE, { editingId: null, onEdit, editBody: () => body });
    const [, tesagentCard] = cards(el);
    const btn = tesagentCard.querySelector<HTMLButtonElement>(".card-edit-btn")!;
    expect(btn.disabled).toBe(false);
    btn.click();
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "tesagent" }));

    const el2 = container();
    renderAgents(el2, brand(), EMPTY_STORE, { editingId: "tesagent", onEdit, editBody: () => body });
    const [c2, d2] = cards(el2);
    expect(d2.classList.contains("editing")).toBe(true);
    expect(d2.querySelector(".card-edit-btn")!.textContent).toBe("Editing");
    expect(d2.querySelector<HTMLButtonElement>(".card-edit-btn")!.disabled).toBe(true);
    expect(d2.querySelector(".d")!.textContent).toBe(BRAND_LOCKED_NOTE);
    expect(d2.querySelector(".edit-body")).toBe(body);
    expect(d2.querySelector(".facts")).toBeNull();
    expect(c2.classList.contains("dim")).toBe(true);
    expect(c2.querySelector<HTMLButtonElement>(".card-edit-btn")!.disabled).toBe(true);
    expect(c2.querySelector(".facts")).not.toBeNull();
  });
});
