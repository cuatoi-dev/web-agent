import path from "path";
import { type Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import { chooseTheme, openPanel, sendChat } from "./helpers";
import { listThemes } from "@cuatoi/web-agent-lit/themes";

test.use({ viewport: { width: 1024, height: 768 } });

// Task-file stem, not a bare order number — see AGENTS.md artifact hygiene rules.
const ARTIFACTS_DIR = path.resolve(
  __dirname,
  "../../../temp/artifacts/2026-08-10-000415-017-fix-working-dots-indicator",
);

/**
 * 003410-005: `.message-container.assistant`'s only child is now the
 * `<wa-working-dots>` tag, not the bare `<div>` directly — the fade-in
 * animation and the bouncing spans still live on ITS own inner `<div>`
 * (both registries: default registry class="wa-working-dots"; cat-store
 * override: no class, styled entirely inline), one level down, so the
 * selector reaches through the tag to keep matching the animated element.
 */
const DOTS_SELECTOR =
  "agent-chat-panel .messages-list > .message-row.assistant .message-container.assistant > wa-working-dots > div";

/** WCAG 2.x relative luminance + contrast ratio, run inside the page. Reads the
 *  first working-dots span's painted `background-color` against
 *  `.messages-list`'s — the transcript surface both registries render onto. */
const CONTRAST_PROBE = `(() => {
  const parse = (s) => s.match(/[\\d.]+/g).slice(0, 3).map(Number);
  const lum = (rgb) => {
    const c = rgb.map((v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  // 003: the "live turn" group opens the real bubble (agent-chat-panel lives
  // in its OPEN shadow root); the "gallery — cat-store override" group uses
  // gallery.html?frame=..., which mounts agent-chat-panel in a plain <div> on
  // document.body with no bubble at all. Fall back to document when there is
  // no bubble, so this one probe works in both.
  const root = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot ?? document;
  const dot = root.querySelector(
    "agent-chat-panel .messages-list > .message-row.assistant span"
  );
  if (!dot) return null;
  const fg = lum(parse(getComputedStyle(dot).backgroundColor));
  const bg = lum(parse(getComputedStyle(
    root.querySelector("agent-chat-panel .messages-list")
  ).backgroundColor));
  const ratio = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
  return { ratio, dotColor: getComputedStyle(dot).backgroundColor };
})()`;

type ContrastResult = { ratio: number; dotColor: string };

async function runContrastProbe(page: Page): Promise<ContrastResult | null> {
  return page.evaluate<ContrastResult | null>(CONTRAST_PROBE);
}

/** Sets the mock response as a real object via Playwright's argument bridge —
 *  no `.toString()`-on-a-closure involved, so no outer-scope capture to lose. */
async function setMockResponse(page: Page, response: unknown) {
  await page.addInitScript((r) => {
    (window as unknown as { __WA_MOCK_SCRIPT__: unknown }).__WA_MOCK_SCRIPT__ = r;
  }, response);
}

async function toggleTheme(page: Page) {
  const current = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
  await chooseTheme(page, current === "wa2-light" ? "wa2-dark" : "wa2-light");
}

/** Resolves once the workingDots element's own fade-in has completed. */
async function waitForDotsOpaque(page: Page, timeout = 5_000) {
  await page.waitForFunction(
    (sel) => {
      // 003: see CONTRAST_PROBE — fall back to document when there is no
      // bubble (gallery.html?frame=... mounts the panel directly).
      const root = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot ?? document;
      const el = root.querySelector(sel);
      return !!el && parseFloat(getComputedStyle(el).opacity) === 1;
    },
    DOTS_SELECTOR,
    { timeout, polling: 50 },
  );
}

test.describe("live turn — mock tier", () => {
  test.skip(process.env.E2E_ENV !== "mock", "mock tier is mock-only");

  test("dots are visible during a turn, wa2-dark", async ({ page }) => {
    await setMockResponse(page, { text: "ok", finishReason: "stop", delayMs: 5_000 });
    await openPanel(page);
    await sendChat(page, "hello");
    await waitForDotsOpaque(page);

    const result = await runContrastProbe(page);
    expect(result).not.toBeNull();
    expect(result!.ratio).toBeGreaterThanOrEqual(3);
    console.log(`[017] wa2-dark live turn: ratio=${result!.ratio.toFixed(2)} color=${result!.dotColor}`);

    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "01-live-turn-dark.png") });
  });

  test("dots are visible during a turn, wa2-light", async ({ page }) => {
    await setMockResponse(page, { text: "ok", finishReason: "stop", delayMs: 5_000 });
    await openPanel(page);
    await toggleTheme(page);
    await sendChat(page, "hello");
    await waitForDotsOpaque(page);

    const result = await runContrastProbe(page);
    expect(result).not.toBeNull();
    expect(result!.ratio).toBeGreaterThanOrEqual(3);
    console.log(`[017] wa2-light live turn: ratio=${result!.ratio.toFixed(2)} color=${result!.dotColor}`);

    await page.screenshot({ path: path.join(ARTIFACTS_DIR, "01-live-turn-light.png") });
  });

  test("the dots actually animate", async ({ page }) => {
    await setMockResponse(page, { text: "ok", finishReason: "stop", delayMs: 5_000 });
    await openPanel(page);
    await sendChat(page, "hello");
    await waitForDotsOpaque(page);

    // Sample all three dots' transform scale across >1.4s (one full wa-bounce
    // cycle) so every dot is caught at its peak at least once.
    const samples: number[][] = [];
    for (let i = 0; i < 16; i++) {
      const scales = await page.evaluate((sel) => {
        const root = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot ?? document;
        const spans = Array.from(root.querySelectorAll(`${sel} span`));
        return spans.map((s) => {
          const t = getComputedStyle(s).transform;
          if (t === "none") return 1;
          const m = t.match(/matrix\(([^,]+),/); // matrix(scale, 0, 0, scale, tx, ty)
          return m ? parseFloat(m[1]) : 1;
        });
      }, DOTS_SELECTOR);
      samples.push(scales);
      await page.waitForTimeout(100);
    }

    const dotCount = samples[0]?.length ?? 0;
    expect(dotCount).toBe(3);
    const perDotMax = Array.from({ length: dotCount }, (_, i) => Math.max(...samples.map((s) => s[i] ?? 0)));
    console.log(`[017] wa-bounce peak scales: ${perDotMax.map((m) => m.toFixed(2)).join(", ")}`);
    expect(perDotMax.every((m) => m > 0.5)).toBe(true);
  });

  test("the 400ms delay still holds the row back", async ({ page }) => {
    await setMockResponse(page, { text: "ok", finishReason: "stop", delayMs: 5_000 });
    await openPanel(page);
    await sendChat(page, "hello");

    const dots = page.locator(DOTS_SELECTOR);
    await dots.waitFor({ state: "attached", timeout: 3_000 });
    const early = await dots.evaluate((el) => parseFloat(getComputedStyle(el).opacity));
    expect(early).toBeLessThan(1);

    await page.waitForTimeout(800);
    const late = await dots.evaluate((el) => parseFloat(getComputedStyle(el).opacity));
    expect(late).toBe(1);
  });

  test("a fast turn does not flash the indicator", async ({ page }) => {
    await setMockResponse(page, { text: "ok", finishReason: "stop", delayMs: 200 });
    await openPanel(page);
    await sendChat(page, "hello");
    await page.waitForTimeout(700);

    const opacity = await page.evaluate((sel) => {
      const root = (document.querySelector('cat-agent-widget')?.shadowRoot ?? document).querySelector('web-agent-bubble')?.shadowRoot ?? document;
      const el = root.querySelector(sel);
      return el ? parseFloat(getComputedStyle(el).opacity) : null;
    }, DOTS_SELECTOR);
    expect(opacity === null || opacity < 1).toBe(true);
  });
});

