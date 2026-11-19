import { test, expect } from './fixtures';
import { openPanel, shot } from './helpers';

// The bubble is a shadow element.
test.skip(process.env.E2E_ENV !== 'mock', 'mock tier is mock-only');

test.describe('web-agent-bubble is a shadow element', () => {
  test('1: the shadow root is open and the light DOM is empty', async ({ page }) => {
    await openPanel(page);
    const shape = await page.evaluate(() => {
      const b = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')!;
      return {
        hasRoot: !!b.shadowRoot,
        mode: b.shadowRoot?.mode ?? null,
        lightLauncher: !!b.querySelector('#launcher'),
        lightPanel: !!b.querySelector('agent-chat-panel'),
        shadowLauncher: !!b.shadowRoot!.querySelector('button#launcher'),
        shadowContainer: !!b.shadowRoot!.querySelector('#panel-container'),
        shadowPanel: !!b.shadowRoot!.querySelector('agent-chat-panel'),
        sheet: !!b.shadowRoot!.querySelector('style[data-wa-styles="bubble"]'),
        sheetId: b.shadowRoot!.querySelector('style')!.id,
      };
    });
    expect(shape.hasRoot).toBe(true);
    expect(shape.mode).toBe('open');
    expect(shape.lightLauncher).toBe(false);
    expect(shape.lightPanel).toBe(false);
    expect(shape.shadowLauncher).toBe(true);
    expect(shape.shadowContainer).toBe(true);
    expect(shape.shadowPanel).toBe(true);
    expect(shape.sheet).toBe(true);
    expect(shape.sheetId).toBe('');
  });

  test('2: the launcher paints from --wa-* tokens across the boundary', async ({ page }) => {
    await openPanel(page);
    const paint = await page.evaluate(() => {
      const b = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')!;
      const btn = b.shadowRoot!.querySelector('#launcher') as HTMLElement;
      const probe = document.createElement('div');
      probe.style.color = 'var(--wa-action-color-info)';
      document.body.appendChild(probe);
      const token = getComputedStyle(probe).color;
      probe.remove();
      const cs = getComputedStyle(btn);
      return { bg: cs.backgroundColor, token, w: cs.width, h: cs.height, radius: cs.borderRadius };
    });
    expect(paint.bg).toBe(paint.token);
    expect(paint.w).toBe('56px');
    expect(paint.h).toBe('56px');
    expect(paint.radius).toBe('50%');
    await shot(page, '003-bubble-shadow-launcher-catstore.png');
  });

  test('3: nothing new reaches document.head', async ({ page }) => {
    await openPanel(page);
    const inHead = await page.evaluate(
      () => document.head.querySelectorAll('style[data-wa-styles]').length,
    );
    expect(inHead).toBe(0);
  });
});
