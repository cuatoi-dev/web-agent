import { openProviderGrid } from "./lib/provider-grid-dialog";
import { brandForThisContext } from "./lib/brand-source";
import { renderSkills } from "./lib/saved-skills";
import { mountTabs } from "./lib/options-tabs";
import { chromeSkillStorage } from "./lib/skill-registry";
import { readAgentStore, chromeAgentStorage, listAgents } from "./lib/agent-store";
import { mountAgentEditor } from "./lib/agent-editor";
import { getSettings, setSettings } from "./lib/settings";
import { resolveModels } from "./lib/brand-models";
import { registerBrandThemes, applyTheme, listThemes, type ThemeBinding } from "./lib/theme";
import {
  brandDefaultKey,
  brandProviderId,
  deleteModels,
  listModels,
  readModelStore,
  saveCustomProvider,
  setBrandKey,
  setDefault,
  setEnabled,
  writeModelStore,
} from "./lib/model-store";
import { deleteButtonText, modelCountText, renderModelTable } from "./lib/model-table";
import { openBrandKeyDialog } from "./lib/brand-key-dialog";
import { openProviderDialog } from "./lib/provider-dialog";
import { openModelDeleteDialog } from "./lib/model-delete-dialog";
import { deleteDialogMessage, deleteDialogTitle } from "./lib/provider-form-rules";
import type { AgentBrand, CustomProvider, ModelRef, ModelStore } from "./lib/types";

const tabModels = document.getElementById("tab-btn-models") as HTMLButtonElement;
const tabSkills = document.getElementById("tab-btn-skills") as HTMLButtonElement;
const tabAgents = document.getElementById("tab-btn-agents") as HTMLButtonElement;
const panelModels = document.getElementById("tab-models") as HTMLElement;
const panelSkills = document.getElementById("tab-skills") as HTMLElement;
const panelAgents = document.getElementById("tab-agents") as HTMLElement;
const agentCards = document.getElementById("agent-cards") as HTMLDivElement;
const modelTable = document.getElementById("model-table") as HTMLTableElement;
const modelCount = document.getElementById("model-count") as HTMLParagraphElement;
const modelToolbarActions = document.getElementById("model-toolbar-actions") as HTMLDivElement;
const addModelBtn = document.getElementById("add-model-btn") as HTMLButtonElement;
const deleteModelsBtn = document.getElementById("delete-models-btn") as HTMLButtonElement;
const modelTableHint = document.getElementById("model-table-hint") as HTMLParagraphElement;
const theme = document.getElementById("theme") as HTMLSelectElement;
const save = document.getElementById("save") as HTMLButtonElement;
const status = document.getElementById("status") as HTMLParagraphElement;
const skillList = document.getElementById("skill-list") as HTMLDivElement;
const addAgentBtn = document.getElementById("add-agent-btn") as HTMLButtonElement;

function report(message: string, isError: boolean): void {
  status.textContent = message;
  status.classList.toggle("error", isError);
}

// Re-applies the chosen theme to the whole page. The select is populated in
// init(); a user cannot change it before then.
theme.addEventListener("change", () => {
  applyPageTheme(theme.value);
});

/** The options page owns its own --wa-* tokens, so the visited-site rule in
 *  `applyTheme` must not read the tokens this page applied and strip them
 *  again. The dark query is the real one. */
function pageThemeEnv() {
  return {
    siteSuppliesTokens: () => false,
    darkQuery: () => window.matchMedia("(prefers-color-scheme: dark)"),
  };
}

/** Holds the live binding so switching away from "auto" drops its media-query
 *  listener instead of letting it overwrite the new fixed choice later. */
let themeBinding: ThemeBinding | null = null;

function applyPageTheme(pref: string): void {
  themeBinding?.dispose();
  themeBinding = applyTheme(document.documentElement, pref, pageThemeEnv());
}

let currentBrand: AgentBrand | null = null;
let currentModelStore: ModelStore | null = null;
let selectedRefs = new Set<ModelRef>();

function syncDeleteButton(): void {
  const n = selectedRefs.size;
  deleteModelsBtn.textContent = deleteButtonText(n);
  deleteModelsBtn.disabled = n === 0;
}

/** Paints the model table and the count line from `store`. Every switch,
 *  radio, Key save, provider save and delete writes the store at once and
 *  repaints (136/005, 136/006). */
function paintModels(brand: AgentBrand, store: ModelStore): void {
  currentBrand = brand;
  currentModelStore = store;
  const locked = brand.options.lockModel === true;
  modelToolbarActions.hidden = locked;
  const entries = listModels(brand, store);
  const validCustomRefs = new Set(entries.filter((e) => e.kind === "custom").map((e) => e.ref));
  selectedRefs = new Set([...selectedRefs].filter((r) => validCustomRefs.has(r)));
  syncDeleteButton();
  modelCount.textContent = modelCountText(entries);
  renderModelTable(modelTable, entries, store, {
    lockModel: locked,
    selected: selectedRefs,
    onSelectionChange: (next) => {
      selectedRefs = next;
      syncDeleteButton();
    },
    onToggle: (ref, on) => {
      const result = setEnabled(entries, store, ref, on);
      if (!result.ok) {
        modelTableHint.textContent = result.hint;
        modelTableHint.hidden = false;
        paintModels(brand, store); // puts the switch back on
        return;
      }
      modelTableHint.hidden = true;
      void commitModels(brand, result.store);
    },
    onDefault: (ref) => {
      modelTableHint.hidden = true;
      void commitModels(brand, setDefault(entries, store, ref));
    },
    onKey: (provider) => {
      void openBrandKeyDialog({
        name: provider.name,
        wireFormat: provider.wireFormat,
        endpoint: provider.endpoint,
        // 137/001 — only the user's own key; `provider.apiKey` may be the
        // brand's default key, which must not be shown or saved as the user's.
        current: store.brandKeys[provider.id] ?? "",
        hasBrandKey: brandDefaultKey(
          resolveModels(brand).filter((e) => brandProviderId(e) === provider.id),
        ) !== "",
      }).then((value) => {
        if (value === null) return;
        void commitModels(brand, setBrandKey(store, provider.id, value));
      });
    },
    onEdit: (providerId) => {
      const existing = store.providers.find((p) => p.id === providerId);
      if (!existing) return;
      void openProviderDialog({ provider: existing }).then((saved) => {
        if (!saved) return;
        modelTableHint.hidden = true;
        void commitModels(brand, saveCustomProvider(brand, store, saved));
      });
    },
  });
}

