import { test, expect } from './fixtures';
import { openPanel, sendChat } from './helpers';

// USER.md and MEMORY.md reach the model in the first message of an
// Agent page chat, and never in the bubble.
test.skip(process.env.E2E_ENV !== 'mock', 'mock tier is mock-only');

const USER_KEY = 'web-agent-vfs:shared:f:/USER.md';
const MEMORY_KEY = 'web-agent-vfs:home:f:/MEMORY.md';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ userKey, memoryKey }) => {
    const file = (content: string) => JSON.stringify({ content, encoding: 'utf8', mimeType: 'text/markdown', mtimeMs: 1 });
    localStorage.setItem(userKey, file('Name: Alex. Prefers short answers.'));
    localStorage.setItem(memoryKey, file('The user likes cats.'));
    window.__USER_TEXTS__ = [];
    window.__WA_MOCK_SCRIPT__ = (opts: any) => {
      const lastMsg = opts.messages[opts.messages.length - 1];
      let text = '';
      if (typeof lastMsg?.content === 'string') text = lastMsg.content;
      else if (Array.isArray(lastMsg?.content)) {
        text = lastMsg.content
          .filter((p: any) => p && p.type === 'text' && typeof p.text === 'string')
          .map((p: any) => p.text)
          .join('\n');
      }
      if (text.includes('Summarize the following conversation as a short UI title')) return { text: 'Title' };
      if (lastMsg?.role === 'user') window.__USER_TEXTS__!.push(text);
      return { text: 'Mock reply.' };
    };
  }, { userKey: USER_KEY, memoryKey: MEMORY_KEY });
});

const USER_BLOCK = '<memory path="/home/shared/USER.md">\nName: Alex. Prefers short answers.\n</memory>';
const MEMORY_BLOCK = '<memory path="/home/agent/MEMORY.md">\nThe user likes cats.\n</memory>';

test('Agent page: the first message carries both memory blocks, the second carries neither', async ({ page }) => {
  await page.goto('#/agent');
  await expect(page.locator('agent-chat-panel #input')).toBeVisible({ timeout: 15_000 });
  await sendChat(page, 'hello');
  await expect(page.locator('agent-message-view .assistant .content').last()).toContainText('Mock reply.', { timeout: 10_000 });
  await sendChat(page, 'again');
  await expect.poll(() => page.evaluate(() => window.__USER_TEXTS__!.length), { timeout: 10_000 }).toBe(2);
  const texts = await page.evaluate(() => window.__USER_TEXTS__!);
  expect(texts[0]).toContain(USER_BLOCK);
  expect(texts[0]).toContain(MEMORY_BLOCK);
  expect(texts[0].indexOf(USER_BLOCK)).toBeLessThan(texts[0].indexOf(MEMORY_BLOCK));
  expect(texts[0]).toContain('hello');
  expect(texts[1]).not.toContain('<memory');
  // The transcript shows only what the user typed.
  await expect(page.locator('agent-message-view .user .content').first()).not.toContainText('<memory');
});

test('bubble: the first message carries no memory block', async ({ page }) => {
  await openPanel(page);
  await sendChat(page, 'hello');
  await expect.poll(() => page.evaluate(() => window.__USER_TEXTS__!.length), { timeout: 10_000 }).toBe(1);
  const texts = await page.evaluate(() => window.__USER_TEXTS__!);
  expect(texts[0]).not.toContain('<memory');
  expect(texts[0]).toContain('hello');
});
