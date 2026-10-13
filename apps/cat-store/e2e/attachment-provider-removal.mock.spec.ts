import { test, expect } from './fixtures';
import { openPanel, shot } from './helpers';

import type { ChatPanelProbe } from './dom-types';
test.describe.configure({ mode: 'serial' });
test.skip(process.env.E2E_ENV !== 'mock', 'mock tier is mock-only');

// Tag-agnostic: cat-store aliases ui/registry.js to its own acme-registry.ts,
// whose iconButton() renders <md-icon-button> (Material Web), not a native
// <button> — the tag the default registry (and the unit tests) use. Matching
// the existing convention in helpers.ts attachmentIcon().
const ICONS = 'agent-chat-panel .composer-controls [data-attachment-provider]';

const providerIds = (page: import('@playwright/test').Page) =>
  page.evaluate(() => {
    const panel = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel') as ChatPanelProbe | null;
    return panel!.session!.getAttachmentProviders().map((p) => p.id);
  });

test.beforeEach(async ({ page }) => {
  await openPanel(page);
});

test('imageInput=false after connect removes the image icon and the session provider', async ({ page }) => {
  await expect(page.locator(`${ICONS}[data-attachment-provider="image"]`)).toHaveCount(1);
  await shot(page, '002-before-remove.png');

  await page.evaluate(() => {
    (((document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel') as ChatPanelProbe | null))!.imageInput = false;
  });

  await expect(page.locator(`${ICONS}[data-attachment-provider="image"]`)).toHaveCount(0);
  expect(await providerIds(page)).not.toContain('image');
  await shot(page, '002-after-remove.png');
});

test('imageInput=true restores the image icon', async ({ page }) => {
  await page.evaluate(() => {
    const panel = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel') as ChatPanelProbe | null;
    panel!.imageInput = false;
    panel!.imageInput = true;
  });
  await expect(page.locator(`${ICONS}[data-attachment-provider="image"]`)).toHaveCount(1);
  await shot(page, '002-restored.png');
});

test('removing one host provider leaves the other', async ({ page }) => {
  // 002 fix: alpha and beta use distinct icons from each other, from the
  // built-in image provider's `attach_file`, and from the picker's
  // `ads_click`, so a removal capture cannot be pixel-identical to any other
  // state in this file (reviewer rejection). Icon names must be in the
  // registry's ICON_SVGS map (apps/cat-store/src/acme-registry.ts) — an
  // unknown name falls back to rendering as literal text.
  await page.evaluate(() => {
    const panel = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel') as ChatPanelProbe | null;
    const mk = (id: string, icon: string) => ({
      id, label: id, icon,
      pick: () => {}, hasPending: () => false, onUserPrompt: () => undefined,
    });
    panel!.imageInput = false;
    panel!.attachmentProviders = [mk('alpha', 'history'), mk('beta', 'bug_report')];
  });
  await expect(page.locator(`${ICONS}[data-attachment-provider="alpha"]`)).toHaveCount(1);
  await expect(page.locator(`${ICONS}[data-attachment-provider="beta"]`)).toHaveCount(1);
  await shot(page, '002-two-host-providers.png');

  await page.evaluate(() => {
    const panel = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel') as ChatPanelProbe | null;
    const mk = (id: string, icon: string) => ({
      id, label: id, icon,
      pick: () => {}, hasPending: () => false, onUserPrompt: () => undefined,
    });
    panel!.attachmentProviders = [mk('alpha', 'history')];
  });
  await expect(page.locator(`${ICONS}[data-attachment-provider="beta"]`)).toHaveCount(0);
  await expect(page.locator(`${ICONS}[data-attachment-provider="alpha"]`)).toHaveCount(1);
  expect(await providerIds(page)).not.toContain('beta');
  await shot(page, '002-host-provider-removed.png');
});
