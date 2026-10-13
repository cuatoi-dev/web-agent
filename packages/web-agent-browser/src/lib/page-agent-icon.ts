import { iconNode } from "@cuatoi/web-agent-lit/ui/icon-svgs";
import type { ToggleView } from "./types";

/** The icon button's tooltip and accessible name: today's button label and
 *  status line as one string (120/003). `status` already ends with a full stop
 *  and `label` does not (panel-toggle.ts:39-70). */
export function pageAgentIconText(view: ToggleView): string {
  return `${view.label}. ${view.status}`;
}

/** Puts the `ads_click` glyph and the "on" dot into the empty button. The glyph
 *  is taken from the lit registry's icon set
 *  (packages/web-agent-lit/src/ui/icon-svgs.ts, ICON_SVGS.ads_click) rather than a copied path.
 *  Both are decorative: `aria-label` and `aria-pressed` carry the state. */
export function mountPageAgentIcon(button: HTMLButtonElement): void {
  const svg = iconNode("ads_click");
  if (svg && svg.tagName.toLowerCase() === "svg") {
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    button.appendChild(svg);
  }
  const dot = document.createElement("span");
  dot.className = "dot";
  dot.setAttribute("aria-hidden", "true");
  dot.hidden = true;
  button.appendChild(dot);
}

/** Writes one tab state onto the icon button: tooltip, accessible name,
 *  pressed, disabled, and the non-colour cue — the `off` class draws the slash
 *  and a pressed button shows the dot (120/003). */
export function paintPageAgentIcon(button: HTMLButtonElement, view: ToggleView): void {
  const text = pageAgentIconText(view);
  button.setAttribute("aria-label", text);
  button.title = text;
  button.setAttribute("aria-pressed", String(view.pressed));
  button.disabled = view.disabled;
  button.classList.toggle("on", view.pressed);
  button.classList.toggle("off", !view.pressed);
  const dot = button.querySelector<HTMLElement>(".dot");
  if (dot) dot.hidden = !view.pressed;
}
