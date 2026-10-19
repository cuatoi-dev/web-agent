import { ICON_SVGS } from "@cuatoi/web-agent-lit/ui/icon-svgs";
import type { ModelEntry, PublicModel } from "./types";

/** Brand and custom providers both use the generic server icon (idea 136
 *  item 22); task 007 adds the provider logos. */
export const PROVIDER_ICON = "dns";

/** What the page may see of one model: never `apiKey`, never `headers`. */
export function toPublicModel(e: ModelEntry): PublicModel {
  return {
    ref: e.ref,
    label: e.label,
    icon: ICON_SVGS[PROVIDER_ICON],
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
