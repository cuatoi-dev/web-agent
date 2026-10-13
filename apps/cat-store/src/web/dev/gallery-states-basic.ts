// gallery-states-basic.ts — the basic gallery states: the closed launcher, an
// empty panel, the header-off panel and plain mid-conversation turns. Split out
// of gallery-states.ts; the states are unchanged and stay in their original
// order.

import type { GalleryState } from "./types";
import { makeState } from "./gallery-blocks";

export const BASIC_STATES: GalleryState[] = [
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
