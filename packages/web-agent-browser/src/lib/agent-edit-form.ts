import type { AgentBrand } from "./types";
import type { ListedAgent } from "./agent-store.types";
import type {
  AgentDraft,
  AgentDraftErrors,
  AgentDraftField,
  AgentEditLists,
  EditForm,
  EditFormHandlers,
} from "./agent-editor.types";
import type { MultiSelect } from "./multi-select.types";
import { mountMultiSelect } from "./multi-select";

export const FIELD_ORDER: AgentDraftField[] = ["displayName", "description", "instructions", "skills", "tools"];
export const MODEL_DEFAULT_LABEL = "Use the options page model";
export const MODEL_HINT = "\"Use the options page model\" follows the Models tab.";
export const EXCLUDE_SKILLS_HINT = "Used only when All skills (*) is selected.";
export const EXCLUDE_TOOLS_HINT = "Used only when All tools (*) is selected.";
export const DELETE_AGENT_LABEL = "Delete agent";

function div(className: string): HTMLDivElement {
  const d = document.createElement("div");
  d.className = className;
  return d;
}

function hint(text: string): HTMLParagraphElement {
  const p = document.createElement("p");
  p.className = "hint";
  p.textContent = text;
  return p;
}

function button(text: string, className: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = className;
  b.textContent = text;
  return b;
}

