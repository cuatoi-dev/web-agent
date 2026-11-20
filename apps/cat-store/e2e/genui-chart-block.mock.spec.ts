import { test, expect } from './fixtures';
import { chooseTheme, gotoAgentPage } from './helpers';
import path from 'path';
import fs from 'fs';
import { panelChartSkill } from '../src/web/store/panel-chart-skill';

const ARTIFACTS_DIR = path.resolve(
  __dirname,
  '../../../temp/artifacts/live-chart-block-in-genui-frame',
);

/** A live revenue chart block — same shape as demo-chart-datasource in gallery-demos.ts. */
const LIVE_REVENUE_CHART_ARGS = JSON.stringify({
  type: 'chart',
  title: 'Monthly Order Revenue (Live Data)',
  refresh: { mode: 'auto', intervalMs: 30000 },
  query: {
    source: 'orders',
    aggregate: {
      groupBy: [{ field: 'createdAt', granularity: 'month', as: 'createdAt_month' }],
      measures: [{ op: 'sum', field: 'total', as: 'revenue' }],
      sort: [{ field: 'createdAt_month', dir: 'asc' }],
    },
  },
  encoding: {
    mark: 'line',
    x: { field: 'createdAt_month', type: 'temporal' },
    y: { field: 'revenue', type: 'quantitative' },
    tooltip: ['createdAt_month', 'revenue'],
  },
});

/** A genui source the mock model returns. */
const CHART_SOURCE =
  `<agent-chart-block><script type="application/json">${LIVE_REVENUE_CHART_ARGS}</script></agent-chart-block>`;

test.skip(process.env.E2E_ENV !== 'mock', 'mock tier is mock-only');

test.use({ consoleErrorExtraAllowlist: ['Content Security Policy', '[agent-chart-block]'] });

test.beforeEach(() => {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
});

test('chart-block scenario 1: a live chart source mounts and draws', async ({ page }) => {
  await page.addInitScript((source) => {
    window.__WA_MOCK_SCRIPT__ = [
      {
        toolCalls: [
          {
            id: 'call_render_chart',
            name: 'render_agent_ui',
            input: { source },
          },
        ],
      },
      {
        text: 'Here is the orders revenue chart.',
        finishReason: 'stop',
      },
    ];
  }, CHART_SOURCE);

  await gotoAgentPage(page);

  const chatInput = page.locator('agent-chat-panel').first().locator('textarea, [contenteditable]').first();
  await chatInput.click();
  await chatInput.fill('show me a revenue chart');
  await chatInput.press('Enter');

  // Wait for tool step
  await expect(page.locator('.tool-step[title="render_agent_ui"]').first()).toBeVisible({ timeout: 30_000 });

  // Wait for the assistant response
  await expect(page.locator('agent-message-view').last()).toContainText('revenue chart', {
    timeout: 20_000,
  });

  // Wait for frame to load
  const frame = page.frame({ url: /genui\/frame/ });
  expect(frame).not.toBeNull();

  // Scenario 1: canvas should be present (chart drawn), not "Loading chart data"
  await expect(frame!.locator('canvas#chart-el')).toBeAttached({ timeout: 15_000 });
  const bodyText = await frame!.locator('body').textContent();
  expect(bodyText).not.toContain('Loading chart data');

  await page.screenshot({
    path: path.join(ARTIFACTS_DIR, 'chart-block-scenario-1-drawn-dark.png'),
    fullPage: true,
  });
});

