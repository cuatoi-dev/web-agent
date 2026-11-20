import {
  genuiRenderers,
  coreSkills,
  getAgentCursor,
  createActionCue,
  setMockScript,
  LocalStorageSkillRegistry,
  type AgentChatPanel,
} from "@cuatoi/web-agent-lit";
import { SPEED_PRESETS, calcTool } from "@cuatoi/web-agent-core";
import { ANY_MODEL_ENDPOINT_TYPE } from "./any-model-chain";
import { withGatewayAuth } from "./gateway-auth";
import { domTools, domSkills } from "@cuatoi/web-agent-dom";
import { chartingTools, chartingSkills } from "@cuatoi/web-agent-charting";
import { chartingRenderers } from "@cuatoi/web-agent-charting/lit";
import { mcpToolProviders } from "@cuatoi/web-agent-mcp";
import { openApiToolProviders } from "@cuatoi/web-agent-openapi";
import { memorySkills, vfsTools, type VfsBackend, type VfsEntry, type VfsFile } from "@cuatoi/web-agent-vfs";
import { filesScreen } from "@cuatoi/web-agent-vfs/lit";

const PROMO_CONTENT =
  "# Special Store Promotion\n\n" +
  "We are currently offering a complimentary gift with every cat toy purchase! " +
  "This limited-time reward applies automatically to all toy orders in our catalog.\n";

const PAGE_LOAD_TIME_MS = Date.now();

const storeBackend: VfsBackend = {
  get(rel: string): Promise<VfsFile | undefined> {
    const normalized = rel.startsWith("/") ? rel : `/${rel}`;
    if (normalized === "/latest-promotion.md") {
      return Promise.resolve({
        content: PROMO_CONTENT,
        encoding: "utf8",
        mimeType: "text/markdown",
        mtimeMs: PAGE_LOAD_TIME_MS,
      });
    }
    return Promise.resolve(undefined);
  },
  list(): Promise<VfsEntry[]> {
    return Promise.resolve([
      {
        path: "/latest-promotion.md",
        mimeType: "text/markdown",
        encoding: "utf8",
        mtimeMs: PAGE_LOAD_TIME_MS,
        size: PROMO_CONTENT.length,
      },
    ]);
  },
};
import { store } from "./store";
import { setToast } from "./store/ui-slice";
import { getCatSources } from "./orders-backend/datasource-sources";
import { addToCartTool } from "./store/add-to-cart-tool";
import { setThemeTool, getThemeTool } from "./store/theme-tool";
import { createRenderAgentUiTool } from "./store/genui-tool";
import { promotionsAssistantSkill } from "./store/promotions-skill";
import { catStoreDemoSkill } from "./store/demo-skill";
import { financeDemoSkill } from "./store/finance-demo-skill";
import { dataAnalysisDemoSkill } from "./store/data-analysis-skill";
import { panelChartSkill } from "./store/panel-chart-skill";
import { shopManagerReportSkill } from "./store/shop-manager-skill";
import { stockMonitorSkill } from "./store/stock-monitor-skill";
import { DEMO_AGENT_AVATAR } from "./dev/gallery-states";
import { buildCatStoreAppInstructions } from "./agent-prompt-config";
import type { AgentPanelOptions, PanelProps, ProviderEntry } from "./types";

export type { ProviderEntry, AgentPanelOptions, PanelProps } from "./types";

/** Four entries: three provider routes plus the fallback chain. `sonnet` over
 *  each of the two OpenAI-and-Anthropic-shaped paths, then Gemini, then
 *  "Any model". One pass over the switcher therefore exercises both wire
 *  formats, and the chain falls back through all three routes (see
 *  any-model-chain.ts).
 *  OPENAI_URL and ANTHROPIC_URL point at an OpenAI- and Anthropic-compatible
 *  model gateway; GEMINI_URL goes direct to Google. "sonnet" is a model alias
 *  the gateway resolves.
 *
 *  Note: on the Anthropic path a gateway may return a `thinking` block ahead of
 *  the text block, so nothing may assume `content[0]` is the reply.
 *
 *  Paths are the ones core's providers expect for the reverse proxy routes
 *  described in web-agent-core docs/providers.md, "Reverse proxy routes":
 *    - anthropic: "/api/anthropic"  -> provider appends "/v1/messages"
 *      (anthropic-provider.ts:172-177 strips a trailing "/v1" first)
 *    - openai:    "/api/openai/v1"  -> provider appends "/chat/completions"
 *      (openai-provider.ts:75-80 expects the base URL to end in "/v1")
 *    - gemini:    "/api/gemini"     -> provider appends
 *      "/v1beta/models/{model}:generateContent" or
 *      ":streamGenerateContent?alt=sse" (gemini-provider.ts:97,147), so this
 *      path carries NO "/v1" suffix */
