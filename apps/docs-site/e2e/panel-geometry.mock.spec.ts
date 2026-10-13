import { test, expect } from './fixtures';
import { openBubble } from './helpers';

test.describe('002: panel geometry comes from its container', () => {
  test('default bubble box is 480 x min(660, 80vh)', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await openBubble(page);
    const box = await page.locator('agent-chat-panel').boundingBox();
    expect(box).not.toBeNull();
    expect(Math.round(box!.width)).toBe(480);
    expect(Math.round(box!.height)).toBe(Math.round(Math.min(660, 0.8 * 768)));
  });

  test('a host resizes the box with the two custom properties', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await openBubble(page);
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--web-agent-panel-width', '600px');
      document.documentElement.style.setProperty('--web-agent-panel-height', '400px');
    });
    const panel = page.locator('agent-chat-panel');
    const box = await panel.boundingBox();
    expect(Math.round(box!.width)).toBe(600);
    expect(Math.round(box!.height)).toBe(400);
    expect((await panel.getAttribute('style')) ?? '').not.toMatch(/position|width|height/);
  });
});
