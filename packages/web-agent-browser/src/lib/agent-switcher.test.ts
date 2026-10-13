import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createConfirmScrim } from "@cuatoi/web-agent-lit/chat-ui/confirm-scrim";
import { EMPTY_BRAND } from "./brand";
import { createAgentSwitcher, orderAgents, type SwitchablePanel } from "./agent-switcher";
import type { AgentBrand, BrandAgent } from "./types";

function agent(id: string, displayName: string): BrandAgent {
  return { id, displayName, description: `${displayName} description`, instructions: "I", tools: "*", skills: "*" };
}
const chromagent = agent("chromagent", "Chromagent");
const tesagent = agent("tesagent", "tesagent");
const checkout = agent("checkout_tester", "Checkout tester");

describe("orderAgents", () => {
  it("puts the default agent first, then the rest by display name", () => {
    const brand: AgentBrand = { ...EMPTY_BRAND, agents: [tesagent, checkout, chromagent], defaultAgent: "chromagent" };
    expect(orderAgents(brand).map((a) => a.displayName)).toEqual(["Chromagent", "Checkout tester", "tesagent"]);
  });

  it("follows defaultAgent, not file order", () => {
    const brand: AgentBrand = { ...EMPTY_BRAND, agents: [chromagent, tesagent, checkout], defaultAgent: "tesagent" };
    expect(orderAgents(brand).map((a) => a.id)).toEqual(["tesagent", "checkout_tester", "chromagent"]);
  });
});

describe("createAgentSwitcher", () => {
  const brand: AgentBrand = { ...EMPTY_BRAND, agents: [chromagent, tesagent], defaultAgent: "chromagent" };
  let container: HTMLElement;
  let built: Record<string, SwitchablePanel & { stop: ReturnType<typeof vi.fn> }>;
  let shown: string[];
  let saved: string[];

  function setup() {
    return createAgentSwitcher({
      brand,
      container,
      buildPanel: (a) => {
        const el = Object.assign(document.createElement("div"), { stop: vi.fn() });
        el.style.position = "relative";
        built[a.id] = el;
        return el;
      },
      confirm: (panel, detail) => createConfirmScrim(panel)(detail),
      onShow: (a) => shown.push(a.id),
      saveLastId: (id) => saved.push(id),
    });
  }

  function setRunning(id: string, running: boolean) {
    built[id].dispatchEvent(new CustomEvent("agent-running-change", { detail: { running } }));
  }

  function dialogButton(label: string): HTMLButtonElement {
    const btn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === label);
    if (!btn) throw new Error(`no button ${label}`);
    return btn;
  }

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    built = {};
    shown = [];
    saved = [];
  });

  afterEach(() => container.remove());

  it("show builds a panel once, hides the others, paints and saves", () => {
    const s = setup();
    s.show(chromagent);
    expect(container.children).toHaveLength(1);
    expect(built.chromagent.hidden).toBe(false);
    s.show(tesagent);
    expect(container.children).toHaveLength(2);
    expect(built.chromagent.hidden).toBe(true);
    expect(built.tesagent.hidden).toBe(false);
    s.show(chromagent);
    expect(container.children).toHaveLength(2);
    expect(built.chromagent.hidden).toBe(false);
    expect(built.tesagent.hidden).toBe(true);
    expect(shown).toEqual(["chromagent", "tesagent", "chromagent"]);
    expect(saved).toEqual(["chromagent", "tesagent", "chromagent"]);
    expect(s.activeId()).toBe("chromagent");
  });

  it("selecting the agent already shown does nothing", async () => {
    const s = setup();
    s.show(chromagent);
    await s.select("chromagent");
    expect(container.children).toHaveLength(1);
    expect(shown).toEqual(["chromagent"]);
    expect(saved).toEqual(["chromagent"]);
  });

  it("switching while idle shows no dialog", async () => {
    const s = setup();
    s.show(chromagent);
    await s.select("tesagent");
    expect(container.querySelector(".wa-confirm-scrim")).toBeNull();
    expect(built.chromagent.stop).not.toHaveBeenCalled();
    expect(s.activeId()).toBe("tesagent");
  });

  it("a turn that has ended counts as idle", async () => {
    const s = setup();
    s.show(chromagent);
    setRunning("chromagent", true);
    setRunning("chromagent", false);
    await s.select("tesagent");
    expect(container.querySelector(".wa-confirm-scrim")).toBeNull();
    expect(s.activeId()).toBe("tesagent");
  });

  it("switching while busy asks; Cancel keeps the agent and its turn", async () => {
    const s = setup();
    s.show(chromagent);
    setRunning("chromagent", true);
    const pending = s.select("tesagent");

    const card = built.chromagent.querySelector(".wa-confirm-card");
    expect(card).not.toBeNull();
    expect(card!.querySelector("h3")!.textContent).toBe("Switch to tesagent?");
    expect(card!.querySelector("p")!.textContent).toBe("Chromagent is still working. Stop it and switch to tesagent?");
    expect(Array.from(card!.querySelectorAll("button")).map((b) => b.textContent)).toEqual(["Cancel", "Stop and switch"]);

    dialogButton("Cancel").click();
    await pending;
    expect(container.querySelector(".wa-confirm-scrim")).toBeNull();
    expect(built.chromagent.stop).not.toHaveBeenCalled();
    expect(built.tesagent).toBeUndefined();
    expect(s.activeId()).toBe("chromagent");
    expect(shown).toEqual(["chromagent"]);
  });

  it("switching while busy asks; Stop and switch stops the turn, then shows the next agent", async () => {
    const s = setup();
    s.show(chromagent);
    setRunning("chromagent", true);
    const pending = s.select("tesagent");
    dialogButton("Stop and switch").click();
    await pending;
    expect(built.chromagent.stop).toHaveBeenCalledTimes(1);
    expect(built.chromagent.hidden).toBe(true);
    expect(built.tesagent.hidden).toBe(false);
    expect(s.activeId()).toBe("tesagent");
    expect(saved).toEqual(["chromagent", "tesagent"]);
  });
});
