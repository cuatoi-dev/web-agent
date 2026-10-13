// gallery-blocks.ts — the shared building blocks the cat-store demo gallery
// states are made of: demo avatars, the launcher icon, the `makeState` helper
// and the chart / form / buttons block constants. Split out of
// gallery-states.ts; the code is unchanged.

import type { SessionState } from "@cuatoi/web-agent-core";
import type { FormBlock, ButtonsBlock } from "@cuatoi/web-agent-core";
import type { ChartBlock } from "@cuatoi/web-agent-charting";

// Tiny inline SVG data-URLs — airgap-safe demo avatars (never fetched).
/* eslint-disable wa/no-raw-colour -- Inside an SVG data: URI, which is an isolated document that page custom properties do not cascade into. */
export const DEMO_AGENT_AVATAR =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'%3E%3Crect width='40' height='40' rx='20' fill='%236200ee'/%3E%3Ctext x='20' y='27' font-size='22' text-anchor='middle' fill='white'%3E%F0%9F%90%B1%3C/text%3E%3C/svg%3E";
export const DEMO_USER_AVATAR =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'%3E%3Crect width='40' height='40' rx='20' fill='%2303dac6'/%3E%3Ctext x='20' y='27' font-size='20' text-anchor='middle' fill='%23003b34'%3EA%3C/text%3E%3C/svg%3E";
// B-1: the 'branded-launcher' gallery state exists to show a HOST-SET avatar
// distinct from the built-in default above — reusing DEMO_AGENT_AVATAR there
// defeated the point of the tile. A "W" monogram, not the 🐱 emoji.
export const DEMO_BRANDED_AVATAR =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'%3E%3Crect width='40' height='40' rx='20' fill='%236200ee'/%3E%3Ctext x='20' y='27' font-size='20' font-family='sans-serif' font-weight='bold' text-anchor='middle' fill='white'%3EW%3C/text%3E%3C/svg%3E";
/* eslint-enable wa/no-raw-colour */

// B-2: cat-store vendors no Material Symbols icon font, so the launcher glyph
// cannot be a ligature — it used to be the 🐱 emoji, but emoji render with
// their own fixed built-in colours regardless of CSS `color`, so they cannot
// track --wa-action-text-color-info and measured 2.66-2.95:1 against the
// launcher fill in every theme (WCAG 1.4.11 needs 3:1). An inline SVG with
// `fill="currentColor"` inherits the launcher's `color`, which IS the
// contrast-safe token pair already used everywhere else (task 008's pattern).
export const CAT_STORE_LAUNCHER_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12c0 1.85.5 3.58 1.38 5.07L2 22l5.07-1.38C8.52 21.5 10.25 22 12 22c5.52 0 10-4.48 10-10S17.52 2 12 2zm1 14h-2v-2h2v2zm0-4h-2V7h2v5z"/></svg>';

export function makeState(partial: Partial<SessionState>): SessionState {
  return {
    messages: [],
    sessions: [{ id: 'demo', title: '', titleManual: false, createdAt: 0, updatedAt: 0, messageCount: 0 }],
    activeSessionId: 'demo',
    running: false,
    compacting: false,
    canCompact: false,
    usage: { input: 0, output: 0 },
    contextWindow: { used: 0, total: 128000, percent: 0 },
    queuedMessages: [],
    model: "sonnet",
    ...partial,
  };
}

export const CHART_BLOCK: ChartBlock = {
  type: 'chart',
  title: 'Can Prices',
  config: {
    type: 'bar',
    data: {
      labels: ['Salmon Can', 'Tuna Can', 'Chicken Can', 'Turkey Can'],
      datasets: [
        {
          label: 'Price ($)',
          data: [4.99, 3.49, 3.99, 4.49],
          // eslint-disable-next-line wa/no-raw-colour -- Chart.js paints this to a canvas from a JS option value, so a CSS custom property cannot resolve here (chart-theme.ts:8). Data-encoding colour, the same case DATA_ENCODING_FILES records for chart-skill.ts.
          backgroundColor: ['#6200ee', '#03dac6', '#ff6384', '#36a2eb'],
        },
      ],
    },
    options: { responsive: true, maintainAspectRatio: false },
  },
};

export const CANDLESTICK_BLOCK: ChartBlock = {
  type: 'chart',
  title: 'ACME Corp — Daily',
  config: {
    type: 'candlestick',
    data: {
      datasets: [{
        label: 'ACME',
        data: [
          { x: '2026-01-05', o: 100, h: 104, l: 99, c: 103 },
          { x: '2026-01-06', o: 103, h: 106, l: 102, c: 102.5 },
          { x: '2026-01-07', o: 102.5, h: 103, l: 98, c: 99 },
          { x: '2026-01-08', o: 99, h: 101, l: 97.5, c: 100.5 },
          { x: '2026-01-09', o: 100.5, h: 108, l: 100, c: 107 },
          { x: '2026-01-12', o: 107, h: 109, l: 105, c: 105.5 },
        ],
      }],
    },
    options: {
      scales: { xAxes: [{ type: 'time', time: { unit: 'day' } }] },
      // eslint-disable-next-line wa/no-raw-colour -- Chart.js paints this to a canvas from a JS option value, so a CSS custom property cannot resolve here (chart-theme.ts:8). Data-encoding colour, the same case DATA_ENCODING_FILES records for chart-skill.ts.
      annotation: { lines: [{ axis: 'y', value: 103, color: '#6200ee', label: 'entry', dash: [4, 4] }] },
    },
  },
};

