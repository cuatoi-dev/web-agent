import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { chooseTheme, openPanel, attachmentIcon, sendChat, waitForAssistantReply } from './helpers';
import path from 'path';
import fs from 'fs/promises';

const ARTIFACTS = path.resolve(__dirname, '../../../temp/artifacts/attach-folder-button');

// The menu surface animates open and an ancestor can clip it, so an item's own
// box says nothing. Wait until the surface box is nonzero and unchanged.
async function waitForMenuSettled(page: Page): Promise<void> {
  // Playwright locators pierce the open shadow roots that document.querySelector cannot.
  const menu = page.locator('agent-chat-panel md-menu');
  const surfaceBox = () =>
    menu.evaluateAll((menus) => {
      const open = (menus as Array<HTMLElement & { open?: boolean }>).find((m) => m.open);
      const surface = open?.shadowRoot?.querySelector('.menu') as HTMLElement | null;
      if (!surface) return null;
      const r = surface.getBoundingClientRect();
      return { key: `${r.x},${r.y},${r.width},${r.height}`, nonzero: r.width > 0 && r.height > 0 };
    });
  let previous: string | null = null;
  await expect
    .poll(async () => {
      const box = await surfaceBox();
      const stable = !!box && box.nonzero && box.key === previous;
      previous = box ? box.key : null;
      return stable;
    }, { timeout: 5000, intervals: [100] })
    .toBe(true);
}

async function waitForMenuClosed(page: Page): Promise<void> {
  await expect
    .poll(() => page.locator('agent-chat-panel md-menu').evaluateAll((menus) => (menus as Array<HTMLElement & { open?: boolean }>).some((m) => m.open)), { timeout: 5000 })
    .toBe(false);
  await page.waitForTimeout(400);
}

// Contrast of an item's headline text against the pixel behind it, sampled
// from a real screenshot so the state layer (hover, focus) is included.
async function measureItemContrast(page: Page, item: Locator, label: string): Promise<number> {
  const box = (await item.boundingBox())!;
  const clip = { x: Math.floor(box.x), y: Math.floor(box.y), width: Math.ceil(box.width), height: Math.ceil(box.height) };
  const png = await page.screenshot({ clip });
  const textColour = await item.locator('[slot="headline"]').evaluate((el) => getComputedStyle(el).color);
  const ratio = await page.evaluate(async ({ b64, textColour, h }) => {
    const bmp = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const bg = Array.from(ctx.getImageData(3, Math.floor(h / 2), 1, 1).data).slice(0, 3);
    const fg = (textColour.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const lum = (rgb: number[]) => {
      const [r, g, b] = rgb.map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const [hi, lo] = [lum(fg), lum(bg)].sort((a, z) => z - a);
    return (hi + 0.05) / (lo + 0.05);
  }, { b64: png.toString('base64'), textColour, h: clip.height });
  await fs.appendFile(path.join(ARTIFACTS, 'catstore-menu-state-contrast.txt'), `${label}: ${ratio.toFixed(2)}:1\n`);
  return ratio;
}

// Hover and keyboard-focus states of the open menu, in the current theme.
async function captureItemStates(page: Page, item: Locator, other: Locator, theme: string): Promise<void> {
  await item.hover();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(ARTIFACTS, `catstore-menu-hover-${theme}.png`) });
  expect(await measureItemContrast(page, item, `catstore ${theme} hover`)).toBeGreaterThanOrEqual(4.5);
  await page.mouse.move(2, 2);
  await other.focus();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(ARTIFACTS, `catstore-menu-focus-${theme}.png`) });
  const focused = await page.locator('agent-chat-panel md-menu').evaluateAll((menus) => {
    const menu = (menus as Array<HTMLElement & { open?: boolean }>).find((m) => m.open);
    return menu?.querySelector('md-menu-item[tabindex="0"]')?.textContent?.trim() ?? null;
  });
  expect(focused).not.toBeNull();
  expect(await measureItemContrast(page, other, `catstore ${theme} focus`)).toBeGreaterThanOrEqual(4.5);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.__USER_TEXTS__ = [];
    window.__WA_MOCK_SCRIPT__ = (opts: any) => {
      const lastMsg = opts.messages[opts.messages.length - 1];
      if (lastMsg?.role === 'user') {
        let text = '';
        if (typeof lastMsg.content === 'string') {
          text = lastMsg.content;
        } else if (Array.isArray(lastMsg.content)) {
          text = lastMsg.content
            .filter((p: any) => p && p.type === 'text' && typeof p.text === 'string')
            .map((p: any) => p.text)
            .join('\n');
        }
        if (text && !text.includes('Summarize the following conversation as a short UI title')) {
          window.__USER_TEXTS__!.push(text);
        }
      }
      const lastText = typeof lastMsg?.content === 'string' ? lastMsg.content : '';
      if (lastText.includes('Summarize the following conversation as a short UI title')) {
        return { text: 'Title' };
      }
      return { text: 'Mock reply.' };
    };
  });
});

