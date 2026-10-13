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
  dataTools,
  defaultTools,
  genuiTools,
  type CustomToolDef,
  type ToolContext,
  type ToolProvider,
} from "@cuatoi/web-agent-core";
import { createActionJournal } from "./lib/action-journal";
import { createRecordingController, hostOf } from "./lib/recording-controller";
import { createWatchMeProvider } from "./lib/watch-me-provider";

import { getLastAgentId, getSettings, getToken, setLastAgentId } from "./lib/settings";
import { requestBrand } from "./lib/brand-request";
import { readAgentStore, chromeAgentStorage, mergedBrand } from "./lib/agent-store";
import { applyTheme, registerBrandThemes } from "./lib/theme";
import { applyPanelSettings, type PanelLike } from "./lib/panel-setup";
import {
  resolveTabState,
  toggleTab,
  toggleView,
  type QueryTabs,
  type SendToTab,
  type TabState,
} from "./lib/panel-toggle";
import { tabTools } from "./lib/tab-tools";
import { tabSkills } from "./lib/tab-skill";
import { websiteEditSkill } from "./lib/website-edit-skill";
import { playwrightScriptSkill } from "./lib/playwright-script-skill";
import { testPlanSkill } from "./lib/test-plan-skill";
import { testHealerSkill } from "./lib/test-healer-skill";
import {
  agentAllows,
  effectiveSettings,
  mergeBrandSkills,
  resolveAgent,
} from "./lib/brand-capabilities";
import { pageAgentTools } from "./lib/page-agent-tools";
import { panelPageTools } from "./lib/panel-page-tools";
import { createDebuggerSession } from "./lib/debugger-session";
import { createHelperWorlds } from "./lib/debugger-helper-world";
import { createDebuggerRecorder } from "./lib/debugger-recorder";
import { DirectoryBackend, vfsTools } from "@cuatoi/web-agent-vfs";
import { filesScreen } from "@cuatoi/web-agent-vfs/lit";
import { ChromeStorageBackend } from "./lib/chrome-storage-backend";
import { extensionSkillRegistry } from "./lib/skill-registry";
import { createAgentSwitcher, orderAgents } from "./lib/agent-switcher";
import { mountAgentCombo } from "./lib/agent-combo";
import { mountPageAgentIcon, paintPageAgentIcon } from "./lib/page-agent-icon";
import type { AgentBrand, AgentSettings, BrandAgent } from "./lib/types";

const toggleBtn = document.getElementById("page-agent-toggle") as HTMLButtonElement;
const chat = document.getElementById("chat") as HTMLDivElement;
const agentCombo = document.getElementById("agent-combo") as HTMLButtonElement;
const agentList = document.getElementById("agent-list") as HTMLUListElement;

// 120/003 — the glyph and dot go in before the first paint() at the bottom of
// this file.
mountPageAgentIcon(toggleBtn);

let tabState: TabState | null = null;

function paint(): void {
  paintPageAgentIcon(toggleBtn, toggleView(tabState));
}

const query: QueryTabs = (info) => chrome.tabs.query(info);
const send: SendToTab = (tabId, message) => chrome.tabs.sendMessage(tabId, message);

// 124/001 — one debugger session for this side panel page, shared by every
// agent's panel. A debugger attach belongs to the extension, not this page,
// so closing the panel would leave the tab attached: detach it here.
const debuggerSession = createDebuggerSession();
window.addEventListener("pagehide", () => {
  debuggerSession.detachAll();
});
// 131/002 / 131/004 — one helper-world cache and one recorder driver for this
// side panel page, shared by every agent's panel tools and its recording
// controller, so a recording and an agent action share one debugger attach.
const helper = createHelperWorlds(debuggerSession);
const recorder = createDebuggerRecorder(debuggerSession, helper);

/** Builds the `<agent-chat-panel>` for one agent: its own prompt, display
 *  name, session namespace, and tools/skills filtered by the agent's `tools`,
 *  `excludeTools`, `skills` and `excludeSkills`. 120/001 — one agent per
 *  panel; 120/002 — the switcher builds one per agent, on first show. */
