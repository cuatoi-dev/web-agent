// gallery-states-working.ts — the in-progress gallery states: awaiting the
// next block, thinking before the first response, and compacting the context.
// Split out of gallery-states.ts; the states are unchanged and stay in their
// original order.

import type { GalleryState } from "./types";
import { makeState } from "./gallery-blocks";

export const WORKING_STATES: GalleryState[] = [
  {
    id: 'working',
    title: 'Working (next block pending)',
    caption: 'An inline, bubble-less 3-dot animated placeholder shows at the transcript tail while awaiting the next block (delayed 400ms to avoid flash).',
    kind: 'panel',
    state: makeState({
      messages: [
        { role: 'user', text: 'Add two salmon cans to my cart' },
        { role: 'assistant', text: 'On it — adding them now…', pending: true },
      ],
      running: true,
      inProgressTurnId: 'turn-1',
    }),
  },
  {
    id: 'working-thinking',
    title: 'Working (thinking before first response)',
    caption: 'Thinking — an inline, bubble-less 3-dot animated placeholder shows right after user sends, before any assistant message exists (delayed 400ms to avoid flash).',
    kind: 'panel',
    state: makeState({
      messages: [
        { role: 'user', text: 'Add two salmon cans to my cart' },
      ],
      running: true,
      inProgressTurnId: 'turn-1',
    }),
  },
  {
    id: 'compacting',
    title: 'Compacting the context (009)',
    caption: 'Automatic compaction — running is false (the turn already settled) but compacting is true: the permanent "Agent compacts its context · running" row, the gauge spinning, and the same working-dots row a normal in-progress turn shows.',
    kind: 'panel',
    state: makeState({
      messages: [
        { role: 'user', text: 'Add two salmon cans to my cart' },
        {
          role: 'assistant',
          text: 'Added 2 × Salmon Pâté to your cart.',
          parts: [
            { kind: 'text', text: 'Added 2 × Salmon Pâté to your cart.' },
            { kind: 'compaction', compaction: { status: 'running' } },
          ],
        },
      ],
      running: false,
      compacting: true,
      contextWindow: { used: 96000, total: 128000, percent: 75 },
    }),
  },
];
