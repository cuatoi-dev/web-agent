import type { JournalEntry, ToolTtlPolicy } from "./types.js";
import { hashArgs, redactionNote } from "./context-helpers.js";
import { currentUserTurn } from "./context-assembly.js";

/**
 * Expire tool results whose declared lifetime has run out, in place
 * in the journal. Returns how many results it redacted.
 *
 * This replaces P1, which knew `snapshot_page` and `query_state` by name and
 * counted them parameter-blind. Behaviour now comes from the tool definition
 * only: a tool that is not in `defs`, or that declares neither `ttl` nor
 * `uttl`, is never redacted — that is the whole of the "unchanged for tools
 * that say nothing" guarantee.
 *
 * `ttl` and `uttl` are independent tests, not a fallback chain. Whichever
 * expires first wins.
 *
 * The sweep runs between user turns, BEFORE the compaction check, so a
 * session it brings back under the threshold does not compact.
 */
export function redactExpiredResultsInJournal(journal: JournalEntry[], defs: readonly ToolTtlPolicy[]): number {
  const policy = new Map<string, ToolTtlPolicy>();
  for (const d of defs) policy.set(d.name, d);

  // A tool-result part carries no arguments of its own, so identity comes
  // from the matching tool-call. One forward pass builds the lookup.
  const argsByCallId = new Map<string, Record<string, unknown>>();
  for (const entry of journal) {
    if (!Array.isArray(entry.msg.content)) continue;
    for (const part of entry.msg.content) {
      if (part.type === "tool-call") argsByCallId.set(part.toolCallId, part.input);
    }
  }

  const turnNow = currentUserTurn(journal);
  const seen = new Map<string, number>();   // identity -> newer results found
  let redacted = 0;

  // Newest first: that is what makes `ttl` a window. Counting from the newest
  // end means the survivors are always the most recent results per identity.
  for (let i = journal.length - 1; i >= 0; i--) {
    const entry = journal[i];
    if (!Array.isArray(entry.msg.content)) continue;
    let touched = false;

    for (let j = entry.msg.content.length - 1; j >= 0; j--) {
      const part = entry.msg.content[j];
      if (part.type !== "tool-result") continue;
      if (part.redacted) continue;                  // redacting twice is a no-op

      const def = policy.get(part.toolName);
      if (!def) continue;                           // unknown tool: never redacted

      const ttl = def.ttl ?? null;
      const uttl = def.uttl ?? null;
      if (ttl === null && uttl === null) continue;  // declares neither: never redacted

      const identity = `${part.toolName}:${hashArgs(argsByCallId.get(part.toolCallId))}`;
      const newer = seen.get(identity) ?? 0;
      seen.set(identity, newer + 1);

      const age = turnNow - (entry.meta.userTurn ?? turnNow);
      const ttlExpired = ttl !== null && newer >= ttl;
      const uttlExpired = uttl !== null && age > uttl;
      if (!ttlExpired && !uttlExpired) continue;

      part.output = { type: "text", value: redactionNote(part.toolName, age) };
      part.redacted = true;
      redacted++;
      touched = true;
    }

    if (touched) entry.meta.chars = JSON.stringify(entry.msg).length;
  }

  return redacted;
}
