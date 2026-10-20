import { iconNode } from "@cuatoi/web-agent-lit/ui/icon-svgs";
import {
  BUILT_IN,
  CUSTOM_TILE,
  builtInById,
  builtInDefaultHeaders,
  builtInInitialModels,
  endpointForFormat,
  providerIconNode,
} from "./provider-builtins";
import type { BuiltIn } from "./provider-builtins.types";
import { originPattern } from "./origin";
import { clearRowResults, mountRowTest } from "./model-test";
import type { RowTestContext } from "./model-test.types";
import {
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
  test: RowTestContext,
  initial: ProviderFormModelRow = { model: "", label: "", vision: false },
): void {
  const row = el("div", "form-model-row");
  const idInput = el("input", "form-model-id");
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

  const { button: testBtn, result } = mountRowTest(row, idInput, test);
  row.append(idInput, labelInput, visionLabel, testBtn, removeBtn, result);
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

function replaceModelRows(list: HTMLElement, rows: ProviderFormModelRow[], test: RowTestContext): void {
  list.textContent = "";
  for (const r of rows) appendModelRow(list, test, r);
}

/** Opens the provider modal. Resolves with the saved
 *  `CustomProvider`, or `null` when cancelled. A built-in provider fills in
 *  the endpoint, the format and its known models. */
export function openProviderDialog(opts: ProviderDialogOptions = {}): Promise<CustomProvider | null> {
  return new Promise<CustomProvider | null>((resolve) => {
    const existing = opts.provider;
    const selectable = opts.showProviderSelect === true;
    const startId = existing
      ? existing.builtIn
      : (opts.builtIn ?? (selectable ? BUILT_IN[0].id : undefined));
    let currentDef = builtInById(startId);
    const dialog = el("dialog", "confirm-dialog provider-dialog");
    const title = selectable
      ? existing
        ? (currentDef ? `Edit ${currentDef.name}` : `Edit provider — ${existing.name}`)
        : "Add model"
      : currentDef
        ? `${existing ? "Edit" : "Add"} ${currentDef.name}`
        : existing
          ? `Edit provider — ${existing.name}`
          : "Add custom provider";
    const heading = el("h2", "", title);

    const selectLogo = el("span", "prov-select-logo");
    /** Paints `id`'s logo beside the Provider select and in the title. The
     *  Custom entry, and an absent id, get the generic server icon. */
    const paintLogo = (id: string | undefined): void => {
      heading.querySelector("svg.logo")?.remove();
      heading.prepend(providerIconNode(id));
      selectLogo.replaceChildren(providerIconNode(id));
    };
    if (selectable || currentDef) paintLogo(currentDef?.id);

    const providerWrap = el("div");
    let providerSelect: HTMLSelectElement | null = null;
    if (selectable) {
      const providerLabel = el("label", "", "Provider");
      providerLabel.htmlFor = "provider-select";
      const selectRow = el("div", "prov-select");
      const select = el("select");
      select.id = "provider-select";
      for (const provider of BUILT_IN) {
        const opt = el("option", "", provider.name);
        opt.value = provider.id;
        select.append(opt);
      }
      const customOpt = el("option", "", CUSTOM_TILE.name);
      customOpt.value = CUSTOM_TILE.id;
      select.append(customOpt);
      select.value = currentDef?.id ?? CUSTOM_TILE.id;
      if (existing) select.disabled = true;
      selectRow.append(selectLogo, select);
      providerWrap.append(providerLabel, selectRow);
      providerSelect = select;
    }

    const topGrid = el("div", "form-grid-2");
    const nameWrap = el("div");
    const nameLabel = el("label", "", "Name");
    nameLabel.htmlFor = "provider-name";
    const nameInput = el("input");
    nameInput.id = "provider-name";
    nameInput.type = "text";
    nameInput.placeholder = "Local vLLM";
    nameInput.value = existing?.name ?? currentDef?.name ?? "";
    nameWrap.append(nameLabel, nameInput);

    const formatWrap = el("div");
    const formatLabel = el("label", "", "Format");
    const formatHost = el("div");
    let fixedFormat: WireFormat | null = null;
    let formatButtons: HTMLButtonElement[] = [];
    let currentFormat: WireFormat = existing?.wireFormat ?? currentDef?.formats[0].wireFormat ?? "openai";

    /** Builds the format control for `provider` (`undefined` is Custom): the
     *  segmented control for two formats, fixed text for one, and the free
     *  select for Custom. Called at open and on every Provider change. */
    const paintFormat = (provider: BuiltIn | undefined, format: WireFormat): void => {
      formatHost.textContent = "";
      fixedFormat = null;
      formatButtons = [];
      currentFormat = format;
      if (provider && provider.formats.length === 2) {
        // Two formats: a segmented control in the provider's own order.
        const group = el("div", "format-switch");
        group.setAttribute("role", "group");
        group.setAttribute("aria-label", "Format");
        for (const f of provider.formats) {
          const btn = el("button", "btn format-opt", f.wireFormat);
          btn.type = "button";
          btn.dataset.format = f.wireFormat;
          btn.setAttribute("aria-pressed", String(f.wireFormat === format));
          btn.addEventListener("click", () => setFormat(f.wireFormat));
          group.append(btn);
          formatButtons.push(btn);
        }
        formatLabel.htmlFor = "";
        formatHost.append(group);
      } else if (provider) {
        // One format: shown, not changeable.
        fixedFormat = provider.formats[0].wireFormat;
        currentFormat = fixedFormat;
        formatLabel.htmlFor = "";
        formatHost.append(el("p", "format-fixed", fixedFormat));
      } else {
        // Custom provider: all three formats remain available.
        const select = el("select");
        select.id = "provider-format";
        formatLabel.htmlFor = "provider-format";
        for (const fmt of ["openai", "anthropic", "gemini"] as WireFormat[]) {
          const opt = el("option", "", fmt);
          opt.value = fmt;
          select.append(opt);
        }
        select.value = format;
        select.addEventListener("change", () => setFormat(select.value as WireFormat));
        formatHost.append(select);
      }
    };
    paintFormat(currentDef, currentFormat);
    formatWrap.append(formatLabel, formatHost);
    topGrid.append(nameWrap, formatWrap);

    const endpointLabel = el("label", "", "Endpoint URL");
    endpointLabel.htmlFor = "provider-endpoint";
    const endpointInput = el("input");
    endpointInput.id = "provider-endpoint";
    endpointInput.type = "text";
    endpointInput.placeholder = "http://localhost:8000/v1";
    endpointInput.value = existing?.endpoint ?? (currentDef ? (endpointForFormat(currentDef, currentFormat) ?? "") : "");
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

    const headersHead = el("div", "section-head");
    const headersTitle = el("label", "", "Custom headers");
    const addHeaderBtn = el("button", "btn add-header-btn", "+ Add header");
    addHeaderBtn.type = "button";
    headersHead.append(headersTitle, addHeaderBtn);
    const headersList = el("div", "headers-list");
    for (const h of existing?.headers ?? []) appendHeaderRow(headersList, h);
    if (!existing && currentDef) {
      for (const h of builtInDefaultHeaders(currentDef, [])) appendHeaderRow(headersList, h);
    }
    addHeaderBtn.addEventListener("click", () => appendHeaderRow(headersList));

    /** The unsaved form values a row's Test sends (138/001). Blank header
     *  names are dropped, as Refresh from /models does. */
    const rowTest: RowTestContext = {
      getProvider: () => ({
        id: "",
        kind: "custom",
        name: nameInput.value,
        endpoint: endpointInput.value,
        wireFormat: currentFormat,
        apiKey: keyInput.value,
        headers: readHeaderRows(headersList)
          .map((h) => ({ name: h.name.trim(), value: h.value.trim() }))
          .filter((h) => h.name !== ""),
      }),
      deps: opts,
    };

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
    modelCols.append(el("span", "", "Model ID"), el("span", "", "Display name"), el("span", "", "Vision"), el("span"), el("span"));

    const modelsList = el("div", "models-list");
    const initialModels = existing ? existing.models : currentDef ? builtInInitialModels(currentDef) : [];
    if (initialModels.length > 0) {
      for (const m of initialModels) appendModelRow(modelsList, rowTest, m);
    } else {
      appendModelRow(modelsList, rowTest);
    }
    addModelRowBtn.addEventListener("click", () => appendModelRow(modelsList, rowTest));

    // 138/001 — an edit to the endpoint, the key or any header clears every
    // row's result. A format switch clears them in setFormat.
    const clearResults = (): void => clearRowResults(modelsList);
    endpointInput.addEventListener("input", clearResults);
    keyInput.addEventListener("input", clearResults);
    headersList.addEventListener("input", clearResults);
    headersList.addEventListener("click", (e) => {
      if ((e.target as Element | null)?.closest(".remove-header-btn")) clearResults();
    });
    addHeaderBtn.addEventListener("click", clearResults);

    const modelsErr = el("p", "field-error provider-models-error");
    modelsErr.setAttribute("role", "alert");
    modelsErr.hidden = true;

    /** Applies `providerId`'s preset to Name, Endpoint, Format and the model
     *  rows. The API key and the custom header rows are kept, so what the user
     *  typed survives the switch; the preset's default headers are added. */
    const applyPreset = (providerId: string): void => {
      currentDef = builtInById(providerId);
      const provider = currentDef;
      nameInput.value = provider?.name ?? "";
      const format = provider?.formats[0].wireFormat ?? "openai";
      paintFormat(provider, format);
      endpointInput.value = provider ? (endpointForFormat(provider, format) ?? "") : "";
      endpointErr.hidden = true;
      modelsErr.hidden = true;
      const rows = provider ? builtInInitialModels(provider) : [];
      replaceModelRows(modelsList, rows.length > 0 ? rows : [{ model: "", label: "", vision: false }], rowTest);
      refreshBtn.hidden = currentFormat !== "openai";
      if (provider) {
        for (const h of builtInDefaultHeaders(provider, readHeaderRows(headersList))) {
          appendHeaderRow(headersList, h);
        }
      }
      paintLogo(provider?.id);
    };

    if (providerSelect) {
      const select = providerSelect;
      select.addEventListener("change", () => applyPreset(select.value));
    }

    /** Applies a format choice: endpoint, pressed state and Refresh. */
    const setFormat = (next: WireFormat): void => {
      if (fixedFormat !== null && next !== fixedFormat) return;
      clearResults();
      currentFormat = next;
      for (const b of formatButtons) b.setAttribute("aria-pressed", String(b.dataset.format === next));
      if (currentDef) {
        const ep = endpointForFormat(currentDef, next);
        if (ep !== undefined) endpointInput.value = ep;
      }
      refreshBtn.hidden = next !== "openai";
    };

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
          replaceModelRows(modelsList, applyModelsDiff(readModelRows(modelsList), diff), rowTest);
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
      providerWrap,
      topGrid,
      endpointLabel,
      endpointInput,
      endpointErr,
      keyLabel,
      keyInput,
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
        builtIn: existing?.builtIn ?? currentDef?.id,
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
    if (providerSelect && !providerSelect.disabled) providerSelect.focus();
    else nameInput.focus();
  });
}
