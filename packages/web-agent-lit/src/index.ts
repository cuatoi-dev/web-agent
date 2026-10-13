export * from "@cuatoi/web-agent-core";

import "./chat-ui/chat-panel.js";
import "./chat-ui/message-view.js";
import "./chat-ui/context-gauge.js";
import "./chat-ui/schedule-clock.js";
import "./chat-ui/todo-indicator.js";
import "./ui-blocks/renderer/form-block.js";
import "./ui-blocks/renderer/buttons-block.js";
import "./embed/web-agent-embed.js";
import "./chat-ui/element-tags.types.js";
import "./ui-blocks/renderer/element-tags.types.js";

export { AgentChatPanel } from "./chat-ui/chat-panel.js";
export { createConfirmScrim } from "./chat-ui/confirm-scrim.js";
export { AgentMessageView } from "./chat-ui/message-view.js";
export { AgentContextGauge } from "./chat-ui/context-gauge.js";
export { AgentScheduleClock, scheduleSummary } from "./chat-ui/schedule-clock.js";
export { AgentTodoIndicator } from "./chat-ui/todo-indicator.js";
export type { MessagePart } from "./chat-ui/types.js";
export type { DemoWindowState } from "./chat-ui/types.js";
export type { SendOutcome } from "./chat-ui/types.js";
export type { ConfirmScrimDetail, PanelScreen, PanelScreenContext } from "./chat-ui/types.js";
export { describeThing } from "./chat-ui/tool-phrases.js";
export type { ToolPhraseDef } from "./chat-ui/types.js";
export { renderBlocks, renderBlocksToElement } from "./ui-blocks/renderer/block-renderer.js";
export * from "./ui-blocks/renderer/types.js";
export { generativeUiRenderer } from "./ui-blocks/renderer/generative-ui-renderer.js";

export { genuiRenderers, defaultRenderers } from "./renderers.js";

// Base UI primitives so downstream packages (e.g. web-agent-charting/lit)
// can author custom block elements without reaching into lit's src.
export { Component } from "./ui/component.js";
export { html, svg, render, nothing } from "./ui/template.js";

export { defineUiElements } from "./ui/registry.js";
export { iconNode } from "./ui/icon-svgs.js";
export type {
  WaButtonVariant, WaMenuItem, WaSelectDetail, WaCheckedChangeDetail,
  WaValueInputDetail, WaElementEntry,
} from "./ui/types.js";
export { styles } from "./ui/styles.js";

export { agentCursor, getAgentCursor } from "./chat-ui/agent-cursor.js";
export type { AgentCursor } from "./chat-ui/agent-cursor.js";
export { createActionCue } from "./chat-ui/cue-actions.js";
export type { CueActionDeps, ActionCueFn } from "./chat-ui/cue-actions.js";
export { WebAgentBubble } from "./embed/web-agent-embed.js";
