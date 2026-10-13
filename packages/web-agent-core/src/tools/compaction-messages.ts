// 108/001 — one home for the compaction verdict type and every string the
// compaction paths render. The tool (builders.ts) and the /compact command
// (controller-queue.ts) both read NOTHING_TO_COMPACT from here, so the two paths
// cannot drift into different wording for the same state — which is exactly
// how the honesty bug got in.
//
// The type itself is declared in `../tool-hooks.types.ts`, next to the
// `ToolContext` seam that returns it, and re-exported here through
// `./types.ts` so the verdict and its strings share one import.

export type { CompactionRequestOutcome } from "./types.js";

/** No eligible turns. Read by BOTH the tool and the /compact command's
 *  `unavailableMessage`. Change it here or not at all. */
export const NOTHING_TO_COMPACT = "There is nothing to compact yet.";

/** No controller owns this ToolContext, so there is nothing to ask. */
export const COMPACTION_NOT_AVAILABLE = "Compaction is not available here.";

/** First unconfirmed call. Deliberately NOT an error: asking is correct
 *  behaviour, and flagging it as a failure teaches the model otherwise. It
 *  names both permitted authorities — the user or a skill. */
export const NEEDS_CONFIRMATION =
  "Did the user or a skill ask you to compact? If yes, call this tool again " +
  "with confirmation set to true. If this was your own idea, do not compact " +
  "— carry on with the task.";

/** Second unconfirmed call in the same turn. An error, because by now the
 *  question has been asked and ignored. */
export const UNCONFIRMED_REPEAT =
  "You have already been asked to confirm. If nobody requested compaction, " +
  "stop calling this tool and continue with the task.";

/** A second confirmed call in a turn that already has one queued. */
export const ALREADY_REQUESTED =
  "You already requested compaction in this turn. Do not call this tool " +
  "again; tell the user it runs when the turn ends.";

/** A compaction is running right now. */
export const COMPACTION_IN_PROGRESS = "A compaction is already running.";

/** The accepted-request message, assembled from three parts so the follow-up
 *  sentence appears only when a follow-up was actually recorded. */
export const REQUESTED_BASE = "Compaction requested; it runs when this turn ends.";
export const REQUESTED_FOLLOW_UP = " Your follow-up then runs with the compacted context.";
export const REQUESTED_TAIL = " Do not call this tool again in this turn.";
