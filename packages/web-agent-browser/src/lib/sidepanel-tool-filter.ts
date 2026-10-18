import {
  dataTools,
  defaultTools,
  genuiTools,
  type CustomToolDef,
  type ToolContext,
} from "@cuatoi/web-agent-core";
import type { AgentBrand } from "./types";

/** The tools the side panel never offers, whatever a brand or an agent asks for.
 *
 *  `show_generative_ui` is the only entry. It validates its own result with ajv
 *  (web-agent-core/src/tools/show-generative-ui.ts:56 ->
 *  web-agent-core/src/ui-blocks/schema.ts:283-284), and ajv builds the validator
 *  with `new Function` (web-agent-core/src/tools/validate-json-schema.ts:35).
 *  The extension page's Content Security Policy refuses that, so the check fails
 *  closed and the tool returns an error instead of a block. No brand may switch
 *  it back on. */
export const SIDE_PANEL_DROPPED_TOOL_NAMES: readonly string[] = genuiTools().map(
  (tool) => tool.name,
);

/** The side panel's core tool list: core's defaults, minus every tool in
 *  SIDE_PANEL_DROPPED_TOOL_NAMES, minus a brand group switched off. The agent's
 *  own `tools` / `excludeTools` filters this list afterwards (sidepanel.ts). */
export function sidePanelTools(brand: AgentBrand, ctx: ToolContext): CustomToolDef[] {
  const drop = new Set<string>(SIDE_PANEL_DROPPED_TOOL_NAMES);
  if (brand.tools.data?.enabled === false) {
    for (const tool of dataTools()) drop.add(tool.name);
  }
  return defaultTools(ctx).filter((tool) => !drop.has(tool.name));
}
