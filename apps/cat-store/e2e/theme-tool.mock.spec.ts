import { test, expect } from "@playwright/test";
import { chooseTheme, openPanel, sendChat } from "./helpers";

test.skip(process.env.E2E_ENV !== "mock", "mock tier is mock-only");

/** A mock model that calls one tool, then answers with that tool's real
 *  output, so the spec can read exactly what the tool returned. */
function echoToolScript(name: string, input: Record<string, unknown>): string {
  return `window.__WA_MOCK_SCRIPT__ = function (opts) {
    for (const msg of opts.messages) {
      if (msg.role === "tool" && Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === "tool-result") {
            const out = typeof part.output === "string" ? part.output : JSON.stringify(part.output);
            return { text: "Tool said: " + out, finishReason: "stop" };
          }
        }
      }
    }
    return { toolCalls: [{ id: "call_theme", name: ${JSON.stringify(name)}, input: ${JSON.stringify(input)} }] };
  };`;
}

function htmlTheme(page: import("@playwright/test").Page) {
  return page.evaluate(() => document.documentElement.getAttribute("data-theme"));
}

test("set_theme with a theme id applies it and names the label", async ({ page }) => {
  let apiCallCount = 0;
  await page.route("**/api/anthropic/**", (route) => { apiCallCount++; void route.abort(); });
  await page.addInitScript(echoToolScript("set_theme", { theme: "wa1-dark" }));
  await openPanel(page);
  await sendChat(page, "switch the theme to WA v1 (Dark)");
  await expect.poll(() => htmlTheme(page), { timeout: 10_000 }).toBe("wa1-dark");
  await expect(page.locator("agent-message-view").last())
    .toContainText("Theme set to WA v1 (Dark) (wa1-dark).", { timeout: 10_000 });
  await page.locator("app-root .theme-menu-button").click();
  await expect(page.locator('app-root .theme-menu-item[aria-checked="true"]')).toHaveAttribute("data-theme-id", "wa1-dark");
  expect(apiCallCount).toBe(0);
});

test('set_theme "dark" applies the default dark theme', async ({ page }) => {
  await page.addInitScript(echoToolScript("set_theme", { theme: "dark" }));
  await page.goto("/");
  await chooseTheme(page, "wa2-light");
  await openPanel(page);
  await sendChat(page, "switch to dark theme");
  await expect.poll(() => htmlTheme(page), { timeout: 10_000 }).toBe("wa2-dark");
  await expect(page.locator("agent-message-view").last())
    .toContainText("Theme set to WA v2 (Dark) (wa2-dark).", { timeout: 10_000 });
});

test("set_theme with an unknown theme lists the available ids and changes nothing", async ({ page }) => {
  await page.addInitScript(echoToolScript("set_theme", { theme: "nope" }));
  await openPanel(page);
  await sendChat(page, "set theme to nope");
  await expect(page.locator("agent-message-view").last())
    .toContainText("Unknown theme nope. Available: wa1-dark, wa2-dark, wa2-light.", { timeout: 10_000 });
  expect(await htmlTheme(page)).toBe("wa2-dark");
});

test("get_theme reports the label and id after a menu switch", async ({ page }) => {
  await page.addInitScript(echoToolScript("get_theme", {}));
  await page.goto("/");
  await chooseTheme(page, "wa2-light");
  await openPanel(page);
  await sendChat(page, "what theme is active?");
  await expect(page.locator("agent-message-view").last())
    .toContainText("Current theme: WA v2 (Light) (wa2-light).", { timeout: 10_000 });
});
