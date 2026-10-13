import { DEFAULT_THEME } from "./constants";
import { PRESET_ENTRIES } from "./presets";
import type { AgentBrand, AgentSettings, PresetEntry } from "./types";

/** The model list this build offers.
 *
 *  A brand that shipped `model.yml` decides the list. An empty list means the
 *  brand was compiled without one, or `brand.json` could not be read at all —
 *  the compiled presets are then the degrade path, the same rule task 001 set
 *  for the agent prompts. */
export function resolveModels(brand: AgentBrand): PresetEntry[] {
  return Array.isArray(brand.models) && brand.models.length > 0
    ? brand.models
    : PRESET_ENTRIES;
}

/** What a profile with nothing stored uses. The FIRST entry of the brand's
 *  model list, plus an empty key and the default theme.
 *
 *  `resolveModels` never returns an empty array — `PRESET_ENTRIES` has six
 *  entries — so `[0]` is always defined. */
export function defaultSettings(brand: AgentBrand): AgentSettings {
  const first = resolveModels(brand)[0];
  return {
    endpoint: first.endpoint,
    wireFormat: first.wireFormat,
    model: first.model,
    streaming: first.streaming,
    apiKey: "",
    theme: DEFAULT_THEME,
  };
}
