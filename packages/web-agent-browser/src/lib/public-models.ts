import { providerIconSvg } from "./provider-builtins";
import type { AgentBrand, ModelEntry, PublicModel } from "./types";

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

/** The brand as the page may see it: every model is a copy without
 *  `apiKey`. Only the payload posted to the MAIN world goes
 *  through this; the side panel and the options page are extension pages
 *  and keep the full brand. */
export function pageBrand(brand: AgentBrand): AgentBrand {
  return {
    ...brand,
    models: brand.models.map((m) => {
      const copy = { ...m };
      delete copy.apiKey;
      return copy;
    }),
  };
}
