import type { ModelMessage } from "../types.js";
import type { JournalEntry } from "./types.js";

/** Marks the message that carries a compaction summary. `assembleContext`
 *  writes it; `validateWorkingContext` reads it to allow the one legal
 *  user→user pair at the head of a rebuilt context. */
export const SUMMARY_PREFIX = "[conversation summary]";

/** Index of the last tombstone in `entries`, or -1 when none exists.
 *  -1 means "never compacted", which means NO trimming at all. */
export function lastTombstoneIndex(entries: JournalEntry[]): number {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].meta.tombstone) return i;
  }
  return -1;
}

/** 107/004: the ordinal of the user turn about to run — the number of user
 *  turns already in the journal, plus the one being appended now.
 *
 *  A turn starts at the `appendUser` entry, the only entry with
 *  `stepNo === 0`. A tombstone is also a `role: "user"` entry, so it is
 *  excluded explicitly; it is not a turn.
 */
export function currentUserTurn(journal: JournalEntry[]): number {
  let n = 1;
  for (const e of journal) {
    if (e.msg.role === "user" && e.meta.stepNo === 0 && !e.meta.tombstone) n++;
  }
  return n;
}

export function convertToMessages(entries: JournalEntry[]): ModelMessage[] {
  // 107/002: a tombstone carries no message of its own. The summary is
  // emitted by assembleContext at the tombstone's position; an older
  // tombstone that falls inside the kept window is simply dropped.
  return entries.filter((e) => !e.meta.tombstone).map((e) => e.msg);
}

/**
 * Index of the user message that starts the `n`-th turn before `index`, or 0
 * when fewer than `n` turns exist — in which case every earlier turn is kept.
 *
 * A turn starts at an `appendUser` entry, which is the only entry with
 * `stepNo === 0`. Tool results carry `role: "tool"` on this transport and
 * assistant/tool steps always have `stepNo >= 1`, so the cut can never land
 * between a `tool-call` and its matching `tool-result`.
 */
export function startOfNthTurnBefore(entries: JournalEntry[], index: number, n: number): number {
  let count = 0;
  for (let i = index - 1; i >= 0; i--) {
    const e = entries[i];
    const isTurnStart = e.msg.role === "user" && e.meta.stepNo === 0 && !e.meta.tombstone;
    if (isTurnStart) {
      count++;
      if (count === n) return i;
    }
  }
  return 0;
}

/**
 * 107/002: the whole of context assembly.
 *
 * NO TOMBSTONE MEANS NO TRIMMING. A conversation that never crossed 75% keeps
 * every turn, however many there are. The 2-turn window is a POST-COMPACTION
 * FLOOR, not a running cap.
 *
 * With a tombstone: the summary, then the 2 turns immediately before the
 * tombstone, then everything after it. The summary is its own message at the
 * head — never prefixed into the first user message. It is `role: "user"`
 * because Anthropic has no system role for input messages, and the resulting
 * user→user pair at the head is legal: consecutive same-role turns are
 * combined (verified against the live endpoint, 2026-09-04).
 */
export function assembleContext(entries: JournalEntry[]): ModelMessage[] {
  const t = lastTombstoneIndex(entries);
  if (t === -1) return convertToMessages(entries);

  const summary = entries[t].meta.tombstone!.summary;
  const keptStart = startOfNthTurnBefore(entries, t, 2);

  return [
    { role: "user", content: `${SUMMARY_PREFIX}\n${summary}` },
    ...convertToMessages(entries.slice(keptStart, t)),
    ...convertToMessages(entries.slice(t + 1)),
  ];
}
