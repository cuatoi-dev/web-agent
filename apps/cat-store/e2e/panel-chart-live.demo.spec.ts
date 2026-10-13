import { test } from './fixtures';
import { gotoAgentPage, ask, expectCall } from './helpers';

test.setTimeout(150_000);
test.use({ consoleErrorExtraAllowlist: ['[autotitle]'] });

test('live: panel-chart reference skill renders a working panel chart from a natural question', async ({ page }) => {
  await gotoAgentPage(page);

  const { trace } = await ask(page, 'Create a panel dashboard showing our order revenue by month.');

  expectCall(trace, 'load_skill', { name: 'panel-chart' });
  expectCall(trace, 'render_agent_ui', (input: unknown) => {
    const src = (input as { source?: unknown })?.source;
    return typeof src === 'string' && src.includes('<agent-chart-block>') && src.includes('application/json');
  });
});
