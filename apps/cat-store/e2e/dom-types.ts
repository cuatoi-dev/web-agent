import type { AgentChatPanel } from '@cuatoi/web-agent-lit';
import type { WebAgentBubble } from '@cuatoi/web-agent-lit/embed/web-agent-embed';
import type { AgentChartBlock } from '@cuatoi/web-agent-charting/lit';
import type { SessionState } from '@cuatoi/web-agent-core';
import type { AgentPage } from '../src/web/components/agent-page';

/** The one corner of a Chart.js v2 instance the theme specs read — chart.js's
 *  own bundled types don't declare `.scales` at all. */
interface ChartScaleLike {
  options: {
    ticks?: { fontColor?: string };
    gridLines?: { color?: string };
  };
}
interface ChartInstanceLike {
  scales: Record<string, ChartScaleLike>;
}

/** What the specs read off <agent-chat-panel> from inside the page. Built
 *  from the real class so every public member (buildSessionConfig, tools,
 *  messages, config, imageInput, attachmentProviders, session, error,
 *  createSession, …) stays exact; `_state` and `_defaultConfirmScrim` are
 *  protected on AgentChatPanel, so `Omit` drops their protected declarations
 *  before this interface re-admits them — an `AgentChatPanel & {...}`
 *  intersection instead collapses to `never` the moment a key is non-public on
 *  one side and public on the other. */
export type ChatPanelProbe = Omit<AgentChatPanel, '_state' | '_defaultConfirmScrim'> & {
  _state?: SessionState;
  _defaultConfirmScrim?: (detail: { ref: string; name: string; action: string; reason?: string }) => Promise<boolean>;
};

/** The composer input inside the panel's shadow root. */
export interface ComposerInputProbe extends HTMLElement {
  value: string;
  resetHeight?: () => void;
}

/** What the specs read off <agent-page>. `_activeId`, `_entryIndex` and
 *  `_panel` are private on the real class; same reasoning as ChatPanelProbe
 *  above. `_entries` is already public (`readonly`) so it needs no
 *  redeclaration. */
export type AgentPageProbe = Omit<AgentPage, '_activeId' | '_entryIndex' | '_panel'> & {
  _activeId?: string;
  _entryIndex?: number;
  _panel?: ChatPanelProbe;
};

/** What stop-during-dom-actions.mock.spec.ts drives directly on
 *  <web-agent-bubble> to force the collapsed-launcher Stop control into a
 *  known state without a live turn. `panelEl`, `_running`, `isOpen` and
 *  `_syncStopBtn` are all private on the real class. */
export type WebAgentBubbleProbe = Omit<WebAgentBubble, 'panelEl' | '_running' | 'isOpen' | '_syncStopBtn'> & {
  panelEl?: ChatPanelProbe | null;
  _running?: boolean;
  isOpen?: boolean;
  _syncStopBtn?: () => void;
};

/** What the chart theming specs read off <agent-chart-block>. `_chartInstance`
 *  is private on the real class; re-typed here to expose `.scales`, which
 *  chart.js's own bundled types omit entirely. */
export type AgentChartBlockProbe = Omit<AgentChartBlock, '_chartInstance'> & {
  _chartInstance?: ChartInstanceLike | null;
};
