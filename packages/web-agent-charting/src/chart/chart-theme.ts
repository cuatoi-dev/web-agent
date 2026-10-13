import Chart from "chart.js";
import type { ChartScaleDefaults } from "./types.js";

/**
 * Resolve a CSS colour expression — which may contain `var()`, `color-mix()`
 * or CSS Color 4 `hsl(<angle>deg …)` — into a canvas-safe `rgb()/rgba()`
 * literal, evaluated in the `[data-theme]` scope `host` lives under.
 *
 * Chart.js paints ticks, gridlines, the legend and the title to a canvas from
 * JS option values, so they cannot inherit a CSS custom property; the value has
 * to be resolved here and handed over concretely. Round-tripping through a
 * probe element (the technique used by the gallery capture spec) is what makes
 * `color-mix(in oklab, …)` — used by both wa2 theme blocks — safe to pass to a
 * canvas.
 */
export function resolveCssColour(host: Element, cssValue: string): string {
  const probe = document.createElement("span");
  probe.style.display = "none";
  probe.style.color = cssValue;
  host.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  // Environments without full CSS support (jsdom) return "" — pass the
  // expression through rather than inventing a literal.
  return resolved || cssValue;
}

/**
 * Write the theme into the Chart.js 2.7.3 global defaults. Must run BEFORE
 * `new Chart(...)`: tick/legend/title colours are read at draw time, but
 * gridline colours are merged into a scale's options when the scale is built.
 */
export function applyChartDefaults(host: Element): void {
  const text = resolveCssColour(host, "var(--wa-text-color, #3c4043)");
  const grid = resolveCssColour(host, "var(--wa-border-color, #e0e0e0)");
  const zeroLine = resolveCssColour(host, "var(--wa-label-color, #666)");
  const family = getComputedStyle(host).getPropertyValue("--wa-font-family").trim();

  const d = Chart.defaults;
  d.global.defaultFontColor = text;
  d.global.defaultFontFamily = family
    ? `${family}, system-ui, sans-serif`
    : `"Public Sans", system-ui, sans-serif`;
  const scale = d.scale as ChartScaleDefaults;
  scale.ticks.fontColor = text;
  scale.gridLines.color = grid;
  scale.gridLines.zeroLineColor = zeroLine;
}
