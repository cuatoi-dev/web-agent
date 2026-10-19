// The shapes shared by the modules in this directory. Every interface and type
// alias lives here or in sibling *.types.ts files, kept acyclic.

import type { ConfirmInteractionDetail, CustomToolDef, SkillDef, ToolContext } from "@cuatoi/web-agent-core";
import type { VfsHandle } from "@cuatoi/web-agent-vfs";
import type { CaptureApi, PageScreenshotToolOptions } from "./page-screenshot-tool.types";
import type { SkillsRequestMessage, SkillsResultMessage } from "./skill-registry.types";
import type { RecordingController } from "./recorder.types";
import type { DebuggerToolsOptions } from "./debugger-tools.types";
import type { DebuggerRecorder } from "./debugger-recorder.types";
import type { HelperWorlds } from "./debugger-helper-world.types";
import type { ModelRef, ModelEntry, PublicModel, WireFormat } from "./model-store.types";

// --- constants.ts ----------------------------------------------------------

// 136/005 — `WireFormat` moved to model-store.types.ts, re-exported below.
export type * from "./model-store.types";

/** A registered theme identifier or "auto" to follow system preferences.
 *  `string & {}` keeps the literal `"auto"` for autocomplete while still
 *  accepting any theme id. */
export type ThemePreference = "auto" | (string & {});

/** One custom brand theme entry compiled from plugin.yml. */
export interface BrandTheme {
  id: string;
  label: string;
  scheme: "dark" | "light";
  base: string;
  css: string;
}

/** What `data-theme` is set to on the bubble element. The two literals are the
 *  values of `DARK_TOKEN_SET` and `LIGHT_TOKEN_SET` in `constants.ts`, written
 *  out rather than read back with `typeof` so this file never imports the
 *  module that imports it. `constants.ts` pins each constant against this type
 *  with `satisfies`, so the two cannot drift apart without a compile error. */
export type TokenSet = "wa2-dark" | "wa2-light";

// --- relay-protocol.ts -----------------------------------------------------

export interface RelayRequest {
  type: "request";
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
  /** 136/005 — the model the request is for. The worker adds that model's
   *  provider key only when `url` is under that provider's endpoint. */
  modelRef: ModelRef;
}
export interface RelayAbort { type: "abort" }
export interface RelayHead {
  type: "head";
  status: number;
  statusText: string;
  /** Only `content-type` is forwarded. Re-attaching `content-length` or
   *  `content-encoding` from the real response would describe bytes the
   *  synthetic Response does not carry. */
  contentType: string | null;
}
export interface RelayChunk { type: "chunk"; b64: string }
export interface RelayEnd { type: "end" }
export interface RelayError { type: "error"; message: string }
export type RelayToWorker = RelayRequest | RelayAbort;
export type RelayToPage = RelayHead | RelayChunk | RelayEnd | RelayError;

/** What `handleRelayRequest` (relay-handler.ts) needs from the worker. */
export interface RelayHandlerDeps {
  readModels: (this: void) => Promise<{ entries: ModelEntry[]; token: string }>;
  fetchImpl: (input: string, init: RequestInit) => Promise<Response>;
  post: (this: void, msg: RelayToPage) => void;
  signal: AbortSignal;
}

// --- settings.ts -----------------------------------------------------------

/** What the options page writes under "agentSettings". 136/005 — the model
 *  fields moved to the model store (model-store.types.ts); a stored old
 *  object's endpoint, wireFormat, model and apiKey are ignored. */
export interface AgentSettings {
  /** How the bubble looks on a site that supplies no --wa-* tokens. */
  theme: ThemePreference;
}

/** What the bridge posts to the MAIN world with wa-bridge-enable and
 *  wa-bridge-toggle. No key and no header value. */
export interface BubblePayload {
  models: PublicModel[];
  current: ModelRef;
  theme: ThemePreference;
  brand: AgentBrand;
}

// --- brand.ts ----------------------------------------------------------

/** The only key `brand/plugin.yml`'s `prompts` block accepts; the build fails
 *  on any other. Side panel agents get their prompt from `instructions` in
 *  `brand/agents/<id>.yml` instead (see {@link BrandAgent}). */
