import { describe, expect, it, vi } from "vitest";
import { deleteAgent, deleteMessage, ownedSkillCount, sessionDatabaseName } from "./agent-delete";
import type { AgentStorage } from "./agent-store.types";

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
const flush = () => new Promise((r) => setTimeout(r, 0));

const CT = {
  id: "checkout-tester", displayName: "Checkout tester", description: "d", instructions: "i",
  model: null, tools: "*", excludeTools: [], skills: "*", excludeSkills: [],
};

describe("agent-delete", () => {
  it("D1 deleteMessage for 0, 1 and 2", () => {
    expect(deleteMessage("Checkout tester", 1)).toBe("Delete Checkout tester? Its chat history and its 1 private skill are deleted too.");
    expect(deleteMessage("Checkout tester", 2)).toBe("Delete Checkout tester? Its chat history and its 2 private skills are deleted too.");
    expect(deleteMessage("Checkout tester", 0)).toBe("Delete Checkout tester? Its chat history and its 0 private skills are deleted too.");
  });

  it("D2 ownedSkillCount counts only that owner and tolerates a corrupt key", async () => {
    const skills = [
      { name: "a", owner: "checkout-tester" }, { name: "b" }, { name: "c", owner: "analyst" },
      { name: "d", owner: "checkout-tester" }, "junk", null,
    ];
    expect(await ownedSkillCount(fakeStorage({ savedSkills: skills }).storage, "checkout-tester")).toBe(2);
    expect(await ownedSkillCount(fakeStorage({ savedSkills: "oops" }).storage, "checkout-tester")).toBe(0);
    expect(await ownedSkillCount(fakeStorage().storage, "checkout-tester")).toBe(0);
    await flush();
  });

  it("D3 deleteAgent removes record, owned skills, sidePanelAgent, then the database", async () => {
    const analyst = { ...CT, id: "analyst", displayName: "Analyst" };
    const { store, calls, storage, set } = fakeStorage({
      userAgents: [CT, analyst],
      savedSkills: [{ name: "a", owner: "checkout-tester" }, { name: "b" }, { name: "c", owner: "analyst" }],
      sidePanelAgent: "checkout-tester",
    });
    const deleteDatabase = vi.fn((name: string) => { calls.push(`db:${name}`); });
    await deleteAgent(storage, "checkout-tester", deleteDatabase);
    expect(set).toHaveBeenCalledTimes(1);
    expect(store.userAgents).toEqual([analyst]);
    expect(store.savedSkills).toEqual([{ name: "b" }, { name: "c", owner: "analyst" }]);
    expect("sidePanelAgent" in store).toBe(false);
    expect(deleteDatabase).toHaveBeenCalledWith("web-agent-web-agent-extension-panel-checkout-tester");
    expect(calls).toEqual([
      "set:savedSkills,userAgents",
      "remove:sidePanelAgent",
      "db:web-agent-web-agent-extension-panel-checkout-tester",
    ]);
  });

  it("D4 sidePanelAgent naming another agent is kept", async () => {
    const { store, storage, remove } = fakeStorage({ userAgents: [CT], sidePanelAgent: "tesagent" });
    await deleteAgent(storage, "checkout-tester", () => {});
    expect(remove).not.toHaveBeenCalled();
    expect(store.sidePanelAgent).toBe("tesagent");
    expect(store.userAgents).toEqual([]);
    expect(store.savedSkills).toEqual([]);
  });

  it("D5 sessionDatabaseName", () => {
    expect(sessionDatabaseName("checkout-tester")).toBe("web-agent-web-agent-extension-panel-checkout-tester");
  });
});
