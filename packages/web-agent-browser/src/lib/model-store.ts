import { resolveModels } from "./brand-models";
import { defaultKeyVault } from "./key-vault";
import type {
  AgentBrand,
  AgentModelChoice,
  CustomProvider,
  KeyVault,
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
 *  path without a trailing slash, e.g. "localhost:30000/api/anthropic". */
export function brandProviderName(group: PresetEntry[]): string {
  const named = group.find((e) => typeof e.provider === "string" && e.provider.trim() !== "");
  if (named?.provider) return named.provider;
  const url = new URL(group[0].endpoint);
  return (url.host + url.pathname).replace(/\/+$/, "");
}

/** The group's default key: the first entry, in model.yml order, with a
 *  non-blank `apiKey`; else "". Two entries with different keys: the first
 *  wins. */
export function brandDefaultKey(group: PresetEntry[]): string {
  const withKey = group.find((e) => typeof e.apiKey === "string" && e.apiKey.trim() !== "");
  return withKey?.apiKey?.trim() ?? "";
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
    // A Key-button key wins; otherwise the brand's default key.
    const userKey = (store.brandKeys[id] ?? "").trim();
    const defaultKey = brandDefaultKey(group);
    const provider: ResolvedProvider = {
      id,
      kind: "brand",
      name: brandProviderName(group),
      endpoint: group[0].endpoint,
      wireFormat: group[0].wireFormat,
      apiKey: userKey || defaultKey,
      keySource: userKey ? "user" : defaultKey ? "brand" : "none",
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
      builtIn: p.builtIn,
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

/** Upserts `provider` in `store.providers` (same index when editing, else
 *  appended). Newly added model refs are enabled (not in `disabled`). Refs of
 *  `provider` that no longer exist are removed from `disabled`; if
 *  `defaultModel` was one of them, `defaultModel` moves to the first enabled
 *  model. */
export function saveCustomProvider(
  brand: AgentBrand,
  store: ModelStore,
  provider: CustomProvider,
): ModelStore {
  const idx = store.providers.findIndex((p) => p.id === provider.id);
  const providers =
    idx >= 0
      ? store.providers.map((p, i) => (i === idx ? provider : p))
      : [...store.providers, provider];
  const prefix = `${provider.id}/`;
  const keptRefs = new Set(provider.models.map((m) => `${provider.id}/${m.model}`));
  const disabled = store.disabled.filter((r) => !r.startsWith(prefix) || keptRefs.has(r));
  const draft: ModelStore = { ...store, providers, disabled };
  const defaultRemoved =
    store.defaultModel !== null && store.defaultModel.startsWith(prefix) && !keptRefs.has(store.defaultModel);
  const defaultModel = defaultRemoved
    ? (enabledModels(listModels(brand, draft))[0]?.ref ?? null)
    : store.defaultModel;
  return { ...draft, defaultModel };
}

/** Deletes the custom models in `refs` (brand refs are ignored). Refuses when
 *  deleting `refs` would leave zero enabled models. Removes any custom
 *  provider whose models are all deleted, prunes `disabled`, and moves
 *  `defaultModel` to the first remaining enabled model when the current
 *  default was deleted. */
export function deleteModels(
  brand: AgentBrand,
  store: ModelStore,
  refs: ReadonlySet<ModelRef>,
): SetEnabledResult {
  const entries = listModels(brand, store);
  const customRefs = new Set(
    entries.filter((e) => e.kind === "custom" && refs.has(e.ref)).map((e) => e.ref),
  );
  if (customRefs.size === 0) return { ok: true, store };
  const remainingEnabled = enabledModels(entries).filter((e) => !customRefs.has(e.ref));
  if (remainingEnabled.length === 0) {
    return { ok: false, hint: LAST_MODEL_HINT };
  }
  const currentDefault = resolveDefault(entries, store)?.ref ?? null;
  const providers: CustomProvider[] = [];
  for (const p of store.providers) {
    const models = p.models.filter((m) => !customRefs.has(`${p.id}/${m.model}`));
    if (models.length > 0) providers.push({ ...p, models });
  }
  const disabled = store.disabled.filter((r) => !customRefs.has(r));
  const defaultModel =
    currentDefault && customRefs.has(currentDefault)
      ? (remainingEnabled[0]?.ref ?? null)
      : store.defaultModel;
  return { ok: true, store: { ...store, providers, disabled, defaultModel } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads "modelStore" tolerantly: a value of the wrong shape reads as empty,
 *  field by field, the same tolerance readAgentStore gives (agent-store.ts:26-56). */
export async function readModelStore(
  storage: ModelStorage = chromeModelStorage,
  vault: KeyVault | null = defaultKeyVault(),
): Promise<ModelStore> {
  const got = await storage.get(MODEL_STORE_KEY);
  const raw = got[MODEL_STORE_KEY];
  if (!isRecord(raw)) return { ...EMPTY_MODEL_STORE };
  const rawProviders = Array.isArray(raw.providers)
    ? (raw.providers as unknown[]).filter(
        (p): p is CustomProvider => isRecord(p) && typeof p.id === "string" && Array.isArray(p.models),
      )
    : [];
  const providers = rawProviders.map((p) => ({ ...p }));
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
  if (vault === null) return { providers, brandKeys, disabled, defaultModel };
  for (const p of providers) {
    if (typeof p.apiKey === "string") {
      p.apiKey = await vault.open(p.apiKey);
    }
  }
  for (const id of Object.keys(brandKeys)) {
    brandKeys[id] = await vault.open(brandKeys[id]);
  }
  return { providers, brandKeys, disabled, defaultModel };
}

export async function writeModelStore(
  store: ModelStore,
  storage: ModelStorage = chromeModelStorage,
  vault: KeyVault | null = defaultKeyVault(),
): Promise<void> {
  if (vault === null) {
    throw new Error("writeModelStore must run in an extension page");
  }
  const providers: CustomProvider[] = [];
  for (const p of store.providers) {
    providers.push({
      ...p,
      headers: p.headers.map((h) => ({ ...h })),
      models: p.models.map((m) => ({ ...m })),
      apiKey: await vault.seal(p.apiKey),
    });
  }
  const brandKeys: Record<string, string> = {};
  for (const [id, key] of Object.entries(store.brandKeys)) {
    brandKeys[id] = await vault.seal(key);
  }
  const copy: ModelStore = {
    providers,
    brandKeys,
    disabled: [...store.disabled],
    defaultModel: store.defaultModel,
  };
  await storage.set({ [MODEL_STORE_KEY]: copy });
}
