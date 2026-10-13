import { describe, it, expect } from 'vitest';
import { GALLERY_STATES } from './gallery-states';
import { requiresCharting } from './gallery-filter';

describe('requiresCharting', () => {
  it('returns true for chart states and present-demo', () => {
    const chartIds = ['charts', 'candlestick', 'payoff', 'equity', 'drawdown', 'volume', 'waterfall', 'present-demo'];
    for (const id of chartIds) {
      const gs = GALLERY_STATES.find((s) => s.id === id);
      expect(gs, `state ${id} should exist`).toBeDefined();
      expect(requiresCharting(gs!), `state ${id} should require charting`).toBe(true);
    }
  });

  it('returns false for non-chart states', () => {
    const nonChartIds = ['empty', 'header-off', 'mid', 'rich-table', 'generative-ui'];
    for (const id of nonChartIds) {
      const gs = GALLERY_STATES.find((s) => s.id === id);
      expect(gs, `state ${id} should exist`).toBeDefined();
      expect(requiresCharting(gs!), `state ${id} should not require charting`).toBe(false);
    }
  });
});
