import { test, expect } from './fixtures';
import { openPanel, sendChat, waitForTurnComplete } from './helpers';
import { auditToolNames } from './demo-helpers';

test.skip(process.env.E2E_ENV !== 'mock', 'mock tier is mock-only');

// Guard for the defect where `show_chart` returns `outcome.block`,
// so it renders as a chart block and produces NO `.tool-step` row. The audit
// helper must still report it — otherwise the live demo spec's
// `expect.soft(tools).toContain('show_chart')` can only pass when charting is
// BROKEN (an error outcome has no block, so it does get a tool-step row).
test('auditToolNames reports block-emitting tools (show_chart) alongside text tools', async ({ page }) => {
  test.setTimeout(60_000);

  await page.addInitScript(() => {
    window.__WA_MOCK_SCRIPT__ = [
      { toolCalls: [{ id: 'call_query_data', name: 'query_data', input: { source: 'products' } }] },
      {
        toolCalls: [{
          id: 'call_show_chart',
          name: 'show_chart',
          input: {
            title: 'Probe chart',
            config: { type: 'bar', data: { labels: ['A', 'B'], datasets: [{ label: 'Q', data: [1, 2] }] } },
          },
        }],
      },
      { text: 'Here is the chart.', finishReason: 'stop' },
    ];
  });
  await page.route('**/api/anthropic/**', (route) => route.abort());

  await openPanel(page);
  await sendChat(page, 'draw a chart');
  await waitForTurnComplete(page);

  // The chart really rendered as a block (no tool-step row for it).
  await expect(page.locator('agent-chart-block')).toHaveCount(1);
  expect(
    await page.evaluate(() =>
      [...((document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelectorAll('agent-message-view .tool-step') ?? [])]
        .map((el) => el.getAttribute('title')),
    ),
  ).not.toContain('show_chart');

  // …yet the audit helper reports it, in order, next to the text-outcome tool.
  const tools = await auditToolNames(page);
  expect(tools).toContain('query_data');
  expect(tools).toContain('show_chart');
  expect(tools.indexOf('query_data')).toBeLessThan(tools.indexOf('show_chart'));
});
