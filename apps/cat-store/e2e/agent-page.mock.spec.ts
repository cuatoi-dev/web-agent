import { test, expect } from './fixtures';
import { chooseTheme, sendChat, openPanel } from './helpers';
import path from 'path';
import fs from 'fs';

import type { ChatPanelProbe, AgentPageProbe } from './dom-types';
import type { WebAgentBubble } from '@cuatoi/web-agent-lit/embed/web-agent-embed';
const MOCK_REPLY = 'AGENT-PAGE-MOCK-9c2f';
const ARTIFACTS_DIR = path.resolve(
  __dirname,
  '../../../temp/artifacts/agent-page-shell',
);
const ARTIFACTS_DIR_003A = path.resolve(
  __dirname,
  '../../../temp/artifacts/hide-bubble-on-agent-page',
);

test.skip(process.env.E2E_ENV !== 'mock', 'mock tier is mock-only');

test.beforeEach(async ({ page }) => {
  await page.addInitScript((reply) => {
    window.__WA_MOCK_SCRIPT__ = { text: reply, finishReason: 'stop' };
  }, MOCK_REPLY);
});

test('scenario 1: nav entry opens the agent page', async ({ page }) => {
  await page.goto('');
  await page.locator('.nav a[href="#/agent"]').click();
  expect(page.url()).toContain('#/agent');
  await expect(page.locator('agent-page')).toBeVisible({ timeout: 10_000 });
  const link = page.locator('.nav a[href="#/agent"]');
  await expect(link).toHaveClass(/active/);
});

test('scenario 2: direct hash load renders the agent page', async ({ page }) => {
  await page.goto('#/agent');
  await expect(page.locator('agent-page')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('agent-chat-panel #input')).toBeVisible({ timeout: 15_000 });
});

