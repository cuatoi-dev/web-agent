import path from 'path';
import fs from 'fs';
import { test, expect } from './fixtures';
import { openPanel, sendChat, waitForTurnComplete, waitForAgentInitSettled } from './helpers';
import type { ChatPanelProbe } from './dom-types';

const ARTIFACTS_DIR = path.resolve(
  __dirname, '../../../temp/artifacts/session-records-the-store-can-page',
);

test.setTimeout(60_000);
test.use({ consoleErrorExtraAllowlist: ['[autotitle]'] });

test('session records survive a reload', async ({ page }) => {
  await page.addInitScript(() => {
    window.__WA_MOCK_SCRIPT__ = [
      { text: 'Hello! We sell cat supplies.', finishReason: 'stop' },
      { text: 'The current theme is light.', finishReason: 'stop' },
    ];
  });

  await openPanel(page);

  // Create a fresh session through the panel's own API, so the record count
  // starts at zero.
  await page.evaluate(async () => {
    const panel = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document)
      .querySelector('web-agent-bubble')?.shadowRoot
      ?.querySelector('agent-chat-panel') as ChatPanelProbe | null;
    await panel!.createSession();
  });

  const sessionId = await page.evaluate(() => {
    const panel = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document)
      .querySelector('web-agent-bubble')?.shadowRoot
      ?.querySelector('agent-chat-panel') as ChatPanelProbe | null;
    return panel!._state!.activeSessionId;
  });

  await sendChat(page, 'Hello, what do you sell?');
  await waitForTurnComplete(page);

  await sendChat(page, 'Use the get_theme tool and tell me the current theme.');
  await waitForTurnComplete(page);

  const transcriptBefore = await page.evaluate(() => {
    const root = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document)
      .querySelector('web-agent-bubble')?.shadowRoot;
    return [...(root?.querySelectorAll('agent-message-view') ?? [])].map(v => v.textContent?.trim() ?? '');
  });
  expect(transcriptBefore.length).toBeGreaterThan(0);

  const idb = await page.evaluate(() => new Promise<{ keys: string[]; index: unknown }>((resolve, reject) => {
    const req = indexedDB.open('web-agent-cat-store');
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('sessions', 'readonly');
      const os = tx.objectStore('sessions');
      const kReq = os.getAllKeys();
      const iReq = os.get('web-agent-sessions');
      tx.oncomplete = () => resolve({ keys: kReq.result.map(String), index: iReq.result });
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    };
  }));

  const recordKeys = idb.keys.filter(k => k.startsWith(`session-rec-${sessionId}-`));
  console.log('[session-records] record keys:', recordKeys);
  console.log('[session-records] index entry:', JSON.stringify(idb.index));

  expect(recordKeys.length).toBeGreaterThanOrEqual(2);
  for (const k of recordKeys) {
    expect(k).toMatch(/^session-rec-.+-\d{6}$/);
  }
  expect(idb.keys.some(k => k.startsWith('session-msgs-'))).toBe(false);

  const indexEntry = (idb.index as { id: string; lastSeq?: number }[] | undefined)?.find(m => m.id === sessionId);
  expect(indexEntry?.lastSeq).toBe(recordKeys.length);

  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(ARTIFACTS_DIR, 'idb-keys.txt'),
    `record keys: ${JSON.stringify(recordKeys)}\nindex entry: ${JSON.stringify(indexEntry)}\n`,
  );

  await page.reload();
  await openPanel(page);
  await waitForAgentInitSettled(page);

  const transcriptAfter = await page.evaluate(() => {
    const root = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document)
      .querySelector('web-agent-bubble')?.shadowRoot;
    return [...(root?.querySelectorAll('agent-message-view') ?? [])].map(v => v.textContent?.trim() ?? '');
  });
  expect(transcriptAfter).toEqual(transcriptBefore);

  const restoredCount = await page.evaluate(() => {
    const root = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document)
      .querySelector('web-agent-bubble')?.shadowRoot;
    return root?.querySelectorAll('agent-message-view').length ?? 0;
  });
  expect(restoredCount).toBe(transcriptBefore.length);
  const firstBubbleText = await page.evaluate(() => {
    const root = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document)
      .querySelector('web-agent-bubble')?.shadowRoot;
    return root?.querySelector('agent-message-view')?.textContent?.trim() ?? '';
  });
  expect(firstBubbleText).toContain('Hello, what do you sell?');
});