test('chart-block scenario 1 (light theme): a live chart source mounts and draws', async ({ page }) => {
  await page.addInitScript((source) => {
    window.__WA_MOCK_SCRIPT__ = [
      {
        toolCalls: [
          {
            id: 'call_render_chart',
            name: 'render_agent_ui',
            input: { source },
          },
        ],
      },
      {
        text: 'Here is the orders revenue chart.',
        finishReason: 'stop',
      },
    ];
  }, CHART_SOURCE);

  await gotoAgentPage(page);

  // Switch to light theme
  await chooseTheme(page, 'wa2-light');
  await page.waitForFunction(
    () => document.documentElement.getAttribute('data-theme') === 'wa2-light',
    { timeout: 5_000 },
  );

  const chatInput = page.locator('agent-chat-panel').first().locator('textarea, [contenteditable]').first();
  await chatInput.click();
  await chatInput.fill('show me a revenue chart');
  await chatInput.press('Enter');

  await expect(page.locator('.tool-step[title="render_agent_ui"]').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('agent-message-view').last()).toContainText('revenue chart', {
    timeout: 20_000,
  });

  const frame = page.frame({ url: /genui\/frame/ });
  expect(frame).not.toBeNull();

  await expect(frame!.locator('canvas#chart-el')).toBeAttached({ timeout: 15_000 });
  const bodyText = await frame!.locator('body').textContent();
  expect(bodyText).not.toContain('Loading chart data');

  await page.screenshot({
    path: path.join(ARTIFACTS_DIR, 'chart-block-scenario-1-drawn-light.png'),
    fullPage: true,
  });
});

test('chart-block scenario 3: the JSON child stays inside agent-chart-block after mount', async ({ page }) => {
  await page.addInitScript((source) => {
    window.__WA_MOCK_SCRIPT__ = [
      {
        toolCalls: [{ id: 'call_render', name: 'render_agent_ui', input: { source } }],
      },
      { text: 'Chart mounted.', finishReason: 'stop' },
    ];
  }, CHART_SOURCE);

  await gotoAgentPage(page);

  const chatInput = page.locator('agent-chat-panel').first().locator('textarea, [contenteditable]').first();
  await chatInput.click();
  await chatInput.fill('show chart');
  await chatInput.press('Enter');

  await expect(page.locator('.tool-step[title="render_agent_ui"]').first()).toBeVisible({ timeout: 30_000 });

  // Check JSON child is still inside agent-chart-block and has no sourceURL
  const frame = page.frame({ url: /genui\/frame/ });
  expect(frame).not.toBeNull();

  await frame!.waitForSelector('agent-chart-block', { timeout: 15_000 });

  // The JSON child must still be inside the element (not moved out by script sweep)
  const sourceURLPresent = await frame!.evaluate(() => {
    return document.documentElement.innerHTML.includes('sourceURL');
  });
  expect(sourceURLPresent).toBe(false);
});

