import type { AgentBrand, ModelContext } from "./types";
import type { AgentStore, ListedAgent } from "./agent-store.types";
import { mergedBrand } from "./agent-store";
import { orderAgents } from "./agent-switcher";
import type { CardView } from "./agent-editor.types";
import { EMPTY_MODEL_STORE, listModels, modelForAgent } from "./model-store";

export const BRAND_LOCKED_NOTE = "Display name and id are provided and cannot be changed.";
/** `editingId` while the new card is open. Never a valid agent id:
 *  brand ids match `^[a-z]` (`tool/compile-brand.cjs:344`) and `makeId`
 *  emits only `[a-z0-9-]`. */
export const NEW_AGENT_ID = "_new";
export const NEW_AGENT_TITLE = "New agent";
export const NEW_AGENT_NOTE = "Fill in the fields, then save.";

/** The card's Model fact when the agent's model is off or gone. */
export const MODEL_FELL_BACK_LABEL = "Options page model (its model is off or deleted)";

/** Help copy shown next to the per-agent Memory switch. */
export const MEMORY_HELP_TEXT =
  "Remember things about you and this agent between chats. Saved in this browser.";

/** "All", "All except N" or "N selected" — the same rule for tools and
 *  skills. `exclude` matters only when `list` is `"*"`. */
export function summary(list: "*" | string[], exclude?: string[]): string {
  if (list !== "*") return `${list.length} selected`;
  if ((exclude ?? []).length > 0) return `All except ${(exclude ?? []).length}`;
  return "All";
}

/** The placeholder agent the new card's head is painted from. The form edits
 *  a separate draft (agent-editor.ts); this object is never stored. */
function newAgentPlaceholder(): ListedAgent {
  return {
    id: NEW_AGENT_ID,
    displayName: NEW_AGENT_TITLE,
    description: NEW_AGENT_NOTE,
    instructions: "",
    tools: "*",
    skills: "*",
    origin: "user",
    edited: false,
  };
}

function buildMemoryRow(a: ListedAgent, view: CardView | undefined): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "card-memory";

  const sw = document.createElement("label");
  sw.className = "sw";
  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  toggle.className = "agent-memory-toggle";
  toggle.id = `agent-memory-${a.id}`;
  toggle.setAttribute("role", "switch");
  toggle.setAttribute("aria-describedby", `agent-memory-help-${a.id}`);
  toggle.checked = view?.memoryEnabled?.[a.id] === true;
  toggle.disabled = view !== undefined && view.editingId !== null;
  toggle.addEventListener("change", () => {
    view?.onMemoryToggle?.(a.id, toggle.checked);
  });
  const track = document.createElement("span");
  track.className = "track";
  track.setAttribute("aria-hidden", "true");
  sw.append(toggle, track);

  const text = document.createElement("div");
  text.className = "card-memory-text";
  const label = document.createElement("label");
  label.className = "card-memory-label";
  label.htmlFor = toggle.id;
  label.textContent = "Memory";
  const help = document.createElement("p");
  help.className = "card-memory-help";
  help.id = `agent-memory-help-${a.id}`;
  help.textContent = MEMORY_HELP_TEXT;
  text.append(label, help);

  row.append(sw, text);
  return row;
}

function buildCard(
  a: ListedAgent,
  brand: AgentBrand,
  view: CardView | undefined,
  models: ModelContext,
): HTMLDivElement {
    const card = document.createElement("div");
    card.className = "card";
    card.setAttribute("data-agent-id", a.id);

    const head = document.createElement("div");
    head.className = "card-head";

    const title = document.createElement("div");
    title.className = "card-title";

    const nameRow = document.createElement("div");
    nameRow.className = "n";
    nameRow.textContent = a.displayName;

    if (a.id === brand.defaultAgent) {
      const defPill = document.createElement("span");
      defPill.className = "pill def";
      defPill.textContent = "Default";
      nameRow.append(defPill);
    }

    const originPill = document.createElement("span");
    originPill.className = "pill";
    originPill.textContent = a.origin === "brand" ? "Provided" : "Added by you";
    nameRow.append(originPill);

    if (a.edited) {
      const editedPill = document.createElement("span");
      editedPill.className = "pill";
      editedPill.textContent = "Edited";
      nameRow.append(editedPill);
    }

    const desc = document.createElement("div");
    desc.className = "d";
    desc.textContent = a.description;

    title.append(nameRow, desc);

    const isEditing = view !== undefined && view.editingId === a.id;

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "btn card-edit-btn";
    editBtn.textContent = isEditing ? "Editing" : "Edit";
    editBtn.disabled = view === undefined || view.editingId !== null;
    if (view !== undefined) {
      editBtn.addEventListener("click", () => view.onEdit(a));
    }

    head.append(title, editBtn);

    const facts = document.createElement("div");
    facts.className = "facts";

    const modelFact = document.createElement("span");
    modelFact.textContent = "Model ";
    const modelB = document.createElement("b");
    const choice = modelForAgent(models.entries, models.store, a.model);
    modelB.textContent = !a.model
      ? "Options page model"
      : choice.fellBack ? MODEL_FELL_BACK_LABEL : choice.entry.label;
    modelFact.append(modelB);

    const toolsFact = document.createElement("span");
    toolsFact.textContent = "Tools ";
    const toolsB = document.createElement("b");
    toolsB.textContent = summary(a.tools, a.excludeTools);
    toolsFact.append(toolsB);

    const skillsFact = document.createElement("span");
    skillsFact.textContent = "Skills ";
    const skillsB = document.createElement("b");
    skillsB.textContent = summary(a.skills, a.excludeSkills);
    skillsFact.append(skillsB);

    facts.append(modelFact, toolsFact, skillsFact);
    if (isEditing) {
      card.classList.add("editing");
      if (a.origin === "brand") desc.textContent = BRAND_LOCKED_NOTE;
      card.append(head, view.editBody(a));
    } else {
      if (view !== undefined && view.editingId !== null) card.classList.add("dim");
      card.append(head, facts);
      if (a.memory === true) {
        card.append(buildMemoryRow(a, view));
      }
    }
    return card;
}

/** Paints one collapsed card per merged agent, default agent first then the
 *  rest by display name (`orderAgents`). While the new card is open
 *  (`view.editingId === NEW_AGENT_ID`) it is painted first. Every piece of
 *  agent-supplied text is set with `textContent`, never `innerHTML` — a user
 *  agent's display name, description and instructions are typed by the user. */
export function renderAgents(
  container: HTMLElement,
  brand: AgentBrand,
  store: AgentStore,
  view?: CardView,
  models: ModelContext = { entries: listModels(brand, EMPTY_MODEL_STORE), store: EMPTY_MODEL_STORE },
): void {
  container.textContent = "";
  const merged = mergedBrand(brand, store);
  const agents = orderAgents(merged) as ListedAgent[];
  if (view !== undefined && view.editingId === NEW_AGENT_ID) {
    container.append(buildCard(newAgentPlaceholder(), brand, view, models));
  }
  for (const a of agents) container.append(buildCard(a, brand, view, models));
}
