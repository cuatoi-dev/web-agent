// gallery-states.ts — framework/DOM-free state definitions for the docs-site
// demo gallery. Owned by apps/docs-site. apps/cat-store keeps its own copy and
// the two are free to drift; there is no shared source any more.

import type { GalleryState } from './types';
export type { GalleryState, GalleryStateId } from './types';

import { makeState } from './gallery-blocks';
import { FINANCE_GALLERY_STATES } from './gallery-states-finance';
import { CONVERSATION_GALLERY_STATES } from './gallery-states-conversation';
import { CONFIG_AND_DEMO_GALLERY_STATES } from './gallery-states-config-and-demos';

// The avatars, the state factory and the content blocks live in
// ./gallery-blocks; they stay importable from here.
export {
  DEMO_AGENT_AVATAR,
  DEMO_USER_AVATAR,
  DEMO_BRANDED_AVATAR,
  makeState,
  CHART_BLOCK,
  CANDLESTICK_BLOCK,
  PAYOFF_BLOCK,
  EQUITY_BLOCK,
  DRAWDOWN_BLOCK,
  VOLUME_BLOCK,
  WATERFALL_BLOCK,
  FORM_BLOCK,
  BUTTONS_BLOCK,
} from './gallery-blocks';

// The opening states of the gallery: closed launcher through a running tool.
const INTRO_GALLERY_STATES: GalleryState[] = [
  {
    id: 'launcher',
    title: 'Closed / Launcher',
    caption: 'Closed — the floating launcher button the user taps to open the assistant.',
    kind: 'bubble',
  },
  {
    id: 'empty',
    title: 'Open, empty',
    caption: 'Open & empty — a fresh session ready for the first question.',
    kind: 'panel',
    state: makeState({ messages: [], running: false, contextWindow: { used: 0, total: 128000, percent: 0 } }),
  },
  {
    id: 'header-off',
    title: 'Header off',
    caption: 'Header off — panel with built-in header hidden, rendering only message list and composer.',
    kind: 'panel',
    hideHeader: true,
    state: makeState({
      messages: [
        { role: 'user', text: 'What cans do you stock?' },
        { role: 'assistant', text: 'We carry salmon, tuna, chicken and turkey cans.' },
      ],
      contextWindow: { used: 15360, total: 128000, percent: 12 },
    }),
  },
  {
    id: 'mid',
    title: 'Mid-conversation',
    caption: 'Mid-conversation — plain text turns.',
    kind: 'panel',
    state: makeState({
      messages: [
        { role: 'user', text: 'What cans do you stock?' },
        { role: 'assistant', text: 'We carry salmon, tuna, chicken and turkey cans — all in 85 g tins.' },
      ],
      contextWindow: { used: 15360, total: 128000, percent: 12 },
    }),
  },
  {
    id: 'tool-running',
    title: 'Working (tool running)',
    caption: 'Working — the agent is running a tool: progress bar + Stop button, input disabled.',
    kind: 'panel',
    state: makeState({
      messages: [
        { role: 'user', text: 'Add two salmon cans to my cart' },
        { role: 'assistant', text: 'On it — adding them now…' },
      ],
      running: true,
    }),
  },
];

export const GALLERY_STATES: GalleryState[] = [
  ...INTRO_GALLERY_STATES,
  ...FINANCE_GALLERY_STATES,
  ...CONVERSATION_GALLERY_STATES,
  ...CONFIG_AND_DEMO_GALLERY_STATES,
];
