export { domTools } from "./tool-provider.js";
export type { DomToolsOptions, ConfirmInteractionDetail } from "./tool-provider.js";

export { DomAdapter, describeElementParts } from "./adapters/dom-adapter.js";
export type { DomAdapterOptions, ActionCueFn } from "./adapters/dom-adapter.js";
// The panel's page_verify and page_generate_locator run in the MAIN
// world and need the same role, name and visibility rules the snapshot uses.
export { getRole, getName } from "./adapters/element-semantics.js";
export { isElementVisible } from "./utils/visibility.js";
export { StateAdapter } from "./adapters/state-adapter.js";
export { RefTable } from "./adapters/ref-table.js";
export type { ResolveResult } from "./adapters/ref-table.js";
export { resolveAgentPermission } from "./adapters/permission-resolver.js";
export type { AgentPermission, PermissionResolution } from "./adapters/permission-resolver.js";

// The panel's act-by-ref page tools build their own disabled/block
// error text in content.ts (the MAIN world), ahead of the real action, so it
// can be reused byte-identical instead of duplicated in web-agent-browser.
export { disabledRef, blockedByPolicy } from "./tools/error-messages.js";

export { buildPointedElementsBlock } from "./utils/pointed-elements.js";
export type { PointedElementSnapshot } from "./utils/pointed-elements.js";

export { pickerAttachmentProvider } from "./picker-provider.js";
export type { PickerProviderOptions } from "./picker-provider.js";

import type { SkillDef } from "@cuatoi/web-agent-core";
import { multiStepUiSkill } from "./skills/multi-step-ui-skill.js";

/** multi_step_ui skill — spread into a host's `skills:` like chartingSkills(). */
export function domSkills(): SkillDef[] {
  return [multiStepUiSkill];
}

export { multiStepUiSkill } from "./skills/multi-step-ui-skill.js";
