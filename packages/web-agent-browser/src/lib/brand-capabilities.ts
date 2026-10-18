import {
  dataTools,
  defaultTools,
  type CustomToolDef,
  type SkillDef,
  type ToolContext,
} from "@cuatoi/web-agent-core";
import type { AgentBrand, AgentSettings, BrandAgent, BrandCapabilityConfig, BrandSkillGroup } from "./types";

/**
 * The skills one agent gets: its own built-in groups, minus the ones the brand
 * switched off, with the brand's own skills merged over the top.
 *
 * The caller passes its own built-in groups, so the in-page agent and the side
 * panel each name only the sets they actually have. A group the brand does not
 * mention is kept — only an explicit `{ enabled: false }` drops one.
 *
 * A brand skill with the same `name` as a built-in REPLACES it, in the built-in's
 * position, so the merged list holds exactly one entry per name. This is
 * `config.skills`; the extension's saved-skill registry still merges OVER this
 * list inside core (controller-config.ts:197-205) and still wins a name clash.
 */
export function mergeBrandSkills(
  groups: Partial<Record<BrandSkillGroup, SkillDef[]>>,
  brand: AgentBrand,
): SkillDef[] {
  const kept: SkillDef[] = [];
  for (const group of Object.keys(groups) as BrandSkillGroup[]) {
    if (brand.skills[group]?.enabled === false) continue;
    kept.push(...(groups[group] ?? []));
  }

  const byName = new Map(kept.map((s) => [s.name, s]));
  for (const skill of brand.skillDefs) byName.set(skill.name, skill);
  return [...byName.values()];
}

/**
 * The session-config fields a brand's `tools` block writes. Spread it LAST over
 * the agent's own config literal, so a brand flag overrides the host's opt-in.
 *
 * `scheduler` and `todo` are core's own host opt-ins and flow straight through:
 * `todo: { enabled: false }` leaves `ctx._todos` unset, and `todoTools(ctx)`
 * then returns an empty list (tools/todo-tools.ts:14-15). `data`
 * has no such switch, so it is removed from the tool list instead, through
 * the existing `SessionConfig.tools` seam (config.types.ts:112). No core change.
 * The side panel drops `show_generative_ui` itself, with no brand flag, because
 * no brand may switch it on (lib/sidepanel-tool-filter.ts).
 *
 * `tools` is set ONLY when a group is actually switched off. With no flags the
 * agent keeps core's own factory, which is what makes the default build
 * identical to a build with no brand at all.
 */
export function brandToolConfig(brand: AgentBrand): BrandCapabilityConfig {
  const out: BrandCapabilityConfig = {};
  if (brand.tools.scheduler) out.scheduler = { enabled: brand.tools.scheduler.enabled };
  if (brand.tools.todo) out.todo = { enabled: brand.tools.todo.enabled };

  const drop = new Set<string>();
  if (brand.tools.data?.enabled === false) {
    for (const tool of dataTools()) drop.add(tool.name);
  }
  if (drop.size > 0) {
    out.tools = (ctx: ToolContext): CustomToolDef[] =>
      defaultTools(ctx).filter((tool) => !drop.has(tool.name));
  }
  return out;
}

/**
 * Checks whether an agent configuration allows a named tool or skill.
 */
export function agentAllows(
  list: "*" | string[],
  exclude: string[] | undefined,
  name: string,
): boolean {
  const allowed = list === "*" || list.includes(name);
  const excluded = (exclude ?? []).includes(name);
  return allowed && !excluded;
}

/**
 * Resolves the active agent definition from a compiled brand.
 */
export function resolveAgent(
  brand: AgentBrand,
  lastId?: string,
): BrandAgent | undefined {
  if (lastId) {
    const found = brand.agents.find((a) => a.id === lastId);
    if (found) return found;
  }
  return brand.agents.find((a) => a.id === brand.defaultAgent);
}

/**
 * Derives the effective settings for an agent, overriding model and endpoint
 * if specified in the agent's definition.
 */
export function effectiveSettings(
  settings: AgentSettings,
  brand: AgentBrand,
  agent: BrandAgent,
): AgentSettings {
  if (!agent.model) return settings;
  const entry = brand.models.find((m) => m.id === agent.model);
  if (!entry) return settings;
  return {
    ...settings,
    endpoint: entry.endpoint,
    wireFormat: entry.wireFormat,
    model: entry.model,
    streaming: entry.streaming,
  };
}
