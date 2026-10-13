import {
  approvedColoursRule,
  componentEquivalentsRule,
  registeredElementsRule,
} from "./genui-rules";
import type { GenuiConfig, GenuiResource, HtmlRule } from "./types";

export type { GenuiResource, GenuiRule, GenuiConfig } from "./types";

export const MATERIAL_GENUI_RESOURCES: GenuiResource[] = [
  { type: "style", url: "wa-tokens.css" },
  { type: "script", url: "genui-material.js", module: true },
];

export const PLAIN_GENUI_RESOURCES: GenuiResource[] = [
  { type: "style", url: "wa-tokens.css" },
];

/** Every custom element the frame registers: the nine Material tags from
 *  genui-material-bundle.ts, plus agent-chart-block from
 *  genui-chart-bundle.ts. The e2e spec asserts customElements.get(tag) inside
 *  the frame for every entry, so this list cannot drift from the bundles
 *  without a red test. */
export const MATERIAL_GENUI_COMPONENTS: string[] = [
  "md-filled-button",
  "md-outlined-button",
  "md-icon-button",
  "md-outlined-text-field",
  "md-checkbox",
  "md-linear-progress",
  "md-menu",
  "md-menu-item",
  "md-icon",
  "agent-chart-block",
];

/** Raw HTML controls that have a registered Material equivalent. Only tags in
 *  MATERIAL_GENUI_COMPONENTS appear on the right-hand side — advice that names
 *  an unregistered tag would fail registeredElementsRule on the retry. */
export const MATERIAL_COMPONENT_MAP: Record<string, string> = {
  button: "md-filled-button",
  input: "md-outlined-text-field",
  textarea: "md-outlined-text-field",
  progress: "md-linear-progress",
};

/** Curated, real --wa-* tokens named in the colour rule's prompt and
 *  every violation message. Verified 2026-08-27 against
 *  apps/cat-store/dist/web/genui/wa-tokens.css: every entry here is
 *  declared in all three theme blocks (1056 `--wa-*` declarations total)
 *  and actually resolves. Verify with a declaration-only grep, not a plain
 *  substring search — the stylesheet documents its own renames as comments
 *  (e.g. line 134: `/* substitution: --wa-primary-color ->
 *  --wa-action-color-info *\/`), and a substring match hits those
 *  comments too, which is how `--wa-primary-color` (0 real declarations —
 *  a legacy name, replaced) got onto this list the first time:
 *    grep -cE '^\s*<token>:' apps/cat-store/dist/web/genui/wa-tokens.css
 *  Every token below returns 3 (once per theme). There is no live "primary
 *  brand colour" token any more — wa-tokens.css's own migration comments
 *  route every `--wa-primary-*` name to `--wa-action-color-info`,
 *  which is why that token covers both roles here. The list is short on
 *  purpose — naming a handful of real tokens beats listing all 1056. */
export const GENUI_TOKEN_ROLES: Record<string, string> = {
  "--wa-text-color": "all text, headings and prices on page or card backgrounds",
  "--wa-background-color": "page and card backgrounds",
  "--wa-action-color-error": "fills and borders of error status badges, buttons and highlights",
  "--wa-action-color-success": "fills and borders of success status badges, buttons and highlights",
  "--wa-action-color-warn": "fills and borders of warning status badges, buttons and highlights",
  "--wa-action-color-info": "fills and borders of info status badges, buttons and highlights",
  "--wa-action-text-color-error": "only on a fill of the matching --wa-action-color-error; never on a card or page background",
  "--wa-action-text-color-success": "only on a fill of the matching --wa-action-color-success; never on a card or page background",
};

export const GENUI_APPROVED_COLOUR_TOKENS: string[] = Object.keys(GENUI_TOKEN_ROLES);

export const MATERIAL_GENUI_RULES: HtmlRule[] = [
  componentEquivalentsRule(MATERIAL_COMPONENT_MAP),
  approvedColoursRule({
    available: GENUI_APPROVED_COLOUR_TOKENS,
    roles: GENUI_TOKEN_ROLES,
  }),
  registeredElementsRule({ available: MATERIAL_GENUI_COMPONENTS }),
];

export const DEFAULT_GENUI_CONFIG: GenuiConfig = {
  resources: MATERIAL_GENUI_RESOURCES,
  rules: MATERIAL_GENUI_RULES,
  components: MATERIAL_GENUI_COMPONENTS,
};
