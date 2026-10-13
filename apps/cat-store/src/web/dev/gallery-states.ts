// gallery-states.ts — framework/DOM-free state definitions for the cat-store
// demo gallery. Owned by apps/cat-store. apps/docs-site keeps its own copy and
// the two are free to drift; there is no shared source any more.
//
// The states themselves live in the sibling `gallery-states-*.ts` modules, in
// the order they appear below, and the blocks they are built from live in
// `gallery-blocks.ts`. This module composes them and keeps the import surface
// other modules already use.

import type { GalleryState } from "./types";
import { BASIC_STATES } from "./gallery-states-basic";
import { CHART_STATES } from "./gallery-states-charts";
import { RICH_OUTPUT_STATES } from "./gallery-states-rich";
import { WORKING_STATES } from "./gallery-states-working";
import { ERROR_STATES } from "./gallery-states-errors";
import { PANEL_STATES } from "./gallery-states-panel";
import { WINDOW_STATES } from "./gallery-states-window";

export type { GalleryStateId, GalleryState } from "./types";

export {
  DEMO_AGENT_AVATAR,
  DEMO_USER_AVATAR,
  DEMO_BRANDED_AVATAR,
  CAT_STORE_LAUNCHER_ICON,
  makeState,
  CHART_BLOCK,
  CANDLESTICK_BLOCK,
  PAYOFF_BLOCK,
  EQUITY_BLOCK,
  DRAWDOWN_BLOCK,
  VOLUME_BLOCK,
  WATERFALL_BLOCK,
  FORM_BLOCK,
  BUTTONS_BLOCK,
} from "./gallery-blocks";

export const GALLERY_STATES: GalleryState[] = [
  ...BASIC_STATES,
  ...CHART_STATES,
  ...RICH_OUTPUT_STATES,
  ...WORKING_STATES,
  ...ERROR_STATES,
  ...PANEL_STATES,
  ...WINDOW_STATES,
];