async function commitModels(brand: AgentBrand, next: ModelStore): Promise<void> {
  await writeModelStore(next);
  paintModels(brand, next);
}

addModelBtn.addEventListener("click", () => {
  if (!currentBrand || !currentModelStore) return;
  const brand = currentBrand;
  const store = currentModelStore;
  void openAddProvider(brand).then((saved) => {
    if (!saved) return;
    modelTableHint.hidden = true;
    void commitModels(brand, saveCustomProvider(brand, store, saved));
  });
});

/** "+ Add model": the provider grid when the brand turns it on, else the
 *  custom form directly. */
async function openAddProvider(brand: AgentBrand): Promise<CustomProvider | null> {
  if (brand.options.builtInProviders !== true) return openProviderDialog();
  const choice = await openProviderGrid();
  if (choice === null) return null;
  return choice === "custom" ? openProviderDialog() : openProviderDialog({ builtIn: choice.builtIn });
}

deleteModelsBtn.addEventListener("click", () => {
  if (!currentBrand || !currentModelStore || selectedRefs.size === 0) return;
  const brand = currentBrand;
  const store = currentModelStore;
  const picked = new Set(selectedRefs);
  const result = deleteModels(brand, store, picked);
  if (!result.ok) {
    modelTableHint.textContent = result.hint;
    modelTableHint.hidden = false;
    return;
  }
  const entries = listModels(brand, store);
  const title = deleteDialogTitle(picked.size);
  const msg = deleteDialogMessage(entries, store, picked);
  void openModelDeleteDialog(title, msg).then((confirmed) => {
    if (!confirmed) return;
    modelTableHint.hidden = true;
    selectedRefs.clear();
    void commitModels(brand, result.store);
  });
});

/** Fills the theme picker, the theme and the model table.
 *
 *  ORDER MATTERS for the e2e ready wait (e2e/extension.fixture.ts
 *  optionsReady): `#model-count` is painted LAST, in the same synchronous
 *  block as the theme value, so "the count line has text" means
 *  the whole tab is ready. Do not add an `await` inside that block. */
async function init(): Promise<void> {
  const brand = await brandForThisContext();
  registerBrandThemes(brand.themes, { linkCss: true });

  // The theme list is the built-ins plus the brand's own themes, in
  // registration order. Rebuilt here so a brand theme is offered by label.
  theme.innerHTML = "";
  const autoOption = document.createElement("option");
  autoOption.value = "auto";
  autoOption.textContent = "Auto (follow system)";
  theme.append(autoOption);
  for (const t of listThemes()) {
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.label;
    theme.append(opt);
  }

  const [s, store] = await Promise.all([getSettings(), readModelStore()]);
  // --- no await below this line ---
  theme.value = s.theme;
  applyPageTheme(s.theme);
  paintModels(brand, store);
}

void init();

// The skills list paints from its own storage read, independently of the
// settings above: a slow or failing settings read must not leave the section
// blank, and neither read depends on the other.
mountTabs([tabModels, tabSkills, tabAgents], [panelModels, panelSkills, panelAgents]);

void (async () => {
  const [brand, store, modelStore] = await Promise.all([
    brandForThisContext(),
    readAgentStore(chromeAgentStorage),
    readModelStore(),
  ]);
  const mergedAgents = listAgents(brand, store.edits, store.users);
  await renderSkills(skillList, chromeSkillStorage, mergedAgents);
  await mountAgentEditor({
    container: agentCards,
    brand,
    storage: chromeAgentStorage,
    addButton: addAgentBtn,
    modelStore,
    // Not awaited: an open side panel holds a connection, and the delete
    // stays pending until it closes (121/004 design).
    deleteDatabase: (name) => {
      indexedDB.deleteDatabase(name);
    },
    // The removed private skills must not linger on the Skills tab.
    onAgentDeleted: async () => {
      const fresh = await readAgentStore(chromeAgentStorage);
      await renderSkills(skillList, chromeSkillStorage, listAgents(brand, fresh.edits, fresh.users));
    },
  });
})();

// 136/005 — Save keeps Theme only (137/001 removed Token). The model table saves itself;
// there is no endpoint here any more, so no host permission is asked for.
save.addEventListener("click", () => {
  void (async () => {
    await setSettings({ theme: theme.value });
    report("Saved. Reload a page to use the new settings.", false);
  })();
});
