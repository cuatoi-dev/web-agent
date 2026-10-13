/** The fixed widths of the `<agent-page>` columns and the two pure functions
 *  that keep a dragged right-panel width inside them. Moved out of
 *  `agent-page.ts` unchanged. */

/** Left column — session history. Task 004 fills it. Fixed by the user on
 *  2026-08-12. */
export const AGENT_SESSIONS_COLUMN_WIDTH_PX = 200;
/** Right column — hosts the generative UI frame.
 *  The raw task fixed only "a fixed width"; 320px matches the widest chart card
 *  the charting renderers produce and still leaves the chat column the majority
 *  of a 1280px viewport (760px). Task 005 keeps it as the starting width; the
 *  user can drag it or collapse it from there. */
export const AGENT_RIGHT_PANEL_WIDTH_PX = 320;

/** The right panel never drags below this. */
export const AGENT_RIGHT_PANEL_MIN_WIDTH_PX = 200;
/** The chat column never drags below this. 360px is the width the shipped
 *  bubble box already uses as its minimum (panel-resize.ts:20), where the
 *  message list and the two-row composer are proven to render without
 *  clipping. */
export const AGENT_CHAT_MIN_WIDTH_PX = 360;
/** The divider straddles the boundary: it is absolutely positioned and takes
 *  no layout width, so the chat gives up exactly what the right panel gains. */
export const AGENT_DIVIDER_WIDTH_PX = 12;

/** Keeps a right-panel width inside the agreed bounds. The minimum wins when
 *  the layout is too narrow for it, so the result is never below the minimum.
 *  Shaped after clampPanelSize() in panel-resize.ts:41-48. */
export function clampSideWidth(desired: number, layoutWidth: number): number {
  const max = Math.max(
    AGENT_RIGHT_PANEL_MIN_WIDTH_PX,
    layoutWidth - AGENT_SESSIONS_COLUMN_WIDTH_PX - AGENT_CHAT_MIN_WIDTH_PX,
  );
  return Math.round(Math.min(max, Math.max(AGENT_RIGHT_PANEL_MIN_WIDTH_PX, desired)));
}

/** The divider sits on the panel's LEFT edge, so moving the pointer left (a
 *  negative delta) makes the panel wider. Shaped after resizeFromGrip()
 *  in panel-resize.ts:52-57. */
export function sideWidthFromDrag(
  startWidth: number,
  deltaX: number,
  layoutWidth: number,
): number {
  return clampSideWidth(startWidth - deltaX, layoutWidth);
}
