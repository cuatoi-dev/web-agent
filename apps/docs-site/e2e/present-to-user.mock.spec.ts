import { test, expect } from './fixtures';

const DEMO_URL = 'gallery.html?frame=generative-ui';

test('present-to-user: interleaved form and action buttons render on docs-site', async ({ page }) => {
  test.setTimeout(30_000);
  await page.goto(DEMO_URL);

  const msgView = page.locator('agent-message-view');
  await msgView.waitFor({ state: 'visible', timeout: 15_000 });

  const partContainers = await page.evaluate(() => {
    // gallery.html?frame=generative-ui mounts agent-chat-panel in a plain <div> in
    // document.body (gallery.ts renderFrameMode) — no <web-agent-bubble> on
    // this page at all, so no shadow root to pierce.
    const view = document.querySelector('agent-message-view');
    if (!view) return [];
    return [...view.querySelectorAll('[data-part-idx]')].map(el => ({
      idx: parseInt(el.getAttribute('data-part-idx') ?? '', 10),
      class: el.className,
      tag: el.tagName.toLowerCase(),
    }));
  });
  expect(partContainers.length).toBeGreaterThanOrEqual(1);
});
