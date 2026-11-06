// The shapes for the agent card editor (agent-edit-rules.ts,
// agent-edit-form.ts, agent-editor.ts, and the view hook in agent-cards.ts).

import type { AgentBrand, ModelStore } from "./types";
import type { AgentStorage, ListedAgent } from "./agent-store.types";
import type { MultiSelectGroup, MultiSelectValue } from "./multi-select.types";

export interface AgentDraft {
  displayName: string;
  description: string;
  instructions: string;
  /** A ModelRef; null = "Use the options page model". */
  model: string | null;
  tools: MultiSelectValue;
  excludeTools: string[];
  skills: MultiSelectValue;
  excludeSkills: string[];
}

/** The fields validation can report on, in form order. */
export type AgentDraftField = "displayName" | "description" | "instructions" | "skills" | "tools";

export type AgentDraftErrors = Partial<Record<AgentDraftField, string>>;

/** One option of the agent editor's Model select (136/005). */
export interface AgentModelOption {
  value: string;
  text: string;
}

export interface AgentEditLists {
  tools: MultiSelectGroup[];
  skills: MultiSelectGroup[];
  /** The enabled models, as "label — provider". */
  models: AgentModelOption[];
}

export interface EditFormHandlers {
  onCancel(): void;
  onSave(): void;
  onReset(): void;
  /** 121/004 — non-null only for a saved user agent; shows Delete agent. */
  onDelete: (() => void) | null;
  /** 121/004 — non-null only for the new card; returns the id the hint shows
   *  for the display name typed so far. */
  idHint: ((displayName: string) => string) | null;
}

export interface EditForm {
  root: HTMLElement;
  showErrors(errors: AgentDraftErrors): void;
}

/** Passed to renderAgents to switch a card into edit mode and wire per-card switches. */
export interface CardView {
  editingId: string | null;
  onEdit(agent: ListedAgent): void;
  /** Called once, for the card whose id is editingId. */
  editBody(agent: ListedAgent): HTMLElement;
  /** 104/003 — current user switches (`settings.memoryEnabled`). */
  memoryEnabled?: Record<string, boolean>;
  /** 104/003 — called when the user flips an agent's Memory switch. */
  onMemoryToggle?: (agentId: string, on: boolean) => void;
}

export interface AgentEditorDeps {
  container: HTMLElement;
  /** The brand as brand.json holds it — never the merged brand. */
  brand: AgentBrand;
  storage: AgentStorage;
  /** `#add-agent-btn`. Enabled while no card is open. */
  addButton: HTMLButtonElement;
  /** `indexedDB.deleteDatabase` in the page; a fake in unit tests. Not awaited. */
  deleteDatabase: (name: string) => void;
  /** Called after a delete has been written and the cards repainted, so the
   *  options page can repaint the Skills tab list. */
  onAgentDeleted: () => Promise<void>;
  /** 136/005 — the stored model store, read by the options page. Absent in
   *  unit tests that do not care; the empty store is used then. */
  modelStore?: ModelStore;
  /** 104/003 — initial `settings.memoryEnabled` map. Defaults to `{}`. */
  memoryEnabled?: Record<string, boolean>;
  /** 104/003 — persists `settings.memoryEnabled[agentId]`. */
  onMemoryToggle?: (agentId: string, on: boolean) => void;
}

/** The open Delete agent dialog, as `openDeleteDialog` resolves it. */
export interface DeleteDialogResult {
  /** true = the user selected Delete agent; false = Cancel or Escape. */
  confirmed: boolean;
  /** Closes and removes the dialog. Safe to call more than once. On Cancel
   *  and Escape it has already been called. */
  close(): void;
}
