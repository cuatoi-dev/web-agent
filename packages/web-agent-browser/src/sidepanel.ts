// Registers <agent-chat-panel> as a side effect
// (packages/web-agent-lit/src/index.ts:3), the same way
// apps/cat-store/src/web/components/agent-page.ts:3-4 does.
import "@cuatoi/web-agent-lit";
import {
  createConfirmScrim,
  defaultRenderers,
  setMockScript,
  type AgentChatPanel,
} from "@cuatoi/web-agent-lit";
import {
  type CustomToolDef,
  type ToolContext,
  type ToolProvider,
} from "@cuatoi/web-agent-core";
import { createRecordingController, hostOf } from "./lib/recording-controller";
import { createWatchMeProvider } from "./lib/watch-me-provider";

import {
  getLastAgentId,
  getSettings,
  parseMemoryEnabled,
  setLastAgentId,
  SETTINGS_KEY,
} from "./lib/settings";
import {
  createPanelMemorySync,
  isAgentMemoryOn,
  type PanelMemorySync,
} from "./lib/panel-memory";
import { requestBrand } from "./lib/brand-request";
import { readAgentStore, chromeAgentStorage, mergedBrand } from "./lib/agent-store";
import { applyTheme, registerBrandThemes } from "./lib/theme";
import { applyPanelSettings, type PanelLike } from "./lib/panel-setup";
import {
  toggleView,
  type QueryTabs,
  type SendToTab,
  type TabState,
} from "./lib/panel-toggle";
import { createTabStateActions, watchActiveTab } from "./lib/tab-state-sync";
import { tabTools } from "./lib/tab-tools";
import { tabSkills } from "./lib/tab-skill";
import { websiteEditSkill } from "./lib/website-edit-skill";
import { testPlanSkill } from "./lib/test-plan-skill";
import { testReportSkill } from "./lib/test-report-skill";
import { exploreAppSkill } from "./lib/explore-app-skill";
import {
  agentAllows,
  mergeBrandSkills,
  resolveAgent,
} from "./lib/brand-capabilities";
import { listModels, modelForAgent, readModelStore, resolveRef } from "./lib/model-store";
import { toPublicModels } from "./lib/public-models";
import { createModelSwitch } from "./lib/model-switch";
import { sidePanelTools } from "./lib/sidepanel-tool-filter";
import { pageAgentTools } from "./lib/page-agent-tools";
import { panelPageTools } from "./lib/panel-page-tools";
import { createDebuggerSession } from "./lib/debugger-session";
import { createHelperWorlds } from "./lib/debugger-helper-world";
import { createDebuggerRecorder } from "./lib/debugger-recorder";
import { DirectoryBackend, memorySkills, vfsTools } from "@cuatoi/web-agent-vfs";
import { filesScreen } from "@cuatoi/web-agent-vfs/lit";
import { indexedDbFolderStore } from "./lib/folder-store";
import { seedHomeAgentsMd } from "./lib/seed-home-agents-md";
import { ChromeStorageBackend } from "./lib/chrome-storage-backend";
import { extensionSkillRegistry } from "./lib/skill-registry";
import { createAgentSwitcher, orderAgents } from "./lib/agent-switcher";
import { mountAgentCombo } from "./lib/agent-combo";
import { mountPageAgentIcon, paintPageAgentIcon } from "./lib/page-agent-icon";
import type { AgentBrand, BrandAgent, ModelContext, ModelSwitch, ResolvedProvider } from "./lib/types";

const toggleBtn = document.getElementById("page-agent-toggle") as HTMLButtonElement;
const chat = document.getElementById("chat") as HTMLDivElement;
const agentCombo = document.getElementById("agent-combo") as HTMLButtonElement;
const agentList = document.getElementById("agent-list") as HTMLUListElement;

// The glyph and dot go in before the first paint() at the bottom of
// this file.
mountPageAgentIcon(toggleBtn);

let tabState: TabState | null = null;

function paint(): void {
  paintPageAgentIcon(toggleBtn, toggleView(tabState));
}

const query: QueryTabs = (info) => chrome.tabs.query(info);
const send: SendToTab = (tabId, message) => chrome.tabs.sendMessage(tabId, message);

// One debugger session for this side panel page, shared by every
// agent's panel. A debugger attach belongs to the extension, not this page,
// so closing the panel would leave the tab attached: detach it here.
const debuggerSession = createDebuggerSession();
window.addEventListener("pagehide", () => {
  debuggerSession.detachAll();
});
// One helper-world cache and one recorder driver for this
// side panel page, shared by every agent's panel tools and its recording
// controller, so a recording and an agent action share one debugger attach.
const helper = createHelperWorlds(debuggerSession);
const recorder = createDebuggerRecorder(debuggerSession, helper);

