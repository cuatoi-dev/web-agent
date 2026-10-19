import type {
  CustomProvider,
  HeaderPair,
  ModelDef,
  ModelEntry,
  ModelRef,
  ModelStore,
  ModelsDiff,
  ProviderFormDraft,
  ProviderFormErrors,
  ProviderFormModelRow,
} from "./types";

export const ENDPOINT_ERROR = "Enter an endpoint URL that starts with http:// or https://.";
export const EMPTY_MODELS_ERROR = "Add at least one model.";
export const DUPLICATE_MODELS_ERROR = "Each model ID can appear only once.";
export const PERMISSION_DENIED_ERROR = "Permission to reach this endpoint was not granted.";
export const API_KEY_HINT =
  "The key is stored unencrypted in this browser profile's extension storage. It is sent only to the endpoint above, and never to the web pages you visit.";

/** Validates the draft from the provider dialog. */
export function validateProviderDraft(draft: ProviderFormDraft): ProviderFormErrors {
  const errors: ProviderFormErrors = {};
  const endpoint = draft.endpoint.trim();
  if (!/^https?:\/\//i.test(endpoint)) {
    errors.endpoint = ENDPOINT_ERROR;
  } else {
    try {
      const url = new URL(endpoint);
      if (!url.host) errors.endpoint = ENDPOINT_ERROR;
    } catch {
      errors.endpoint = ENDPOINT_ERROR;
    }
  }

  const nonEmpty = draft.models.map((r) => r.model.trim()).filter((id) => id !== "");
  if (nonEmpty.length === 0) {
    errors.models = EMPTY_MODELS_ERROR;
  } else if (new Set(nonEmpty).size !== nonEmpty.length) {
    errors.models = DUPLICATE_MODELS_ERROR;
  }
  return errors;
}

/** Builds a normalized `CustomProvider` from a validated draft. Header rows
 *  with an empty trimmed name are dropped; blank provider name defaults to the
 *  endpoint's host; blank model label defaults to the model id. */
export function buildCustomProvider(
  draft: ProviderFormDraft,
  newId: (this: void) => string = () => crypto.randomUUID(),
): CustomProvider {
  const endpoint = draft.endpoint.trim();
  const host = new URL(endpoint).host;
  const name = draft.name.trim() || host;
  const headers: HeaderPair[] = draft.headers
    .map((h) => ({ name: h.name.trim(), value: h.value.trim() }))
    .filter((h) => h.name !== "");
  const models: ModelDef[] = draft.models
    .map((r) => ({
      model: r.model.trim(),
      label: r.label.trim() || r.model.trim(),
      vision: r.vision === true,
    }))
    .filter((r) => r.model !== "");
  const out: CustomProvider = {
    id: draft.id ?? newId(),
    name,
    wireFormat: draft.wireFormat,
    endpoint,
    apiKey: draft.apiKey.trim(),
    headers,
    models,
  };
  if (draft.builtIn) out.builtIn = draft.builtIn;
  return out;
}

/** Extracts unique non-empty model IDs in endpoint order from an OpenAI
 *  `/models` response body (`{ data: [{ id: string }, ...] }`), or `null` when
 *  the body does not have a `data` array of model objects with string IDs. */
export function parseModelsResponse(body: unknown): string[] | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const data = (body as Record<string, unknown>).data;
  if (!Array.isArray(data)) return null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of data) {
    if (typeof item === "object" && item !== null && typeof (item as Record<string, unknown>).id === "string") {
      const id = ((item as Record<string, unknown>).id as string).trim();
      if (id !== "" && !seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
  }
  return out;
}

/** Compares the endpoint's model IDs against the current form rows:
 *  - `add`: `ids − current` in endpoint order
 *  - `remove`: `current − ids` in form order
 *  - `keep`: `current ∩ ids` in form order */
export function compareModels(rows: ProviderFormModelRow[], endpointIds: string[]): ModelsDiff {
  const current: string[] = [];
  const currentSet = new Set<string>();
  for (const r of rows) {
    const id = r.model.trim();
    if (id !== "" && !currentSet.has(id)) {
      currentSet.add(id);
      current.push(id);
    }
  }
  const endpointSet = new Set(endpointIds);
  const add = endpointIds.filter((id) => !currentSet.has(id));
  const remove = current.filter((id) => !endpointSet.has(id));
  const keep = current.filter((id) => endpointSet.has(id));
  return { returnedCount: endpointIds.length, add, remove, keep };
}

/** Applies a confirmed `ModelsDiff` to the form's model rows: kept rows stay
 *  first with their existing `label` and `vision`, followed by added rows with
 *  `{ model: id, label: id, vision: false }`. */
export function applyModelsDiff(
  rows: ProviderFormModelRow[],
  diff: ModelsDiff,
): ProviderFormModelRow[] {
  const keepSet = new Set(diff.keep);
  const kept: ProviderFormModelRow[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const id = r.model.trim();
    if (id !== "" && keepSet.has(id) && !seen.has(id)) {
      seen.add(id);
      kept.push({ model: id, label: r.label, vision: r.vision });
    }
  }
  const added: ProviderFormModelRow[] = diff.add.map((id) => ({
    model: id,
    label: id,
    vision: false,
  }));
  return [...kept, ...added];
}

/** Joins human-readable names ("a", "a and b", "a, b, and c"). */
export function joinNames(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

export function deleteDialogTitle(count: number): string {
  return count === 1 ? "Delete 1 model?" : `Delete ${count} models?`;
}

/** Formats the confirmation copy for deleting the selected models. */
export function deleteDialogMessage(
  entries: ModelEntry[],
  store: ModelStore,
  selected: ReadonlySet<ModelRef>,
): string {
  const picked = entries.filter((e) => e.kind === "custom" && selected.has(e.ref));
  const labels = picked.map((e) => e.label);
  const emptied = store.providers
    .filter((p) => p.models.length > 0 && p.models.every((m) => selected.has(`${p.id}/${m.model}`)))
    .map((p) => p.name);
  const providerClause =
    emptied.length === 0
      ? ""
      : emptied.length === 1
        ? ` (and the ${emptied[0]} provider with them)`
        : ` (and the ${joinNames(emptied)} providers with them)`;
  return `This removes ${joinNames(labels)}${providerClause}. You cannot undo this.`;
}
