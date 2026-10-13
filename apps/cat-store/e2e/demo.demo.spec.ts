import { test } from './fixtures';
import { openPanel, clearCartViaUI, ask, expectCall } from './helpers';
import { TRIGGER } from './demo-helpers';

test.describe.configure({ mode: 'serial' });
test.setTimeout(600_000);
test.use({ consoleErrorExtraAllowlist: ['[autotitle]'] });

test('cat-store full demo run via /demo skill', async ({ page }) => {
  await openPanel(page);
  await clearCartViaUI(page);

  const { trace } = await ask(page, TRIGGER, { timeoutMs: 540_000 });

  expectCall(trace, 'load_skill', { name: 'demo' });

  const expectedTools = [
    'get_theme',
    'set_theme',
    'wait',
    'snapshot_page',
    'click',
    'add_to_cart',
    'demomcp_place_order',
    'ordersApi_describeOrders',
    'show_live_chart',
  ];

  for (const t of expectedTools) {
    expectCall(trace, t);
  }
});
