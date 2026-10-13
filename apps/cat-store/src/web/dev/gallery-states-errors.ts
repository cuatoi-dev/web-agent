// gallery-states-errors.ts — the interruption gallery states: the fenced-UI
// confirm scrim, the global error banner, an inline failed turn and the
// auto-retry indicator. Split out of gallery-states.ts; the states are
// unchanged and stay in their original order.

import type { GalleryState } from "./types";
import { makeState } from "./gallery-blocks";

export const ERROR_STATES: GalleryState[] = [
  {
    id: 'confirm',
    title: 'Fenced-UI confirm scrim',
    caption: 'Fenced action — a confirm scrim awaits Allow / Reject before the agent touches the page.',
    kind: 'panel',
    state: makeState({
      messages: [
        { role: 'user', text: 'What cans do you stock?' },
        { role: 'assistant', text: 'We carry salmon, tuna, chicken and turkey cans — all in 85 g tins.' },
      ],
      contextWindow: { used: 15360, total: 128000, percent: 12 },
    }),
    overlay: 'confirm',
    confirmDetail: {
      tool: 'click',
      ref: 'btn-add-cart',
      name: 'Add to cart',
      action: 'click',
      reason: 'You asked to add salmon cans.',
    },
  },
  {
    id: 'error',
    title: 'Error state',
    caption: 'Error — a failed request surfaces a dismissible error banner.',
    kind: 'panel',
    state: makeState({
      messages: [{ role: 'user', text: 'Place my order' }],
      error: 'Request failed: network error (502 Bad Gateway)',
    }),
  },
  {
    id: 'failed-turn',
    title: 'Inline failed turn',
    caption: 'Turn error — inline error card under the hanging message with a Retry button; global banner suppressed.',
    kind: 'panel',
    state: makeState({
      messages: [
        {
          role: 'user',
          text: 'Place my order',
          failed: {
            message: 'Request failed: network error (502 Bad Gateway)',
            retryable: true,
          },
        },
      ],
      running: false,
    }),
  },
  {
    id: 'retrying',
    title: 'Auto-retrying',
    caption: 'Auto-retrying — transient indicator showing attempt progress while retrying a failed turn.',
    kind: 'panel',
    state: makeState({
      messages: [
        {
          role: 'user',
          text: 'Place my order',
        },
      ],
      running: true,
    }),
    retryAttempt: { attempt: 2, maxRetries: 5, reason: 'Rate limited (HTTP 429)' },
  },
];
