import { getTheme } from "@cuatoi/web-agent-lit/themes";

/** The theme the generated-UI frame shows when it has no host theme. */
const FRAME_DEFAULT_THEME_ID = "wa2-dark";

/** The `data-theme` the generated-UI frame gets for the host's `data-theme`.
 *  A custom theme shows its base theme: no custom CSS is sent into the
 *  frame (idea 135, user decision). */
export function frameThemeFor(hostThemeId: string | null): string {
  const t = getTheme(hostThemeId ?? FRAME_DEFAULT_THEME_ID) ?? getTheme(FRAME_DEFAULT_THEME_ID);
  return t?.base ?? t?.id ?? FRAME_DEFAULT_THEME_ID;
}

/** Sets the frame root's theme from the host's. The frame never gets
 *  `data-theme-base` or a theme stylesheet. */
export function syncFrameTheme(frameDoc: Document, hostThemeId: string | null): void {
  const root = frameDoc.documentElement;
  root.setAttribute("data-theme", frameThemeFor(hostThemeId));
  root.removeAttribute("data-theme-base");
}
