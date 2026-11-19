import { formatHumanEvery, parseSavedOutput, type AuditEntry, type CompactionRowStatus } from "@cuatoi/web-agent-core";
import type { PhraseBuilder, ToolPhraseDef } from "./types.js";

const GENERIC_AGENT = "Agent";

function agentLabel(agentShortName?: string): string {
  const trimmed = agentShortName?.trim();
  return trimmed ? trimmed : GENERIC_AGENT;
}

function asRecord(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" ? (input as Record<string, unknown>) : {};
}

/** 'role "name"' or bare 'role' (from DomAdapter.describeElement()) →
 *  'the role "name"' / 'the role'. */
export function describeThing(desc: string): string {
  const m = /^(\S+)(?: "(.+)")?$/.exec(desc.trim());
  if (!m) return "an element";
  const [, role, name] = m;
  return name ? `the ${role} "${name}"` : `the ${role}`;
}

function extractClickDesc(outcomeSummary: string): string | undefined {
  const m = /^Clicked \[[^\]]+\] ([^.]+)\./.exec(outcomeSummary);
  return m?.[1]?.trim();
}

function extractFillDesc(outcomeSummary: string): string | undefined {
  const m = /^Filled \[[^\]]+\] ([^→]+)→/.exec(outcomeSummary);
  return m?.[1]?.trim();
}

