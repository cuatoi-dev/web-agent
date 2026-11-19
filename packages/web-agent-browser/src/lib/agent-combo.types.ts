// The shapes for the side panel agent combo box.

import type { BrandAgent } from "./types";

export interface AgentComboDeps {
  /** `#agent-combo` in sidepanel.html. Holds `span.name` and `span.description`. */
  button: HTMLButtonElement;
  /** `#agent-list` in sidepanel.html. Starts empty and hidden. */
  list: HTMLElement;
  /** The agents in list order — `orderAgents(brand)`. Never empty. */
  agents: BrandAgent[];
  /** The id of the agent the panel shows now. */
  currentId: () => string;
  /** Called after the list has closed, with the chosen agent id. */
  onSelect: (id: string) => void;
}

export interface AgentCombo {
  /** Writes the agent's name and description on the button and marks its
   *  option selected. */
  paint(agent: BrandAgent): void;
}
