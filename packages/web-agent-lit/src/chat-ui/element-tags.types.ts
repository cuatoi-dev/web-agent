// element-tags.types.ts — the `HTMLElementTagNameMap` entries for the custom
// elements defined in this directory.
//
// Kept out of `types.ts` because the augmentation names each element class,
// so this file imports the modules that own them. Those modules import
// `types.ts` for their own shapes, and declaring the map there would close an
// import cycle between the two files.
//
// `src/index.ts` imports this file for its side effect so the augmentation
// reaches every consumer of the package, exactly as it did when each map
// entry sat beside its own element.
import type { AgentChatPanel } from "./chat-panel.js";
import type { AgentMessageView } from "./message-view.js";
import type { AgentContextGauge } from "./context-gauge.js";
import type { AgentScheduleClock } from "./schedule-clock.js";
import type { AgentTodoIndicator } from "./todo-indicator.js";

declare global {
  interface HTMLElementTagNameMap {
    "agent-chat-panel": AgentChatPanel;
    "agent-message-view": AgentMessageView;
    "agent-context-gauge": AgentContextGauge;
    "agent-schedule-clock": AgentScheduleClock;
    "agent-todo-indicator": AgentTodoIndicator;
  }
}
