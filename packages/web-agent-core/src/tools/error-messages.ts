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

/** Schema violation — shared wording for both the Zod and Ajv validation branches. */
export function schemaViolation(name: string, msg: string): string {
  return `Invalid input for ${name}: ${msg}.`;
}

/**
 * The model's tool arguments arrived but were not valid JSON, so transport
 * substituted `{}` (`ToolUseBlock.argumentsIssue === "unparsable"`, set by
 * the transport). Worded so the model cannot read it as a schema violation: it never
 * says a property is missing, because the model DID send arguments — it is the
 * JSON that could not be read.
 */
export function argumentsUnparsable(name: string): string {
  return (
    `Could not read the arguments for ${name}: what you sent was not valid ` +
    `JSON, so the tool did not run. This is not a schema problem — no ` +
    `argument was missing. Call ${name} again and send its arguments as ` +
    `valid JSON.`
  );
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

/**
 * A row query arrived for a source wider than the host's threshold with no
 * column selection. The message must let the agent recover WITHOUT asking
 * the user, so it carries five things: which source, how wide it is, what
 * the limit is, the exact shape of the fix with two real column names from
 * this source, and the two tools that find more column names and values.
 */
export function selectRequiredForWideSource(
  source: string,
  columnCount: number,
  threshold: number,
  exampleFields: string[],
): string {
  const example = exampleFields.slice(0, 2).map((f) => `"${f}"`).join(", ");
  return (
    `Source "${source}" has ${columnCount} columns, which is more than the ` +
    `${threshold}-column limit for a query with no column selection, so no rows ` +
    `were returned. Pick the columns you need and pass them in "select", for ` +
    `example { "source": "${source}", "select": [${example}] }. Call ` +
    `get_field_details({ source: "${source}", filter: "<word>" }) to search ` +
    `column names, and sample_field_values({ source: "${source}", ` +
    `field: "<column>" }) to see a column's values. An aggregate query does ` +
    `not need "select".`
  );
}
