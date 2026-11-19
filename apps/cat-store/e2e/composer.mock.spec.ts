import { test, expect } from './fixtures';
import { openPanel } from './helpers';

import type { ComposerInputProbe } from './dom-types';
test.describe('composer & panel geometry', () => {
  test('panel computes to 480 x min(660, 80vh) desktop size', async ({ page }) => {
    await openPanel(page);
    const panel = page.locator('agent-chat-panel');
    await expect(panel).toBeVisible();

    const viewport = page.viewportSize();
    // The panel fills #panel-container, whose size is
    // var(--web-agent-panel-width, 480px) x var(--web-agent-panel-height, 660px) capped at
    // 80vh. Measure the rendered border box with boundingBox() — the panel
    // has box-sizing: border-box, so its border box IS the size the host set
    // through --web-agent-panel-*, with no content/border discrepancy.
    const box = await panel.boundingBox();
    expect(box).not.toBeNull();
    expect(Math.round(box!.width)).toBe(480);
    expect(Math.round(box!.height))
      .toBe(Math.round(Math.min(660, 0.8 * (viewport?.height ?? 800))));
  });

  test('composer markup and controls row structure', async ({ page }) => {
    await openPanel(page);
    const composer = page.locator('agent-chat-panel .composer');
    await expect(composer).toBeVisible();
    await expect(composer.locator('#input')).toBeVisible();
    await expect(composer.locator('.composer-controls')).toBeVisible();
    await expect(composer.locator('.composer-controls md-icon-button[data-aria-label="Send"]')).toBeVisible();
  });

  test('long text paste (12,000 chars) keeps all content and does not truncate', async ({ page }) => {
    await openPanel(page);
    const longText = 'A'.repeat(12_000);
    await page.evaluate((text) => {
      const field = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel #input') as ComposerInputProbe | null;
      field!.value = text;
      field!.dispatchEvent(new Event('input', { bubbles: true }));
    }, longText);

    const readBack = await page.evaluate(() => {
      const field = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel #input') as ComposerInputProbe | null;
      return field!.value;
    });
    expect(readBack.length).toBe(12_000);
    expect(readBack).toBe(longText);
  });

  test('50% cap math: typing 30+ lines clamps input height at panelHeight * 0.5 with overflow-y: auto', async ({ page }) => {
    await openPanel(page);
    const multiLine = Array.from({ length: 35 }, (_, i) => `Line ${i + 1}`).join('\n');
    await page.evaluate((text) => {
      const field = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel #input') as ComposerInputProbe | null;
      field!.value = text;
      field!.dispatchEvent(new Event('input', { bubbles: true }));
    }, multiLine);

    const metrics = await page.evaluate(() => {
      const panel = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel') as HTMLElement;
      const panelH = panel.getBoundingClientRect().height;
      const input = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel #input') as HTMLElement;
      const inputH = input.getBoundingClientRect().height;
      // #input is now the <wa-text-area> wrapper, not the real
      // field — its own shadowRoot is null. The field a registry actually
      // renders (a light-DOM child of the wrapper) may itself keep the real
      // <textarea> in ITS shadow DOM (Acme's <md-outlined-text-field>), or as
      // a light-DOM child (the default registry) — check both places, one
      // level down from the wrapper.
      const registryField = input.firstElementChild as HTMLElement | null;
      const inner = registryField?.shadowRoot?.querySelector('textarea')
        || registryField?.querySelector('textarea')
        || input.querySelector('textarea');
      const overflowY = inner ? window.getComputedStyle(inner).overflowY : '';
      return { panelH, inputH, ratio: inputH / panelH, overflowY };
    });

    expect(metrics.ratio).toBeCloseTo(0.5, 2);
    expect(metrics.overflowY).toBe('auto');
  });

  test('Shift+Enter inserts a newline without sending', async ({ page }) => {
    await openPanel(page);
    await page.evaluate(() => {
      const field = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel #input') as ComposerInputProbe | null;
      field!.value = 'hello';
      field!.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // #input is the <wa-text-area> wrapper: it has no shadow
    // root and no tabindex of its own, so locator.press()'s internal
    // .focus() call on it is a no-op — the key would land wherever focus
    // already was (nowhere useful). A real click hit-tests to the actual
    // rendered field inside the wrapper and focuses it the way a user would,
    // including through Material's delegatesFocus. Then send keys directly,
    // with no further focus attempt.
    const inputHost = page.locator('agent-chat-panel #input');
    await inputHost.click();
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('world');

    const value = await page.evaluate(() => {
      const field = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel #input') as ComposerInputProbe | null;
      return field!.value;
    });
    expect(value).toContain('hello\nworld');

    const msgCount = await page.locator('agent-chat-panel .messages-list agent-message-view').count();
    expect(msgCount).toBe(0);
  });

  test('Enter key sends the message and collapses input back to single line height resetHeight', async ({ page }) => {
    await openPanel(page);
    // A bare page.keyboard.type() cannot build this multi-line content: this
    // composer sends on a plain Enter, so a literal "\n" character would
    // submit after the first line instead of inserting a newline. Real
    // Shift+Enter between lines is the only interaction that both (a) reaches
    // this._composerValue the way the send gate below requires, and (b)
    // matches how a user actually types a multi-line message — the wrapper's
    // own .value setter (used by the tests above) updates only the wrapper,
    // never the panel's tracked composer value the send gate reads.
    const inputHost = page.locator('agent-chat-panel #input');
    await inputHost.click();
    const lines = ['line 1', 'line 2', 'line 3', 'line 4', 'line 5'];
    for (let i = 0; i < lines.length; i++) {
      await page.keyboard.type(lines[i]);
      if (i < lines.length - 1) await page.keyboard.press('Shift+Enter');
    }
    await page.keyboard.press('Enter');

    const collapsedValue = await page.evaluate(() => {
      const field = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel #input') as ComposerInputProbe | null;
      return field!.value;
    });
    expect(collapsedValue).toBe('');

    const collapsedHeight = await page.evaluate(() => {
      const field = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel #input') as ComposerInputProbe | null;
      return field!.getBoundingClientRect().height;
    });
    expect(collapsedHeight).toBeLessThan(100);

    const msgCount = await page.locator('agent-chat-panel .messages-list agent-message-view').count();
    expect(msgCount).toBeGreaterThan(0);
  });

  test('iPad landscape 1024x768: panel fits and composer is usable', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await openPanel(page);
    const panel = page.locator('agent-chat-panel');
    await expect(panel).toBeVisible();

    // 80vh of 768 = 614.4px (measured 614.391px) — the panel is clamped by
    // #panel-container's max-height. Measured via boundingBox(), the rendered
    // border box — the panel has box-sizing: border-box, so this is the same
    // number getComputedStyle would report.
    const box = await panel.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(Math.round(box.width)).toBe(480);
      expect(Math.round(box.height)).toBe(Math.round(Math.min(660, 0.8 * 768)));
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(1024);
    }

    const controlsNoWrap = await page.evaluate(() => {
      const ctrl = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel .composer-controls') as HTMLElement;
      if (!ctrl) return false;
      const buttons = [...ctrl.children].filter(ch => (ch as HTMLElement).offsetHeight > 0) as HTMLElement[];
      if (buttons.length === 0) return false;
      const firstTop = buttons[0].getBoundingClientRect().top;
      return buttons.every(ch => Math.abs(ch.getBoundingClientRect().top - firstTop) < 2);
    });
    expect(controlsNoWrap).toBe(true);
  });

  test('a host resizes the box with --web-agent-panel-width/--web-agent-panel-height, no inline style on the panel', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await openPanel(page);
    // The host sets two inherited properties on its own element. 400px is under
    // the 80vh cap (614.4px at this viewport), so the effect is observable.
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--web-agent-panel-width', '600px');
      document.documentElement.style.setProperty('--web-agent-panel-height', '400px');
    });
    const panel = page.locator('agent-chat-panel');
    const box = await panel.boundingBox();
    expect(Math.round(box!.width)).toBe(600);
    expect(Math.round(box!.height)).toBe(400);
    // The bubble must not have written geometry onto the panel element.
    const inline = (await panel.getAttribute('style')) ?? '';
    expect(inline).not.toMatch(/position|width|height/);
  });
});
