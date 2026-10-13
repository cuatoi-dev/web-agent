import { test, expect } from './fixtures';
import {
  openBubble,
  sendChat,
  waitForAssistantReply,
  attachButtonCount,
  imageAttachButtonCount,
  installMockScript,
  shot,
} from './helpers';
import { docsProseReplyScript } from '../src/e2e-mock/mock-scripts';

test.describe.configure({ mode: 'serial' });

// No shared beforeEach: addInitScript must be registered before openBubble
// navigates, so each test installs the mock itself.

test('composer has no attach button', async ({ page }) => {
  await installMockScript(page, docsProseReplyScript);
  await openBubble(page);
  await expect(page.locator('agent-chat-panel .wa-textarea')).toBeVisible();
  // docs-site is non-vision for IMAGES: `imageInput: false` means the image
  // provider is never added. It still has the element picker, which
  // `domTools()` registers unconditionally (web-agent-dom
  // tool-provider.ts:209-211) — the product is correct, the old
  // "zero attachment providers" expectation was stale.
  expect(await imageAttachButtonCount(page)).toBe(0);
  expect(await attachButtonCount(page)).toBe(1);
  await shot(page, 'docs-nonvision-01-no-attach.png');
});

test('paste/drag does not add an image thumbnail', async ({ page }) => {
  await installMockScript(page, docsProseReplyScript);
  await openBubble(page);
  // Dispatch a synthetic paste of a tiny image blob onto the composer input
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ff6600';
    ctx.fillRect(0, 0, 32, 32);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(b => (b ? resolve(b) : reject(new Error('toBlob returned null'))), 'image/png'),
    );
    const file = new File([blob], 'tiny.png', { type: 'image/png' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = (document.querySelector('docs-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot?.querySelector('agent-chat-panel .wa-textarea');
    if (input) {
      input.dispatchEvent(new ClipboardEvent('paste', {
        clipboardData: dt, bubbles: true, cancelable: true,
      }));
    }
  });
  // Brief wait for any async processing
  await page.waitForTimeout(2_000);
  await expect(page.locator('agent-chat-panel .wa-thumb-strip img')).toHaveCount(0);
  await shot(page, 'docs-nonvision-02-no-paste-thumb.png');
});

test('no see tool offered (visual ask handled by text, no 400)', async ({ page }) => {
  test.setTimeout(180_000);
  const modelCalls = await installMockScript(page, docsProseReplyScript);
  await openBubble(page);
  await sendChat(page, 'Use your vision to look at the current page and describe what you see.');
  const reply = await waitForAssistantReply(page, 150_000);
  expect(reply.length).toBeGreaterThan(5);
  // No screenshot image injected in transcript (see tool would embed one)
  await expect(
    page.locator('agent-message-view img.msg-thumbnail, agent-message-view .image-strip img')
  ).toHaveCount(0);
  // No 400 error surfaced to user — reply is non-empty meaningful text
  expect(reply).not.toMatch(/400|error|fail/i);
  expect(modelCalls()).toBe(0);
  await shot(page, 'docs-nonvision-03-see-absent.png');
});