export const PROVIDER_ENTRIES: ProviderEntry[] = [
  {
    id: "anthropic-sonnet-nonstream",
    label: "Sonnet Anthropic",
    endpointType: "anthropic",
    path: "/api/anthropic",
    model: "sonnet",
  },
  {
    id: "openai-sonnet-nonstream",
    label: "Sonnet OpenAI",
    endpointType: "openai",
    path: "/api/openai/v1",
    model: "sonnet",
  },
  {
    id: "gemini-flash-nonstream",
    label: "Gemini Flash",
    endpointType: "gemini",
    path: "/api/gemini",
    model: "gemini-flash-lite-latest",
  },
  {
    // The fallback chain (any-model-chain.ts). `path` and `model` are written
    // onto the panel like any other entry, but the chain ignores both: every
    // chain entry carries its own baseURL and model.
    id: "any-model",
    label: "Any model",
    endpointType: ANY_MODEL_ENDPOINT_TYPE,
    path: "/api/anthropic",
    model: "sonnet",
  },
];

/** The entry every host starts on. */
export const DEFAULT_PROVIDER_ENTRY_INDEX = 0;

/** Write one entry onto a panel. The three setters queue ONE
 *  `updateConfig(buildSessionConfig())` between them (chat-panel-props.ts
 *  `_scheduleConfigSync`), so the transport is rebuilt with no package change.
 *  `createSession()` pushes the queued update first, so calling it afterwards
 *  starts the conversation on the new configuration. */
export function applyProviderEntry(
  target: { type?: string; path?: string; model?: string },
  entry: ProviderEntry,
): void {
  target.type = entry.endpointType;
  target.path = entry.path;
  target.model = entry.model;
}

const CUE_SPEED: "slow" | "fast" = "slow";
const HOOK_LOG = "[cat-store hooks]";