test.describe("gallery — cat-store override", () => {
  const FRAMES: Array<{ id: string; screenshotPrefix?: string }> = [
    { id: "working", screenshotPrefix: "02-gallery-working" },
    { id: "working-thinking" },
    { id: "compacting", screenshotPrefix: "03-gallery-compacting" },
  ];

  for (const frame of FRAMES) {
    for (const theme of listThemes().map(({ id }) => id)) {
      test(`${frame.id} — ${theme}`, async ({ page }) => {
        test.skip(
          process.env.E2E_ENV !== "mock" && process.env.E2E_ENV !== "local",
          "gallery.html is a dev page — not on the public tier",
        );

        await page.goto(`gallery.html?frame=${frame.id}&theme=${theme}`, {
          waitUntil: "networkidle",
          timeout: 30_000,
        });
        await waitForDotsOpaque(page);

        const result = await runContrastProbe(page);
        expect(result).not.toBeNull();
        expect(result!.ratio).toBeGreaterThanOrEqual(3);
        console.log(`[017] gallery ${frame.id} ${theme}: ratio=${result!.ratio.toFixed(2)} color=${result!.dotColor}`);

        if (frame.screenshotPrefix) {
          await page.screenshot({ path: path.join(ARTIFACTS_DIR, `${frame.screenshotPrefix}-${theme}.png`) });
        }
      });
    }
  }
});
