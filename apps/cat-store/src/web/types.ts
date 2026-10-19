// types.ts — shared shapes for the top-level modules of the cat-store browser
// app.

import type { GenuiToolHost } from "./store/types";
import type { GenuiConfig } from "./genui/genui-config";
import type { AgentChatPanel, BlockRenderer, PanelScreen } from "@cuatoi/web-agent-lit";
import type {
  AgentHooks,
  CuesConfig,
  CustomToolDef,
  ModelOption,
  SessionConfig,
  SkillDef,
  SkillRegistry,
  SourceEntry,
  ToolProvider,
} from "@cuatoi/web-agent-core";

// --- agent-panel-config.ts --------------------------------------------------

/** One testable provider/model/mode combination. The switcher in
 *  agent-page.view.ts renders this list and writes these four values onto the
 *  panel; adding a combination means adding an entry here and nothing else.
 *  Host-only by design: none of this reaches @cuatoi/web-agent-core or
 *  @cuatoi/web-agent-lit. */
export interface ProviderEntry {
  /** Stable id, used as the option key and in tests. Never shown to the user. */
  id: string;
  /** Shown in the picker. ASCII only — a missing glyph renders as a tofu box. */
  label: string;
  /** Maps to `panel.type` -> SessionConfig.endpointType. */
  endpointType: "openai" | "anthropic" | "gemini" | "fallback-chain";
  /** Maps to `panel.path` -> SessionConfig.baseURL. */
  path: string;
  /** Maps to `panel.model`. */
  model: string;
}

export interface AgentPanelOptions {
  /** true → the agent can see and drive the page (bubble mode).
   *  false → no DOM tools, no DOM skill, no action cue, no confirm scrim
   *  (full-page mode). This flag is the ONLY difference between the two. */
  domAccess: boolean;
  /** Supplied only by <agent-page>, which owns the generative UI frame. When
   *  it is absent — bubble mode — render_agent_ui is not registered, which is
   *  what keeps the bubble out of scope for task 008. */
  genui?: GenuiToolHost;
}

export interface AgentPageGenuiHost {
  mount(source: string): Promise<void>;
  drainDiagnostics(): unknown[];
  validateSource(source: string, configOverride?: GenuiConfig): Promise<unknown>;
}

export interface PanelProps {
  fetch: typeof fetch;
  store: AgentChatPanel["store"];
  appContext: NonNullable<AgentChatPanel["appContext"]>;
  config: Partial<SessionConfig>;
  agentName: string;
  agentShortName: string;
  agentAvatar: string;
  type: string;
  path: string;
  model: string;
  models: ModelOption[];
  imageInput: boolean | undefined;
  renderers: BlockRenderer[];
  sources: SourceEntry[];
  tools: CustomToolDef[];
  skills: SkillDef[];
  skillRegistry: SkillRegistry;
  cues?: CuesConfig;
  toolProviders: ToolProvider[];
  screens: PanelScreen[];
  notify: (msg: string) => void;
  hooks: AgentHooks;
}

// --- agent-prompt-config.ts -------------------------------------------------

export interface CustomPromptConfig {
  role?: string;
  tone?: string;
  length?: string;
  language?: string;
  extra?: string;
}

export interface PresetOption {
  label: string;
  sample: string;
}

// --- panel-resize.ts --------------------------------------------------------

export interface Size {
  width: number;
  height: number;
}

// --- router.ts --------------------------------------------------------------

export type OnNavigateCb = (path: string) => void;