export type AgentPromptKey = "inPage";

/** Settings a brand fixes for every install. */
export interface BrandOptions {
  /** True shows only brand models in the options page table and hides the
   *  row checkboxes (136/005). Enable, Default and Key still work. Absent
   *  means false. */
  lockModel?: boolean;
  /** True makes "+ Add model" offer the seven built-in providers and Custom
   *  first; absent means the custom form opens directly. */
  builtInProviders?: boolean;
}

/** One flag in `plugin.yml`'s `tools` or `skills` block. The same shape core
 *  uses for its own host opt-ins (`scheduler` and `todo`,
 *  packages/web-agent-core/src/controller.types.ts:118,121), so a flag reads
 *  like the config it drives. */
export interface BrandFlag {
  enabled: boolean;
}

/** The three tool groups `plugin.yml` may switch. An omitted group keeps its
 *  current default; `tool/compile-brand.cjs` fails the build on any other
 *  key. */
export type BrandToolGroup = "scheduler" | "todo" | "data";

/** The six skill groups `plugin.yml` may switch — the built-in sets the two
 *  agents spread. `core`, `dom` and `pageFetch` belong to the in-page bubble;
 *  `tab`, `websiteEdit` and `testing` to the side panel. */
export type BrandSkillGroup = "core" | "dom" | "pageFetch" | "tab" | "websiteEdit" | "testing";

export type BrandToolFlags = Partial<Record<BrandToolGroup, BrandFlag>>;
export type BrandSkillFlags = Partial<Record<BrandSkillGroup, BrandFlag>>;

/** The part of a session config a brand's `tools` block writes. Both agents
 *  build a config object of their own and spread this over it. */
export interface BrandCapabilityConfig {
  scheduler?: BrandFlag;
  todo?: BrandFlag;
  tools?: (ctx: ToolContext) => CustomToolDef[];
}

/** One side panel agent, from `brand/agents/<id>.yml`. `tools` / `skills` are
 *  `"*"` or a list of names; `excludeTools` / `excludeSkills` remove names
 *  from an otherwise-allowed set. */
export interface BrandAgent {
  id: string;
  displayName: string;
  description: string;
  instructions: string;
  /** The text of `brand/agents/<id>.home/AGENTS.md`. The side panel seeds it
   *  into this agent's `/home/agent/AGENTS.md` once, when that file does not
   *  exist (127/004). Absent means the agent has no starter file. */
  homeAgentsMd?: string;
  /** An id from `model.yml` in brand.json. `listAgents` turns it into the
   *  ModelRef `"brand:" + id` (136/005). Absent means the default model. */
  model?: string;
  tools: "*" | string[];
  excludeTools?: string[];
  skills: "*" | string[];
  excludeSkills?: string[];
}

/** The owner fields a saved-skill row needs. `BrandAgent` satisfies this
 *  structurally; the narrower shape keeps `saved-skills.ts` testable without
 *  a full brand. */
export interface AgentOwnerRef {
  id: string;
  displayName: string;
}

/** The compiled brand, as `dist/brand.json` holds it. Every key is always
 *  present, so a reader never has to test for a missing one. */
export interface AgentBrand {
  agents: BrandAgent[];
  /** The agent the side panel runs with no stored last-agent id (task 002).
   *  The build guarantees this names a file in `agents`. */
  defaultAgent: string;
  prompts: Partial<Record<AgentPromptKey, string>>;
  tools: BrandToolFlags;
  skills: BrandSkillFlags;
  options: BrandOptions;
  models: PresetEntry[];
  skillDefs: SkillDef[];
  /** plugin.yml `hosts`. The build turns this into the manifest's
   *  host_permissions; nothing at runtime reads it. Carried on the brand so
   *  one compile pass validates the whole folder before anything is written. */
  hosts: string[];
  /** plugin.yml `themes`. Custom themes the runtime registers with the theme
   *  registry. An empty list means the brand adds no theme. */
  themes: BrandTheme[];
}

/** The app-context fields this package reads or writes. Declared here rather
 *  than imported: `@cuatoi/web-agent-core` does not export `AppContext` from
 *  its entry point, and `@cuatoi/web-agent-lit` does not export
 *  `PanelAppContext` either (both checked 2026-09-11), while
 *  `wa/no-deep-import` forbids reaching past an entry point. */
