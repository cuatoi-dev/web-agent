// The handler shapes and the `onUserPrompt` payloads. These reference nothing
// from the tool layer, so `attachments/types.ts` can read them without pulling
// `tools/types.ts` in behind them. `hooks/types.ts` re-exports every name here,
// so the import path hosts use is unchanged.
import type { MessagePart } from "../types.js";

/** One hook handler. Awaited inline, with NO timeout. */
export type HookHandler<P, R> = (payload: P) => R | Promise<R>;
/** A single handler, or an array of handlers run in registration order. */
export type HookEntry<P, R> = HookHandler<P, R> | HookHandler<P, R>[];

// --- onUserPrompt ------------------------------------------------------
export interface UserPromptPayload {
  parts: MessagePart[];
  sessionId?: string;
  firstInChat?: boolean;
  displayText?: string;
}
export interface UserPromptResult {
  /** Replacement parts sent to the model. */
  parts?: MessagePart[];
  /** Shown in the transcript instead of the model-facing text. */
  userDisplayText?: string;
  /** Additional turn metadata. Core concatenates attachment chip arrays. */
  meta?: Record<string, unknown>;
}
export interface UserPromptMerged {
  parts: MessagePart[];
  userDisplayText?: string;
  meta?: Record<string, unknown>;
}
