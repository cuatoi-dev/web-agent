import type { AgentBrand, AgentPromptKey, BrandableElement } from "./types";

export type { AgentBrand, AgentPromptKey, BrandableElement } from "./types";

/** Every key a brand carries, all empty. What the runtime falls back to when
 *  `brand.json` is missing or unreadable, and what a message that carries no
 *  brand means. The build is what guarantees the real file is valid; the
 *  runtime must not brick an installed extension over it. */
export const EMPTY_BRAND: AgentBrand = {
  agents: [],
  defaultAgent: "",
  prompts: {},
  tools: {},
  skills: {},
  options: {},
  models: [],
  skillDefs: [],
  hosts: [],
  themes: [],
};

/** Gives one agent its own system prompt.
 *
 *  `appInstructions` renders a `# App instructions` section
 *  (`packages/web-agent-core/src/prompt/system-prompt.ts:121-122`). That
 *  section is part of `TAIL` (`:184`), and `buildSystemPromptParts` returns
 *  `static: PREFIX + TAIL` (`:204`), so a per-agent prompt stays inside the
 *  prompt-cache breakpoint instead of busting it every turn.
 *
 *  An absent prompt sets `appInstructions` to `undefined`, and the section is
 *  then left out entirely — which is exactly what "no brand" must look like.
 *  `appName` and `appDescription` are left as the caller set them; the
 *  identity move is task 004. */
export function applyAgentBrand(
  el: BrandableElement,
  brand: AgentBrand,
  which: AgentPromptKey,
): void {
  el.appContext = { ...el.appContext, appInstructions: brand.prompts[which] };
}
