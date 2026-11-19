import type { AgentComboDeps, AgentCombo } from "./agent-combo.types";

export type { AgentComboDeps, AgentCombo } from "./agent-combo.types";

const SVG_NS = "http://www.w3.org/2000/svg";

/** The check mark in front of the selected option. Same path as the lit
 *  registry's `check` icon (packages/web-agent-lit/src/ui/icon-svgs.ts, ICON_SVGS.check).
 *  Decorative: `aria-selected` carries the state for assistive technology. */
function checkIcon(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "check");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", "M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z");
  svg.appendChild(path);
  return svg;
}

/** Builds the options and wires the select-only combobox pattern
 *  (WAI-ARIA APG): Enter, Space or ArrowDown open; ArrowDown/ArrowUp move the
 *  highlight and stop at the ends; Enter selects; Escape closes with no change;
 *  a click outside closes with no change. */
export function mountAgentCombo(deps: AgentComboDeps): AgentCombo {
  const { button, list, agents } = deps;
  const nameEl = button.querySelector(".name");
  const descriptionEl = button.querySelector(".description");
  let highlight = 0;

  const options = agents.map((agent) => {
    const option = document.createElement("li");
    option.id = `agent-option-${agent.id}`;
    option.setAttribute("role", "option");
    option.setAttribute("aria-selected", "false");
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = agent.displayName;
    const description = document.createElement("span");
    description.className = "description";
    description.textContent = agent.description;
    option.append(checkIcon(), name, description);
    option.addEventListener("click", () => {
      close();
      deps.onSelect(agent.id);
    });
    list.appendChild(option);
    return option;
  });

  const isOpen = (): boolean => !list.hidden;

  function setHighlight(index: number): void {
    highlight = index;
    options.forEach((option, i) => option.classList.toggle("highlighted", i === index));
    button.setAttribute("aria-activedescendant", options[index].id);
  }

  function onOutsideClick(e: MouseEvent): void {
    const target = e.target;
    if (target instanceof Node && (button.contains(target) || list.contains(target))) return;
    close();
  }

  function open(): void {
    const current = agents.findIndex((a) => a.id === deps.currentId());
    list.hidden = false;
    button.setAttribute("aria-expanded", "true");
    setHighlight(current < 0 ? 0 : current);
    // Capture phase. Added while the opening click is already past `document`,
    // so that click does not reach this listener and close the list again.
    document.addEventListener("click", onOutsideClick, true);
  }

  function close(): void {
    list.hidden = true;
    button.setAttribute("aria-expanded", "false");
    button.removeAttribute("aria-activedescendant");
    for (const option of options) option.classList.remove("highlighted");
    document.removeEventListener("click", onOutsideClick, true);
    button.focus();
  }

  button.addEventListener("click", (e) => {
    // Enter and Space on a <button> also fire a click, with detail 0. The
    // keydown handler owns the keyboard, so only a pointer click toggles.
    if (e.detail === 0) return;
    if (isOpen()) close();
    else open();
  });

  button.addEventListener("keydown", (e) => {
    if (!isOpen()) {
      if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
        e.preventDefault();
        open();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight(Math.min(highlight + 1, options.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight(Math.max(highlight - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const id = agents[highlight].id;
      close();
      deps.onSelect(id);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  });

  return {
    paint(agent) {
      if (nameEl) nameEl.textContent = agent.displayName;
      if (descriptionEl) descriptionEl.textContent = agent.description;
      options.forEach((option, i) =>
        option.setAttribute("aria-selected", String(agents[i].id === agent.id)),
      );
    },
  };
}
