import { PRESET_ENTRIES } from "./presets";
import type { AgentBrand, PresetEntry } from "./types";

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
