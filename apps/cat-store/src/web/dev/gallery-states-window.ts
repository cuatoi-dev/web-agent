// gallery-states-window.ts — the message-window gallery states and the long
// demo transcript they share. Split out of gallery-states.ts; the transcript
// helpers and the states are unchanged and stay in their original order.

import type { SessionMessage } from "@cuatoi/web-agent-core";
import type { GalleryState } from "./types";
import { makeState } from "./gallery-blocks";

// A transcript longer than one message window, for the four window
// states. 80 turns x (1 user row + 1 assistant row + 4 tool-chip rows) = 480
// rows against the 200-row default window (chat-panel-window.ts:7), so the window is
// active and there is more than one older window behind it. Same shape as the
// `turn()` / `transcript()` helpers in
// `apps/cat-store/e2e/message-window.mock.spec.ts:17-33`, which is where the
// 204-row / 68-view numbers below were measured.
const WINDOW_TURNS = 80;

function windowTurn(n: number): SessionMessage[] {
  return [
    { role: 'user', text: `Question ${n}` },
    {
      role: 'assistant',
      text: `Reply ${n}`,
      parts: [
        { kind: 'text', text: `Reply ${n}` },
        ...Array.from({ length: 4 }, (_, k) => ({
          kind: 'tool' as const,
          audit: { ts: 0, name: `tool_${k}`, input: {}, outcomeSummary: 'ok' },
        })),
      ],
    },
  ];
}

/** 160 messages / 480 rows. `_recomputeWindow()` cuts this to `_windowStart`
 *  92 — 68 messages, 204 rows — and one more window back lands at 24, which is
 *  136 messages / 408 rows. Both numbers were computed from
 *  `_computeWindowStart()` (chat-panel-window.ts:251) and are asserted in the
 *  mock e2e specs, so a change to the window rule fails a test rather than silently
 *  changing what these tiles show. */
const WINDOW_TRANSCRIPT: SessionMessage[] = Array.from(
  { length: WINDOW_TURNS },
  (_, i) => windowTurn(i),
).flat();

export const WINDOW_STATES: GalleryState[] = [
  // The four message-window states. Together they make the whole
  // windowing feature (008, 009, 010) reviewable with no model run.
  {
    id: 'window-bottom',
    title: 'Window — at the bottom',
    caption: 'A transcript longer than one window, parked at the newest window. No jump button, because there is nothing below.',
    kind: 'panel',
    state: makeState({
      messages: WINDOW_TRANSCRIPT,
      contextWindow: { used: 96000, total: 128000, percent: 75 },
    }),
  },
  {
    id: 'window-scrolled',
    title: 'Window — scrolled up',
    caption: 'The same transcript, scrolled off the bottom. The circular arrow is centred over the list, clear of the composer, and carries no count.',
    kind: 'panel',
    state: makeState({
      messages: WINDOW_TRANSCRIPT,
      contextWindow: { used: 96000, total: 128000, percent: 75 },
    }),
    // 400px: off the bottom, and well above TOP_THRESHOLD_PX (80), so no
    // scroll-up load starts under a static tile.
    demoWindow: { scrollTop: 400 },
  },
  {
    id: 'window-loading-older',
    title: 'Window — loading older',
    caption: 'The same transcript at the top of the list, with the three-dot loader held at the head while the next window loads.',
    kind: 'panel',
    state: makeState({
      messages: WINDOW_TRANSCRIPT,
      contextWindow: { used: 96000, total: 128000, percent: 75 },
    }),
    // `loadingOlder` renders the loader AND satisfies the `!this._loadingOlder`
    // guard at chat-panel-window.ts:317, so scrollTop 0 cannot start a real load that
    // would then clear the loader again.
    demoWindow: { loadingOlder: true, scrollTop: 0 },
  },
  {
    id: 'window-loaded-older',
    title: 'Window — older block loaded',
    caption: 'After the load: the older window is prepended above, 408 rows instead of 204, and the reader is still parked mid-list.',
    kind: 'panel',
    state: makeState({
      messages: WINDOW_TRANSCRIPT,
      contextWindow: { used: 96000, total: 128000, percent: 75 },
    }),
    // 24 is what `_loadWindow({ before: 92, limit: 200 })` returns for this
    // transcript — one window further back, not an arbitrary index.
    demoWindow: { windowStart: 24, scrollTop: 400 },
  },
];