export const PAYOFF_BLOCK: ChartBlock = {
  type: 'chart',
  title: 'Bull Call Spread — Payoff at Expiry',
  config: {
    type: 'payoff',
    data: { datasets: [] },
    options: {
      payoff: {
        legs: [
          { kind: 'call', strike: 100, premium: 5, qty: 1, side: 'long' },
          { kind: 'call', strike: 110, premium: 2, qty: 1, side: 'short' },
        ],
        priceRange: [90, 120],
      },
    },
  },
};

export const EQUITY_BLOCK: ChartBlock = {
  type: 'chart',
  title: 'Strategy P&L — Cumulative',
  config: {
    type: 'equity',
    data: { datasets: [] },
    options: {
      pnl: {
        returns: [200, -150, -180, 120, 260, -90, 300],
        x: ['2026-01-02', '2026-01-09', '2026-01-16', '2026-01-23', '2026-01-30', '2026-02-06', '2026-02-13'],
      },
    },
  },
};

export const DRAWDOWN_BLOCK: ChartBlock = {
  type: 'chart',
  title: 'Underwater — Drawdown from Peak',
  config: {
    type: 'drawdown',
    data: { datasets: [] },
    options: {
      pnl: {
        equity: [10000, 10250, 10120, 9800, 9950, 10400, 10150, 10600],
        x: ['2026-01-02', '2026-01-09', '2026-01-16', '2026-01-23', '2026-01-30', '2026-02-06', '2026-02-13', '2026-02-20'],
        percent: true,
      },
    },
  },
};

export const VOLUME_BLOCK: ChartBlock = {
  type: 'chart',
  title: 'ACME — Price & Volume',
  config: {
    type: 'bar',
    data: {
      labels: ['Jan 05', 'Jan 06', 'Jan 07', 'Jan 08', 'Jan 09', 'Jan 12'],
      datasets: [
        { type: 'line', label: 'Price', yAxisID: 'price',
          data: [103, 102.5, 99, 100.5, 107, 105.5],
          // eslint-disable-next-line wa/no-raw-colour -- Chart.js paints this to a canvas from a JS option value, so a CSS custom property cannot resolve here (chart-theme.ts:8). Data-encoding colour, the same case DATA_ENCODING_FILES records for chart-skill.ts.
          borderColor: '#37474f', fill: false, pointRadius: 0, lineTension: 0 },
        { type: 'bar', label: 'Volume', yAxisID: 'volume',
          data: [1200, 1800, 2400, 900, 2100, 1500],
          // eslint-disable-next-line wa/no-raw-colour -- Chart.js paints this to a canvas from a JS option value, so a CSS custom property cannot resolve here (chart-theme.ts:8). Data-encoding colour, the same case DATA_ENCODING_FILES records for chart-skill.ts.
          backgroundColor: 'rgba(38,166,154,0.4)' },
      ],
    },
    options: {
      scales: {
        yAxes: [
          { id: 'price', position: 'left' },
          { id: 'volume', position: 'right', ticks: { beginAtZero: true, max: 8000 }, gridLines: { display: false } },
        ],
      },
    },
  },
};

export const WATERFALL_BLOCK: ChartBlock = {
  type: 'chart',
  title: 'Trade P&L Bridge',
  config: {
    type: 'waterfall',
    data: { datasets: [] },
    options: {
      waterfall: {
        start: 0,
        steps: [
          { label: 'Open', value: 1000 },
          { label: 'Fees', value: -120 },
          { label: 'Gains', value: 640 },
          { label: 'Slippage', value: -80 },
        ],
        total: 'Net P&L',
        showTotalLine: true,
      },
    },
  },
};

export const FORM_BLOCK: FormBlock = {
  type: 'form',
  id: 'filter',
  title: 'Filter cans',
  fields: [
    { kind: 'select', name: 'protein', label: 'Protein', options: ['Salmon', 'Tuna', 'Chicken', 'Turkey'] },
    { kind: 'checkbox', name: 'inStock', label: 'In stock only', default: true },
  ],
  submit_label: 'Apply',
};

export const BUTTONS_BLOCK: ButtonsBlock = {
  type: 'buttons',
  options: [
    { label: 'Show bestsellers', prompt: 'show bestsellers' },
    { label: 'Cheapest first', prompt: 'sort by price' },
  ],
};