test('scenario 3: three column widths measured', async ({ page }) => {
  await page.goto('#/agent');
  await expect(page.locator('agent-page')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('agent-chat-panel #input')).toBeVisible({ timeout: 15_000 });

  const sessions = page.locator('agent-page .col-sessions');
  const chat = page.locator('agent-page .col-chat');
  const side = page.locator('agent-page .col-side');

  const bSessions = await sessions.boundingBox();
  const bChat = await chat.boundingBox();
  const bSide = await side.boundingBox();

  expect(bSessions).not.toBeNull();
  expect(bChat).not.toBeNull();
  expect(bSide).not.toBeNull();

  expect(bSessions!.width).toBeCloseTo(200, 0);
  expect(bSide!.width).toBeCloseTo(320, 0);
  expect(bChat!.width).toBeCloseTo(1280 - 200 - 320, 0);

  // All three heights are equal within 1px and greater than 600px.
  expect(bSessions!.height).toBeGreaterThan(600);
  expect(Math.abs(bSessions!.height - bChat!.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(bSessions!.height - bSide!.height)).toBeLessThanOrEqual(1);
});

test('scenario 4: columns on narrow viewport — left does not shrink', async ({ page }) => {
  await page.goto('#/agent');
  await expect(page.locator('agent-page')).toBeVisible({ timeout: 10_000 });
  await page.setViewportSize({ width: 900, height: 800 });

  const sessions = page.locator('agent-page .col-sessions');
  const chat = page.locator('agent-page .col-chat');
  const side = page.locator('agent-page .col-side');

  const bSessions = await sessions.boundingBox();
  const bChat = await chat.boundingBox();
  const bSide = await side.boundingBox();

  expect(bSessions!.width).toBeCloseTo(200, 0);
  expect(bSide!.width).toBeCloseTo(320, 0);
  expect(bChat!.width).toBeCloseTo(900 - 200 - 320, 0);
});

test('scenario 5: panel has no header, has messages-list and composer', async ({ page }) => {
  await page.goto('#/agent');
  await expect(page.locator('agent-chat-panel #input')).toBeVisible({ timeout: 15_000 });

  expect(await page.locator('agent-chat-panel .header').count()).toBe(0);
  expect(await page.locator('agent-chat-panel .messages-list').count()).toBe(1);
  expect(await page.locator('agent-chat-panel .composer').count()).toBe(1);
});

test('scenario 6: panel fills the middle column', async ({ page }) => {
  await page.goto('#/agent');
  await expect(page.locator('agent-chat-panel #input')).toBeVisible({ timeout: 15_000 });

  const panelBox = await page.locator('agent-chat-panel').boundingBox();
  const chatBox = await page.locator('agent-page .col-chat').boundingBox();

  expect(panelBox).not.toBeNull();
  expect(chatBox).not.toBeNull();

  expect(Math.abs(panelBox!.x - chatBox!.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(panelBox!.y - (chatBox!.y + 16))).toBeLessThanOrEqual(1);
  expect(Math.abs(panelBox!.width - chatBox!.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(panelBox!.height - (chatBox!.height - 16))).toBeLessThanOrEqual(1);
});

test('scenario 7: sending a message gets a mock reply', async ({ page }) => {
  await page.goto('#/agent');
  await expect(page.locator('agent-chat-panel #input')).toBeVisible({ timeout: 15_000 });

  await sendChat(page, 'hi');

  await expect(
    page.locator('agent-message-view .assistant .content').last()
  ).toContainText(MOCK_REPLY, { timeout: 30_000 });
});

test('scenario 8: full-page agent has no DOM tools', async ({ page }) => {
  await page.goto('#/agent');
  await expect(page.locator('agent-chat-panel #input')).toBeVisible({ timeout: 15_000 });

  const cfg = await page.evaluate(() => {
    const appRoot = document.querySelector('app-root');
    const agentPage = appRoot?.shadowRoot?.querySelector('agent-page') as AgentPageProbe | null;
    const panel = agentPage?.shadowRoot?.querySelector('agent-chat-panel') as ChatPanelProbe | null;
    const config = panel?.buildSessionConfig();
    return {
      providerNames: (config?.toolProviders ?? []).map((p) => p.name),
      skillNames: (config?.skills ?? []).map((s) => s.name),
      cues: config?.cues,
    };
  });

  expect(cfg.providerNames).not.toContain('dom');
  expect(cfg.providerNames).not.toContain('unreachable');
  expect(cfg.providerNames).toContain('demomcp');
  expect(cfg.providerNames).toContain('openapi');
  expect(cfg.skillNames).not.toContain('multi_step_ui');
  expect(cfg.cues).toBeUndefined();
});

test('scenario 9: bubble keeps its DOM tools (regression)', async ({ page }) => {
  await openPanel(page);

  const cfg = await page.evaluate(() => {
    const widget = document.querySelector('cat-agent-widget');
    const bubble = widget?.shadowRoot?.querySelector('web-agent-bubble') as WebAgentBubble | null;
    const panel = bubble?.shadowRoot?.querySelector('agent-chat-panel') as ChatPanelProbe | null;
    const config = panel?.buildSessionConfig();
    return {
      providerNames: (config?.toolProviders ?? []).map((p) => p.name),
      skillNames: (config?.skills ?? []).map((s) => s.name),
      cues: config?.cues,
    };
  });

  expect(cfg.providerNames).toContain('dom');
  expect(cfg.skillNames).toContain('multi_step_ui');
  expect(cfg.cues?.enabled).toBe(true);
});

test('scenario 10 + 11: screenshot in dark and light theme', async ({ page }) => {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });

  await page.goto('#/agent');
  await expect(page.locator('agent-chat-panel #input')).toBeVisible({ timeout: 15_000 });

  // Dark theme screenshot.
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'agent-page-dark.png'), fullPage: true });

  // Switch to light theme.
  await chooseTheme(page, 'wa2-light');
  await page.waitForFunction(
    () => document.documentElement.getAttribute('data-theme') === 'wa2-light',
    { timeout: 5_000 },
  );
  await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'agent-page-light.png'), fullPage: true });
});

