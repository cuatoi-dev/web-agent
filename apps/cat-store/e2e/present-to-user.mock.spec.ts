import { test, expect } from './fixtures';

const DEMO_URL = 'gallery.html?frame=present-demo';

test('present-to-user: interleaved text + blocks render in order, chart + buttons + click round-trip', async ({ page }) => {
  test.setTimeout(30_000);

  await page.goto(DEMO_URL);

  // Wait for agent-message-view parts to render
  const firstPart = page.locator('agent-message-view [data-part-idx="0"]');
  await firstPart.waitFor({ state: 'visible', timeout: 15_000 });

  const partContainers = await page.evaluate(() => {
    // gallery.html?frame=present-demo mounts agent-chat-panel in a plain <div>
    // on document.body (gallery.ts renderFrameMode) — no <web-agent-bubble> on
    // this page at all, so no shadow root to pierce.
    const view = document.querySelector('agent-message-view');
    if (!view) return [];
    return [...view.querySelectorAll('[data-part-idx]')].map(el => ({
      idx: parseInt(el.getAttribute('data-part-idx') ?? '', 10),
      class: el.className,
      tag: el.tagName.toLowerCase(),
    }));
  });
  expect(partContainers).toHaveLength(4);
  expect(partContainers[0]).toMatchObject({ idx: 0, class: 'content' });
  expect(partContainers[1]).toMatchObject({ idx: 1, class: 'blocks-container' });
  expect(partContainers[2]).toMatchObject({ idx: 2, class: 'content' });
  expect(partContainers[3]).toMatchObject({ idx: 3, class: 'blocks-container' });

  // ── 2. Text content: "Here is your chart:" before block, "quick actions" after ──
  const text0 = await page.locator('[data-part-idx="0"].content').innerText();
  expect(text0).toContain('Here is your chart');
  const text2 = await page.locator('[data-part-idx="2"].content').innerText();
  expect(text2).toContain('quick actions');

  // ── 3. Canvas chart with non-zero area (Chart.js) ──
  await page.waitForFunction(() => {
    function findCanvas(root: Document | ShadowRoot): boolean {
      if (root.querySelector('canvas')) return true;
      for (const el of root.querySelectorAll('*')) {
        const sr = (el as Element & { shadowRoot?: ShadowRoot }).shadowRoot;
        if (sr && findCanvas(sr)) return true;
      }
      return false;
    }
    return findCanvas(document);
  }, { timeout: 20_000 });

  await page.waitForTimeout(800);

  const chartArea = await page.evaluate(() => {
    function traverse(root: Document | ShadowRoot): number {
      let maxA = 0;
      for (const el of root.querySelectorAll('canvas')) {
        const r = el.getBoundingClientRect();
        maxA = Math.max(maxA, r.width * r.height);
      }
      for (const el of root.querySelectorAll('*')) {
        const sr = (el as Element & { shadowRoot?: ShadowRoot }).shadowRoot;
        if (sr) maxA = Math.max(maxA, traverse(sr));
      }
      return maxA;
    }
    return traverse(document);
  });
  expect(chartArea, 'chart canvas should have positive area').toBeGreaterThan(1000);

  // ── 4. Buttons render in the second blocks-container ──
  const buttonsBlock = page.locator('[data-part-idx="3"].blocks-container');
  const buttonTexts = await buttonsBlock.locator('button, md-filled-button, md-outlined-button').allInnerTexts();
  expect(buttonTexts).toContain('Add to cart');

  // ── 5. Interactive click round-trip: button click fires block-button event ──
  // The demo appends a log entry to #click-log when block-button fires.
  await buttonsBlock.locator('button, md-filled-button, md-outlined-button').filter({ hasText: 'Add to cart' }).click();

  const log = page.locator('#click-log');
  await expect(log).toContainText('block-button');

  const logText = await log.innerText();
  expect(logText).toContain('add p01');
});
