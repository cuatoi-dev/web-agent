import { describe, it, expect, vi } from "vitest";
import { renderSkills, onDeletePressed, ownerLabel } from "./saved-skills";
import { SKILLS_KEY } from "./skill-registry";
import type { SkillStorage } from "./types";

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

const EMPTY_TEXT = "No skills saved yet. Ask the agent to create one and it appears here.";

function container(): HTMLDivElement {
  const el = document.createElement("div");
  document.body.append(el);
  return el;
}

function names(el: HTMLElement): string[] {
  return [...el.querySelectorAll(".skill-name")].map((n) => n.textContent ?? "");
}

describe("renderSkills", () => {
  it("U1: storage key absent paints the empty note and never writes", async () => {
    const { storage, set } = fakeStorage();
    const el = container();
    await renderSkills(el, storage);
    expect(el.querySelectorAll(".skill-row")).toHaveLength(0);
    expect(el.querySelector("p.empty-note")?.textContent).toBe(EMPTY_TEXT);
    expect(set).not.toHaveBeenCalled();
  });

  it("U2: key holds [] paints the empty note and never writes", async () => {
    const { storage, set } = fakeStorage({ [SKILLS_KEY]: [] });
    const el = container();
    await renderSkills(el, storage);
    expect(el.querySelectorAll(".skill-row")).toHaveLength(0);
    expect(el.querySelector("p.empty-note")?.textContent).toBe(EMPTY_TEXT);
    expect(set).not.toHaveBeenCalled();
  });

  it("U3: key holds a non-array value paints the empty note without throwing", async () => {
    for (const bad of ["broken", null, {}]) {
      const { storage } = fakeStorage({ [SKILLS_KEY]: bad });
      const el = container();
      await renderSkills(el, storage);
      expect(el.querySelectorAll(".skill-row")).toHaveLength(0);
      expect(el.querySelector("p.empty-note")?.textContent).toBe(EMPTY_TEXT);
    }
  });

  it("U4: two stored skills render two rows in stored order with names and descriptions", async () => {
    const { storage } = fakeStorage({ [SKILLS_KEY]: [SKILL_A, SKILL_B] });
    const el = container();
    await renderSkills(el, storage);
    expect(el.querySelectorAll(".skill-row")).toHaveLength(2);
    expect(names(el)).toEqual(["pirate_speak", "panel_note"]);
    const descs = [...el.querySelectorAll(".skill-desc")].map((n) => n.textContent ?? "");
    expect(descs).toEqual(["Answer like a pirate", "A note"]);
    expect(el.querySelector(".empty-note")).toBeNull();
  });

  it("U5: no rendered text contains either skill's definition value", async () => {
    const { storage } = fakeStorage({ [SKILLS_KEY]: [SKILL_A, SKILL_B] });
    const el = container();
    await renderSkills(el, storage);
    expect(el.textContent).not.toContain("Say arr.");
    expect(el.textContent).not.toContain("Note text.");
  });

  it("U6: each row holds one Delete button with type button and a per-row aria-label", async () => {
    const { storage } = fakeStorage({ [SKILLS_KEY]: [SKILL_A, SKILL_B] });
    const el = container();
    await renderSkills(el, storage);
    const rows = [...el.querySelectorAll(".skill-row")];
    const expected = [
      [0, "Delete skill pirate_speak"],
      [1, "Delete skill panel_note"],
    ] as const;
    for (const [idx, aria] of expected) {
      const btn = rows[idx].querySelector<HTMLButtonElement>("button.skill-del");
      expect(btn?.textContent).toBe("Delete");
      expect(btn?.type).toBe("button");
      expect(btn?.getAttribute("aria-label")).toBe(aria);
    }
  });

  it("U7: a skill name containing HTML is rendered as text, never as markup", async () => {
    const sneaky = { name: "<img src=x onerror=alert(1)>", description: "x", definition: "d" };
    const { storage } = fakeStorage({ [SKILLS_KEY]: [sneaky] });
    const el = container();
    await renderSkills(el, storage);
    expect(el.querySelector(".skill-name")?.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(el.querySelectorAll("img")).toHaveLength(0);
  });

  it("U8: rendering twice on the same container paints two rows, not four", async () => {
    const { storage } = fakeStorage({ [SKILLS_KEY]: [SKILL_A, SKILL_B] });
    const el = container();
    await renderSkills(el, storage);
    await renderSkills(el, storage);
    expect(el.querySelectorAll(".skill-row")).toHaveLength(2);
  });

  it("U9: a change in storage between paints is reflected — the list is re-read, not cached", async () => {
    const { store, storage } = fakeStorage({ [SKILLS_KEY]: [SKILL_A, SKILL_B] });
    const el = container();
    await renderSkills(el, storage);
    store[SKILLS_KEY] = [SKILL_A];
    await renderSkills(el, storage);
    expect(names(el)).toEqual(["pirate_speak"]);
  });
});

describe("onDeletePressed", () => {
  it("U10: deleting one of two stored skills removes exactly that one", async () => {
    const { storage, set } = fakeStorage({ [SKILLS_KEY]: [SKILL_A, SKILL_B] });
    const el = container();
    await onDeletePressed(el, storage, "panel_note");
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith({ [SKILLS_KEY]: [SKILL_A] });
    expect(names(el)).toEqual(["pirate_speak"]);
  });

  it("U11: deleting the last skill switches to the empty note", async () => {
    const { storage, set } = fakeStorage({ [SKILLS_KEY]: [SKILL_A] });
    const el = container();
    await onDeletePressed(el, storage, "pirate_speak");
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith({ [SKILLS_KEY]: [] });
    expect(el.querySelectorAll(".skill-row")).toHaveLength(0);
    expect(el.querySelector("p.empty-note")?.textContent).toBe(EMPTY_TEXT);
  });

  it("U12: deleting a name that is not stored never writes and repaints the rows", async () => {
    const { storage, set } = fakeStorage({ [SKILLS_KEY]: [SKILL_A, SKILL_B] });
    const el = container();
    await onDeletePressed(el, storage, "not_there");
    expect(set).not.toHaveBeenCalled();
    expect(names(el)).toHaveLength(2);
  });

  it("U13: deleting on an empty store never writes and paints the empty note", async () => {
    const { storage, set } = fakeStorage();
    const el = container();
    await onDeletePressed(el, storage, "anything");
    expect(set).not.toHaveBeenCalled();
    expect(el.querySelector("p.empty-note")?.textContent).toBe(EMPTY_TEXT);
  });

  it("U14: the filter is an exact match on the name", async () => {
    const lower = { ...SKILL_A, name: "a" };
    const upper = { ...SKILL_B, name: "A" };
    const { storage, set } = fakeStorage({ [SKILLS_KEY]: [lower, upper] });
    const el = container();
    await onDeletePressed(el, storage, "a");
    expect(set).toHaveBeenCalledWith({ [SKILLS_KEY]: [{ ...SKILL_B, name: "A" }] });
    expect(names(el)).toEqual(["A"]);
  });

  it("U15: clicking the rendered Delete button reaches the handler", async () => {
    const { storage, set } = fakeStorage({ [SKILLS_KEY]: [SKILL_A, SKILL_B] });
    const el = container();
    await renderSkills(el, storage);
    el.querySelectorAll("button.skill-del")[1].dispatchEvent(new MouseEvent("click"));
    await vi.waitFor(() => expect(set).toHaveBeenCalled());
    expect(set).toHaveBeenCalledWith({ [SKILLS_KEY]: [SKILL_A] });
    expect(names(el)).toEqual(["pirate_speak"]);
  });
});

describe("ownerLabel", () => {
  it("O-U1: skill without owner returns Shared", () => {
    expect(ownerLabel({ name: "a", description: "d", definition: "b" }, [])).toBe("Shared");
  });

  it("O-U2: skill with owner tesagent and matching agent returns tesagent", () => {
    expect(
      ownerLabel({ name: "a", description: "d", definition: "b", owner: "tesagent" }, [
        { id: "tesagent", displayName: "tesagent" },
      ]),
    ).toBe("tesagent");
  });

  it("O-U3: skill with owner tesagent and displayName Test Agent OS returns it", () => {
    expect(
      ownerLabel({ name: "a", description: "d", definition: "b", owner: "tesagent" }, [
        { id: "tesagent", displayName: "Test Agent OS" },
      ]),
    ).toBe("Test Agent OS");
  });

  it("O-U4: skill with unknown owner and empty agent list returns raw id", () => {
    expect(
      ownerLabel({ name: "a", description: "d", definition: "b", owner: "legacy-agent" }, []),
    ).toBe("legacy-agent");
  });
});

describe("renderSkills owner labels", () => {
  it("O-U5: row for shared skill renders span.owner with Shared", async () => {
    const { storage } = fakeStorage({ [SKILLS_KEY]: [SKILL_A] });
    const el = container();
    await renderSkills(el, storage);
    const owner = el.querySelector(".skill-row .owner");
    expect(owner?.textContent).toBe("Shared");
    expect(owner?.classList.contains("private")).toBe(false);
  });

  it("O-U6: row for private skill renders span.owner.private with agent name", async () => {
    const owned = { ...SKILL_A, owner: "tesagent" };
    const { storage } = fakeStorage({ [SKILLS_KEY]: [owned] });
    const el = container();
    await renderSkills(el, storage, [{ id: "tesagent", displayName: "tesagent" }]);
    const owner = el.querySelector(".skill-row .owner");
    expect(owner?.textContent).toBe("tesagent");
    expect(owner?.classList.contains("private")).toBe(true);
  });

  it("O-U7: owner label text with HTML is rendered literally via textContent", async () => {
    const owned = { ...SKILL_A, owner: "<b>evil</b>" };
    const { storage } = fakeStorage({ [SKILLS_KEY]: [owned] });
    const el = container();
    await renderSkills(el, storage);
    const owner = el.querySelector(".skill-row .owner");
    expect(owner?.textContent).toBe("<b>evil</b>");
    expect(owner?.querySelectorAll("b")).toHaveLength(0);
  });

  it("O-U8: clicking Delete re-renders the list with owners kept", async () => {
    const owned = { ...SKILL_A, owner: "tesagent" };
    const { storage, set } = fakeStorage({ [SKILLS_KEY]: [owned, SKILL_B] });
    const el = container();
    const agents = [{ id: "tesagent", displayName: "tesagent" }];
    await renderSkills(el, storage, agents);
    el.querySelectorAll("button.skill-del")[0].dispatchEvent(new MouseEvent("click"));
    await vi.waitFor(() => expect(set).toHaveBeenCalled());
    expect(names(el)).toEqual(["panel_note"]);
    expect(el.querySelector(".skill-row .owner")?.textContent).toBe("Shared");
  });
});