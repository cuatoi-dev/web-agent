import { test, expect } from './fixtures';
import { openBubble, sendChat, waitForAssistantReply, installMockScript, shot } from './helpers';
import { docsProseReplyScript, docsMarkdownListScript } from '../src/e2e-mock/mock-scripts';

test.describe.configure({ mode: 'serial' });

// No shared beforeEach: each test installs its own mock script, and
// addInitScript must be registered before openBubble navigates.

test('chat: relevant docs reply', async ({ page }) => {
  test.setTimeout(180_000);
  const modelCalls = await installMockScript(page, docsProseReplyScript);
  await openBubble(page);
  await sendChat(page, 'What is Web Agent and what can it do?');
  const reply = await waitForAssistantReply(page);
  // Deterministic: a substantive, non-empty assistant reply was produced.
  expect(reply.length).toBeGreaterThan(20);
  expect(modelCalls()).toBe(0);
  await shot(page, 'docs-func-01-chat.png');
});

test('summarize current page', async ({ page }) => {
  test.setTimeout(180_000);
  const modelCalls = await installMockScript(page, docsProseReplyScript);
  await openBubble(page);
  await sendChat(page, 'Summarize the page I am currently on.');
  const reply = await waitForAssistantReply(page);
  // Deterministic: a substantive summary reply (the page is rich, the
  // summary should exceed a low bar of substantive content).
  expect(reply.length).toBeGreaterThan(20);
  expect(modelCalls()).toBe(0);
  await shot(page, 'docs-func-02-summarize.png');
});

test('markdown / UI-block rendering', async ({ page }) => {
  test.setTimeout(180_000);
  const modelCalls = await installMockScript(page, docsMarkdownListScript);
  await openBubble(page);
  await sendChat(page, 'List the main docs sections as a bulleted list.');
  await waitForAssistantReply(page);
  const listCount = await page.locator(
    '.message-container.assistant li, ' +
    '.message-container.assistant ul, ' +
    '.message-container.assistant .blocks-container *'
  ).count();
  const reply = await page.evaluate(() => {
    const vs = [...((document.querySelector('docs-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelectorAll('agent-message-view') ?? [])].filter(v =>
      v.querySelector('.message-container.assistant')
    );
    if (vs.length === 0) return '';
    return (vs[vs.length - 1].querySelector('.content') as HTMLElement)?.textContent ?? '';
  });
  const hasList = listCount > 0;
  const hasKeywords = /registry|architecture|embedding|theming|tools|troubleshooting/i.test(reply);
  expect(hasList || hasKeywords).toBe(true);
  expect(modelCalls()).toBe(0);
  await shot(page, 'docs-func-04-markdown.png');
});