export interface BrandableAppContext {
  appName?: string;
  appDescription?: string;
  appInstructions?: string;
}

/** Only the field `applyAgentBrand` writes. Keeps the unit test free of the
 *  real custom element, the same way `PanelLike` does for `panel-setup.ts`.
 *  Both `WebAgentBubble` and `AgentChatPanel` satisfy it with no cast —
 *  checked with `tsc --strict` in the refine. */
export interface BrandableElement {
  appContext?: BrandableAppContext;
}

// --- bridge-protocol.ts ----------------------------------------------------

/** One message on the window.postMessage channel between the MAIN world
 *  (content.ts) and the ISOLATED world (bridge.ts). The same shapes both files
 *  already send; this file only gives them a name. */
export type BridgeMessage =
  | { type: "wa-bridge-enable"; models?: PublicModel[]; current?: ModelRef; theme?: ThemePreference; brand?: AgentBrand }
  | { type: "wa-bridge-toggle"; models?: PublicModel[]; current?: ModelRef; theme?: ThemePreference; brand?: AgentBrand }
  | { type: "wa-bridge-send"; text: string }
  | { type: "wa-bridge-read" }
  | { type: "wa-bridge-state-request" }
  | { type: "wa-bridge-toggle-result"; mounted: boolean; foreign: boolean; requested: "on" | "off" }
  | { type: "wa-bridge-state"; mounted: boolean; foreign: boolean }
  | { type: "wa-bridge-send-result"; mounted: boolean; foreign: boolean; delivered: boolean; ranCommand: boolean; command?: string }
  | { type: "wa-bridge-read-result"; mounted: boolean; foreign: boolean; messages: { role: string; text: string }[]; running: boolean }
  | { type: "wa-bridge-set-origin-enabled"; origin: string; enabled: boolean }
  | { type: "wa-relay-req"; reqId: string; request: RelayToWorker }
  | { type: "wa-relay-res"; reqId: string; msg: RelayToPage }
  | { type: "wa-relay-abort"; reqId: string }
  | SkillsRequestMessage
  | SkillsResultMessage;

// --- relay-fetch.ts --------------------------------------------------------

type PostMessage = (message: unknown, targetOrigin: string) => void;
type AddListener = (type: string, listener: (event: MessageEvent) => void) => void;
type RemoveListener = (type: string, listener: (event: MessageEvent) => void) => void;

export interface RelayFetchContext {
  postMessage: PostMessage;
  addEventListener: AddListener;
  removeEventListener: RemoveListener;
}

// --- presets.ts ------------------------------------------------------------

/** One brand model from model.yml (or the compiled presets). The options
 *  page groups entries with the same endpoint and wire format into one
 *  provider row (136/005). */
export interface PresetEntry {
  /** Stable id. Its ModelRef is "brand:" + id. Never shown alone. */
  id: string;
  /** Shown in the table and the switchers. ASCII only — a missing glyph
   *  renders as a tofu box. */
  label: string;
  endpoint: string;
  wireFormat: WireFormat;
  model: string;
  /** True when the model accepts images. */
  vision: boolean;
  /** The provider row's display name. Absent: the endpoint's host and path. */
  provider?: string;
}

// --- panel-setup.ts --------------------------------------------------------

/** Only the fields this module writes. Keeps the unit test free of the real
 *  custom element. */
export interface PanelLike {
  path?: string;
  type?: string;
  model?: string;
  fetch?: typeof fetch;
  config?: { persist: boolean; sessionNamespace: string; maxIterations: number } & BrandCapabilityConfig;
  [key: string]: unknown;
}

// --- panel-toggle.ts -------------------------------------------------------

/** The tab the control acts on, as the tab itself reported it. */
export interface TabState {
  tabId: number;
  origin: string;
  mounted: boolean;
  foreign: boolean;
}

/** The two chrome calls this module needs, as narrow function types so a unit
 *  test can supply fakes without a chrome global. */
export type QueryTabs = (info: { active: true; currentWindow: true }) => Promise<{ id?: number }[]>;
export type SendToTab = (tabId: number, message: { type: string }) => Promise<unknown>;

