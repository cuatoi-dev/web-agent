import {
  dataTools,
  defaultTools,
  genuiTools,
  schedulerTools,
  todoTools,
  type SkillRegistry,
  type ToolContext,
} from "@cuatoi/web-agent-core";
import type { VfsHandle } from "@cuatoi/web-agent-vfs";
import type { AgentBrand } from "./types";
import type { MultiSelectGroup } from "./multi-select.types";
import { createTabTools } from "./tab-tools";
import { createPanelPageTools } from "./panel-page-tools";
import { createPageAgentTools } from "./page-agent-tools";
import { tabSkills } from "./tab-skill";
import { websiteEditSkill } from "./website-edit-skill";
import { testPlanSkill } from "./test-plan-skill";
import { mergeBrandSkills } from "./brand-capabilities";

/** A writable registry, so create_skill is listed: skill-tools.ts:132 adds
 *  it only when `save` is a function, and the side panel always passes one
 *  (sidepanel.ts:162). Never called. */
const STUB_REGISTRY: SkillRegistry = {
  list: () => Promise.resolve([]),
  get: () => Promise.resolve(undefined),
  save: () => Promise.resolve(),
};

/** A handle that only answers the tool catalogue. 127/003 — `toolGroups` builds
 *  the page tools to read their names, so it needs a `VfsHandle`; nothing here
 *  ever executes, and no storage is instantiated. */
const STUB_VFS: VfsHandle = {
  mounts: () => [],
  list: () => Promise.resolve([]),
  get: () => Promise.resolve(undefined),
  write: () => Promise.reject(new Error("Tool catalogue VFS cannot execute operations.")),
  delete: () => Promise.reject(new Error("Tool catalogue VFS cannot execute operations.")),
  mount: () => { throw new Error("Tool catalogue VFS cannot execute operations."); },
  unmount: () => false,
  subscribe: () => () => {},
};

/** Only truthiness is read at construction (scheduler-tools.ts:14,
 *  todo-tools.ts:15), so empty objects list the scheduler and todo names. */
const STUB_CTX = {
  _scheduler: {},
  _todos: {},
  skillRegistry: STUB_REGISTRY,
} as unknown as ToolContext;

const namesOf = (tools: { name: string }[]): string[] => tools.map((t) => t.name);

/** A name listed in more than one group appears once, in its first group.
 *  A group left with no names is dropped. */
export function uniqueGroups(groups: MultiSelectGroup[]): MultiSelectGroup[] {
  const seen = new Set<string>();
  const out: MultiSelectGroup[] = [];
  for (const g of groups) {
    const names = g.names.filter((n) => {
      if (seen.has(n)) return false;
      seen.add(n);
      return true;
    });
    if (names.length > 0) out.push({ heading: g.heading, names });
  }
  return out;
}

/** The design's toolGroups(brand). */
export function toolGroups(brand: AgentBrand): MultiSelectGroup[] {
  const drop = new Set<string>();
  if (brand.tools.data?.enabled === false) for (const n of namesOf(dataTools())) drop.add(n);
  if (brand.tools.genui?.enabled === false) for (const n of namesOf(genuiTools())) drop.add(n);
  if (brand.tools.scheduler?.enabled === false) for (const n of namesOf(schedulerTools(STUB_CTX))) drop.add(n);
  if (brand.tools.todo?.enabled === false) for (const n of namesOf(todoTools(STUB_CTX))) drop.add(n);

  return uniqueGroups([
    { heading: "Tabs", names: namesOf(createTabTools()) },
    // Listed for every model; the side panel still offers page_screenshot only
    // to a model with vision (panel-page-tools.ts:59, the vision gate).
    { heading: "Page", names: [...namesOf(createPanelPageTools({ vfs: STUB_VFS })), "page_screenshot"] },
    { heading: "Page agent", names: namesOf(createPageAgentTools()) },
    { heading: "Core", names: namesOf(defaultTools(STUB_CTX)).filter((n) => !drop.has(n)) },
  ]);
}

/** The design's skillNames(brand): the same call as sidepanel.ts:152-155.
 *  Saved skills are not listed. */
export function skillNames(brand: AgentBrand): MultiSelectGroup[] {
  const skills = mergeBrandSkills(
    {
      tab: tabSkills(),
      websiteEdit: [websiteEditSkill],
      testing: [testPlanSkill],
    },
    brand,
  );
  return uniqueGroups([{ heading: null, names: skills.map((s) => s.name) }]);
}
