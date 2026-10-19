import { resolveModels } from "./brand-models";
import type {
  AgentBrand,
  AgentModelChoice,
  CustomProvider,
  ModelEntry,
  ModelRef,
  ModelStorage,
  ModelStore,
  PresetEntry,
  ResolvedProvider,
  SetEnabledResult,
} from "./types";

export const MODEL_STORE_KEY = "modelStore";
export const BRAND_REF_PREFIX = "brand:";
export const LAST_MODEL_HINT = "At least one model must stay on.";

export const EMPTY_MODEL_STORE: ModelStore = {
  providers: [],
  brandKeys: {},
  disabled: [],
  defaultModel: null,
};

export const chromeModelStorage: ModelStorage = {
  get: (key) => chrome.storage.local.get(key),
  set: (items) => chrome.storage.local.set(items),
};

export function brandRef(id: string): ModelRef {
  return BRAND_REF_PREFIX + id;
}

export function brandProviderId(entry: Pick<PresetEntry, "wireFormat" | "endpoint">): string {
  return `brand:${entry.wireFormat}:${entry.endpoint}`;
}

/** The first non-empty `provider` in the group, else the endpoint's host and
 *  path without a trailing slash, e.g. "localhost:28780/api/anthropic". */
export function brandProviderName(group: PresetEntry[]): string {
  const named = group.find((e) => typeof e.provider === "string" && e.provider.trim() !== "");
  if (named?.provider) return named.provider;
  const url = new URL(group[0].endpoint);
  return (url.host + url.pathname).replace(/\/+$/, "");
}

/** Every model in table order: brand groups in model.yml order, then
 *  custom providers in stored order. */
export function listModels(brand: AgentBrand, store: ModelStore): ModelEntry[] {
  const out: ModelEntry[] = [];
  const groups = new Map<string, PresetEntry[]>();
  for (const e of resolveModels(brand)) {
    const id = brandProviderId(e);
    const group = groups.get(id);
    if (group) group.push(e);
    else groups.set(id, [e]);
  }
  for (const [id, group] of groups) {
    const provider: ResolvedProvider = {
      id,
      kind: "brand",
      name: brandProviderName(group),
      endpoint: group[0].endpoint,
      wireFormat: group[0].wireFormat,
      apiKey: store.brandKeys[id] ?? "",
      headers: [],
    };
    for (const e of group) {
      const ref = brandRef(e.id);
      out.push({
        ref,
        label: e.label,
        model: e.model,
        // `=== true`: a hand-patched brand.json may lack the key.
        vision: e.vision === true,
        provider,
        kind: "brand",
        enabled: !store.disabled.includes(ref),
      });
    }
  }
  for (const p of store.providers) {
    const provider: ResolvedProvider = {
      id: p.id,
      kind: "custom",
      name: p.name,
      endpoint: p.endpoint,
      wireFormat: p.wireFormat,
      apiKey: p.apiKey,
      headers: p.headers,
    };
    for (const d of p.models) {
      const ref = `${p.id}/${d.model}`;
      out.push({
        ref,
        label: d.label,
        model: d.model,
        vision: d.vision === true,
        provider,
        kind: "custom",
        enabled: !store.disabled.includes(ref),
      });
    }
  }
  return out;
}

export function enabledModels(entries: ModelEntry[]): ModelEntry[] {
  return entries.filter((e) => e.enabled);
}

export function resolveDefault(entries: ModelEntry[], store: ModelStore): ModelEntry | null {
  const on = enabledModels(entries);
  return on.find((e) => e.ref === store.defaultModel) ?? on[0] ?? null;
}

export function resolveRef(entries: ModelEntry[], ref: ModelRef): ModelEntry | null {
  return entries.find((e) => e.ref === ref) ?? null;
}

/** The agent's own model when it is on; otherwise the default, with
 *  `fellBack` true when the agent named a model. With every model off (only
 *  reachable by editing storage by hand) the first listed model answers. */
export function modelForAgent(
  entries: ModelEntry[],
  store: ModelStore,
  agentModel: ModelRef | undefined,
): AgentModelChoice {
  const e = agentModel ? resolveRef(entries, agentModel) : null;
  if (e && e.enabled) return { entry: e, fellBack: false };
  return { entry: resolveDefault(entries, store) ?? entries[0], fellBack: !!agentModel };
}

/** Turns one model on or off. Refuses to turn off the last enabled model.
 *  Turning off the default moves the default to the first other enabled
 *  model in table order. */
export function setEnabled(
  entries: ModelEntry[],
  store: ModelStore,
  ref: ModelRef,
  on: boolean,
): SetEnabledResult {
  const enabled = enabledModels(entries);
  if (!on && enabled.length === 1 && enabled[0].ref === ref) {
    return { ok: false, hint: LAST_MODEL_HINT };
  }
  const currentDefault = resolveDefault(entries, store)?.ref ?? null;
  const disabled = on
    ? store.disabled.filter((r) => r !== ref)
    : store.disabled.includes(ref) ? [...store.disabled] : [...store.disabled, ref];
  let defaultModel = store.defaultModel;
  if (!on && ref === currentDefault) {
    defaultModel = enabled.find((e) => e.ref !== ref)?.ref ?? null;
  }
  return { ok: true, store: { ...store, disabled, defaultModel } };
}

/** Only an enabled model can be the default; any other ref changes nothing. */
export function setDefault(entries: ModelEntry[], store: ModelStore, ref: ModelRef): ModelStore {
  const e = resolveRef(entries, ref);
  if (!e || !e.enabled) return store;
  return { ...store, defaultModel: ref };
}

export function setBrandKey(store: ModelStore, providerId: string, key: string): ModelStore {
  return { ...store, brandKeys: { ...store.brandKeys, [providerId]: key.trim() } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads "modelStore" tolerantly: a value of the wrong shape reads as empty,
 *  field by field, the same tolerance readAgentStore gives (agent-store.ts:26-56). */
export async function readModelStore(storage: ModelStorage = chromeModelStorage): Promise<ModelStore> {
  const got = await storage.get(MODEL_STORE_KEY);
  const raw = got[MODEL_STORE_KEY];
  if (!isRecord(raw)) return { ...EMPTY_MODEL_STORE };
  const providers = Array.isArray(raw.providers)
    ? (raw.providers as unknown[]).filter(
        (p): p is CustomProvider => isRecord(p) && typeof p.id === "string" && Array.isArray(p.models),
      )
    : [];
  const brandKeys: Record<string, string> = {};
  if (isRecord(raw.brandKeys)) {
    for (const [id, key] of Object.entries(raw.brandKeys)) {
      if (typeof key === "string") brandKeys[id] = key;
    }
  }
  const disabled = Array.isArray(raw.disabled)
    ? (raw.disabled as unknown[]).filter((r): r is string => typeof r === "string")
    : [];
  const defaultModel = typeof raw.defaultModel === "string" && raw.defaultModel ? raw.defaultModel : null;
  return { providers, brandKeys, disabled, defaultModel };
}

export async function writeModelStore(
  store: ModelStore,
  storage: ModelStorage = chromeModelStorage,
): Promise<void> {
  await storage.set({ [MODEL_STORE_KEY]: store });
}
