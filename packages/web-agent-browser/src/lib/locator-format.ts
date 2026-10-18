// 127/002 — the text lines page_generate_locator, stop_recording and the
// Watch me composer print for one LocatorSet. No DOM: the side panel imports it.
import type { LocatorSet } from "./types";

/** What an absent form prints. */
const NONE = "—";

/** The plan's locator lines for `set`, each indented by two spaces. */
export function locatorLines(set: LocatorSet): string[] {
  const lines = [
    `role+name: ${set.role} "${set.name}" (matches ${set.roleMatches})`,
    `id: ${set.id ?? NONE}`,
    `data-testid: ${set.testId ?? NONE}`,
    `name: ${set.nameAttr ?? NONE}`,
  ];
  // A shadow chain replaces the css and xpath lines.
  if (set.shadow === undefined) lines.push(`css: ${set.css ?? NONE}`, `xpath: ${set.xpath ?? NONE}`);
  if (set.frames !== undefined && set.frames.length > 0) lines.push(`frames: ${set.frames.join(" >> ")}`);
  if (set.shadow !== undefined) lines.push(`shadow: ${set.shadow.join(" >> ")}`);
  return lines.map((l) => `  ${l}`);
}

/** The locator lines for one recorded step: its set plus the frame chain the
 *  panel added. Empty for a step without an element. */
export function stepLocatorLines(step: { locators?: LocatorSet; frames?: string[] }): string[] {
  if (step.locators === undefined) return [];
  const set = step.frames !== undefined && step.frames.length > 0 ? { ...step.locators, frames: step.frames } : step.locators;
  return locatorLines(set);
}
