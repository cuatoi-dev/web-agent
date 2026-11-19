import { test, expect } from './fixtures';
import {
  openPanel,
  attachImage,
  shot,
} from './helpers';
import type { ChatPanelProbe } from './dom-types';
import path from 'path';
import fs from 'fs';

test.describe.configure({ mode: 'serial' });
test.skip(process.env.E2E_ENV !== "mock", "mock tier is mock-only");

const TEST_IMAGE = path.resolve(__dirname, 'fixtures/004-test-rainbow.png');

const IMAGE_DATA_URL = (() => {
  const buf = fs.readFileSync(TEST_IMAGE);
  const b64 = buf.toString('base64');
  return `data:image/png;base64,${b64}`;
})();

test.beforeEach(async ({ page }) => {
  await openPanel(page);
  const imageInput = await page.evaluate(() => {
    const panel = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel') as ChatPanelProbe | null;
    return panel?.imageInput !== false;
  });
  test.skip(!imageInput, 'imageInput is disabled on this host');
});

test('transcript thumbnail: user message with image renders thumbnail', async ({ page }) => {
  test.setTimeout(30_000);
  await page.evaluate((dataUrl) => {
    const panel = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel') as ChatPanelProbe | null;
    if (!panel) return;
    panel.messages = [
      { role: 'user', text: 'Here is an image', images: [{ dataUrl, mediaType: 'image/png' }] },
    ];
  }, IMAGE_DATA_URL);
  await page.waitForTimeout(500);
  await expect(page.locator('agent-message-view .msg-thumbnail')).toBeVisible({ timeout: 5_000 });
  await shot(page, 'img-ui-01-thumbnail.png');
});

test('overlay: opens on thumbnail click inside the panel, closes on Escape', async ({ page }) => {
  test.setTimeout(30_000);
  await attachImage(page);
  await page.evaluate((dataUrl) => {
    const panel = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel') as ChatPanelProbe | null;
    if (!panel) return;
    panel.messages = [
      { role: 'user', text: 'Here is an image', images: [{ dataUrl, mediaType: 'image/png' }] },
    ];
  }, IMAGE_DATA_URL);
  await page.waitForTimeout(500);
  await page.locator('agent-message-view .msg-thumbnail').first().click();
  await expect(page.locator('agent-chat-panel .wa-image-overlay')).toBeVisible({ timeout: 3_000 });
  await shot(page, 'img-ui-02-overlay-open.png');
  await page.keyboard.press('Escape');
  await expect(page.locator('agent-chat-panel .wa-image-overlay')).toHaveCount(0, { timeout: 3_000 });
});

test('overlay: Tab then Escape closes it (Escape listener is not once-only)', async ({ page }) => {
  test.setTimeout(30_000);
  await attachImage(page);
  await page.evaluate((dataUrl) => {
    const panel = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel') as ChatPanelProbe | null;
    if (!panel) return;
    panel.messages = [
      { role: 'user', text: 'Here is an image', images: [{ dataUrl, mediaType: 'image/png' }] },
    ];
  }, IMAGE_DATA_URL);
  await page.waitForTimeout(500);
  await page.locator('agent-message-view .msg-thumbnail').first().click();
  await expect(page.locator('agent-chat-panel .wa-image-overlay')).toBeVisible({ timeout: 3_000 });
  await page.keyboard.press('Tab');
  await expect(page.locator('agent-chat-panel .wa-image-overlay')).toBeVisible({ timeout: 3_000 });
  await page.keyboard.press('Escape');
  await expect(page.locator('agent-chat-panel .wa-image-overlay')).toHaveCount(0, { timeout: 3_000 });
});

test('reload clears transcript (no persistence)', async ({ page }) => {
  test.setTimeout(30_000);
  await page.evaluate((dataUrl) => {
    const panel = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel') as ChatPanelProbe | null;
    if (!panel) return;
    panel.messages = [
      { role: 'user', text: 'persisted?', images: [{ dataUrl, mediaType: 'image/png' }] },
    ];
  }, IMAGE_DATA_URL);
  await page.waitForTimeout(500);
  await expect(page.locator('agent-message-view .msg-thumbnail')).toBeVisible({ timeout: 5_000 });
  await page.reload({ waitUntil: 'networkidle' });
  await openPanel(page);
  await expect(page.locator('agent-message-view .msg-thumbnail')).toHaveCount(0, { timeout: 5_000 });
  await shot(page, 'img-ui-03-reload.png');
});
