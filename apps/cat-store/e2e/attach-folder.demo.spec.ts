import { test, expect } from './fixtures';
import { openPanel, attachmentIcon, sendChat, waitForAssistantReply } from './helpers';
import path from 'path';
import fs from 'fs/promises';

const ARTIFACTS = path.resolve(__dirname, '../../../temp/artifacts/attach-folder-button');

test('attach folder against real model in cat-store', async ({ page }) => {
  test.setTimeout(300_000);
  await fs.mkdir(ARTIFACTS, { recursive: true });

  await page.addInitScript(() => {
    Object.defineProperty(window, 'showDirectoryPicker', {
      value: undefined,
      configurable: true,
      writable: true,
    });
  });

  const requests: { url: string; postData: unknown }[] = [];
  page.on('request', (req) => {
    if (!req.url().includes('/api/anthropic/')) return;
    let postData: unknown;
    try {
      postData = JSON.parse(req.postData() ?? '');
    } catch {
      postData = req.postData();
    }
    requests.push({ url: req.url(), postData });
  });

  await openPanel(page);

  const fixtureDir = path.resolve(__dirname, '../test-results/attach-folder-fixtures/reports');
  await fs.mkdir(fixtureDir, { recursive: true });
  await fs.writeFile(path.join(fixtureDir, 'q3-sales.csv'), 'quarter,sales\nQ3,120000\n');
  await fs.writeFile(path.join(fixtureDir, 'q3-costs.csv'), 'quarter,costs\nQ3,45000\n');
  await fs.writeFile(path.join(fixtureDir, 'q3-headcount.csv'), 'quarter,headcount\nQ3,24\n');

  await attachmentIcon(page, 'folder').click();
  const copyItem = page.getByRole('menuitem', { name: /Attach folder \(read-only copy\)/ });
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
  // The model can write a short line before its tool calls; the helper returns on
  // that first text. Wait for the final reply, which carries the three figures.
  const lastReply = () =>
    page.evaluate(() => {
      const root = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot;
      const views = [...(root?.querySelectorAll('agent-message-view') ?? [])].filter((v) => v.querySelector('.assistant'));
      return [...(views[views.length - 1]?.querySelectorAll('.content') ?? [])].map((c) => c.textContent ?? '').join('\n').trim();
    });
  await expect
    .poll(async () => {
      const plain = (await lastReply()).replace(/,/g, '');
      return ['120000', '45000', '24'].every((fig) => plain.includes(fig));
    }, { timeout: 120_000, intervals: [1_000] })
    .toBe(true);
  const reply = await lastReply();

  await page.screenshot({ path: path.join(ARTIFACTS, 'live-catstore-summary.png') });

  const attachReq = requests.find((r) =>
    JSON.stringify(r.postData).includes('The user attached the folder /share/reports (read only, 3 files).'),
  );
  expect(attachReq, 'expected a request with attach line').toBeTruthy();

  const plain = reply.replace(/,/g, '');
  for (const fig of ['120000', '45000', '24']) {
    expect(plain, `reply should contain ${fig}`).toContain(fig);
  }

  await fs.writeFile(path.join(ARTIFACTS, 'live-catstore-requests.json'), JSON.stringify(requests, null, 2));
  await fs.writeFile(
    path.join(ARTIFACTS, 'live-catstore-answer.json'),
    JSON.stringify({ prompt: 'Summarise the Q3 CSVs', reply }, null, 2),
  );
});
