// The shapes for helper-api.ts and helper-api-actions.ts (131/002) — the
// helper bundle's own functions, called through Runtime.callFunctionOn. Split
// out to satisfy wa/types-in-types-file.
import type { JournalTarget } from "./action-journal.types";

export interface HelperDescribe {
  /** false when the element has left the document — the stale-ref signal. */
  connected: boolean;
  name: string;
  desc: string;
  permission: string;
  reason?: string;
  disabled: boolean;
  /** `disabledRef(...)` or `blockedByPolicy(...)`, already formatted; the panel
   *  returns it as-is. Absent when the action may proceed. */
  refusal?: string;
}

export type SelectPrepareResult =
  | { ok: false; message: string }
  | { ok: true; name: string; target: JournalTarget };