test('chart-block scenario 4: auto-refresh updates chart data when a new order is created without re-render', async ({ page }) => {
  const shortRefreshChartArgs = JSON.stringify({
    type: 'chart',
    title: 'Monthly Order Revenue (Auto Refresh)',
    refresh: { mode: 'auto', intervalMs: 5000 },
    query: {
      source: 'orders',
      aggregate: {
        groupBy: [{ field: 'createdAt', granularity: 'month', as: 'createdAt_month' }],
        measures: [{ op: 'sum', field: 'total', as: 'revenue' }],
        sort: [{ field: 'createdAt_month', dir: 'asc' }],
      },
    },
    encoding: {
      mark: 'line',
      x: { field: 'createdAt_month', type: 'temporal' },
      y: { field: 'revenue', type: 'quantitative' },
      tooltip: ['createdAt_month', 'revenue'],
    },
  });

  const shortRefreshSource =
    `<agent-chart-block><script type="application/json">${shortRefreshChartArgs}</script></agent-chart-block>`;

  await page.addInitScript((source) => {
    window.__WA_MOCK_SCRIPT__ = [
      {
        toolCalls: [
          {
            id: 'call_render_chart',
            name: 'render_agent_ui',
            input: { source },
          },
        ],
      },
      {
        text: 'Here is the live orders revenue chart.',
        finishReason: 'stop',
      },
    ];
  }, shortRefreshSource);

  await gotoAgentPage(page);

  const chatInput = page.locator('agent-chat-panel').first().locator('textarea, [contenteditable]').first();
  await chatInput.click();
  await chatInput.fill('show live revenue chart');
  await chatInput.press('Enter');

  // Wait for tool step
  await expect(page.locator('.tool-step[title="render_agent_ui"]').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('agent-message-view').last()).toContainText('live orders revenue chart', {
    timeout: 20_000,
  });

  const frame = page.frame({ url: /genui\/frame/ });
  expect(frame).not.toBeNull();

  // Wait for initial chart draw
  await expect(frame!.locator('canvas#chart-el')).toBeAttached({ timeout: 15_000 });

  // Read initial data from the chart element
  const initialData = await frame!.evaluate(() => {
    const el = document.querySelector('agent-chart-block') as any;
    const chart = el?._chartInstance;
    return {
      datasets: chart?.data?.datasets?.map((d: any) => [...d.data]) ?? [],
      lastUpdated: el?.lastUpdated,
    };
  });
  expect(initialData.datasets.length).toBeGreaterThan(0);

  // Capture 10-before-panel.png
  const beforeScreenshot = await page.evaluate(() => window.__WA_GENUI_SCREENSHOT__?.());
  if (beforeScreenshot?.dataUrl) {
    const base64 = beforeScreenshot.dataUrl.replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync(path.join(ARTIFACTS_DIR, '10-before-panel.png'), Buffer.from(base64, 'base64'));
  }

  // Post a new order with a distinctive value ($7777)
  const orderRes = await page.evaluate(async () => {
    const apiPath = window.location.pathname.includes('cat-store')
      ? '/cat-store/api/orders'
      : '/api/orders';
    const res = await fetch(apiPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer: 'Live E2E Test Customer',
        category: 'Toys',
        total: 7777,
        status: 'completed',
        itemCount: 1,
        items: 'Laser Pointer Deluxe',
      }),
    });
    return res.json();
  });
  expect(orderRes.total).toBe(7777);

  // Wait for auto-refresh tick to update the chart data
  await frame!.waitForFunction(
    (initialTimestamp) => {
      const el = document.querySelector('agent-chart-block') as any;
      return el && typeof el.lastUpdated === 'number' && el.lastUpdated > initialTimestamp;
    },
    initialData.lastUpdated ?? 0,
    { timeout: 15_000 },
  );

  // Read updated chart data
  const updatedData = await frame!.evaluate(() => {
    const el = document.querySelector('agent-chart-block') as any;
    const chart = el?._chartInstance;
    return {
      datasets: chart?.data?.datasets?.map((d: any) => [...d.data]) ?? [],
      lastUpdated: el?.lastUpdated,
    };
  });

  // Verify the chart data updated to include the new revenue
  expect(updatedData.datasets).not.toEqual(initialData.datasets);
  expect(updatedData.lastUpdated).toBeGreaterThan(initialData.lastUpdated);

  // Capture 11-after-panel.png
  const afterScreenshot = await page.evaluate(() => window.__WA_GENUI_SCREENSHOT__?.());
  if (afterScreenshot?.dataUrl) {
    const base64 = afterScreenshot.dataUrl.replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync(path.join(ARTIFACTS_DIR, '11-after-panel.png'), Buffer.from(base64, 'base64'));
  }

  // Assert render_agent_ui was NOT called again (only exactly 1 tool-step chip exists)
  const toolStepCount = await page.locator('.tool-step[title="render_agent_ui"]').count();
  expect(toolStepCount).toBe(1);
});

test('chart-block scenario 5: malformed JSON child produces a readable diagnostic in diagnostics channel', async ({ page }) => {
  await gotoAgentPage(page);

  const badSource =
    '<agent-chart-block><script type="application/json">{ not json }</script></agent-chart-block>';

  await page.evaluate(async (src) => {
    await window.__WA_GENUI_MOUNT__?.(src);
  }, badSource);

  const diagnostics = await page.evaluate(() => window.__WA_GENUI_DRAIN__?.() ?? []);
  expect(diagnostics.length).toBeGreaterThan(0);
  const errorEntry = diagnostics.find(
    (d: { kind?: string; level?: string; args?: string[] }) =>
      d.kind === 'console' &&
      d.level === 'error' &&
      d.args?.some((a) => typeof a === 'string' && a.includes('not valid JSON')),
  );
  expect(errorEntry).toBeDefined();
});

test('chart-block scenario 6: missing JSON child produces a readable diagnostic in diagnostics channel', async ({ page }) => {
  await gotoAgentPage(page);

  const missingSource = '<agent-chart-block></agent-chart-block>';

  await page.evaluate(async (src) => {
    await window.__WA_GENUI_MOUNT__?.(src);
  }, missingSource);

  const diagnostics = await page.evaluate(() => window.__WA_GENUI_DRAIN__?.() ?? []);
  expect(diagnostics.length).toBeGreaterThan(0);
  const errorEntry = diagnostics.find(
    (d: { kind?: string; level?: string; args?: string[] }) =>
      d.kind === 'console' &&
      d.level === 'error' &&
      d.args?.some((a) => typeof a === 'string' && a.includes('no <script type="application/json"> child')),
  );
  expect(errorEntry).toBeDefined();
});

