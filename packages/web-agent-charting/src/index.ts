import type { CustomToolDef, SkillDef } from "@cuatoi/web-agent-core";
import { runShowChart, SHOW_CHART_SCHEMA } from "./tools/show-chart.js";
import { runShowLiveChart, SHOW_LIVE_CHART_SCHEMA } from "./tools/show-live-chart.js";
import { chartSkill } from "./skills/chart-skill.js";

/** Charting tools — spread into a host's `tools:` like dataTools(). */
export function chartingTools(): CustomToolDef[] {
  return [
    {
      name: "show_chart",
      description:
        "Present a Chart.js chart to the user. The config you pass is a frozen snapshot: it " +
        "never refreshes. Use it for data that is not in a data source. If the data came from " +
        "a data source and the host offers a live chart tool that covers it, call that tool " +
        'instead. Call load_skill("chart") before your first chart ' +
        "to learn the config shape, supported types, per-type data rules, and worked examples. " +
        "Pass { title?, config } where config is a Chart.js 2.x config object. " +
        "On invalid config the tool returns a precise field-path error so you can fix and retry.",
      inputSchema: SHOW_CHART_SCHEMA,
      execute: runShowChart,
    },
    {
      name: "show_live_chart",
      description:
        "Present a live, query-bound, self-refreshing chart to the user for any data source. " +
        "Unlike show_chart, which takes a frozen snapshot, show_live_chart binds directly to a " +
        "data source query and updates when underlying data changes or on a refresh interval. " +
        'Call load_skill("chart") before your first chart to learn the encoding shape, ' +
        "supported marks, and field mapping. Pass { query, encoding, refresh?, title? }. " +
        "On invalid encoding or query the tool returns a precise field-path error so you can fix and retry.",
      inputSchema: SHOW_LIVE_CHART_SCHEMA,
      execute: runShowLiveChart,
    },
  ];
}

/** chart skill — spread into a host's `skills:` like coreSkills(). */
export function chartingSkills(): SkillDef[] {
  return [chartSkill];
}

export * from "./ui-blocks/chart-schema.js";
export * from "./ui-blocks/chart-normalize.js";
export { validateChartSchema, validateChartBlock } from "./ui-blocks/validate-chart.js";
export * from "./ui-blocks/chart-spec.js";
export { runShowChart, SHOW_CHART_SCHEMA } from "./tools/show-chart.js";
export { runShowLiveChart, SHOW_LIVE_CHART_SCHEMA } from "./tools/show-live-chart.js";
export { chartSkill } from "./skills/chart-skill.js";