function buildPanelProps(
  { domAccess, memory, genui }: AgentPanelOptions,
  target?: AgentChatPanel,
): PanelProps {
  const panel = {} as AgentChatPanel;
  if (target?.config) panel.config = target.config;
  // Key gate: every /api/openai, /api/anthropic and /api/gemini call
  // carries the gateway key in that route's own auth header, or the reverse
  // proxy rejects it with 401. `process.env.WEB_AGENT_TOKEN` is a build-time
  // constant, injected by webpack.config.js's DefinePlugin — not a source
  // literal, so rotating the key is a redeploy with a new env value.
  panel.fetch = withGatewayAuth(window.fetch.bind(window), process.env.WEB_AGENT_TOKEN as string);
  // AgentChatPanel's `store` setter takes `HostStore`, a type web-agent-lit
  // does not export from its entry point. HostStore's index signature exists
  // so hosts can pass a real state container (Redux, here) whose members the
  // panel never reads (chat-ui/types.ts:76-79) — TS still requires a cast to
  // satisfy that signature for a named type rather than an object literal.
  panel.store = store as unknown as AgentChatPanel["store"];
  panel.appContext = {
    appName: "Cat Store",
    appDescription: "A pet store selling organic cat food products.",
    appInstructions: buildCatStoreAppInstructions(),
  };
  // The shop-manager monthly report is the longest demo flow here: it runs
  // three aggregated queries, then one calc per category profit, per category
  // margin, per month-over-month delta, the average delta and the projection,
  // and only then renders. Measured live on 2026-09-04, that reaches the
  // core default of that time, 50 steps, before render_agent_ui is ever
  // called, so the panel showed tool chips and no report. 120 lets the flow
  // finish. The core default is now 200; this host keeps its own cap of 120.
  panel.config = { ...panel.config, maxIterations: 120 };
  panel.agentName = "Whiskers";
  panel.agentShortName = "Whiskers";
  panel.agentAvatar = DEMO_AGENT_AVATAR;
  // path, model and endpoint type all come from one entry, so
  // the switcher and the default can never disagree. "sonnet" is a model alias
  // the gateway resolves. The internal proxy uses the same alias, so hosts and
  // proxy name the model identically.
  applyProviderEntry(panel, PROVIDER_ENTRIES[DEFAULT_PROVIDER_ENTRY_INDEX]);
  // Runtime model switcher — friendly labels for the kebab "Choose model" group.
  panel.models = [{ id: "sonnet", label: "Leo" }, { id: "haiku", label: "Mochi" }];

  // Test/e2e seam: deterministic mock LLM (no network). Inert unless a script is set.
  // The full mock tier uses it: test:e2e:mock on both hosts, mock-llm.mock.spec.ts and the docs-site seam.
  const mockScript = window.__WA_MOCK_SCRIPT__;
  if (mockScript) {
    // Test seam only: overrides the entry's transport, deliberately AFTER
    // applyProviderEntry() so the picker still shows the configured entry.
    setMockScript(mockScript);
    panel.type = "mock";
  }

  panel.imageInput = true;
  panel.renderers = [...genuiRenderers, ...chartingRenderers];
  panel.sources = getCatSources(() => store.getState());
  panel.tools = [
    ...chartingTools(),
    calcTool,
    addToCartTool,
    setThemeTool,
    getThemeTool,
    ...(genui ? [createRenderAgentUiTool(genui)] : []),
  ];
  const schedulerEnabled = panel.config?.scheduler?.enabled !== false;
  const todoEnabled = panel.config?.todo?.enabled !== false;
  // The agent's virtual file system (ten tools), default layout:
  // /tmp on sessionStorage, /home/agent and /home/shared on localStorage.
  // Read-only host mount at /store for store promotions.
  // Memory (USER.md, MEMORY.md) only when the caller turns it on —
  // the Agent page does, the bubble does not.
  // Created here, above panel.skills, because memorySkills() reads the
  // provider's resolved memory options. It is added to toolProviders below.
  const vfs = vfsTools({
    mounts: {
      "/store": storeBackend,
    },
    ...(memory ? { memory: true } : {}),
  });
  panel.screens = [filesScreen(vfs.vfs)];
  panel.skills = [
    ...coreSkills(),
    ...chartingSkills(),
    ...(domAccess ? domSkills() : []),
    promotionsAssistantSkill,
    catStoreDemoSkill,
    financeDemoSkill,
    dataAnalysisDemoSkill,
    panelChartSkill,
    shopManagerReportSkill,
    ...(schedulerEnabled ? [stockMonitorSkill] : []),
    // [] when memory is off, so the bubble has neither skill.
    ...memorySkills(vfs),
  ];
  // Async skill seam: skills the user stored in this
  // browser. The namespace matches sessionNamespace below, so cat-store's
  // stored skills never collide with another app on the same origin. A stored
  // skill with the same name as one above replaces it.
  panel.skillRegistry = new LocalStorageSkillRegistry("cat-store");
  if (domAccess) {
    panel.cues = { enabled: true, speed: CUE_SPEED };
  }
  // Remote MCP: consume the cat-store server's OWN /mcp endpoint (relative to
  // the page origin, so it still resolves when a reverse proxy serves the app
  // under a path prefix such as /cat-store/ and strips that prefix).
  // `demomcp` is required (a connect/discover failure is a hard startup error).
  // Test seam __WA_EXTRA_MCP_SERVERS__ allows e2e specs to inject optional servers.
  // The host owns the confirm-scrim wiring too — it is the only layer
  // that knows both @cuatoi/web-agent-lit (the dialog) and
  // @cuatoi/web-agent-dom (the "ask"-tier permission check).
  const extraMcpServers = window.__WA_EXTRA_MCP_SERVERS__ ?? [];
  panel.toolProviders = [
    ...(domAccess
      ? domTools({
          getState: () => store.getState(),
          actionCue: createActionCue({ getCursor: () => getAgentCursor(), speed: () => CUE_SPEED }),
          typingPaceMs: SPEED_PRESETS[CUE_SPEED].msPerWord,
          confirmInteraction: target ? target.confirmInteraction.bind(target) : undefined,
        })
      : []),
    ...mcpToolProviders([
      {
        name: "demomcp",
        description: "Cat Store remote MCP endpoint",
        url: "mcp",
        required: true,
      },
      ...extraMcpServers,
    ]),
    ...openApiToolProviders([
      {
        name: "ordersApi",
        description: "Cat Store Orders REST API",
        specUrl: "/api/orders/openapi.json",
        operations: ["describeOrders", "queryOrders"],
        credentials: "same-origin",
        required: true,
      },
    ]),
    // The same provider that panel.skills read, created above.
    vfs,
  ];
  panel.config = {
    persist: true,
    sessionNamespace: "cat-store",
    scheduler: { enabled: schedulerEnabled },
    todo: { enabled: todoEnabled },
    ...panel.config,
    maxIterations: 120,
  };
  // `notify` is unrelated to the tool-lifecycle hooks below — it's the
  // panel's general toast channel (e.g. the image-downscale hint), not tool
  // completion. Keep it wired or those toasts silently stop reaching Redux.
  panel.notify = (msg: string) => store.dispatch(setToast(msg));
  // Demo host: every one of the seven lifecycle hooks prints one line so the
  // whole turn can be traced in the browser console. Plain console.log, always
  // on — no dev-only gating. The e2e console-guard only inspects
  // `msg.type() === 'error'` (apps/cat-store/e2e/fixtures.ts:64), so these
  // lines never trip it.
  //
  // EVERY handler MUST use a braced body and return nothing. run-hooks.ts
  // treats a truthy return as an opinion: onPreTool would change the
  // allow/deny/ask decision (and the confirm scrim with it), onUserPrompt
  // would rewrite the prompt, onPostTool would rewrite the tool outcome, and
  // onPreCompact would veto compaction. Logging must stay observe-only.
  panel.hooks = {
    onSessionStart: (p) => {
      console.log(`${HOOK_LOG} onSessionStart sessionId=${p.sessionId}`);
    },
    onUserPrompt: (p) => {
      const parts = p.parts ?? [];
      console.log(
        `${HOOK_LOG} onUserPrompt parts=${parts.length} types=${parts.map((x) => x.type).join(",")}`
      );
    },
    onPreTool: (p) => {
      console.log(
        `${HOOK_LOG} onPreTool name=${p.name} input=${JSON.stringify(p.input)} summary=${p.summary ?? "-"}`
      );
    },
    onPostTool: (p) => {
      const content = String(p.outcome?.content ?? "");
      console.log(
        `${HOOK_LOG} onPostTool name=${p.name} isError=${p.outcome?.isError === true} content=${content.slice(0, 80)}`
      );
    },
    onTurnEnd: (p) => {
      console.log(
        `${HOOK_LOG} onTurnEnd stopReason=${p.stopReason} textLength=${p.result?.assistantText?.length ?? 0}`
      );
    },
    onPreCompact: (p) => {
      console.log(
        `${HOOK_LOG} onPreCompact tokens=${p.tokens} percent=${Math.round((p.percent ?? 0) * 100)}%`
      );
    },
    onPostCompact: (p) => {
      console.log(
        `${HOOK_LOG} onPostCompact tokensBefore=${p.tokensBefore} tokensAfter=${p.tokensAfter}`
      );
    },
  };

  return panel as unknown as PanelProps;
}

export function panelProps(
  opts: AgentPanelOptions,
  panel?: AgentChatPanel,
): PanelProps {
  return buildPanelProps(opts, panel);
}

export function configureAgentPanel(panel: AgentChatPanel, opts: AgentPanelOptions): void {
  Object.assign(panel, panelProps(opts, panel));
}
