// gallery-states-finance.ts — the finance/chart gallery states (charts,
// candlestick, payoff, equity, drawdown, volume, waterfall).
// Split out of gallery-states.ts; the code is unchanged.

import type { GalleryState } from './types';
import {
  makeState,
  CHART_BLOCK,
  CANDLESTICK_BLOCK,
  PAYOFF_BLOCK,
  EQUITY_BLOCK,
  DRAWDOWN_BLOCK,
  VOLUME_BLOCK,
  WATERFALL_BLOCK,
} from './gallery-blocks';

export const FINANCE_GALLERY_STATES: GalleryState[] = [
  {
    id: 'charts',
    title: 'With charts',
    caption: 'Rich output — interleaved text and a rendered chart block.',
    kind: 'panel',
    state: makeState({
      messages: [
        {
          role: 'assistant',
          parts: [
            { kind: 'text', text: 'Here is your chart:' },
            { kind: 'block', block: CHART_BLOCK },
            { kind: 'text', text: 'Done.' },
          ],
        },
      ],
    }),
  },
  {
    id: 'candlestick',
    title: 'Candlestick chart',
    caption: 'Finance — a candlestick/OHLC chart with a temporal x-axis and a dashed reference (entry) line (072).',
    kind: 'panel',
    state: makeState({
      messages: [
        {
          role: 'assistant',
          parts: [
            { kind: 'text', text: 'Here is ACME’s recent price action:' },
            { kind: 'block', block: CANDLESTICK_BLOCK },
          ],
        },
      ],
    }),
  },
  {
    id: 'payoff',
    title: 'Options payoff diagram',
    caption: 'Finance — an options payoff diagram: P/L at expiry with a zero baseline, shaded profit (green) / loss (red) regions, strike lines and a breakeven marker (072).',
    kind: 'panel',
    state: makeState({
      messages: [
        {
          role: 'assistant',
          parts: [
            { kind: 'text', text: 'Here is the payoff for a bull call spread:' },
            { kind: 'block', block: PAYOFF_BLOCK },
          ],
        },
      ],
    }),
  },
  {
    id: 'equity',
    title: 'Equity / P&L curve',
    caption: 'Finance — a cumulative P&L / equity curve with a signed area fill split at the zero line (green above / red below) and a zero baseline (072).',
    kind: 'panel',
    state: makeState({
      messages: [
        {
          role: 'assistant',
          parts: [
            { kind: 'text', text: 'Here is the cumulative P&L for the strategy:' },
            { kind: 'block', block: EQUITY_BLOCK },
          ],
        },
      ],
    }),
  },
  {
    id: 'drawdown',
    title: 'Drawdown / underwater',
    caption: 'Finance — an underwater/drawdown chart: percent decline from the running peak, filled red below the zero high-water line (072).',
    kind: 'panel',
    state: makeState({
      messages: [
        {
          role: 'assistant',
          parts: [
            { kind: 'text', text: 'And the drawdown from the running peak:' },
            { kind: 'block', block: DRAWDOWN_BLOCK },
          ],
        },
      ],
    }),
  },
  {
    id: 'volume',
    title: 'Price & volume (dual-axis)',
    caption: 'Finance — a price line over volume bars on a secondary right-hand y-axis (dual-axis combo) (072).',
    kind: 'panel',
    state: makeState({
      messages: [
        {
          role: 'assistant',
          parts: [
            { kind: 'text', text: 'Price with volume underneath:' },
            { kind: 'block', block: VOLUME_BLOCK },
          ],
        },
      ],
    }),
  },
  {
    id: 'waterfall',
    title: 'Waterfall / P&L bridge',
    caption: 'Finance — a waterfall/P&L bridge: stacked-bar attribution from opening balance through signed steps (green up / red down) to a net total, with a dashed total line (072).',
    kind: 'panel',
    state: makeState({
      messages: [
        {
          role: 'assistant',
          parts: [
            { kind: 'text', text: 'Here is the P&L bridge for the trade:' },
            { kind: 'block', block: WATERFALL_BLOCK },
          ],
        },
      ],
    }),
  },
];
