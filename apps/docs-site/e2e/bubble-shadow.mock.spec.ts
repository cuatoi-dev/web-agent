import { test, expect } from './fixtures';
import { openBubble, shot } from './helpers';

// The bubble is a shadow element.
test.skip(process.env.E2E_ENV !== 'mock', 'mock tier is mock-only');

test.describe('web-agent-bubble is a shadow element', () => {
  test('1: the shadow root is open and the light DOM is empty', async ({ page }) => {
    await openBubble(page);
    const shape = await page.evaluate(() => {
      const b = (document.querySelector('docs-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')!;
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
    await openBubble(page);
    const paint = await page.evaluate(() => {
      const b = (document.querySelector('docs-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')!;
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
    await shot(page, '003-bubble-shadow-launcher-docs.png');
  });

  test('3: nothing new reaches document.head', async ({ page }) => {
    await openBubble(page);
    const inHead = await page.evaluate(
      () => document.head.querySelectorAll('style[data-wa-styles]').length,
    );
    expect(inHead).toBe(0);
  });

  test('4: the Material Symbols launcher glyph renders as a glyph, not as text', async ({ page }) => {
    // Deliberately does NOT call openBubble() — that opens the chat, which
    // swaps the icon to the close glyph. Check the closed-state launcher icon.
    await page.goto('', { waitUntil: 'networkidle', timeout: 30_000 });
    await page.locator('web-agent-bubble button#launcher').waitFor({ state: 'visible', timeout: 15_000 });
    const glyph = await page.evaluate(() => {
      const b = (document.querySelector('docs-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')!;
      const span = b.shadowRoot!.querySelector('#launcher-icon') as HTMLElement;
      const i = span.querySelector('i') as HTMLElement;
      return {
        text: i.textContent,
        partFont: getComputedStyle(span).fontFamily,
        iFont: getComputedStyle(i).fontFamily,
        // A ligature collapses "menu_book" into one glyph, so the rendered box
        // is far narrower than nine characters of body text would be.
        width: Math.round(i.getBoundingClientRect().width),
      };
    });
    expect(glyph.text).toBe('menu_book');
    expect(glyph.partFont).toContain('Material Symbols');
    expect(glyph.iFont).toContain('Material Symbols');
    expect(glyph.width).toBeLessThan(40);
  });
});