/** What the control shows. The state is carried by the LABEL TEXT, never by
 *  colour alone, so it survives a greyscale conversion. */
export interface ToggleView {
  label: string;
  status: string;
  pressed: boolean;
  disabled: boolean;
}

// --- page-agent-tools.ts ---------------------------------------------------

/** One message in the bubble's conversation, as reported by the MAIN world. */
export interface PageAgentConversationMessage {
  role: string;
  text: string;
}

/** What the MAIN world reports back. Mirrors `src/types.ts` `TabAgentState` /
 *  `TabAgentSendResult` / `TabAgentReadResult` without importing from a
 *  content-script entry. */
export interface PageAgentReply {
  origin?: string;
  mounted?: boolean;
  foreign?: boolean;
  /** 002 — which direction the toggle asked for, decided by the MAIN world
   *  from its own state when the request arrived. Without it, "asked for ON
   *  and it is not on" is indistinguishable from "asked for OFF and it is
   *  off", and the panel reported a decline as a deliberate turn-off. */
  requested?: "on" | "off";
  delivered?: boolean;
  /** 001/113 — true only when the in-page panel actually resolved and handled
   *  a slash command. A `/new` that arrived as ordinary text is false. */
  ranCommand?: boolean;
  /** The command name, without the leading slash, when `ranCommand` is true. */
  command?: string;
  messages?: PageAgentConversationMessage[];
  running?: boolean;
}

// --- page-agent-delivery.ts ------------------------------------------------

/** What `reachedPageAgentSession` reports about one send. `delivered` keeps
 *  its old meaning exactly: the message reached the in-page panel's session.
 *  `ranCommand` is true only when the panel resolved a slash command. */
export interface PageAgentDelivery {
  delivered: boolean;
  ranCommand: boolean;
  command?: string;
}

/** The two chrome calls these tools need, as narrow function types so a unit
 *  test can supply fakes without a chrome global — same approach as
 *  `QueryTabs` / `SendToTab` at :243-244. */
export interface PageAgentApi {
  query: (queryInfo: chrome.tabs.QueryInfo) => Promise<chrome.tabs.Tab[]>;
  sendMessage: (tabId: number, message: Record<string, unknown> & { type: string }) => Promise<unknown>;
}

export interface PageAgentToolsOptions {
  pageAgentApi?: PageAgentApi;
  onToggle?: () => Promise<void> | void;
  /** Overridable for tests only, so a fixed-wait test does not really sleep. */
  sleep?: (ms: number) => Promise<void>;
  /** Overridable for tests only. Defaults to
   *  {@link DEFAULT_READ_RESULT_MAX_CHARS}. */
  maxChars?: number;
}

// --- page-eval-tool.ts -----------------------------------------------------

export interface PageEvalToolsOptions {
  /** Maximum serialized-result length before truncation. Defaults to
   *  {@link DEFAULT_PAGE_EVAL_MAX_CHARS}. */
  maxChars?: number;
  /** Test seam: runs the code and resolves with its value. Defaults to the
   *  page realm's own `AsyncFunction`, which is the whole point of the tool. */
  runner?: (code: string) => Promise<unknown>;
}

/** Declared in `src/core/types.ts` with `describeValue`, re-exported here so
 *  `src/lib/` keeps one import path for it (118/001). */
export type { DescribedValue, EvalResult } from "../core/types";

// --- page-fetch-tool.ts ----------------------------------------------------

export interface PageFetchToolsOptions {
  /** The origin to enforce same-origin against. Defaults to `location.origin` (or 'http://localhost' in tests). */
  currentOrigin?: string;
  /** Custom fetch implementation for tests. Defaults to `globalThis.fetch`. */
  fetch?: typeof fetch;
  /** Maximum response character length before truncation. Defaults to {@link DEFAULT_PAGE_FETCH_MAX_CHARS}. */
  maxChars?: number;
}

// --- tab-tools.ts ----------------------------------------------------------

