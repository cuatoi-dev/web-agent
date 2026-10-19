import type { ListedAgent } from "./agent-store.types";
import type { AgentDraft, AgentEditorDeps, EditForm } from "./agent-editor.types";
import { readAgentStore } from "./agent-store";
import { NEW_AGENT_ID, renderAgents } from "./agent-cards";
import { buildEditForm } from "./agent-edit-form";
import {
  addAgent,
  draftFromAgent,
  emptyDraft,
  makeId,
  resetAgent,
  saveAgent,
  takenIds,
  validateDraft,
} from "./agent-edit-rules";
import { deleteAgent, deleteMessage, ownedSkillCount } from "./agent-delete";
import { openDeleteDialog } from "./agent-delete-dialog";
import type { ModelContext } from "./types";
import { EMPTY_MODEL_STORE, listModels } from "./model-store";
import { modelOptions, skillNames, toolGroups } from "./agent-options";

/** The Agents tab state machine: one card open at a time, the new card
 *  included. Resolves after the first paint. */
export async function mountAgentEditor(deps: AgentEditorDeps): Promise<void> {
  const { container, brand, storage, addButton, deleteDatabase, onAgentDeleted } = deps;
  // 136/005 — the model list as the options page has it now. A model turned
  // on or off on the Models tab shows here after the page is reopened.
  const modelStore = deps.modelStore ?? EMPTY_MODEL_STORE;
  const models: ModelContext = { entries: listModels(brand, modelStore), store: modelStore };
  const lists = { tools: toolGroups(brand), skills: skillNames(brand), models: modelOptions(models.entries) };
  let store = await readAgentStore(storage);
  let editingId: string | null = null;
  let draft: AgentDraft | null = null;
  let form: EditForm | null = null;

  const paint = (): void => {
    renderAgents(container, brand, store, { editingId, onEdit, editBody }, models);
    // Add agent is disabled while a card is open (task 003).
    addButton.disabled = editingId !== null;
  };

  const closeAndReload = async (): Promise<void> => {
    editingId = null;
    draft = null;
    form = null;
    store = await readAgentStore(storage);
    paint();
  };

  function onEdit(agent: ListedAgent): void {
    if (editingId !== null) return;
    editingId = agent.id;
    draft = draftFromAgent(agent);
    paint();
  }

  function onAdd(): void {
    if (editingId !== null) return;
    editingId = NEW_AGENT_ID;
    draft = emptyDraft();
    paint();
  }

  async function onDelete(agent: ListedAgent): Promise<void> {
    const n = await ownedSkillCount(storage, agent.id);
    const dialog = await openDeleteDialog(deleteMessage(agent.displayName, n));
    if (!dialog.confirmed) return; // the dialog is closed; the card stays in edit mode
    await deleteAgent(storage, agent.id, deleteDatabase);
    dialog.close();
    await closeAndReload();
    await onAgentDeleted();
  }

  function editBody(agent: ListedAgent): HTMLElement {
    // editBody is called only for the card whose id is editingId, after onEdit
    // or onAdd set draft.
    const d = draft as AgentDraft;
    const isNew = agent.id === NEW_AGENT_ID;
    form = buildEditForm(agent, d, brand, lists, {
      onCancel: () => {
        editingId = null; // nothing written; a new card disappears
        draft = null;
        form = null;
        paint();
      },
      onSave: () => {
        const errs = validateDraft(d, agent.origin);
        if (Object.keys(errs).length > 0) {
          form?.showErrors(errs); // keep the card open; write nothing
          return;
        }
        if (isNew) {
          void addAgent(storage, brand, d).then(closeAndReload);
          return;
        }
        void saveAgent(storage, brand, agent, d).then(closeAndReload);
      },
      onReset: () => {
        void resetAgent(storage, agent.id).then(closeAndReload);
      },
      onDelete: agent.origin === "user" && !isNew ? () => void onDelete(agent) : null,
      idHint: isNew ? (name) => makeId(name.trim(), takenIds(brand, store)) : null,
    });
    return form.root;
  }

  addButton.addEventListener("click", onAdd);
  paint();
}
