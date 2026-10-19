import { iconNode } from "@cuatoi/web-agent-lit/ui/icon-svgs";
import {
  builtInById,
  builtInInitialModels,
  endpointForFormat,
  providerIconNode,
} from "./provider-builtins";
import { originPattern } from "./origin";
import {
  API_KEY_HINT,
  applyModelsDiff,
  buildCustomProvider,
  PERMISSION_DENIED_ERROR,
  validateProviderDraft,
} from "./provider-form-rules";
import { runRefreshFromModels } from "./refresh-models-dialog";
import type {
  CustomProvider,
  HeaderPair,
  ProviderDialogOptions,
  ProviderFormDraft,
  ProviderFormModelRow,
  WireFormat,
} from "./types";

function showDialog(dialog: HTMLDialogElement): void {
  if (typeof dialog.showModal === "function") {
    dialog.showModal();
  } else {
    dialog.setAttribute("open", "");
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function appendHeaderRow(list: HTMLElement, initial: HeaderPair = { name: "", value: "" }): void {
  const row = el("div", "header-row");
  const nameInput = el("input", "header-name");
  nameInput.type = "text";
  nameInput.placeholder = "Header name (e.g. X-Organization)";
  nameInput.value = initial.name;
  nameInput.setAttribute("aria-label", "Header name");

  const valueInput = el("input", "header-value");
  valueInput.type = "text";
  valueInput.placeholder = "Value";
  valueInput.value = initial.value;
  valueInput.setAttribute("aria-label", "Header value");

  const removeBtn = el("button", "btn remove-header-btn", "×");
  removeBtn.type = "button";
  removeBtn.setAttribute("aria-label", "Remove header");
  removeBtn.addEventListener("click", () => row.remove());

  row.append(nameInput, valueInput, removeBtn);
  list.append(row);
}

function appendModelRow(
  list: HTMLElement,
  initial: ProviderFormModelRow = { model: "", label: "", vision: false },
): void {
  const row = el("div", "form-model-row");
  const idInput = el("input", "mid form-model-id");
  idInput.type = "text";
  idInput.placeholder = "model-id";
  idInput.value = initial.model;
  idInput.setAttribute("aria-label", "Model ID");

  const labelInput = el("input", "form-model-label");
  labelInput.type = "text";
  labelInput.placeholder = "Display name";
  labelInput.value = initial.label;
  labelInput.setAttribute("aria-label", "Display name");

  const visionLabel = el("label", "vision-check");
  const visionInput = el("input", "form-model-vision");
  visionInput.type = "checkbox";
  visionInput.checked = initial.vision;
  visionInput.setAttribute("aria-label", "Vision");
  visionLabel.append(visionInput, document.createTextNode("Vision"));

  const removeBtn = el("button", "btn remove-model-btn", "×");
  removeBtn.type = "button";
  removeBtn.setAttribute("aria-label", "Remove model");
  removeBtn.addEventListener("click", () => row.remove());

  row.append(idInput, labelInput, visionLabel, removeBtn);
  list.append(row);
}

function readHeaderRows(list: HTMLElement): HeaderPair[] {
  return Array.from(list.querySelectorAll<HTMLElement>(".header-row")).map((row) => ({
    name: row.querySelector<HTMLInputElement>(".header-name")?.value ?? "",
    value: row.querySelector<HTMLInputElement>(".header-value")?.value ?? "",
  }));
}

function readModelRows(list: HTMLElement): ProviderFormModelRow[] {
  return Array.from(list.querySelectorAll<HTMLElement>(".form-model-row")).map((row) => ({
    model: row.querySelector<HTMLInputElement>(".form-model-id")?.value ?? "",
    label: row.querySelector<HTMLInputElement>(".form-model-label")?.value ?? "",
    vision: row.querySelector<HTMLInputElement>(".form-model-vision")?.checked === true,
  }));
}

function replaceModelRows(list: HTMLElement, rows: ProviderFormModelRow[]): void {
  list.textContent = "";
  for (const r of rows) appendModelRow(list, r);
}

/** Opens the provider modal. Resolves with the saved
 *  `CustomProvider`, or `null` when cancelled. A built-in provider fills in
 *  the endpoint, the format and its known models. */
export function openProviderDialog(opts: ProviderDialogOptions = {}): Promise<CustomProvider | null> {
  return new Promise<CustomProvider | null>((resolve) => {
    const existing = opts.provider;
    const def = builtInById(existing?.builtIn ?? opts.builtIn);
    const preset = existing ? undefined : def;
    const dialog = el("dialog", "confirm-dialog provider-dialog");
    const heading = el(
      "h2",
      "",
      def
        ? `${existing ? "Edit" : "Add"} ${def.name}`
        : existing
          ? `Edit provider — ${existing.name}`
          : "Add custom provider",
    );
    if (def) heading.prepend(providerIconNode(def.id));

    const topGrid = el("div", "form-grid-2");
    const nameWrap = el("div");
    const nameLabel = el("label", "", "Name");
    nameLabel.htmlFor = "provider-name";
    const nameInput = el("input");
    nameInput.id = "provider-name";
    nameInput.type = "text";
    nameInput.placeholder = "Local vLLM";
    nameInput.value = existing?.name ?? preset?.name ?? "";
    nameWrap.append(nameLabel, nameInput);

    const formatWrap = el("div");
    const formatLabel = el("label", "", "Format");
    let formatSelect: HTMLSelectElement | null = null;
    let fixedFormat: WireFormat | null = null;
    const formatButtons: HTMLButtonElement[] = [];
    let currentFormat: WireFormat = existing?.wireFormat ?? def?.formats[0].wireFormat ?? "openai";

    if (def && def.formats.length === 2) {
      // Two formats: a segmented control in the provider's own order.
      const group = el("div", "format-switch");
      group.setAttribute("role", "group");
      group.setAttribute("aria-label", "Format");
      for (const f of def.formats) {
        const btn = el("button", "btn format-opt", f.wireFormat);
        btn.type = "button";
        btn.dataset.format = f.wireFormat;
        btn.setAttribute("aria-pressed", String(f.wireFormat === currentFormat));
        btn.addEventListener("click", () => setFormat(f.wireFormat));
        group.append(btn);
        formatButtons.push(btn);
      }
      formatWrap.append(formatLabel, group);
    } else if (def) {
      // One format: shown, not changeable.
      fixedFormat = def.formats[0].wireFormat;
      currentFormat = fixedFormat;
      formatWrap.append(formatLabel, el("p", "format-fixed", fixedFormat));
    } else {
      // Custom provider: all three formats remain available.
      formatSelect = el("select");
      formatSelect.id = "provider-format";
      formatLabel.htmlFor = "provider-format";
      for (const fmt of ["openai", "anthropic", "gemini"] as WireFormat[]) {
        const opt = el("option", "", fmt);
        opt.value = fmt;
        formatSelect.append(opt);
      }
      formatSelect.value = currentFormat;
      formatWrap.append(formatLabel, formatSelect);
    }
    topGrid.append(nameWrap, formatWrap);

    const endpointLabel = el("label", "", "Endpoint URL");
    endpointLabel.htmlFor = "provider-endpoint";
    const endpointInput = el("input");
    endpointInput.id = "provider-endpoint";
    endpointInput.type = "text";
    endpointInput.placeholder = "http://localhost:8000/v1";
    endpointInput.value = existing?.endpoint ?? (def ? (endpointForFormat(def, currentFormat) ?? "") : "");
    const endpointErr = el("p", "field-error provider-endpoint-error");
    endpointErr.setAttribute("role", "alert");
    endpointErr.hidden = true;

    const keyLabel = el("label", "", "API key");
    keyLabel.htmlFor = "provider-api-key";
    const keyInput = el("input");
    keyInput.id = "provider-api-key";
    keyInput.type = "password";
    keyInput.autocomplete = "off";
    keyInput.placeholder = "Optional for local endpoints";
    keyInput.value = existing?.apiKey ?? "";
    const keyHintEl = el("p", "hint", API_KEY_HINT);

    const headersHead = el("div", "section-head");
    const headersTitle = el("label", "", "Custom headers");
    const addHeaderBtn = el("button", "btn add-header-btn", "+ Add header");
    addHeaderBtn.type = "button";
    headersHead.append(headersTitle, addHeaderBtn);
    const headersList = el("div", "headers-list");
    for (const h of existing?.headers ?? []) appendHeaderRow(headersList, h);
    addHeaderBtn.addEventListener("click", () => appendHeaderRow(headersList));

    const modelsHead = el("div", "section-head");
    const modelsTitle = el("label", "", "Models");
    const modelsActions = el("div", "row");
    const refreshBtn = el("button", "btn refresh-models-btn");
    refreshBtn.type = "button";
    const refreshSvg = iconNode("refresh");
    refreshSvg.classList.add("logo");
    refreshSvg.setAttribute("aria-hidden", "true");
    refreshBtn.append(refreshSvg, document.createTextNode("Refresh from /models"));
    refreshBtn.hidden = currentFormat !== "openai";

    const addModelRowBtn = el("button", "btn add-model-row-btn", "+ Add model");
    addModelRowBtn.type = "button";
    modelsActions.append(refreshBtn, addModelRowBtn);
    modelsHead.append(modelsTitle, modelsActions);

    const modelCols = el("div", "form-model-cols");
    modelCols.append(el("span", "", "Model ID"), el("span", "", "Display name"), el("span", "", "Vision"), el("span"));

    const modelsList = el("div", "models-list");
    const initialModels = existing ? existing.models : preset ? builtInInitialModels(preset) : [];
    if (initialModels.length > 0) {
      for (const m of initialModels) appendModelRow(modelsList, m);
    } else {
      appendModelRow(modelsList);
    }
    addModelRowBtn.addEventListener("click", () => appendModelRow(modelsList));

    const modelsErr = el("p", "field-error provider-models-error");
    modelsErr.setAttribute("role", "alert");
    modelsErr.hidden = true;

    /** Applies a format choice: endpoint, pressed state and Refresh. */
    const setFormat = (next: WireFormat): void => {
      if (fixedFormat !== null && next !== fixedFormat) return;
      currentFormat = next;
      for (const b of formatButtons) b.setAttribute("aria-pressed", String(b.dataset.format === next));
      if (def) {
        const ep = endpointForFormat(def, next);
        if (ep !== undefined) endpointInput.value = ep;
      }
      refreshBtn.hidden = next !== "openai";
    };

    if (formatSelect) {
      const select = formatSelect;
      select.addEventListener("change", () => setFormat(select.value as WireFormat));
    }

    refreshBtn.addEventListener("click", () => {
      void (async () => {
        const diff = await runRefreshFromModels(
          {
            endpoint: endpointInput.value,
            apiKey: keyInput.value,
            headers: readHeaderRows(headersList),
            rows: readModelRows(modelsList),
          },
          opts,
        );
        if (diff) {
          replaceModelRows(modelsList, applyModelsDiff(readModelRows(modelsList), diff));
        }
      })();
    });

    const actions = el("div", "actions dialog-actions");
    const cancelBtn = el("button", "btn cancel-btn", "Cancel");
    cancelBtn.type = "button";
    const saveBtn = el("button", "btn primary save-provider-btn", "Save");
    saveBtn.type = "button";
    actions.append(cancelBtn, saveBtn);

    dialog.append(
      heading,
      topGrid,
      endpointLabel,
      endpointInput,
      endpointErr,
      keyLabel,
      keyInput,
      keyHintEl,
      headersHead,
      headersList,
      modelsHead,
      modelCols,
      modelsList,
      modelsErr,
      actions,
    );
    document.body.append(dialog);

    let settled = false;
    const finish = (result: CustomProvider | null): void => {
      if (settled) return;
      settled = true;
      if (typeof dialog.close === "function" && dialog.open) dialog.close();
      dialog.remove();
      resolve(result);
    };

    saveBtn.addEventListener("click", () => {
      const draft: ProviderFormDraft = {
        id: existing?.id,
        builtIn: existing?.builtIn ?? def?.id,
        name: nameInput.value,
        wireFormat: currentFormat,
        endpoint: endpointInput.value,
        apiKey: keyInput.value,
        headers: readHeaderRows(headersList),
        models: readModelRows(modelsList),
      };
      const errors = validateProviderDraft(draft);
      endpointErr.textContent = errors.endpoint ?? "";
      endpointErr.hidden = !errors.endpoint;
      modelsErr.textContent = errors.models ?? "";
      modelsErr.hidden = !errors.models;
      if (errors.endpoint || errors.models) return;

      const origin = originPattern(draft.endpoint);
      if (!origin) {
        endpointErr.textContent = "Enter an endpoint URL that starts with http:// or https://.";
        endpointErr.hidden = false;
        return;
      }
      const requestPerm =
        opts.requestPermission ?? ((o: string) => chrome.permissions.request({ origins: [o] }));
      // Called synchronously inside the click handler before awaiting.
      const permPromise = requestPerm(origin);
      void (async () => {
        const granted = await permPromise;
        if (!granted) {
          endpointErr.textContent = PERMISSION_DENIED_ERROR;
          endpointErr.hidden = false;
          return;
        }
        finish(buildCustomProvider(draft, opts.newId));
      })();
    });

    cancelBtn.addEventListener("click", () => finish(null));
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      finish(null);
    });
    dialog.addEventListener("close", () => finish(null));

    showDialog(dialog);
    nameInput.focus();
  });
}