function buildAgentPanel(
  agent: BrandAgent,
  brand: AgentBrand,
  settings: AgentSettings,
  token: string,
  refreshTabState: () => Promise<void>,
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
  // 124/007 — the thread's step lines start with this. Without it every line
  // reads "Agent". "tesagent" (brand/agents/tesagent.yml:1) and "Chromagent"
  // (brand/agents/chromagent.yml:1).
  panel.agentShortName = agent.displayName;

  const eff = effectiveSettings(settings, brand, agent);
  // PanelLike carries only the fields applyPanelSettings writes, via an index
  // signature (panel-setup.ts) — a class instance is not assignable to an
  // index-signature type, so the element is passed through its structural
  // shape rather than by re-adding a cast to `any`.
  applyPanelSettings(panel as unknown as PanelLike, eff, token, brand);

  panel.config = {
    ...(panel.config ?? { persist: true }),
    sessionNamespace: `web-agent-extension-panel-${agent.id}`,
  };

  // The brand's own data / genui switches, same rule as before 116/001.
  const groupDrop = new Set<string>();
  if (brand.tools.data?.enabled === false) {
    for (const tool of dataTools()) groupDrop.add(tool.name);
  }
  if (brand.tools.genui?.enabled === false) {
    for (const tool of genuiTools()) groupDrop.add(tool.name);
  }

  panel.config.tools = (ctx: ToolContext): CustomToolDef[] =>
    defaultTools(ctx).filter(
      (t) => !groupDrop.has(t.name) && agentAllows(agent.tools, agent.excludeTools, t.name),
    );

  // 128/003 — an agent that cannot read files gets no folder button.
  const canReadFiles = agentAllows(agent.tools, agent.excludeTools, "read_file");
  const filterProvider = (p: ToolProvider): ToolProvider => ({
    ...p,
    load: async () =>
      (await p.load()).filter((t) => agentAllows(agent.tools, agent.excludeTools, t.name)),
    ...(p.name === "vfs" && !canReadFiles ? { attachmentProviders: [] } : {}),
  });

  // Fix round 1 (124/006) — one journal per panel, built here (not left to
  // createPanelPageTools's own default) so the recording controller below and
  // panelPageTools's own journaled tools (export_test included) share the
  // SAME journal. Building the recording controller with no journal, as the
  // first pass did, gave it its own private one: steps recorded via
  // start_recording landed there, never in the journal export_test reads
  // from — "Journal entry #1 does not exist in this chat."
  // 124/004 — a new chat or a session switch empties the action journal.
  const journal = createActionJournal(() => panel.session?.getState().activeSessionId ?? "");

  // 124/006 — one recording controller per panel, shared by the
  // start_recording/stop_recording tools below and by the Watch me composer
  // control, so the agent and the user watch (and can stop) the same
  // recording. Built only for an agent whose tools include start_recording —
  // an agent without it gets no controller and no icon.
  const recordingController = agentAllows(agent.tools, agent.excludeTools, "start_recording")
    ? createRecordingController({
        journal,
        session: debuggerSession,
        recorder,
      })
    : undefined;

  const vfs = vfsTools({
    tmp: ChromeStorageBackend(chrome.storage.session, `tmp:${agent.id}`),
    home: ChromeStorageBackend(chrome.storage.local, `home:${agent.id}`),
    shared: ChromeStorageBackend(chrome.storage.local, "shared"),
  });
  if (window.__WA_ENABLE_VFS_PROOF__ === true) {
    (window.__WA_VFS_PROOF__ ??= {})[agent.id] = {
      provider: vfs, panel, directoryBackend: DirectoryBackend,
    };
  }

  panel.toolProviders = [
    ...tabTools({
      confirmInteraction: panel.confirmInteraction.bind(panel),
    }),
    ...pageAgentTools({
      onToggle: refreshTabState,
    }),
    // 118/001 — the page tools, pointed at any activated tab.
    // 118/004 — the wire format and model decide whether page_screenshot is
    // offered at all, so they come from the agent's EFFECTIVE model, not the
    // options page settings.
    ...panelPageTools({
      endpointType: eff.wireFormat,
      model: eff.model,
      confirmInteraction: panel.confirmInteraction.bind(panel),
      debuggerSession,
      helper,
      recorder,
      journal,
      // 124/004 — a new chat or a session switch empties the action journal.
      activeSessionId: () => panel.session?.getState().activeSessionId ?? "",
      recording: recordingController,
    }),
    // 069/003 — the agent file system, on chrome.storage rather than this
    // page's own Web Storage. /tmp and /home/agent are namespaced per agent,
    // so two side panel agents never see each other's files; /home/shared is
    // one namespace, so they do. NOT spread: vfsTools returns ONE
    // ToolProvider (web-agent-vfs/src/index.ts:27), unlike the three helpers
    // above, which return arrays.
    vfs,
  ].map(filterProvider);

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

  // 116/003 — the side panel's built-in groups, droppable from
  // brand/plugin.yml's `skills` block, with the brand's own skills merged
  // over.
  // 118/005 — `websiteEdit` is its own group, so a brand that ships no page
  // tools also ships no skill telling the agent to use them.
  // 120/005 — `playwright` is its own group too. The group switch runs
  // first, so a group switched off removes the skill even from an agent
  // whose `skills` list names it.
  panel.skills = mergeBrandSkills(
    {
      tab: tabSkills(),
      websiteEdit: [websiteEditSkill],
      playwright: [playwrightScriptSkill, testPlanSkill, testHealerSkill],
    },
    brand,
  ).filter((s) => agentAllows(agent.skills, agent.excludeSkills, s.name));

  // Same store the in-page agents reach through bridge.js — an extension page
  // calls chrome.storage.local directly. 120/004 — the registry belongs to
  // this agent: it lists shared skills plus this agent's own, and its
  // create_skill offers `shared`. Saved skills are not filtered by the
  // agent's `skills` / `excludeSkills` (idea 120).
  panel.skillRegistry = extensionSkillRegistry({ agentId: agent.id, displayName: agent.displayName });

  // Same escape hatch content.ts:75-84 uses, so the mock e2e tier never calls a
  // real model. Absent in normal use.
  const mockScript = window.__WA_MOCK_SCRIPT__;
  if (mockScript) {
    setMockScript(mockScript);
    panel.type = "mock";
    panel.streaming = false;
  }

  return panel;
}

