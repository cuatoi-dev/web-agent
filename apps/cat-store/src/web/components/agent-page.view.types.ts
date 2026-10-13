// agent-page.view.types.ts — the shape `renderAgentPage()` reads.
//
// `<agent-page>` keeps its state and its behaviour; the templates moved to
// `agent-page.view.ts`. This interface is the seam between them: every value
// the templates read and every callback they invoke, and nothing else. The
// templates never see the element, so the view module cannot reach back into
// `agent-page.ts`.

import type { SessionMeta } from "@cuatoi/web-agent-core";
import type { CustomPromptConfig } from "../types";
import type { GenuiConfig } from "../genui/genui-config";
import type { PanelProps } from "../agent-panel-config";
import type { AgentChatPanel } from "@cuatoi/web-agent-lit";
import type { AgentHooks } from "@cuatoi/web-agent-core";

export interface AgentPageView {
  props: PanelProps;
  hooks: AgentHooks;
  appContext: NonNullable<AgentChatPanel["appContext"]>;
  sessions: SessionMeta[];
  activeId: string;
  renamingId: string;
  configOpen: boolean;
  customConfig: CustomPromptConfig;
  entryIndex: number;
  entryListOpen: boolean;
  pendingIndex: number | null;
  sideWidth: number;
  sideCollapsed: boolean;
  dragging: boolean;
  genuiConfig: GenuiConfig;
  /** The row title, already defaulted for an untitled session. */
  label: (s: SessionMeta) => string;
  onNewChat: () => void;
  onSwitch: (id: string) => void;
  onDelete: (id: string) => void;
  onRenameStart: (id: string) => void;
  onRenameKey: (e: KeyboardEvent, id: string) => void;
  /** The rename input lost focus. Escape goes through `onRenameKey`. */
  onRenameCancel: () => void;
  onToggleConfig: () => void;
  onFieldInput: (field: keyof CustomPromptConfig, value: string) => void;
  onPresetClick: (field: keyof CustomPromptConfig, sample: string) => void;
  onResetConfig: () => void;
  onToggleEntryList: () => void;
  /** Escape inside the open option list. */
  onCloseEntryList: () => void;
  onPickEntry: (index: number) => void;
  onCancelSwitch: () => void;
  onConfirmSwitch: () => void;
  onDividerPointerDown: (e: PointerEvent) => void;
  onToggleSide: () => void;
  onFrameLoad: () => void;
}
