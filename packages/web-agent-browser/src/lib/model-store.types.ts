// The shapes for the model store (idea 136 task 005): stored providers and
// keys, the resolved model list, the public list the page may see, and the
// model switch. Split out of types.ts to stay under its 500-line cap
// (eslint.config.mjs max-lines). Imports nothing relative, so types.ts can
// import from it without a cycle — the rule skill-registry.types.ts follows.

import type { ModelOption, ToolProvider } from "@cuatoi/web-agent-core";

/** The three wire formats `bubble.type` accepts
 *  (web-agent-lit/src/embed/web-agent-embed.ts:100). Moved here from
 *  types.ts in 136/005; types.ts re-exports it. */
export type WireFormat = "openai" | "anthropic" | "gemini";

/** Names one model. Brand: "brand:" + model.yml id. Custom: provider id +
 *  "/" + API model id. */
export type ModelRef = string;

/** One custom request header of a custom provider. */
export interface HeaderPair {
  name: string;
  value: string;
}

/** One model of a custom provider. */
export interface ModelDef {
  /** The API model id sent on the wire. */
  model: string;
  label: string;
  vision: boolean;
}

/** A provider the user added (task 006 adds the form; this task only reads it). */
export interface CustomProvider {
  /** A uuid. */
  id: string;
  name: string;
  builtIn?: string;
  wireFormat: WireFormat;
  endpoint: string;
  apiKey: string;
  headers: HeaderPair[];
  models: ModelDef[];
}

/** `chrome.storage.local` key "modelStore". */
export interface ModelStore {
  providers: CustomProvider[];
  /** API key per brand provider id. Missing or empty = the shared Token. */
  brandKeys: Record<string, string>;
  /** Models switched off. Every other model is on. */
  disabled: ModelRef[];
  defaultModel: ModelRef | null;
}

/** A provider as every reader sees it: a brand group or a custom provider. */
export interface ResolvedProvider {
  id: string;
  kind: "brand" | "custom";
  name: string;
  endpoint: string;
  wireFormat: WireFormat;
  apiKey: string;
  headers: HeaderPair[];
}

/** One row of the model table, in table order. */
export interface ModelEntry {
  ref: ModelRef;
  label: string;
  /** The API model id sent on the wire. */
  model: string;
  vision: boolean;
  provider: ResolvedProvider;
  kind: "brand" | "custom";
  enabled: boolean;
}

/** What `modelForAgent` returns. `fellBack` is true when the agent names a
 *  model that is off or gone. */
export interface AgentModelChoice {
  entry: ModelEntry;
  fellBack: boolean;
}

/** `setEnabled`'s answer: the new store, or the hint for a refused switch. */
export type SetEnabledResult = { ok: true; store: ModelStore } | { ok: false; hint: string };

/** The resolved list plus the store it came from. */
export interface ModelContext {
  entries: ModelEntry[];
  store: ModelStore;
}

/** What the page may see of one model. Never a key, never a header. */
export interface PublicModel {
  ref: ModelRef;
  label: string;
  /** SVG markup for the kebab menu. */
  icon: string;
  vision: boolean;
  endpoint: string;
  wireFormat: WireFormat;
  model: string;
}

/** The two `chrome.storage.local` calls the model store needs, so a unit
 *  test can pass a fake — the approach of `AgentStorage`. */
export interface ModelStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

/** The element fields the model switch writes. `<web-agent-bubble>` and
 *  `<agent-chat-panel>` both have them. */
export interface ModelSwitchTarget {
  path?: string;
  type?: string;
  model?: string;
  imageInput?: boolean;
  models?: ModelOption[];
  selectedModel?: string;
  toolProviders?: ToolProvider[];
  addEventListener(type: string, listener: (event: Event) => void): void;
}

export interface ModelSwitchOptions {
  target: ModelSwitchTarget;
  /** The enabled models, in table order. Never empty. */
  models: PublicModel[];
  /** The ref to open on. */
  initial: ModelRef;
  /** True under `__WA_MOCK_SCRIPT__`: `type` stays "mock". */
  mock: boolean;
  /** The tool providers for a model with or without vision. Called on the
   *  first apply and whenever the vision flag changes. */
  buildToolProviders: (this: void, vision: boolean) => ToolProvider[];
}

export interface ModelSwitch {
  /** The current ref; the relay and the side panel fetch read it per request. */
  current(): ModelRef;
}

/** The callbacks of the options page model table. */
export interface ModelTableHandlers {
  lockModel: boolean;
  selected?: ReadonlySet<ModelRef>;
  onToggle(ref: ModelRef, on: boolean): void;
  onDefault(ref: ModelRef): void;
  onKey(provider: ResolvedProvider): void;
  onEdit?(providerId: string): void;
  onSelectionChange?(selected: Set<ModelRef>): void;
}

/** What the brand Key dialog shows. */
export interface BrandKeyDialogOptions {
  name: string;
  wireFormat: WireFormat;
  endpoint: string;
  /** The stored key, shown in the password field. "" when none. */
  current: string;
}

/** One model row inside the provider form before trimming/validation. */
export interface ProviderFormModelRow {
  model: string;
  label: string;
  vision: boolean;
}

/** The raw values read from the provider form. */
export interface ProviderFormDraft {
  id?: string;
  builtIn?: string;
  name: string;
  wireFormat: WireFormat;
  endpoint: string;
  apiKey: string;
  headers: HeaderPair[];
  models: ProviderFormModelRow[];
}

/** Field errors for the provider form (`undefined` when valid). */
export interface ProviderFormErrors {
  endpoint?: string;
  models?: string;
}

/** The comparison result for Refresh from /models. */
export interface ModelsDiff {
  returnedCount: number;
  add: string[];
  remove: string[];
  keep: string[];
}

/** Injected dependencies for Refresh from /models and Save permission checks. */
export interface ProviderDialogDeps {
  requestPermission?: (this: void, origin: string) => Promise<boolean>;
  fetchImpl?: typeof fetch;
  newId?: (this: void) => string;
}

/** Options for opening the custom provider dialog. */
export interface ProviderDialogOptions extends ProviderDialogDeps {
  /** Existing provider when editing; omitted when adding a new provider. */
  provider?: CustomProvider;
}
