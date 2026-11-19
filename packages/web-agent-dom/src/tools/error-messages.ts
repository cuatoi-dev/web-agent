// Tool error messages — pure builder functions.
// Every function returns an actionable message string.
// Never build raw stack traces here.

/** Stale ref: generation mismatch. */
export function staleRef(ref: string, gen: number, cur: number): string {
  return `Ref ${ref} is stale (generation ${gen}, current ${cur}). Take a new snapshot.`;
}

/** Element disconnected from DOM. */
export function detachedRef(ref: string): string {
  return `Ref ${ref} no longer exists in the DOM. Take a new snapshot.`;
}

/** Element found but disabled. */
export function disabledRef(ref: string, name: string): string {
  return `Ref ${ref} ("${name}") is disabled. Inspect the form for unmet requirements.`;
}

/** Unknown tool name. */
export function unknownTool(name: string, list: string[]): string {
  return `Unknown tool "${name}". Available: ${list.join(", ")}.`;
}

/** Zod schema violation. */
export function schemaViolation(name: string, msg: string): string {
  return `Invalid input for ${name}: ${msg}.`;
}

/** Wait-for timeout (not an error — normal outcome). */
export function waitTimeout(ms: number, cond: string): string {
  return `Timed out after ${ms}ms waiting for ${cond}. Condition not met.`;
}

/** Invalid JSONPath expression. */
export function invalidJsonPath(reason: string): string {
  return `Invalid JSONPath: ${reason}. Paths must start with $.`;
}

/** Select-option match failure. */
export function selectOptionMissing(opt: string, options: string[]): string {
  const listed = options.slice(0, 20);
  return `No option "${opt}". Available: ${listed.join(", ")}${options.length > 20 ? ` …+${options.length - 20} more` : ""}.`;
}

/** Cross-origin navigation attempt. */
export function navigationBlocked(): string {
  return "Only same-origin paths are allowed.";
}

/** The user pressed Stop before the action was dispatched. */
export function stoppedByUser(ref: string): string {
  return `Stopped by the user before the action on ref ${ref} ran. Nothing was changed on the page.`;
}

/**
 * The scoped screenshot target cannot be photographed at all — either it has no
 * rendered size, or rasterizing it produced no image bytes.
 */
export function elementNotVisible(ref: string, name: string): string {
  const label = name ? ` ("${name}")` : "";
  return `Ref ${ref}${label} is not visible, so there is nothing to capture. Call see without a scope to capture the page, or take a new snapshot and pick a visible element.`;
}

/** The capture succeeded but probably does not show the scoped element. */
export function screenshotMayNotContainElement(ref: string, name: string): string {
  const label = name ? ` ("${name}")` : "";
  return `Warning: ref ${ref}${label} is hidden, so this screenshot may not contain the element. Treat what you see as the surrounding page, not as the element.`;
}

/** Rasterization returned a data URL with no image payload. */
export function emptyScreenshot(): string {
  return `The screenshot came back empty and was discarded, so no image was sent. Call see without a scope to capture the page, or use snapshot to read the page as text.`;
}

/** Warning note appended to an action tool result when the target element is not visible. */
export function invisibleTargetNote(ref: string, name?: string): string {
  const label = name ? ` ("${name}")` : "";
  return `Note: ref ${ref}${label} is not visible on screen.`;
}

/** "block"-tier refusal. Byte-identical to the inline text `interactions.ts`
 *  builds for click/fill/selectOption/selectOptions, exported so the panel
 *  page tools' pre-check in content.ts can reuse it rather than
 *  duplicate the wording. */
export function blockedByPolicy(ref: string, name: string, reason?: string): string {
  const desc = name ? ` "${name}"` : "";
  const extra = reason ? ` (${reason})` : "";
  return `Blocked by interaction policy ("block"): not allowed to operate [${ref}]${desc}${extra}; ask the user to do it themselves.`;
}