/** Builds the `<agent-chat-panel>` for one agent: its own prompt, display
 *  name, session namespace, and tools/skills filtered by the agent's `tools`,
 *  `excludeTools`, `skills` and `excludeSkills`. One agent per panel; the
 *  switcher builds one per agent, on first show. */
function buildAgentPanel(
  agent: BrandAgent,
  brand: AgentBrand,
  models: ModelContext,
  refreshTabState: () => Promise<void>,
  getMemoryEnabled: () => Record<string, boolean>,
  registerSync: (id: string, sync: PanelMemorySync) => void,
): AgentChatPanel {
  const panel = document.createElement("agent-chat-panel");
  // Every property is set BEFORE the element is connected — the panel builds
  // its session in connectedCallback and throws without `model`.
  panel.store = {
    getState: () => ({ ui: { route: "sidepanel" } }),
    subscribe: () => () => {},
    dispatch: () => {},
  };
  panel.renderers = defaultRenderers;
  panel.appContext = {
    appName: "Web Agent side panel",
    appDescription:
      "A chat panel docked in the browser side panel. It is not attached to any one page.",
    appInstructions: agent.instructions,
  };
  // The lit header shows this until the session has a title.
  panel.agentName = agent.displayName;
  // The thread's step lines start with this. Without it every line
  // reads "Agent". "tesagent" (brand/agents/tesagent.yml:1) and "Chromagent"
  // (brand/agents/chromagent.yml:1).
  panel.agentShortName = agent.displayName;

  // The agent's own model when it is on, else the options page
  // default (modelForAgent).
  const { entry } = modelForAgent(models.entries, models.store, agent.model);
  // The switch is built below, once the tool providers it rebuilds exist.
  // Each request asks for the CURRENT model's provider, so a pick in the
  // kebab menu changes the next request's headers.
  let modelSwitch: ModelSwitch | null = null;
  const currentProvider = (): ResolvedProvider =>
    (resolveRef(models.entries, modelSwitch?.current() ?? entry.ref) ?? entry).provider;
  // PanelLike carries only the fields applyPanelSettings writes, via an index
  // signature (panel-setup.ts) — a class instance is not assignable to an
  // index-signature type, so the element is passed through its structural
  // shape rather than by re-adding a cast to `any`.
  applyPanelSettings(panel as unknown as PanelLike, currentProvider, brand);

  panel.config = {
    ...(panel.config ?? { persist: true }),
    sessionNamespace: `web-agent-extension-panel-${agent.id}`,
  };

  // The brand's `data` switch, applied on top of the tools the side
  // panel never runs (lib/sidepanel-tool-filter.ts). The agent's own `tools` /
  // `excludeTools` applies last.
  panel.config.tools = (ctx: ToolContext): CustomToolDef[] =>
    sidePanelTools(brand, ctx).filter((t) => agentAllows(agent.tools, agent.excludeTools, t.name));

  // An agent that cannot read files gets no folder button.
  const canReadFiles = agentAllows(agent.tools, agent.excludeTools, "read_file");
  const filterProvider = (p: ToolProvider): ToolProvider => ({
    ...p,
    load: async () =>
      (await p.load()).filter((t) => agentAllows(agent.tools, agent.excludeTools, t.name)),
    ...(p.name === "vfs" && !canReadFiles ? { attachmentProviders: [] } : {}),
  });

  // One recording controller per panel, shared by the
  // start_recording/stop_recording tools below and by the Watch me composer
  // control, so the agent and the user watch (and can stop) the same
  // recording. Built only for an agent whose tools include start_recording —
  // an agent without it gets no controller and no icon.
  const recordingController = agentAllows(agent.tools, agent.excludeTools, "start_recording")
    ? createRecordingController({
        session: debuggerSession,
        recorder,
      })
    : undefined;

  const initialMemoryOn = isAgentMemoryOn(agent, getMemoryEnabled());
  const createVfs = (on: boolean) =>
    vfsTools({
      tmp: ChromeStorageBackend(chrome.storage.session, `tmp:${agent.id}`),
      home: ChromeStorageBackend(chrome.storage.local, `home:${agent.id}`),
      shared: ChromeStorageBackend(chrome.storage.local, "shared"),
      ...(canReadFiles ? { folderStore: indexedDbFolderStore(agent.id) } : {}),
      seedAgentsMd: agent.homeAgentsMd,
      ...(on ? { memory: true } : {}),
    });
  let vfs = createVfs(initialMemoryOn);
  const exposeVfsProof = (): void => {
    if (window.__WA_ENABLE_VFS_PROOF__ === true) {
      (window.__WA_VFS_PROOF__ ??= {})[agent.id] = {
        provider: vfs, panel, directoryBackend: DirectoryBackend,
      };
    }
  };
  exposeVfsProof();
  // The brand's starter /home/agent/AGENTS.md, written once when the
  // file is missing. The promise is awaited in the vfs provider's load() below,
  // so the first prompt of a fresh install already has the file for the
  // <agents-md> block (packages/web-agent-vfs/src/index.ts:144-171).
  const seedHome = seedHomeAgentsMd(vfs.vfs, agent.homeAgentsMd);

  const mockScript = window.__WA_MOCK_SCRIPT__;
  // Rebuilt by the model switch whenever the vision flag changes.
  const buildProviders = (vision: boolean): ToolProvider[] => [
    ...tabTools({
      confirmInteraction: panel.confirmInteraction.bind(panel),
    }),
    ...pageAgentTools({
      onToggle: refreshTabState,
    }),
    // The page tools, for any tab the agent started debugging.
    // page_screenshot is offered only when the CURRENT
    // model has `vision: true`; the explicit flag wins over the name guess.
    ...panelPageTools({
      vfs: vfs.vfs,
      imageInput: vision,
      confirmInteraction: panel.confirmInteraction.bind(panel),
      debuggerSession,
      helper,
      recorder,
      recording: recordingController,
    }),
    // The agent file system, on chrome.storage rather than this
    // page's own Web Storage. /tmp and /home/agent are namespaced per agent,
    // so two side panel agents never see each other's files; /home/shared is
    // one namespace, so they do. vfsTools returns ONE ToolProvider
    // (web-agent-vfs/src/index.ts:36), unlike the three helpers above, which
    // return arrays.
    // The same provider with a load() that awaits the starter seed
    // first. A failed seed resolves, so the session still starts.
    { ...vfs, load: async () => { await seedHome; return vfs.load(); } },
  ].map(filterProvider);
  // Path, type, model, imageInput, the kebab list (enabled models)
  // and the tool providers, before the element is connected. A pick in the
  // kebab menu switches all of them for the next request and keeps the chat;
  // the options page default does not change.
  modelSwitch = createModelSwitch({
    target: panel,
    models: toPublicModels(models.entries),
    initial: entry.ref,
    mock: mockScript !== undefined,
    buildToolProviders: buildProviders,
  });

  panel.screens = [filesScreen(vfs.vfs)];

  if (recordingController) {
    const watchMe = createWatchMeProvider({
      controller: recordingController,
      getActiveTab: async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || tab.id == null || !tab.url) return null;
        return { tabId: tab.id, host: hostOf(tab.url), url: tab.url };
      },
      onNotify: (msg, type) => {
        panel.dispatchEvent(
          new CustomEvent("agent-toast", {
            detail: { message: msg, type },
            bubbles: true,
            composed: true,
          }),
        );
      },
    });
    panel.attachmentProviders = [watchMe];
  }

  // The side panel's built-in groups, droppable from
  // brand/plugin.yml's `skills` block, with the brand's own skills merged
  // over.
  // `websiteEdit` is its own group, so a brand that ships no page
  // tools also ships no skill telling the agent to use them.
  // `testing` is its own group too. The group switch runs
  // first, so a group switched off removes the skill even from an agent
  // whose `skills` list names it.
  const baseSkills = mergeBrandSkills(
    {
      tab: tabSkills(),
      websiteEdit: [websiteEditSkill],
      testing: [testPlanSkill, testReportSkill, exploreAppSkill],
    },
    brand,
  ).filter((s) => agentAllows(agent.skills, agent.excludeSkills, s.name));
  panel.skills = [...baseSkills, ...memorySkills(vfs)];

  const memorySync = createPanelMemorySync({
    initialOn: initialMemoryOn,
    isCurrentChatFresh: () => {
      const s = panel.session?.getState();
      return Boolean(s?.activeSessionId) && !panel.running && panel.messages.length === 0;
    },
    apply: (on) => {
      vfs = createVfs(on);
      exposeVfsProof();
      panel.screens = [filesScreen(vfs.vfs)];
      panel.skills = [...baseSkills, ...memorySkills(vfs)];
      panel.toolProviders = buildProviders(Boolean(panel.imageInput));
    },
  });
  registerSync(agent.id, memorySync);
  queueMicrotask(() => {
    panel.session?.subscribe((s) => memorySync.onSessionState(s));
  });

  // Same store the in-page agents reach through bridge.js — an extension page
  // calls chrome.storage.local directly. The registry belongs to
  // this agent: it lists shared skills plus this agent's own, and its
  // create_skill offers `shared`. Saved skills are not filtered by the
  // agent's `skills` / `excludeSkills`.
  panel.skillRegistry = extensionSkillRegistry({ agentId: agent.id, displayName: agent.displayName });

  // Same escape hatch content.ts uses, so the mock e2e tier never calls a
  // real model. Absent in normal use. The model switch leaves `type` alone
  // under the mock (mock: true above).
  if (mockScript) {
    setMockScript(mockScript);
    panel.type = "mock";
  }

  return panel;
}

