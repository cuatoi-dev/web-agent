import { brandForThisContext } from "./lib/brand-source";
import { resolveModels } from "./lib/brand-models";
import { originPattern } from "./lib/origin";
import { renderSkills } from "./lib/saved-skills";
import { mountTabs } from "./lib/options-tabs";
import { chromeSkillStorage } from "./lib/skill-registry";
import { readAgentStore, chromeAgentStorage, listAgents } from "./lib/agent-store";
import { mountAgentEditor } from "./lib/agent-editor";
import { getSettings, getToken, setSettings, setToken, type AgentSettings } from "./lib/settings";
import { registerBrandThemes, applyTheme, listThemes, type ThemeBinding } from "./lib/theme";
import type { WireFormat } from "./lib/constants";
import type { PresetEntry } from "./lib/types";

const tabModels = document.getElementById("tab-btn-models") as HTMLButtonElement;
const tabSkills = document.getElementById("tab-btn-skills") as HTMLButtonElement;
const tabAgents = document.getElementById("tab-btn-agents") as HTMLButtonElement;
const panelModels = document.getElementById("tab-models") as HTMLElement;
const panelSkills = document.getElementById("tab-skills") as HTMLElement;
const panelAgents = document.getElementById("tab-agents") as HTMLElement;
const agentCards = document.getElementById("agent-cards") as HTMLDivElement;
const preset = document.getElementById("preset") as HTMLSelectElement;
const endpoint = document.getElementById("endpoint") as HTMLInputElement;
const wireFormat = document.getElementById("wireFormat") as HTMLSelectElement;
const model = document.getElementById("model") as HTMLInputElement;
const theme = document.getElementById("theme") as HTMLSelectElement;
const token = document.getElementById("token") as HTMLInputElement;
const apiKey = document.getElementById("apiKey") as HTMLInputElement;
const save = document.getElementById("save") as HTMLButtonElement;
const status = document.getElementById("status") as HTMLParagraphElement;
const skillList = document.getElementById("skill-list") as HTMLDivElement;
const addAgentBtn = document.getElementById("add-agent-btn") as HTMLButtonElement;
const modelHint = document.getElementById("model-hint") as HTMLParagraphElement;

function report(message: string, isError: boolean): void {
  status.textContent = message;
  status.classList.toggle("error", isError);
}

// Filled by init() before any option exists in the picker, so the change
// listener below can never see a value it cannot resolve.
let modelEntries: PresetEntry[] = [];

// Picking an entry fills the three fields; the user can edit them afterwards
// unless the brand locked them. Registered at module load, so the listener is
// attached before init() awaits anything.
preset.addEventListener("change", () => {
  const entry = modelEntries.find((e) => e.id === preset.value);
  if (!entry) return;
  endpoint.value = entry.endpoint;
  wireFormat.value = entry.wireFormat;
  model.value = entry.model;
});

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

/** Builds the picker from the brand, then restores the saved settings into the
 *  form.
 *
 *  ORDER MATTERS, and this is the whole risk of 116/002. The picker's options
 *  must exist BEFORE `preset.value` is assigned, or the assignment silently
 *  selects nothing. Everything from the settings read down to that assignment
 *  runs in one synchronous block with no `await` in it, so "the endpoint field
 *  is filled" and "the picker is preselected" become the same instant — which
 *  is what the e2e helper in change 15 waits for. Do not add an `await` inside
 *  that block. */
async function init(): Promise<void> {
  const brand = await brandForThisContext();
  registerBrandThemes(brand.themes, { linkCss: true });
  modelEntries = resolveModels(brand);

  for (const entry of modelEntries) {
    const option = document.createElement("option");
    option.value = entry.id;
    option.textContent = entry.label;
    preset.append(option);
  }

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

  if (brand.options.lockModel === true) {
    // readOnly on the text inputs, disabled on the select:
    // a read-only input still reports its value to the save handler, and
    // <select> has no readOnly behaviour at all.
    endpoint.readOnly = true;
    model.readOnly = true;
    wireFormat.disabled = true;
    // The picker itself stays enabled: switching between the brand's OWN
    // entries is what the lock is for, and every option in it came from the
    // brand. getManifest().name is the extension's own display name, which
    // task 004 makes the brand owner's name from their package.json.
    modelHint.textContent =
      `Model settings are fixed by ${chrome.runtime.getManifest().name}.`;
    modelHint.hidden = false;
  }

  const [s, t] = await Promise.all([getSettings(), getToken()]);
  // --- no await below this line until the picker is preselected ---
  endpoint.value = s.endpoint;
  wireFormat.value = s.wireFormat;
  model.value = s.model;
  theme.value = s.theme;
  applyPageTheme(s.theme);
  apiKey.value = s.apiKey;
  token.value = t;
  preset.value = modelEntries.find(
    (e) => e.endpoint === s.endpoint && e.wireFormat === s.wireFormat
      && e.model === s.model,
  )?.id ?? "";
}

void init();

// The skills list paints from its own storage read, independently of the
// settings above: a slow or failing settings read must not leave the section
// blank, and neither read depends on the other.
mountTabs([tabModels, tabSkills, tabAgents], [panelModels, panelSkills, panelAgents]);

void (async () => {
  const [brand, store] = await Promise.all([
    brandForThisContext(),
    readAgentStore(chromeAgentStorage),
  ]);
  const mergedAgents = listAgents(brand, store.edits, store.users);
  await renderSkills(skillList, chromeSkillStorage, mergedAgents);
  await mountAgentEditor({
    container: agentCards,
    brand,
    storage: chromeAgentStorage,
    addButton: addAgentBtn,
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

save.addEventListener("click", () => {
  const url = endpoint.value.trim();
  const pattern = originPattern(url);
  if (!pattern) {
    report("Error: that is not a valid http or https endpoint URL.", true);
    return;
  }

  const doSave = async () => {
    try {
      await fetch(url, { method: "GET" });
    } catch (e) {
      report(`Error: ${url} could not be reached (${(e as Error)?.message ?? String(e)}). Nothing was saved.`, true);
      return;
    }

    const settings: AgentSettings = {
      endpoint: url,
      wireFormat: wireFormat.value as WireFormat,
      model: model.value.trim(),
      apiKey: apiKey.value.trim(),
      theme: theme.value,
    };
    await setSettings(settings);
    await setToken(token.value.trim());
    report("Saved. Reload a page to use the new settings.", false);
  };

  // chrome.permissions.request() must be called inside the user gesture, so
  // nothing is awaited before it here — an await before it can end the gesture. An
  // origin the extension already holds is granted silently, with no dialog.
  if (!chrome.permissions?.request) {
    void doSave();
    return;
  }
  void chrome.permissions.request({ origins: [pattern] }).then(async (granted) => {
    if (!granted) {
      report(`Error: permission for ${pattern} was refused, so nothing was saved.`, true);
      return;
    }
    await doSave();
  });
});