export interface TabsApi {
  query: (queryInfo: chrome.tabs.QueryInfo) => Promise<chrome.tabs.Tab[]>;
  create: (createProperties: chrome.tabs.CreateProperties) => Promise<chrome.tabs.Tab>;
  update: (tabId: number, updateProperties: chrome.tabs.UpdateProperties) => Promise<chrome.tabs.Tab | undefined>;
  reload: (tabId: number, reloadProperties?: chrome.tabs.ReloadProperties) => Promise<void>;
  remove: (tabId: number) => Promise<void>;
  get: (tabId: number) => Promise<chrome.tabs.Tab>;
  onUpdated: {
    addListener: (callback: (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => void) => void;
    removeListener: (callback: (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => void) => void;
  };
}

export interface TabToolsOptions {
  confirmInteraction?: (detail: ConfirmInteractionDetail) => Promise<boolean>;
  tabsApi?: TabsApi;
  /** Bound for `navigate_tab`'s wait for the browser's own "complete" status.
   *  Defaults to {@link DEFAULT_NAVIGATE_COMPLETE_TIMEOUT_MS}. */
  navigateCompleteTimeoutMs?: number;
}

// --- theme.ts --------------------------------------------------------------

/** The two browser reads the theme needs. A unit test supplies fakes instead. */
export interface ThemeEnv {
  /** True when the visited page already supplies the --wa-* tokens. */
  siteSuppliesTokens(): boolean;
  /** The live "(prefers-color-scheme: dark)" media query list. */
  darkQuery(): MediaQueryList;
}

/** Returned by applyTheme so the caller can drop the media-query listener. */
export interface ThemeBinding {
  dispose(): void;
}

// --- skill-registry.ts / recorder.types.ts re-exports -----------------------
export type { SkillStorage, SkillsRequestMessage, SkillsResultMessage, PanelSkillOwner } from "./skill-registry.types";
export type { RecordedStep, RecordedStepKind, RecordingApi, RecordingController, RecordingResult, RecordingState } from "./recorder.types";
export type { WatchMeProvider, WatchMeProviderOptions, WatchMeProviderState } from "./watch-me-provider.types";

// --- act-by-ref (122/001) and verify/locator (122/002) page tools -----------
// Types live in act-by-ref-tools.types.ts and verify-locator-tools.types.ts, to
// stay under this file's line cap; re-exported so "./types" imports still work.

export type * from "./act-by-ref-tools.types";
export type * from "./verify-locator-tools.types";
export type * from "./element-target.types";

// --- page-screenshot-tool.ts ------------------------------------------------

export type { CaptureApi, PageScreenshotToolOptions };

// --- panel-page-tools.ts ----------------------------------------------------

export interface RecordingToolsOptions {
  recording?: RecordingController;
}

export interface PanelPageToolsOptions
  extends PageScreenshotToolOptions, DebuggerToolsOptions, RecordingToolsOptions {
  /** The panel's own vfs handle (sidepanel.ts:buildAgentPanel). page_screenshot and
   *  stop_recording save what they produce into it (127/003). */
  vfs: VfsHandle;
  /** The panel's own confirm gate for the "ask" permission tier on
   *  `page_click`, `page_fill_form` and `page_select_option` (122/001). Absent
   *  means every "ask"-tier action proceeds unconfirmed. */
  confirmInteraction?: (detail: ConfirmInteractionDetail) => Promise<boolean>;
  /** 131/004 — called with a tab's origin the moment a tool has confirmed it,
   *  so the step phrases can name the host (page-tool-phrases.ts:11-24).
   *  `forwardToTab` used to make this call; start_debugging makes it now. */
  onActivatedOrigin?: (tabId: number, origin: string) => void;
  /** Overridable for tests only. Defaults to each tool's own
   *  `DEFAULT_PAGE_*_MAX_CHARS` constant. */
  maxChars?: number;
  /** Overridable for tests only. Tracks the last seen documentId per tab. */
  lastSeenDocumentId?: Map<number, string>;
  /** 131/002 — the isolated-world helper the ref tools call. `createPanelPageTools`
   *  always supplies one; a direct caller (and every unit test) may pass its own. */
  helper?: HelperWorlds;
  /** 131/004 — one recorder driver per panel. `createPanelPageTools` always
   *  supplies one; a unit test may pass a fake. */
  recorder?: DebuggerRecorder;
}