test.describe('cat-store attach-folder mock suite', () => {
  test('1. folder button in the composer row; menu with the folder API; two chips', async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).showDirectoryPicker = async () => {
        const root = await navigator.storage.getDirectory();
        return root.getDirectoryHandle('reports', { create: true });
      };
    });
    await openPanel(page);
    const panel = page.locator('agent-chat-panel:visible');
    await expect(attachmentIcon(page, 'folder')).toBeVisible();
    await expect(attachmentIcon(page, 'image')).toBeVisible();

    await attachmentIcon(page, 'folder').click();
    const roItem = panel.getByRole('menuitem', { name: /Attach folder \(read only\)/ });
    const rwItem = panel.getByRole('menuitem', { name: /Attach folder \(read and write\)/ });
    await waitForMenuSettled(page);
    await expect(roItem).toBeVisible();
    await expect(rwItem).toBeVisible();

    // Default theme is wa2-dark: menu screenshot
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'wa2-dark');
    await page.screenshot({ path: path.join(ARTIFACTS, 'catstore-menu-dark.png') });
    await captureItemStates(page, rwItem, roItem, 'dark');

    // Switch to light theme
    await chooseTheme(page, 'wa2-light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'wa2-light');
    await page.waitForTimeout(200);

    // Open menu in light theme: menu screenshot
    await attachmentIcon(page, 'folder').click();
    await waitForMenuSettled(page);
    await expect(rwItem).toBeVisible();
    await page.screenshot({ path: path.join(ARTIFACTS, 'catstore-menu-light.png') });
    await captureItemStates(page, rwItem, roItem, 'light');

    // Mount first folder: read and write
    await rwItem.click();
    await expect(rwItem).not.toBeVisible();
    await waitForMenuClosed(page);
    const chip = page.locator('agent-chat-panel [data-attachment-slot="folder"] .wa-folder-chip');
    await expect(chip.first()).toContainText('/share/reports · read and write');

    // Mount second folder: read only
    await attachmentIcon(page, 'folder').click();
    await expect(roItem).toBeVisible();
    await roItem.click();
    await expect(roItem).not.toBeVisible();
    await waitForMenuClosed(page);
    await expect(chip.filter({ hasText: '/share/reports-2' })).toBeVisible();

    // Two chips screenshot in light and dark
    await page.screenshot({ path: path.join(ARTIFACTS, 'catstore-chips-light.png') });
    await chooseTheme(page, 'wa2-dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'wa2-dark');
    await page.screenshot({ path: path.join(ARTIFACTS, 'catstore-chips-dark.png') });
  });

  test('2. without the folder API: one copy entry; the real webkitdirectory input attaches a read-only copy', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'showDirectoryPicker', {
        value: undefined,
        configurable: true,
        writable: true,
      });
    });

    const fixtureDir = path.resolve(__dirname, '../test-results/attach-folder-fixtures/reports');
    await fs.mkdir(fixtureDir, { recursive: true });
    await fs.writeFile(path.join(fixtureDir, 'q3-sales.csv'), 'quarter,sales\nQ3,120000\n');
    await fs.writeFile(path.join(fixtureDir, 'q3-costs.csv'), 'quarter,costs\nQ3,45000\n');
    await fs.writeFile(path.join(fixtureDir, 'q3-headcount.csv'), 'quarter,headcount\nQ3,24\n');

    await openPanel(page);
    const panel = page.locator('agent-chat-panel:visible');
    await attachmentIcon(page, 'folder').click();

    const copyItem = panel.getByRole('menuitem', { name: /Attach folder \(read-only copy\)/ });
    await expect(copyItem).toBeVisible();

    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      copyItem.click(),
    ]);
    await chooser.setFiles(fixtureDir);

    const chip = page.locator('agent-chat-panel [data-attachment-slot="folder"] .wa-folder-chip');
    await expect(chip.first()).toContainText('/share/reports · read only');

    const sendBtn = page.locator('agent-chat-panel .input-area md-icon-button[data-aria-label="Send"]');
    await expect(sendBtn).toHaveAttribute('disabled', '');
  });

  test('3. the sent message carries the folder chip; the model gets the line', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'showDirectoryPicker', {
        value: undefined,
        configurable: true,
        writable: true,
      });
    });

    const fixtureDir = path.resolve(__dirname, '../test-results/attach-folder-fixtures/reports');
    await fs.mkdir(fixtureDir, { recursive: true });
    await fs.writeFile(path.join(fixtureDir, 'q3-sales.csv'), 'quarter,sales\nQ3,120000\n');
    await fs.writeFile(path.join(fixtureDir, 'q3-costs.csv'), 'quarter,costs\nQ3,45000\n');
    await fs.writeFile(path.join(fixtureDir, 'q3-headcount.csv'), 'quarter,headcount\nQ3,24\n');

    await openPanel(page);
    const panel = page.locator('agent-chat-panel:visible');
    await attachmentIcon(page, 'folder').click();

    const copyItem = panel.getByRole('menuitem', { name: /Attach folder \(read-only copy\)/ });
    await expect(copyItem).toBeVisible();

    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      copyItem.click(),
    ]);
    await chooser.setFiles(fixtureDir);

    const chip = page.locator('agent-chat-panel [data-attachment-slot="folder"] .wa-folder-chip');
    await expect(chip.first()).toContainText('/share/reports · read only');

    await sendChat(page, 'Summarise the Q3 CSVs');
    await waitForAssistantReply(page);

    const texts = await page.evaluate(() => window.__USER_TEXTS__);
    const lastText = texts?.[texts.length - 1] ?? '';
    expect(lastText).toContain('The user attached the folder /share/reports (read only, 3 files).');
    expect(lastText).toContain('Summarise the Q3 CSVs');

    const sentFolderChip = page.locator('agent-chat-panel agent-message-view .attachment-chips [data-attachment-provider="folder"]').last();
    await expect(sentFolderChip).toHaveText('/share/reports · read only');

    const userMsg = page.locator('agent-chat-panel agent-message-view').filter({ hasText: 'Summarise the Q3 CSVs' });
    await expect(userMsg).not.toContainText('The user attached');

    // Currently dark theme by default
    await page.screenshot({ path: path.join(ARTIFACTS, 'catstore-sent-dark.png') });
    await chooseTheme(page, 'wa2-light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'wa2-light');
    await page.screenshot({ path: path.join(ARTIFACTS, 'catstore-sent-light.png') });
  });
});
