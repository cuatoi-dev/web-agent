// The shapes for the side panel agent switcher.

import type { ConfirmScrimDetail } from "@cuatoi/web-agent-lit";
import type { AgentBrand, BrandAgent } from "./types";

/** What the switcher needs from `<agent-chat-panel>`: an element it can hide
 *  and the call the Stop button makes
 *  (packages/web-agent-lit/src/chat-ui/chat-panel-session.ts:264-266).
 *  A property function type, not a method shorthand: a unit test holds a
 *  `vi.fn()` here and reads it back (`built.chromagent.stop`) without calling
 *  it, which `@typescript-eslint/unbound-method` flags for a method
 *  shorthand but not for a plain function-valued property. */
export interface SwitchablePanel extends HTMLElement {
  stop: () => void;
}

export interface AgentSwitcherDeps {
  brand: AgentBrand;
  /** `#chat` in sidepanel.html. Every panel is appended here once. */
  container: HTMLElement;
  buildPanel: (agent: BrandAgent) => SwitchablePanel;
  /** Shows the confirm dialog inside `panel` and resolves to the answer. */
  confirm: (panel: SwitchablePanel, detail: ConfirmScrimDetail) => Promise<boolean>;
  /** Paints the combo button for the agent now shown. */
  onShow: (agent: BrandAgent) => void;
  /** Stores the id of the agent now shown. */
  saveLastId: (id: string) => void;
}

export interface AgentSwitcher {
  show(agent: BrandAgent): void;
  select(nextId: string): Promise<void>;
  activeId(): string;
}
