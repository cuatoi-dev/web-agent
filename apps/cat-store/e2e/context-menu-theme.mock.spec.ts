import path from "path";
import { test, expect } from "./fixtures";
import { listThemes } from "@cuatoi/web-agent-lit/themes";

test.use({ viewport: { width: 1024, height: 768 } });

// Task-file stem — see AGENTS.md artifact hygiene rules.
const ARTIFACTS_DIR = path.resolve(
  __dirname,
  "../../../temp/artifacts/2026-08-10-195636-004-fix-context-menu-theme",
);

/** WCAG 2.x contrast, computed in the page from painted colours. Reads the
 *  md-menu surface out of the component's shadow DOM (`.items`) and each
 *  md-menu-item's painted label colour (`md-item` inside its shadow root). */
const MENU_PROBE = `(() => {
  const parse = (s) => s.match(/[\\d.]+/g).slice(0, 3).map(Number);
  const lum = (rgb) => {
    const c = rgb.map((v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  // gallery.html?frame=choose-model mounts agent-chat-panel directly into
  // document.body (gallery.ts renderFrameMode) — no <web-agent-bubble> here.
  const menu = document.querySelector("agent-chat-panel md-menu");
  if (!menu) return null;
  const items = menu.shadowRoot.querySelector(".items");
  const surface = getComputedStyle(items).backgroundColor;
  const bg = lum(parse(surface));
  const rows = Array.from(menu.querySelectorAll("md-menu-item")).map((mi) => {
    const label = mi.shadowRoot.querySelector("md-item");
    const ring = mi.shadowRoot.querySelector("md-focus-ring");
    const color = getComputedStyle(label).color;
    const ringColor = getComputedStyle(ring).color;
    const opacity = parseFloat(getComputedStyle(mi).opacity);
    return {
      text: mi.textContent.trim(),
      disabled: mi.hasAttribute("disabled"),
      color,
      opacity,
      ratio: ratio(lum(parse(color)), bg),
      ringRatio: ratio(lum(parse(ringColor)), bg),
    };
  });
  return { surface, rows };
})()`;

interface MenuProbeResult {
  surface: string;
  rows: { text: string; color: string; ratio: number; ringRatio: number; disabled: boolean; opacity: number }[];
}

for (const theme of listThemes().map(({ id }) => id)) {
  test(`kebab menu follows the theme — ${theme}`, async ({ page }) => {
    test.skip(
      process.env.E2E_ENV !== "mock" && process.env.E2E_ENV !== "local",
      "gallery.html is a dev page — not on the public tier",
    );

    await page.goto(`gallery.html?frame=choose-model&theme=${theme}`, {
      waitUntil: "networkidle",
      timeout: 30_000,
    });
    await page.locator("agent-chat-panel md-menu md-menu-item").first().waitFor();

    const result = await page.evaluate<MenuProbeResult>(MENU_PROBE);
    expect(result).not.toBeNull();
    console.log(`[004] ${theme} surface=${result.surface}`);
    for (const row of result.rows) {
      console.log(`[004] ${theme} "${row.text}" ${row.color} ratio=${row.ratio.toFixed(2)} disabled=${row.disabled} opacity=${row.opacity}`);
    }

    // 1. The surface follows the theme, not Material's light default.
    expect(result.surface).not.toBe("rgb(243, 237, 247)");
    // 2. Every item, enabled or disabled, meets AA against that surface.
    for (const row of result.rows) {
      expect(row.ratio, `"${row.text}" in ${theme}`).toBeGreaterThanOrEqual(4.5);
      expect(row.ringRatio, `focus ring for "${row.text}" in ${theme}`).toBeGreaterThanOrEqual(3);
    }
    // 3. The disabled group header is not dimmed away.
    const header = result.rows.find((r) => r.disabled);
    expect(header, `no disabled header in ${theme}`).toBeTruthy();
    expect(header!.text).toContain("Choose model");
    expect(header!.opacity).toBe(1);
    // 4. The check mark is a glyph, so the selected model reads without colour.
    expect(result.rows.some((r) => r.text.includes("✓"))).toBe(true);

    await page.screenshot({ path: path.join(ARTIFACTS_DIR, `01-menu-${theme}.png`) });
  });

  test(`outlined Speed button meets contrast floors — ${theme}`, async ({ page }) => {
    test.skip(
      process.env.E2E_ENV !== "mock" && process.env.E2E_ENV !== "local",
      "gallery.html is a dev page — not on the public tier",
    );

    await page.goto(`gallery.html?frame=config&theme=${theme}`, { waitUntil: "networkidle" });
    await page.locator("agent-chat-panel md-outlined-button").waitFor();
    const ratios = await page.evaluate(() => {
      const button = document.querySelector("agent-chat-panel md-outlined-button")!;
      const section = button.closest(".wa-config-section")!;
      const shadow = button.shadowRoot!;
      const parse = (value: string) => value.match(/[\d.]+/g)!.slice(0, 3).map(Number);
      const luminance = (value: string) => {
        const [r, g, b] = parse(value).map((channel) => {
          const v = channel / 255;
          return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const background = luminance(getComputedStyle(section).backgroundColor);
      const ratio = (selector: string, property: "color" | "borderColor") => {
        const node = shadow.querySelector(selector)!;
        const foreground = luminance(getComputedStyle(node)[property]);
        return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
      };
      return {
        label: ratio(".label", "color"),
        outline: ratio(".outline", "borderColor"),
        ring: ratio("md-focus-ring", "color"),
      };
    });
    expect(ratios.label, `Speed label in ${theme}`).toBeGreaterThanOrEqual(4.5);
    expect(ratios.outline, `Speed outline in ${theme}`).toBeGreaterThanOrEqual(3);
    expect(ratios.ring, `Speed focus ring in ${theme}`).toBeGreaterThanOrEqual(3);
  });
}
