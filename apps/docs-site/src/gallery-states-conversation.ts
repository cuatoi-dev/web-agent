// gallery-states-conversation.ts — the conversation, progress, error and queue
// gallery states (rich-table through send-while-running).
// Split out of gallery-states.ts; the code is unchanged.

import type { GalleryState } from './types';
import { makeState, FORM_BLOCK, BUTTONS_BLOCK } from './gallery-blocks';

export const CONVERSATION_GALLERY_STATES: GalleryState[] = [
  {
    id: 'rich-table',
    title: 'With a table',
    caption: 'Rich output — a markdown table renders with faint cell/row borders so tabular data stays legible on the flat assistant background.',
    kind: 'panel',
    state: makeState({
      messages: [
        { role: 'user', text: 'Compare the can prices.' },
        {
          role: 'assistant',
          text: [
            'Here is the price comparison:',
            '',
            '| Product | Protein | Price |',
            '| --- | --- | --- |',
            '| Salmon Can | Salmon | $4.99 |',
            '| Tuna Can | Tuna | $3.49 |',
            '| Chicken Can | Chicken | $3.99 |',
            '| Turkey Can | Turkey | $4.49 |',
            '',
            'Salmon is the priciest; tuna the cheapest.',
          ].join('\n'),
        },
      ],
      contextWindow: { used: 15360, total: 128000, percent: 12 },
    }),
  },
  {
    id: 'generative-ui',
    title: 'Generative UI',
    caption: 'Generative UI — agent-built form and quick-action buttons.',
    kind: 'panel',
    state: makeState({
      messages: [
        {
          role: 'assistant',
          parts: [
            { kind: 'text', text: 'Pick your filters:' },
            { kind: 'block', block: FORM_BLOCK },
            { kind: 'block', block: BUTTONS_BLOCK },
          ],
        },
      ],
    }),
  },
  {
    id: 'multi-tool',
    title: 'Multi-tool turn (interleaved)',
    caption: 'Multi-tool turn — assistant text and compact tool-step rows alternate in reading order (no giant blob, no collapsed "Tool Calls").',
    kind: 'panel',
    state: makeState({
      messages: [
        { role: 'user', text: 'Add 2 salmon and a tuna to my cart, then tell me the total.' },
        {
          role: 'assistant',
          parts: [
            { kind: 'text', text: 'Adding the salmon cans first.' },
            { kind: 'tool', audit: { ts: 0, name: 'add_to_cart', input: { productId: 'p01', qty: 2 }, outcomeSummary: 'Added 2 × Salmon Pâté.' } },
            { kind: 'text', text: 'Now the tuna.' },
            { kind: 'tool', audit: { ts: 0, name: 'add_to_cart', input: { productId: 'p02', qty: 1 }, outcomeSummary: 'Added 1 × Tuna Crunchies.' } },
            { kind: 'text', text: 'Let me check your cart total.' },
            { kind: 'tool', audit: { ts: 0, name: 'query_state', input: { path: '$.cart' }, outcomeSummary: 'Cart: 3 items, $17.' } },
            { kind: 'text', text: 'Let me look up a few recommendations for you.' },
            { kind: 'tool', audit: { ts: 0, name: 'search_skills', input: { query: 'recommendations' }, outcomeSummary: 'query_data_advanced — Guide for complex data queries.' } },
            { kind: 'tool', audit: { ts: 0, name: 'load_skill', input: { name: 'query_data_advanced' }, outcomeSummary: 'Loaded.' } },
            { kind: 'tool', audit: { ts: 0, name: 'show_generative_ui', input: { type: 'buttons' }, outcomeSummary: 'Rendered 3 buttons.' } },
            { kind: 'text', text: 'Done — your cart has 3 items totalling $17.' },
          ],
          trace: [
            { ts: 0, name: 'add_to_cart', input: { productId: 'p01', qty: 2 }, outcomeSummary: 'Added 2 × Salmon Pâté.' },
            { ts: 0, name: 'add_to_cart', input: { productId: 'p02', qty: 1 }, outcomeSummary: 'Added 1 × Tuna Crunchies.' },
            { ts: 0, name: 'query_state', input: { path: '$.cart' }, outcomeSummary: 'Cart: 3 items, $17.' },
            { ts: 0, name: 'search_skills', input: { query: 'recommendations' }, outcomeSummary: 'query_data_advanced — Guide for complex data queries.' },
            { ts: 0, name: 'load_skill', input: { name: 'query_data_advanced' }, outcomeSummary: 'Loaded.' },
            { ts: 0, name: 'show_generative_ui', input: { type: 'buttons' }, outcomeSummary: 'Rendered 3 buttons.' },
          ],
        },
      ],
      contextWindow: { used: 15360, total: 128000, percent: 12 },
    }),
  },
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
    title: 'Compacting the context',
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
    caption: 'Error — a failed request surfaces an inline red assistant notice with Dismiss.',
    kind: 'panel',
    state: makeState({
      messages: [{ role: 'user', text: 'Place my order' }],
      error: 'Request failed: network error (502 Bad Gateway)',
    }),
  },
  {
    id: 'failed-turn',
    title: 'Inline failed turn',
    caption: 'Turn error — inline red assistant notice under the hanging message with Retry and Dismiss.',
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
  {
    id: 'queued',
    title: 'Queued next prompt',
    caption: 'Queued — the composer stays active while running; queued messages list above it with cancel on every item and edit on the last.',
    kind: 'panel',
    state: makeState({
      messages: [
        { role: 'user', text: 'Add two salmon cans to my cart' },
        { role: 'assistant', text: 'On it — adding them now…' },
      ],
      running: true,
      queuedMessages: [
        { id: 'q1', text: 'Also add a tuna can' },
        { id: 'q2', text: 'And show me the checkout total' },
      ],
    }),
  },
  {
    id: 'send-while-running',
    title: 'Send while running (typed reply)',
    caption: 'Running with a reply typed in — the collapsed button switches from Stop back to Send while the turn is still in flight; sending queues it.',
    kind: 'panel',
    state: makeState({
      messages: [
        { role: 'user', text: 'Add two salmon cans to my cart' },
        { role: 'assistant', text: 'On it — adding them now…' },
      ],
      running: true,
    }),
    composerText: 'Also add a tuna can',
  },
];
