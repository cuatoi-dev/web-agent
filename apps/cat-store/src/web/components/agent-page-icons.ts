import { svg } from "lit";

/** Inline SVG, never an icon font: a missing glyph renders as a tofu box, and
 *  cat-store's font is not guaranteed to carry a chevron. Points RIGHT; the
 *  collapsed state rotates it 180deg in CSS. */
export const CHEVRON_RIGHT_SVG = svg`<path
  d="M9 5 L15 12 L9 19"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
/>`;

export const RENAME_ICON_SVG = svg`<path
  d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
  fill="currentColor"
/>`;

export const DELETE_ICON_SVG = svg`<path
  d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"
  fill="currentColor"
/>`;

export const CONFIG_ICON_SVG = svg`<path
  d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z"
  fill="currentColor"
/>`;

/** Points DOWN; the picker opens upward, so this is the affordance, not a
 *  direction indicator. */
export const CARET_DOWN_SVG = svg`<path
  d="M7 10 L12 15 L17 10"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
/>`;

/** Marks the selected entry by SHAPE, so the selection survives a greyscale
 *  conversion and does not depend on colour alone. */
export const CHECK_SVG = svg`<path
  d="M5 13 L9 17 L19 7"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
/>`;