const PHRASE_BUILDERS: Record<string, PhraseBuilder> = {
  click: (entry, agent) => {
    if (!entry.outcomeSummary.startsWith("Clicked [")) {
      return `${agent} tried to click an element`;
    }
    const desc = extractClickDesc(entry.outcomeSummary);
    return desc ? `${agent} clicked ${describeThing(desc)}` : `${agent} clicked an element`;
  },
  fill: (entry, agent) => {
    const { value } = asRecord(entry.input);
    const valueStr = typeof value === "string" ? value : undefined;
    if (!entry.outcomeSummary.startsWith("Filled [")) {
      return valueStr ? `${agent} tried to enter "${valueStr}"` : `${agent} tried to fill in a field`;
    }
    const desc = extractFillDesc(entry.outcomeSummary);
    const target = desc ? describeThing(desc) : "a field";
    return valueStr ? `${agent} entered "${valueStr}" into ${target}` : `${agent} filled in ${target}`;
  },
  select_option: (entry, agent) => {
    const { option } = asRecord(entry.input);
    const optionStr = typeof option === "string" ? option : undefined;
    if (!entry.outcomeSummary.startsWith('Selected "')) {
      return optionStr ? `${agent} tried to select "${optionStr}"` : `${agent} tried to select an option`;
    }
    return optionStr ? `${agent} selected "${optionStr}"` : `${agent} selected an option`;
  },
  see: (entry, agent) => {
    if (!entry.outcomeSummary.startsWith("Screenshot captured.")) {
      return `${agent} tried to take a screenshot`;
    }
    const { ref } = asRecord(entry.input);
    return typeof ref === "string" && ref
      ? `${agent} took a screenshot of part of the page`
      : `${agent} took a screenshot of the page`;
  },
  snapshot_page: (_entry, agent) => `${agent} looked at the page`,
  query_state: (_entry, agent) => `${agent} checked the app's data`,
  wait_for: (_entry, agent) => `${agent} waited for the page to update`,
  wait: (entry, agent) => {
    const { seconds } = asRecord(entry.input);
    return typeof seconds === "number" ? `${agent} waited ${seconds}s` : `${agent} waited`;
  },
  list_data_sources: (_entry, agent) => `${agent} looked at the available data`,
  query_data: (entry, agent) => {
    const { source } = asRecord(entry.input);
    return typeof source === "string" && source
      ? `${agent} looked through the ${source} data`
      : `${agent} looked through the data`;
  },
  show_generative_ui: (entry, agent) => {
    const { type } = asRecord(entry.input);
    return type === "form"
      ? `${agent} showed you a form`
      : `${agent} showed you some options`;
  },
  search_skills: (entry, agent) => {
    const { query } = asRecord(entry.input);
    return typeof query === "string" && query
      ? `${agent} searched skills for "${query}"`
      : `${agent} searched its skills`;
  },
  load_skill: (entry, agent) => {
    const { name } = asRecord(entry.input);
    const summary = entry.outcomeSummary;
    if (summary.startsWith("load_skill was called without a skill name"))
      return `${agent} could not load a skill — no skill name was given`;
    if (/^Skill ".*" not found\./.test(summary))
      return typeof name === "string" && name
        ? `${agent} could not load the ${name} skill — there is no such skill`
        : `${agent} could not load a skill — there is no such skill`;
    return typeof name === "string" && name
      ? `${agent} loaded the ${name} skill`
      : `${agent} loaded a skill`;
  },
  show_chart: (entry, agent) => {
    const { title } = asRecord(entry.input);
    return typeof title === "string" && title
      ? `${agent} drew a chart: ${title}`
      : `${agent} drew a chart`;
  },
  create_skill: (entry, agent) => {
    const { name } = asRecord(entry.input);
    const summary = entry.outcomeSummary;
    // Two distinct failure messages from skill-tools.ts differ in case:
    // "create_skill failed: …" (validation) and "Failed to save skill …"
    // (registry.save rejection) — match case-insensitively so both count.
    if (summary.includes("not confirmed") || /failed/i.test(summary)) {
      return typeof name === "string" && name
        ? `${agent} tried to save the ${name} skill`
        : `${agent} tried to save a skill`;
    }
    return typeof name === "string" && name
      ? `${agent} saved the ${name} skill`
      : `${agent} saved a skill`;
  },
  set_schedule: (entry, agent) => {
    const { name, every } = asRecord(entry.input);
    const nameStr = typeof name === "string" && name.trim() ? name.trim() : undefined;
    const humanEvery = formatHumanEvery(every);

    if (nameStr && humanEvery) {
      return `${agent} set the schedule "${nameStr}" to run every ${humanEvery}`;
    }
    if (humanEvery) {
      return `${agent} set a schedule of ${humanEvery}`;
    }
    if (nameStr) {
      return `${agent} set the schedule "${nameStr}"`;
    }
    return `${agent} set a schedule`;
  },
  list_schedules: (_entry, agent) => `${agent} checked what is scheduled`,
  cancel_schedule: (entry, agent) => {
    const { name } = asRecord(entry.input);
    const nameStr = typeof name === "string" && name.trim() ? name.trim() : typeof name === "number" ? `${name}` : undefined;
    return nameStr ? `${agent} cancelled the schedule "${nameStr}"` : `${agent} cancelled a schedule`;
  },
  get_time: (_entry, agent) => `${agent} checked the time`,
  // A committed plan renders as a numbered list whose first line starts
  // "1. [" (todo.ts renderList). Every other non-empty summary is one of the
  // store's rejection strings, so matching the SHAPE avoids hard-coding those
  // strings: if renderList's format ever changes, the phrase degrades to
  // "tried to update" instead of going wrong silently.
  todo_write: (entry, agent) => {
    if (!/^1\. \[/.test(entry.outcomeSummary)) {
      return `${agent} tried to update its plan`;
    }
    const { items, updates } = asRecord(entry.input);
    if (Array.isArray(items)) {
      return items.length === 0
        ? `${agent} cleared its plan`
        : `${agent} set a ${items.length}-step plan`;
    }
    // `updates`, and the malformed-input case that is still a write.
    void updates;
    return `${agent} updated its plan`;
  },
  todo_read: (entry, agent) =>
    entry.outcomeSummary === "Todo tracking is turned off in this app."
      ? `${agent} tried to check its plan`
      : `${agent} checked its plan`,
};

const IN_PROGRESS_PHRASES: Record<string, (agent: string) => string> = {
  click: (agent) => `${agent} is clicking…`,
  fill: (agent) => `${agent} is typing…`,
  select_option: (agent) => `${agent} is selecting an option…`,
  see: (agent) => `${agent} is taking a screenshot…`,
  snapshot_page: (agent) => `${agent} is looking at the page…`,
  query_state: (agent) => `${agent} is checking the app's data…`,
  wait_for: (agent) => `${agent} is waiting for the page to update…`,
  wait: (agent) => `${agent} is waiting…`,
  list_data_sources: (agent) => `${agent} is looking at the available data…`,
  query_data: (agent) => `${agent} is searching the data…`,
  show_generative_ui: (agent) => `${agent} is preparing some options…`,
  search_skills: (agent) => `${agent} is searching its skills…`,
  load_skill: (agent) => `${agent} is loading a skill…`,
  show_chart: (agent) => `${agent} is drawing a chart…`,
  create_skill: (agent) => `${agent} is saving a skill…`,
  set_schedule: (agent) => `${agent} is setting a schedule…`,
  list_schedules: (agent) => `${agent} is checking what is scheduled…`,
  cancel_schedule: (agent) => `${agent} is cancelling a schedule…`,
  get_time: (agent) => `${agent} is checking the time…`,
  todo_write: (agent) => `${agent} is updating its plan…`,
  todo_read: (agent) => `${agent} is checking its plan…`,
};

/** Friendly, host-facing phrase for one tool-step audit entry. Falls back
 *  to "{Agent} used the tool {name}" for any tool with no defined phrase
 *  (custom tools, or built-ins not in the friendly set). An unresolved
 *  (empty) outcomeSummary means the tool is still in progress, not failed —
 *  route it to a neutral present-tense phrase instead of the "tried to" wording.
 *  A tool that carries its own phrase wins over the built-in list; a phrase that throws is logged and falls through. */
export function baseToolStepPhrase(
  entry: AuditEntry,
  agentShortName?: string,
  toolPhrases?: Map<string, ToolPhraseDef>,
): string {
  const agent = agentLabel(agentShortName);
  const def = toolPhrases?.get(entry.name);
  if (!entry.outcomeSummary && (!entry.images || entry.images.length === 0)) {
    // A tool's own wording wins over the built-in list.
    if (def?.inProgressPhrase) {
      try {
        return def.inProgressPhrase(agent);
      } catch (err) {
        console.error(`Tool inProgressPhrase error for ${entry.name}`, err);
      }
    }
    const inProgress = IN_PROGRESS_PHRASES[entry.name];
    return inProgress ? inProgress(agent) : `${agent} is using ${entry.name}…`;
  }
  if (def?.phrase) {
    try {
      return def.phrase({ input: asRecord(entry.input), outcomeSummary: entry.outcomeSummary, failed: entry.failed === true }, agent);
    } catch (err) {
      // A broken phrase degrades the wording; it never breaks the thread.
      console.error(`Tool phrase error for ${entry.name}`, err);
    }
  }
  const builder = PHRASE_BUILDERS[entry.name];
  return builder ? builder(entry, agent) : `${agent} used the tool ${entry.name}`;
}

/** Append the saved-output path to the phrase chosen above. A saved
 *  result without a path (the block could not be saved) gets no suffix. */
export function toolStepPhrase(
  entry: AuditEntry,
  agentShortName?: string,
  toolPhrases?: Map<string, ToolPhraseDef>,
): string {
  const phrase = baseToolStepPhrase(entry, agentShortName, toolPhrases);
  const saved = parseSavedOutput(entry.outcomeSummary);
  return saved?.saved && saved.path
    ? phrase + " — full output saved to " + saved.path
    : phrase;
}

/** Friendly, host-facing phrase for the permanent compaction transcript row.
 *  Same agent-name resolution as toolStepPhrase (host's agentShortName, or the
 *  "Agent" fallback) — only "done" carries no status suffix. */
export function compactionPhrase(agentShortName: string | undefined, status: CompactionRowStatus): string {
  const agent = agentLabel(agentShortName);
  const suffix =
    status === "running" ? " · running"
    : status === "cancelled" ? " · cancelled"
    : status === "failed" ? " · failed"
    : "";
  return `${agent} compacts its context${suffix}`;
}
