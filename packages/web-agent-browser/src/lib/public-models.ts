import { providerIconSvg } from "./provider-builtins";
import type { ModelEntry, PublicModel } from "./types";

/** What the page may see of one model: never `apiKey`, never `headers`. A
 *  built-in provider contributes its own logo; every other provider gets the
 *  generic server icon. */
export function toPublicModel(e: ModelEntry): PublicModel {
  return {
    ref: e.ref,
    label: e.label,
    icon: providerIconSvg(e.provider.builtIn),
    vision: e.vision,
    endpoint: e.provider.endpoint,
    wireFormat: e.provider.wireFormat,
    model: e.model,
  };
}

/** The enabled models, in table order. */
export function toPublicModels(entries: ModelEntry[]): PublicModel[] {
  return entries.filter((e) => e.enabled).map(toPublicModel);
}
