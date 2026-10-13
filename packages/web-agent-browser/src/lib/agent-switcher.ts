import type { AgentBrand, BrandAgent } from "./types";
import type { AgentSwitcher, AgentSwitcherDeps, SwitchablePanel } from "./agent-switcher.types";

export type { AgentSwitcher, AgentSwitcherDeps, SwitchablePanel } from "./agent-switcher.types";

/** The side panel agents in list order: the brand's default agent first, then
 *  the rest by display name. 120/002. */
export function orderAgents(brand: AgentBrand): BrandAgent[] {
  const first = brand.agents.find((a) => a.id === brand.defaultAgent);
  const rest = brand.agents
    .filter((a) => a.id !== brand.defaultAgent)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  return first ? [first, ...rest] : rest;
}

/** One panel per agent, created the first time the agent is shown and kept,
 *  hidden, afterwards. Switching away from a busy agent asks first. */
export function createAgentSwitcher(deps: AgentSwitcherDeps): AgentSwitcher {
  const panels = new Map<string, SwitchablePanel>();
  const busy = new Map<string, boolean>();
  let activeId = "";

  function show(agent: BrandAgent): void {
    if (!panels.has(agent.id)) {
      const el = deps.buildPanel(agent);
      // detail.running is true while a turn runs or the session compacts
      // (web-agent-lit/src/chat-ui/chat-panel-session.ts:99-109).
      el.addEventListener("agent-running-change", (e) => {
        busy.set(agent.id, (e as CustomEvent<{ running: boolean }>).detail.running);
      });
      deps.container.appendChild(el);
      panels.set(agent.id, el);
    }
    for (const [id, panel] of panels) panel.hidden = id !== agent.id;
    activeId = agent.id;
    deps.onShow(agent);
    deps.saveLastId(agent.id);
  }

  async function select(nextId: string): Promise<void> {
    if (nextId === activeId) return;
    const current = deps.brand.agents.find((a) => a.id === activeId);
    const next = deps.brand.agents.find((a) => a.id === nextId);
    const panel = panels.get(activeId);
    if (!current || !next || !panel) return;

    if (busy.get(activeId) === true) {
      const ok = await deps.confirm(panel, {
        action: "switch_agent",
        title: `Switch to ${next.displayName}?`,
        message: `${current.displayName} is still working. Stop it and switch to ${next.displayName}?`,
        confirmLabel: "Stop and switch",
        cancelLabel: "Cancel",
      });
      // The combo keeps showing the current agent; its turn keeps running.
      if (!ok) return;
      panel.stop();
    }
    show(next);
  }

  return { show, select, activeId: () => activeId };
}
