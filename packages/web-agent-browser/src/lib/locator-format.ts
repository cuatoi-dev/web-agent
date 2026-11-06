// 127/002 — the text lines page_generate_locator, stop_recording and the
// Watch me composer print for one LocatorSet. No DOM: the side panel imports it.
import type { LocatorSet } from "./types";

/** What an absent form prints. */
const NONE = "—";

/** The plan's locator lines for `set`, each indented by two spaces. */
export function locatorLines(set: LocatorSet): string[] {
  const roleName =
    set.role === "" || set.name === ""
      ? `role+name: ${NONE}`
      : `role+name: ${set.role} "${set.name}" (matches ${set.roleMatches})`;
  const lines = [
    roleName,
    `id: ${set.id ?? NONE}`,
    `data-testid: ${set.testId ?? NONE}`,
    `name: ${set.nameAttr ?? NONE}`,
  ];
  // A role-less element is found by its text, so the line sits right after
  // role+name, before the id forms.
  if (set.text !== undefined) lines.splice(1, 0, `text: "${set.text}" (matches ${set.textMatches ?? 0})`);
  // A shadow chain replaces the css and xpath lines.
  if (set.shadow === undefined) lines.push(`css: ${set.css ?? NONE}`, `xpath: ${set.xpath ?? NONE}`);
  if (set.frames !== undefined && set.frames.length > 0) lines.push(`frames: ${set.frames.join(" >> ")}`);
  if (set.shadow !== undefined) lines.push(`shadow: ${set.shadow.join(" >> ")}`);
  return lines.map((l) => `  ${l}`);
}

function withFrames(set: LocatorSet, frames?: string[]): LocatorSet {
  return frames !== undefined && frames.length > 0 ? { ...set, frames } : set;
}

/** The locator lines for one recorded step: its set plus the frame chain the
 *  panel added, for a `drag` step its `dropLocators` after `  drop target:`, and
 *  for a closed-root click the position to click the host at.
 *  Empty for a step without an element. */
export function stepLocatorLines(step: {
  locators?: LocatorSet;
  dropLocators?: LocatorSet;
  frames?: string[];
  closedShadow?: { offsetX: number; offsetY: number };
}): string[] {
  const out = step.locators === undefined ? [] : locatorLines(withFrames(step.locators, step.frames));
  if (step.dropLocators !== undefined) {
    out.push("  drop target:", ...locatorLines(withFrames(step.dropLocators, step.frames)));
  }
  if (step.closedShadow !== undefined) {
    out.push(`  closed shadow root: click the host at position (${step.closedShadow.offsetX}, ${step.closedShadow.offsetY})`);
  }
  return out;
}