async function main(): Promise<void> {
  const [settings, sharedToken, brand, store] = await Promise.all([
    getSettings(),
    getToken(),
    requestBrand(),
    readAgentStore(chromeAgentStorage),
  ]);
  // 121/002 — a stored edit or user agent reaches the panel through the
  // merged brand, read once here; a change saved while the panel is open
  // shows the next time it opens.
  const merged = mergedBrand(brand, store);
  registerBrandThemes(brand.themes, { linkCss: true });

  // The whole page, not just the chat: an extension page has no site theme of
  // its own, so <html> carries the token set and the panel inherits it.
  applyTheme(document.documentElement, settings.theme);

  const refreshTabState = async () => {
    tabState = await resolveTabState(query, send);
    paint();
  };

  // 120/001 — the compiled brand always has an agent matching its
  // defaultAgent, but a worker that could not answer degrades to
  // EMPTY_BRAND (brand-request.ts), and a hand-patched brand.json used by a
  // test can hold no agents at all. Manager decision (2026-09-15): show an
  // error and no chat rather than throw.
  // 120/002 — reopen on the agent used last; a missing one falls back to the
  // default inside resolveAgent.
  // 120/003 manager override — the agent row itself is never hidden, so the
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
    const switcher = createAgentSwitcher({
      brand: merged,
      container: chat,
      buildPanel: (a) => buildAgentPanel(a, merged, settings, sharedToken, refreshTabState),
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
    if (!tabState) return;
    void toggleTab(send, tabState).then((next) => {
      tabState = next;
      paint();
    });
  });

  await refreshTabState();
}

paint();
void main();