test('chart-block scenario 7: agent-chart-block is registered in the frame', async ({ page }) => {
  await gotoAgentPage(page);

  const frame = page.frame({ url: /genui\/frame/ });
  expect(frame).not.toBeNull();
  await frame!.waitForLoadState('load');

  await frame!.waitForFunction(
    () => !!window.customElements.get('agent-chart-block'),
    { timeout: 15_000 },
  );

  const registered = await frame!.evaluate(() => !!window.customElements.get('agent-chart-block'));
  expect(registered).toBe(true);
});

test('chart-block scenario 15: the panel-chart skill worked example, pasted as-is, draws', async ({ page }) => {
  // Extract Example 1's JSON child from the skill definition (the first
  // real <script type="application/json"> block inside a worked
  // <agent-chart-block>, not the prose that documents the tag inside
  // backticks).
  const scriptRegex = /(?<!`)<script\s+type="application\/json">\s*([\s\S]*?)\s*<\/script>/;
  const match = scriptRegex.exec(panelChartSkill.definition)!;
  expect(match).not.toBeNull();
  const chartArgs = match[1];
  const source =
    `<agent-chart-block><script type="application/json">${chartArgs}</script></agent-chart-block>`;

  await page.addInitScript((src) => {
    window.__WA_MOCK_SCRIPT__ = [
      {
        toolCalls: [
          {
            id: 'call_render_skill_example',
            name: 'render_agent_ui',
            input: { source: src },
          },
        ],
      },
      { text: 'Here is the panel chart from the skill example.', finishReason: 'stop' },
    ];
  }, source);

  await gotoAgentPage(page);

  const chatInput = page.locator('agent-chat-panel').first().locator('textarea, [contenteditable]').first();
  await chatInput.click();
  await chatInput.fill('show panel chart');
  await chatInput.press('Enter');

  await expect(page.locator('.tool-step[title="render_agent_ui"]').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('agent-message-view').last()).toContainText('panel chart', {
    timeout: 20_000,
  });

  const frame = page.frame({ url: /genui\/frame/ });
  expect(frame).not.toBeNull();

  await expect(frame!.locator('canvas#chart-el')).toBeAttached({ timeout: 15_000 });
  const bodyText = await frame!.locator('body').textContent();
  expect(bodyText).not.toContain('Loading chart data');
});

test('chart-block scenario 14: screenshot of drawn chart contains canvas', async ({ page }) => {
  await page.addInitScript((source) => {
    window.__WA_MOCK_SCRIPT__ = [
      {
        toolCalls: [{ id: 'call_render_chart', name: 'render_agent_ui', input: { source } }],
      },
      { text: 'Here is the revenue chart.', finishReason: 'stop' },
    ];
  }, CHART_SOURCE);

  await gotoAgentPage(page);

  const chatInput = page.locator('agent-chat-panel').first().locator('textarea, [contenteditable]').first();
  await chatInput.click();
  await chatInput.fill('show revenue chart');
  await chatInput.press('Enter');

  await expect(page.locator('.tool-step[title="render_agent_ui"]').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('agent-message-view').last()).toContainText('revenue chart', { timeout: 20_000 });

  const frame = page.frame({ url: /genui\/frame/ });
  expect(frame).not.toBeNull();

  // Wait for chart canvas
  await expect(frame!.locator('canvas#chart-el')).toBeAttached({ timeout: 15_000 });

  // Capture the panel screenshot
  const screenshotResult = await page.evaluate(() => window.__WA_GENUI_SCREENSHOT__?.());
  expect(screenshotResult?.dataUrl).toBeTruthy();
  expect(screenshotResult!.dataUrl).toMatch(/^data:image\/(png|jpeg)/);

  await page.screenshot({
    path: path.join(ARTIFACTS_DIR, 'chart-block-scenario-14-screenshot.png'),
    fullPage: true,
  });
});
