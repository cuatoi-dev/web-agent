// gallery-states-config-and-demos.ts — the config/debug/model-menu screens, the
// host-branding states and the demo states (config through demo-cues).
// Split out of gallery-states.ts; the code is unchanged.

import { attachmentChipsMeta } from "@cuatoi/web-agent-core";

import type { GalleryState } from './types';
import { makeState, CHART_BLOCK, DEMO_BRANDED_AVATAR } from './gallery-blocks';
import { mountCuesDemo } from './gallery-demos';

export const CONFIG_AND_DEMO_GALLERY_STATES: GalleryState[] = [
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
  {
    id: 'demo-cues',
    title: 'Cues Demo',
    caption: 'Action cues lifecycle (no LLM).',
    kind: 'demo',
    mount: mountCuesDemo,
  },
];
