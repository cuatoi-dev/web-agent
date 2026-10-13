import { test, expect } from './fixtures';
import { shot } from './helpers';

const LINK_SELECTOR =
  'docs-app main.page-content article a[href]:not([class]):not([data-ui])';

/** WCAG relative luminance + contrast ratio, computed from an rgb(...) string. */
function contrastRatio(rgbA: string, rgbB: string): number {
  const toRgb = (s: string) => {
    const m = s.match(/\d+(\.\d+)?/g);
    if (!m) throw new Error(`Not an rgb() colour: ${s}`);
    return [Number(m[0]), Number(m[1]), Number(m[2])];
  };
  const luminance = ([r, g, b]: number[]) => {
    const chan = (c: number) => {
      const v = c / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    const [rl, gl, bl] = [chan(r), chan(g), chan(b)];
    return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
  };
  const lA = luminance(toRgb(rgbA));
  const lB = luminance(toRgb(rgbB));
  const [lighter, darker] = lA > lB ? [lA, lB] : [lB, lA];
  return (lighter + 0.05) / (darker + 0.05);
}

test.describe('in-content link affordance', () => {
  test('1: prose link has the affordance', async ({ page }) => {
    await page.goto('#/lit/porting-to-acme-components', { waitUntil: 'networkidle' });
    await page.locator('docs-app article[data-slug="porting-to-acme-components"]').waitFor();

    const link = page.locator(LINK_SELECTOR).first();
    const style = await link.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        textDecorationLine: cs.textDecorationLine,
        display: cs.display,
        color: cs.color,
        textDecorationThickness: cs.textDecorationThickness,
      };
    });
    expect(style.textDecorationLine).toBe('underline');
    expect(style.display).toBe('inline');
    expect(style.color).toBe('rgb(98, 36, 255)');
    expect(style.textDecorationThickness).toBe('1px');

    await shot(page, '020-content-links-colour.png');
  });

  test('2: resting contrast meets AA', async ({ page }) => {
    await page.goto('#/lit/porting-to-acme-components', { waitUntil: 'networkidle' });
    await page.locator('docs-app article[data-slug="porting-to-acme-components"]').waitFor();

    const { linkColor, bgColor } = await page.locator(LINK_SELECTOR).first().evaluate((el) => {
      const linkColor = getComputedStyle(el).color;
      let node: Element | null = el;
      let bgColor = 'rgba(0, 0, 0, 0)';
      while (node) {
        const bg = getComputedStyle(node).backgroundColor;
        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
          bgColor = bg;
          break;
        }
        node = node.parentElement;
      }
      return { linkColor, bgColor };
    });

    expect(bgColor).toBe('rgb(247, 242, 247)');
    const ratio = contrastRatio(linkColor, bgColor);
    console.log(`[020] resting contrast: ${ratio.toFixed(2)}:1`);
    expect(ratio).toBeGreaterThanOrEqual(4.5);
  });

  test('3: link vs body text contrast, recorded only', async ({ page }) => {
    await page.goto('#/beercss/menu', { waitUntil: 'networkidle' });
    await page.locator('docs-app article[data-slug="menu"]').waitFor();

    const link = page.locator(LINK_SELECTOR).first();
    const { linkColor, textColor } = await link.evaluate((el) => {
      const p = el.closest('p') as HTMLElement;
      return {
        linkColor: getComputedStyle(el).color,
        textColor: getComputedStyle(p).color,
      };
    });

    const ratio = contrastRatio(linkColor, textColor);
    console.log(`[020] link vs body text contrast: ${ratio.toFixed(2)}:1 (recorded, not a gate)`);
  });

  test('4: contrast holds in all three themes', async ({ page }) => {
    await page.goto('#/lit/porting-to-acme-components', { waitUntil: 'networkidle' });
    await page.locator('docs-app article[data-slug="porting-to-acme-components"]').waitFor();

    for (const theme of ['wa2-light', 'wa1-dark', 'wa2-dark']) {
      const { linkColor, bgColor } = await page.evaluate(
        ({ sel, theme }) => {
          document.documentElement.setAttribute('data-theme', theme);
          const link = document.querySelector(sel) as HTMLElement;
          const linkColor = getComputedStyle(link).color;
          let node: Element | null = link;
          let bgColor = 'rgba(0, 0, 0, 0)';
          while (node) {
            const bg = getComputedStyle(node).backgroundColor;
            if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
              bgColor = bg;
              break;
            }
            node = node.parentElement;
          }
          return { linkColor, bgColor };
        },
        { sel: LINK_SELECTOR, theme },
      );
      const ratio = contrastRatio(linkColor, bgColor);
      console.log(`[020] ${theme} contrast: ${ratio.toFixed(2)}:1`);
      expect(ratio, `${theme} contrast should be >= 4.5`).toBeGreaterThanOrEqual(4.5);
    }

    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'wa2-light'));
  });

  test('5: hover is distinct', async ({ page }) => {
    await page.goto('#/lit/porting-to-acme-components', { waitUntil: 'networkidle' });
    await page.locator('docs-app article[data-slug="porting-to-acme-components"]').waitFor();

    const link = page.locator(LINK_SELECTOR).first();
    await link.hover();
    const style = await link.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { color: cs.color, textDecorationThickness: cs.textDecorationThickness };
    });
    expect(style.color).toBe('rgb(116, 61, 255)');
    expect(style.textDecorationThickness).toBe('2px');

    await shot(page, '020-content-links-hover.png');
  });

  test('6: keyboard focus is visible', async ({ page }) => {
    await page.goto('#/lit/porting-to-acme-components', { waitUntil: 'networkidle' });
    await page.locator('docs-app article[data-slug="porting-to-acme-components"]').waitFor();

    const link = page.locator(LINK_SELECTOR).first();
    await link.focus();
    const style = await link.evaluate((el) => {
      const cs = getComputedStyle(el);
      // The ring is declared as `var(--wa-outline-color, …)`, so the token is
      // the expectation — resolve it through a probe element rather than
      // hard-coding the colour, which the token ladder is free to change.
      const probe = document.createElement('span');
      probe.style.color = 'var(--wa-outline-color)';
      document.body.appendChild(probe);
      const outlineToken = getComputedStyle(probe).color;
      probe.remove();
      return {
        outlineStyle: cs.outlineStyle,
        outlineWidth: cs.outlineWidth,
        outlineColor: cs.outlineColor,
        outlineOffset: cs.outlineOffset,
        outlineToken,
      };
    });
    expect(style.outlineStyle).toBe('solid');
    expect(style.outlineWidth).toBe('2px');
    expect(style.outlineColor).toBe(style.outlineToken);
    expect(style.outlineOffset).toBe('2px');

    await shot(page, '020-content-links-focus.png');
  });

  test('7: Beer component demos unchanged', async ({ page }) => {
    await page.goto('#/guides/showcase', { waitUntil: 'networkidle' });
    await page.locator('docs-app article[data-slug="showcase"]').waitFor();

    const matchCount = await page.locator(LINK_SELECTOR).count();
    expect(matchCount).toBe(0);

    // .first() is "Design", which also carries `.active` — pick a chip with
    // no other Beer CSS class so this checks the base `.chip` rule only.
    const chip = page.locator('docs-app article a.chip:not(.active)').first();
    const chipStyle = await chip.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { display: cs.display, textDecorationLine: cs.textDecorationLine };
    });
    // Beer CSS sets `.chip { display: inline-flex }`, but the chip is a flex
    // item of its `.row` parent, so CSS Display Level 3 blockification
    // resolves the *computed* display to `flex` — verified live, unrelated
    // to this change. Our rule requires `:not([class])`, so it can never
    // match a classed anchor like `.chip`; the value we assert here is
    // exactly what the page renders with or without our rule.
    expect(chipStyle.display).toBe('flex');
    expect(chipStyle.textDecorationLine).toBe('none');

    const dataUi = page.locator('docs-app article a[data-ui]').first();
    if (await dataUi.count() > 0) {
      const dataUiStyle = await dataUi.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { display: cs.display, textDecorationLine: cs.textDecorationLine };
      });
      expect(['flex', 'inline-flex']).toContain(dataUiStyle.display);
      expect(dataUiStyle.textDecorationLine).toBe('none');
    }

    await shot(page, '020-showcase-unchanged.png');
  });

  test('8: chrome unchanged', async ({ page }) => {
    await page.goto('#/lit/porting-to-acme-components', { waitUntil: 'networkidle' });
    await page.locator('docs-app article[data-slug="porting-to-acme-components"]').waitFor();

    const navLink = page.locator('nav.side-nav .nav-link').first();
    const navStyle = await navLink.evaluate((el) => getComputedStyle(el).textDecorationLine);
    expect(navStyle).toBe('none');

    const headerLink = page.locator('header a').first();
    if (await headerLink.count() > 0) {
      const headerStyle = await headerLink.evaluate((el) => getComputedStyle(el).textDecorationLine);
      expect(headerStyle).toBe('none');
    }

    await shot(page, '020-chrome-unchanged.png');
  });

  test('9: Beer CSS doc pages style prose links only', async ({ page }) => {
    await page.goto('#/beercss/menu', { waitUntil: 'networkidle' });
    await page.locator('docs-app article[data-slug="menu"]').waitFor();

    const matches = page.locator(LINK_SELECTOR);
    const count = await matches.count();
    expect(count).toBeGreaterThan(0);

    for (let i = 0; i < count; i++) {
      const el = matches.nth(i);
      const parentTag = await el.evaluate((n) => n.closest('p') !== null);
      expect(parentTag).toBe(true);
      const insidePre = await el.evaluate((n) => n.closest('pre') !== null);
      expect(insidePre).toBe(false);
    }
  });

  test('10: long link wraps', async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 800 });
    await page.goto('#/beercss/menu', { waitUntil: 'networkidle' });
    await page.locator('docs-app article[data-slug="menu"]').waitFor();

    const rectCounts = await page.locator(LINK_SELECTOR).evaluateAll((els) =>
      els.map((el) => el.getClientRects().length),
    );
    expect(Math.max(...rectCounts)).toBeGreaterThan(1);
  });

  test('11: greyscale proof', async ({ page }) => {
    await page.goto('#/lit/porting-to-acme-components', { waitUntil: 'networkidle' });
    await page.locator('docs-app article[data-slug="porting-to-acme-components"]').waitFor();
    await page.addStyleTag({ content: 'html { filter: grayscale(1); }' });

    await shot(page, '020-content-links-greyscale.png');
  });
});
