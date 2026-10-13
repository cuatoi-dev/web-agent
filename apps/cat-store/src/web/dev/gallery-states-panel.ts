// gallery-states-panel.ts — the panel chrome and feature gallery states: the
// queue, the config and debug screens, branding, the model menu, pointed
// elements, todos and the hidden present-demo state. Split out of
// gallery-states.ts; the states are unchanged and stay in their original order.

import { attachmentChipsMeta } from "@cuatoi/web-agent-core";
import type { GalleryState } from "./types";
import { makeState, CHART_BLOCK, DEMO_BRANDED_AVATAR } from "./gallery-blocks";

export const PANEL_STATES: GalleryState[] = [
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
  {
    id: 'config',
    title: 'Config screen',
    caption: "Settings — the kebab (⋮) menu's Configuration item flips the panel to the config screen: a Slow/Fast visual-cue speed toggle and an enable/disable checkbox.",
    kind: 'panel',
    configOpen: true,
    state: makeState({
      messages: [
        { role: 'user', text: 'What cans do you stock?' },
        { role: 'assistant', text: 'We carry salmon, tuna, chicken and turkey cans.' },
      ],
      contextWindow: { used: 15360, total: 128000, percent: 12 },
    }),
  },
  {
    id: 'chat-layout',
    title: 'Chat layout',
    caption: 'Claude-style layout — right-aligned user bubble, blended agent prose, recessed tool rows.',
    kind: 'panel',
    agentName: 'Whiskers',
    userName: 'Alex',
    state: makeState({
      messages: [
        { role: 'user', text: 'Add two salmon cans to my cart' },
        {
          role: 'assistant',
          parts: [
            { kind: 'text', text: 'Adding them now.' },
            { kind: 'tool', audit: { ts: 0, name: 'add_to_cart', input: { productId: 'p01', qty: 2 }, outcomeSummary: 'Added 2 × Salmon Pâté.' } },
            { kind: 'text', text: 'Done — two salmon cans are in your cart.' },
          ],
        },
      ],
      contextWindow: { used: 15360, total: 128000, percent: 12 },
    }),
  },
  {
    id: 'branded-launcher',
    title: 'Branded launcher',
    caption: 'Closed launcher showing the host-set agent avatar.',
    kind: 'bubble',
    agentShortName: 'Whiskers',
    agentAvatar: DEMO_BRANDED_AVATAR,
  },
  {
    id: 'debug-screen',
    title: 'Debug screen',
    caption: "Debug flag on — the kebab (⋮) menu gains a Debug item that flips the panel to a read-only debug screen: two copyable textareas (raw conversation + tool calls with config, and the available tools), each with a Copy button.",
    kind: 'panel',
    debug: true,
    debugOpen: true,
    state: makeState({
      messages: [
        { role: 'user', text: 'Add two salmon cans to my cart' },
        {
          role: 'assistant',
          parts: [
            { kind: 'text', text: 'Adding them now.' },
            { kind: 'tool', audit: { ts: 0, name: 'add_to_cart', input: { productId: 'p01', qty: 2 }, outcomeSummary: 'Added 2 × Salmon Pâté.' } },
            { kind: 'text', text: 'Done — two salmon cans are in your cart.' },
          ],
          trace: [{ ts: 0, name: 'add_to_cart', input: { productId: 'p01', qty: 2 }, outcomeSummary: 'Added 2 × Salmon Pâté.' }],
        },
      ],
      contextWindow: { used: 15360, total: 128000, percent: 12 },
    }),
  },
  {
    id: 'choose-model',
    title: 'Choose model',
    caption: "Runtime model switcher — the kebab (⋮) menu's \"Choose model\" group lists the host's models by friendly name (Leo / Mochi); the active one is checked. Selecting another switches the model for the next turn.",
    kind: 'panel',
    menuOpen: true,
    models: [{ id: 'm', label: 'Leo' }, { id: 's', label: 'Mochi' }],
    state: makeState({
      messages: [
        { role: 'user', text: 'What cans do you stock?' },
        { role: 'assistant', text: 'We carry salmon, tuna, chicken and turkey cans.' },
      ],
      model: 'm',
      contextWindow: { used: 15360, total: 128000, percent: 12 },
    }),
  },
  {
    id: 'pointed-sent',
    title: 'Sent with pointed elements',
    caption: 'After Send, pointed element attachments render as chips in the user bubble.',
    kind: 'panel',
    state: makeState({
      messages: [
        {
          role: 'user',
          text: 'Make this one cheaper',
          promptMeta: attachmentChipsMeta([
            { providerId: 'picker', label: '2 elements pointed' },
          ]),
        },
        { role: 'assistant', text: "Salmon Pâté is $12.99 — I can't change prices, but I can look for a coupon." },
      ],
      contextWindow: { used: 15360, total: 128000, percent: 12 },
    }),
  },
  {
    id: 'todo-progress',
    title: 'Todo in progress',
    caption: 'Todo indicator — a five-item plan, two done, one in progress; the badge counts what is left.',
    kind: 'panel',
    todos: [
      { id: 't1', text: 'Fetch the order history', status: 'done' },
      { id: 't2', text: 'Rank last month by volume', status: 'done' },
      { id: 't3', text: 'Draft the restock summary paragraph', status: 'in_progress' },
      { id: 't4', text: 'Check stock levels for the top three items', status: 'pending' },
      { id: 't5', text: 'Recommend reorder quantities for anything below the threshold', status: 'pending' },
    ],
    state: makeState({
      messages: [
        { role: 'user', text: 'Plan the restock for the top sellers and tell me what you find.' },
        { role: 'assistant', text: "I'll work through that in a few steps. Let me start by pulling the current order history." },
        { role: 'assistant', text: "The order history is in. Three products account for most of last month's volume, so I'll summarise those next." },
      ],
      contextWindow: { used: 15360, total: 128000, percent: 12 },
    }),
  },
  {
    id: 'present-demo',
    title: 'Present Demo',
    caption: 'Hidden E2E verification state.',
    kind: 'panel',
    state: makeState({
      messages: [
        {
          role: 'assistant',
          parts: [
            { kind: 'text', text: 'Here is your chart:' },
            { kind: 'block', block: CHART_BLOCK },
            { kind: 'text', text: 'And some quick actions:' },
            {
              kind: 'block',
              block: {
                type: 'buttons',
                options: [
                  { label: 'Add to cart', prompt: 'add p01' },
                  { label: 'View details', prompt: 'show p01 details' },
                ],
              },
            },
          ],
        },
      ],
    }),
  },
];