/** The edit body for one card. Every input writes straight into `draft`. */
export function buildEditForm(
  agent: ListedAgent,
  draft: AgentDraft,
  brand: AgentBrand,
  lists: AgentEditLists,
  h: EditFormHandlers,
): EditForm {
  const p = `edit-${agent.id}`;
  const root = div("edit-body");
  const errorEls: Partial<Record<AgentDraftField, HTMLParagraphElement>> = {};
  const controls: Partial<Record<AgentDraftField, HTMLElement>> = {};

  const errorP = (field: AgentDraftField): HTMLParagraphElement => {
    const e = document.createElement("p");
    e.className = "field-error";
    e.id = `${p}-${field}-error`;
    e.hidden = true;
    errorEls[field] = e;
    return e;
  };

  const textField = (
    field: "displayName" | "description" | "instructions",
    labelText: string,
    multiline: boolean,
  ): HTMLDivElement => {
    const wrap = div("field");
    const label = document.createElement("label");
    label.htmlFor = `${p}-${field}`;
    label.textContent = labelText;
    const input = multiline ? document.createElement("textarea") : document.createElement("input");
    if (input instanceof HTMLInputElement) {
      input.type = "text";
      input.autocomplete = "off";
    } else {
      input.rows = 8;
    }
    input.id = `${p}-${field}`;
    input.value = draft[field];
    input.setAttribute("aria-describedby", `${p}-${field}-error`);
    input.addEventListener("input", () => {
      draft[field] = input.value;
    });
    controls[field] = input;
    wrap.append(label, input, errorP(field));
    return wrap;
  };

  if (agent.origin === "user") {
    const nameField = textField("displayName", "Display name", false);
    const idHint = h.idHint;
    if (idHint !== null) {
      // The new card previews the id. Built with textContent: the
      // name is typed by the user.
      const hintEl = document.createElement("p");
      hintEl.className = "hint";
      hintEl.id = `${p}-id-hint`;
      const code = document.createElement("code");
      const update = (): void => {
        code.textContent = idHint(draft.displayName);
      };
      hintEl.append("Id: ", code);
      update();
      controls.displayName?.addEventListener("input", update);
      nameField.append(hintEl);
    }
    root.append(nameField);
  }
  root.append(textField("description", "Description", false));
  root.append(textField("instructions", "System instructions", true));

  // Model
  const modelWrap = div("field");
  const modelLabel = document.createElement("label");
  modelLabel.htmlFor = `${p}-model`;
  modelLabel.textContent = "Model";
  const select = document.createElement("select");
  select.id = `${p}-model`;
  const first = document.createElement("option");
  first.value = "";
  first.textContent = MODEL_DEFAULT_LABEL;
  select.append(first);
  // The enabled models, as "label — provider"; values are ModelRefs.
  for (const m of lists.models) {
    const option = document.createElement("option");
    option.value = m.value;
    option.textContent = m.text;
    select.append(option);
  }
  select.value = draft.model ?? "";
  select.disabled = brand.options.lockModel === true;
  select.addEventListener("change", () => {
    draft.model = select.value === "" ? null : select.value;
  });
  modelWrap.append(modelLabel, select, hint(MODEL_HINT));
  root.append(modelWrap);

  // Skills + Excluded skills. The exclude control is created first because
  // the include's onChange drives it.
  const excludedSkills: MultiSelect = mountMultiSelect({
    id: `${p}-exclude-skills`,
    label: "Excluded skills",
    groups: lists.skills,
    allOption: null,
    value: draft.excludeSkills,
    disabled: draft.skills !== "*",
    filter: false,
    onChange: (v) => {
      draft.excludeSkills = v === "*" ? [] : v;
    },
  });
  const skills = mountMultiSelect({
    id: `${p}-skills`,
    label: "Skills",
    groups: lists.skills,
    allOption: { label: "All skills (*)" },
    value: draft.skills,
    disabled: false,
    filter: false,
    onChange: (v) => {
      draft.skills = v;
      if (v === "*") {
        excludedSkills.setDisabled(false);
      } else {
        draft.excludeSkills = [];
        excludedSkills.setValue([]);
        excludedSkills.setDisabled(true);
      }
    },
  });
  skills.box.setAttribute("aria-describedby", `${p}-skills-error`);
  controls.skills = skills.box;
  skills.root.append(errorP("skills"));
  excludedSkills.root.append(hint(EXCLUDE_SKILLS_HINT));
  root.append(skills.root, excludedSkills.root);

  // Tools + Excluded tools, the same wiring, with the filter.
  const excludedTools: MultiSelect = mountMultiSelect({
    id: `${p}-exclude-tools`,
    label: "Excluded tools",
    groups: lists.tools,
    allOption: null,
    value: draft.excludeTools,
    disabled: draft.tools !== "*",
    filter: true,
    onChange: (v) => {
      draft.excludeTools = v === "*" ? [] : v;
    },
  });
  const tools = mountMultiSelect({
    id: `${p}-tools`,
    label: "Tools",
    groups: lists.tools,
    allOption: { label: "All tools (*)", hint: "includes tools added later" },
    value: draft.tools,
    disabled: false,
    filter: true,
    onChange: (v) => {
      draft.tools = v;
      if (v === "*") {
        excludedTools.setDisabled(false);
      } else {
        draft.excludeTools = [];
        excludedTools.setValue([]);
        excludedTools.setDisabled(true);
      }
    },
  });
  tools.box.setAttribute("aria-describedby", `${p}-tools-error`);
  controls.tools = tools.box;
  tools.root.append(errorP("tools"));
  excludedTools.root.append(hint(EXCLUDE_TOOLS_HINT));
  root.append(tools.root, excludedTools.root);

  // Actions: Reset (brand agents) or Delete agent (saved user agents) on the
  // left, Cancel and Save on the right.
  const actions = div("actions");
  const left = div("row");
  const right = div("row");
  if (agent.origin === "brand") {
    const reset = button("Reset to brand default", "btn link reset-btn");
    reset.addEventListener("click", () => h.onReset());
    left.append(reset);
  }
  const onDelete = h.onDelete;
  if (onDelete !== null) {
    const del = button(DELETE_AGENT_LABEL, "btn danger delete-btn");
    del.addEventListener("click", () => onDelete());
    left.append(del);
  }
  const cancel = button("Cancel", "btn cancel-btn");
  cancel.addEventListener("click", () => h.onCancel());
  const save = button("Save agent", "btn primary save-btn");
  save.addEventListener("click", () => h.onSave());
  right.append(cancel, save);
  actions.append(left, right);
  root.append(actions);

  return {
    root,
    showErrors(errors: AgentDraftErrors): void {
      let first: AgentDraftField | null = null;
      for (const field of FIELD_ORDER) {
        const errEl = errorEls[field];
        const control = controls[field];
        if (errEl === undefined || control === undefined) continue; // no display name on a brand agent
        errEl.removeAttribute("role");
        const message = errors[field];
        if (message === undefined) {
          errEl.hidden = true;
          errEl.textContent = "";
          control.removeAttribute("aria-invalid");
          continue;
        }
        errEl.textContent = message;
        errEl.hidden = false;
        control.setAttribute("aria-invalid", "true");
        if (first === null) {
          first = field;
          errEl.setAttribute("role", "alert");
        }
      }
      if (first !== null) controls[first]?.focus();
    },
  };
}
