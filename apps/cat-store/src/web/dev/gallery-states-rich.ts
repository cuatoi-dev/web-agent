// gallery-states-rich.ts — the rich-output gallery states: a markdown table,
// generative UI (form + buttons) and an interleaved multi-tool turn. Split out
// of gallery-states.ts; the states are unchanged and stay in their original
// order.

import type { GalleryState } from "./types";
import { makeState, FORM_BLOCK, BUTTONS_BLOCK } from "./gallery-blocks";

export const RICH_OUTPUT_STATES: GalleryState[] = [
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
];