async function main(): Promise<void> {
  const [settings, brand, store, modelStore] = await Promise.all([
    getSettings(),
    requestBrand(),
    readAgentStore(chromeAgentStorage),
    readModelStore(),
  ]);
  // A stored edit or user agent reaches the panel through the
  // merged brand, read once here; a change saved while the panel is open
  // shows the next time it opens. The model list too.
  const merged = mergedBrand(brand, store);
  const models: ModelContext = { entries: listModels(brand, modelStore), store: modelStore };
  registerBrandThemes(brand.themes, { linkCss: true });

  // The whole page, not just the chat: an extension page has no site theme of
  // its own, so <html> carries the token set and the panel inherits it.
  applyTheme(document.documentElement, settings.theme);

  const { refresh: refreshTabState, toggleCurrent } = createTabStateActions({
    query,
    send,
    apply: (next) => {
      tabState = next;
      paint();
    },
  });

  // The compiled brand always has an agent matching its
  // defaultAgent, but a worker that could not answer degrades to
  // EMPTY_BRAND (brand-request.ts), and a hand-patched brand.json used by a
  // test can hold no agents at all. Show an
  // error and no chat rather than throw.
  // Reopen on the agent used last; a missing one falls back to the
  // default inside resolveAgent.
  // The agent row itself is never hidden, so the
  // page-agent icon stays visible and usable with no agent loaded; only the
  // combo box (empty, with no agent to show) is hidden.
  const agent = resolveAgent(merged, await getLastAgentId());
  if (agent === undefined) {
    const el = document.createElement("p");
    el.id = "agent-error";
    el.setAttribute("role", "alert");
    el.textContent =
      "The brand did not load, so no agent is available. Reload the extension, then open the side panel again.";
    chat.appendChild(el);
  } else {
    // Each callback below reads the other object only when the user acts or
    // show() runs, by which time both consts exist.
    const combo = mountAgentCombo({
      button: agentCombo,
      list: agentList,
      agents: orderAgents(merged),
      currentId: () => switcher.activeId(),
      onSelect: (id) => {
        void switcher.select(id);
      },
    });
    let memoryEnabled = settings.memoryEnabled;
    const panelSyncs = new Map<string, PanelMemorySync>();
    const onStorageChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ): void => {
      if (area !== "local" || !(SETTINGS_KEY in changes)) return;
      const nextRaw: unknown = changes[SETTINGS_KEY].newValue;
      const nextObj: { memoryEnabled?: unknown } = nextRaw !== null && typeof nextRaw === "object"
        ? nextRaw
        : {};
      memoryEnabled = parseMemoryEnabled(nextObj.memoryEnabled);
      for (const [id, sync] of panelSyncs) {
        const target = merged.agents.find((x) => x.id === id);
        if (target) sync.setDesired(isAgentMemoryOn(target, memoryEnabled));
      }
    };
    chrome.storage.onChanged.addListener(onStorageChanged);
    window.addEventListener("pagehide", () => {
      chrome.storage.onChanged.removeListener(onStorageChanged);
    });

    const switcher = createAgentSwitcher({
      brand: merged,
      container: chat,
      buildPanel: (a) =>
        buildAgentPanel(
          a,
          merged,
          models,
          refreshTabState,
          () => memoryEnabled,
          (id, sync) => {
            panelSyncs.set(id, sync);
          },
        ),
      confirm: (panel, detail) => createConfirmScrim(panel)(detail),
      onShow: (a) => combo.paint(a),
      saveLastId: (id) => {
        void setLastAgentId(id);
      },
    });
    switcher.show(agent);
    agentCombo.hidden = false;
  }

  toggleBtn.addEventListener("click", () => {
    void toggleCurrent();
  });
  const stopWatching = watchActiveTab({
    events: {
      onActivated: chrome.tabs.onActivated,
      onUpdated: chrome.tabs.onUpdated,
      onFocusChanged: chrome.windows.onFocusChanged,
    },
    getPanelWindowId: () => chrome.windows.getCurrent().then((w) => w.id),
    refresh: refreshTabState,
  });
  window.addEventListener("pagehide", () => stopWatching());

  await refreshTabState();
}

paint();
void main();