test('scenario 12: bubble launcher hidden on the agent route (003a)', async ({ page }) => {
  await page.goto('#/agent');
  await expect(page.locator('agent-chat-panel #input')).toBeVisible({ timeout: 15_000 });

  const display = await page.evaluate(
    () => (document.querySelector('[data-agent-ui]') as HTMLElement).style.display,
  );
  expect(display).toBe('none');
  await expect(page.locator('web-agent-bubble button#launcher')).not.toBeVisible();
});

test('scenario 13: bubble launcher visible and working on shop routes (003a)', async ({ page }) => {
  await page.goto('#/store');
  await expect(page.locator('web-agent-bubble button#launcher')).toBeVisible({ timeout: 15_000 });

  const display = await page.evaluate(
    () => (document.querySelector('[data-agent-ui]') as HTMLElement).style.display,
  );
  expect(display).toBe('');

  // The launcher still opens the panel.
  await page.locator('web-agent-bubble button#launcher').click();
  await expect(page.locator('agent-chat-panel')).toBeVisible({ timeout: 15_000 });
});

test('scenario 14: an open panel closes before hiding on the agent route (003a)', async ({ page }) => {
  await openPanel(page);

  await page.goto('#/agent');
  await expect(page.locator('agent-page')).toBeVisible({ timeout: 10_000 });

  const state = await page.evaluate(() => {
    const widget = document.querySelector('cat-agent-widget');
    const bubble = widget?.shadowRoot?.querySelector('web-agent-bubble') as WebAgentBubble | null;
    return {
      hostDisplay: (document.querySelector('[data-agent-ui]') as HTMLElement).style.display,
      containerDisplay: bubble?.shadowRoot?.querySelector<HTMLElement>('#panel-container')?.style?.display,
    };
  });
  expect(state.hostDisplay).toBe('none');
  expect(state.containerDisplay).toBe('none');

  // Back on a shop route the launcher is back, collapsed.
  await page.goto('#/store');
  await expect(page.locator('web-agent-bubble button#launcher')).toBeVisible({ timeout: 15_000 });
  // B-2: the launcher glyph is an inline SVG (currentColor, contrast-safe),
  // not the 🐱 emoji — see gallery-blocks.ts CAT_STORE_LAUNCHER_ICON.
  const launcherIcon = await page.evaluate(() => {
    const widget = document.querySelector('cat-agent-widget');
    const bubble = widget?.shadowRoot?.querySelector('web-agent-bubble') as WebAgentBubble | null;
    const iconEl = bubble?.shadowRoot?.querySelector('#launcher-icon');
    return {
      hasSvg: !!iconEl?.querySelector('svg'),
      text: iconEl?.textContent?.trim(),
    };
  });
  expect(launcherIcon.hasSvg).toBe(true);
  expect(launcherIcon.text).toBe('');
  await expect(page.locator('agent-chat-panel')).not.toBeVisible();
});

test('scenario 15: the widget stays mounted while hidden (003a)', async ({ page }) => {
  await page.goto('#/agent');
  await expect(page.locator('agent-chat-panel #input')).toBeVisible({ timeout: 15_000 });

  const mounted = await page.evaluate(
    () => !!document.querySelector('[data-agent-ui] cat-agent-widget'),
  );
  expect(mounted).toBe(true);
});

test('scenario 16: screenshots show no launcher on the agent page, both themes (003a)', async ({ page }) => {
  fs.mkdirSync(ARTIFACTS_DIR_003A, { recursive: true });

  await page.goto('#/agent');
  await expect(page.locator('agent-chat-panel #input')).toBeVisible({ timeout: 15_000 });

  await page.screenshot({
    path: path.join(ARTIFACTS_DIR_003A, 'agent-page-bubble-hidden-dark.png'),
    fullPage: true,
  });

  await chooseTheme(page, 'wa2-light');
  await page.waitForFunction(
    () => document.documentElement.getAttribute('data-theme') === 'wa2-light',
    { timeout: 5_000 },
  );
  await page.screenshot({
    path: path.join(ARTIFACTS_DIR_003A, 'agent-page-bubble-hidden-light.png'),
    fullPage: true,
  });
});
