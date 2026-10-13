// gallery-demos.ts — the six dev demos folded into the gallery (task 009).
//
// Each entry renders only in `gallery.html?frame=<id>`: `renderFrameMode` in
// gallery.ts strips the catalog scaffold and hands `document.body` to `mount`.
// They are deliberately NOT catalog tiles — blocks-demo renders two rejected
// charts on purpose, and finance-charts.mock.spec.ts:42 asserts the catalog
// page contains zero `.error-card`.
//
// Every colour, spacing and font value moved from the deleted `.html` pages is
// tokenized here, because the web-agent eslint rules scan `.ts` text and did not
// scan those pages.

import "@cuatoi/web-agent-charting/lit";
import type { GalleryState } from "./types";
import { mountCuesDemo } from "./gallery-demos-cues";
import { mountChartDatasourceDemo } from "./gallery-demos-chart";
import { mountThemeShowcaseDemo } from "./gallery-demos-theme";
import { mountBlocksDemo } from "./gallery-demos-blocks";
import { mountSnapshotDemo } from "./gallery-demos-snapshot";
import { mountAgentRunDemo } from "./gallery-demos-agent-run";

// Import host components for demos mounting the full cat-store app
import "../router";
import "../components/app-root";
import "../components/landing-view";
import "../components/store-view";
import "../components/cart-view";
import "../components/toast-host";
import "../components/product-card";
import "@material/web/button/filled-button.js";
import "@material/web/iconbutton/icon-button.js";

export { GalleryBlocksDemoApp } from "./gallery-demos-blocks";

// ============================================================================
// EXPORTED DEMO STATES
// ============================================================================

export const DEMO_STATES: GalleryState[] = [
  {
    id: "demo-cues",
    title: "Cues demo",
    caption: "Deterministic cue lifecycle showcasing the agent cursor on click and fill actions.",
    kind: "demo",
    mount: mountCuesDemo,
  },
  {
    id: "demo-chart-datasource",
    title: "Datasource chart",
    caption: "Live monthly order revenue chart rendered from the orders datasource.",
    kind: "demo",
    mount: mountChartDatasourceDemo,
  },
  {
    id: "demo-theme-showcase",
    title: "Theme showcase",
    caption: "Four-theme comparison grid showing the agent panel in wa1-dark, wa2-dark, wa2-light, and host-provided tokens.",
    kind: "demo",
    mount: mountThemeShowcaseDemo,
  },
  {
    id: "demo-blocks",
    title: "UI blocks renderer",
    caption: "GenUI blocks renderer displaying forms, buttons, and chart rejection specimens.",
    kind: "demo",
    mount: mountBlocksDemo,
  },
  {
    id: "demo-snapshot",
    title: "DomAdapter snapshot",
    caption: "DomAdapter outline snapshot of the cat-store live store page.",
    kind: "demo",
    mount: mountSnapshotDemo,
  },
  {
    id: "demo-agent-run",
    title: "Agent run",
    caption: "Direct createPageAgent runner demonstrating a multi-step task against the live DOM.",
    kind: "demo",
    mount: mountAgentRunDemo,
  },
];
