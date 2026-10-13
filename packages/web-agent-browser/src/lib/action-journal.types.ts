// 124/004 — the action journal and export_test shapes. Imports nothing,
// mirroring verify-locator-tools.types.ts; re-exported from types.ts.

/** What an entry came from: an action, a PASS check, or page_emulate. */
export type JournalKind = "action" | "check" | "emulate" | "emulate-reset";

/** The device a page_emulate entry set. `preset` is absent for custom values. */
export interface JournalEmulation {
  preset?: string;
  width: number;
  height: number;
  scale: number;
  mobile: boolean;
  touch: boolean;
}

export interface JournalEntry {
  id: number;
  kind: JournalKind;
  text: string;
  code: string[];
  password: boolean;
  emulation?: JournalEmulation;
  /** 131/003 — the `<iframe>` selectors from the top page down to the element
   *  this entry acted on, top-down. Absent for a top-frame step. The `code`
   *  lines already carry the matching `page.frameLocator(...)` prefix. */
  frames?: string[];
}

export type NewJournalEntry = Omit<JournalEntry, "id">;

/** One journal per chat session of one agent panel, in memory. */
export interface ActionJournal {
  /** Appends in order and returns the new ids (1, 2, … per chat). */
  append(entries: NewJournalEntry[]): number[];
  /** The current chat's entries, oldest first. */
  entries(): JournalEntry[];
}

/** What the MAIN world reports about the element an action or PASS check
 *  targets, read before the action runs. `locator` is the Playwright locator
 *  without `page.` (for example `getByRole('button', { name: 'Apply' })`), and
 *  is absent when the locator builder found none. `label` is the text after
 *  "no stable locator for " in the not-journaled suffix. */
export interface JournalTarget {
  role: string;
  name: string;
  label: string;
  locator?: string;
  isPassword: boolean;
}

export interface JournalToolsOptions {
  /** Overridable for tests only. createPanelPageTools makes one per call. */
  journal?: ActionJournal;
  /** The panel's active chat session id. A new value empties the journal. */
  activeSessionId?: () => string;
}

export type ExportKeyword = "given" | "when" | "and" | "then";

export interface ExportStep {
  text: string;
  keyword?: ExportKeyword;
  journal?: number[];
}

export interface ExportCase {
  id: string;
  title: string;
  steps: ExportStep[];
}

export interface ExportTestInput {
  format: "playwright" | "bdd";
  suite: string;
  url?: string;
  cases: ExportCase[];
}

export type ExportTestResult = { ok: true; text: string } | { ok: false; error: string };
