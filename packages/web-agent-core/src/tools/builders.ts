import type { CustomToolDef, ToolContext } from "./types.js";
import type { JsonSchemaObject } from "../types.js";
import {
  WAIT_DEF,
  LIST_DATA_SOURCES_DEF, GET_FIELD_DETAILS_DEF, SAMPLE_FIELD_VALUES_DEF, QUERY_DATA_DEF, type ToolDef,
} from "./definitions.js";
import { runWait } from "./wait.js";
import { getTimeTool } from "./get-time.js";
import { runListDataSources } from "./list-data-sources.js";
import { runGetFieldDetails } from "./get-field-details.js";
import { runSampleFieldValues } from "./sample-field-values.js";
import { runQueryData } from "./query-data.js";
import { runShowGenerativeUi, SHOW_GENERATIVE_UI_SCHEMA } from "./show-generative-ui.js";
import {
  ALREADY_REQUESTED,
  COMPACTION_IN_PROGRESS,
  COMPACTION_NOT_AVAILABLE,
  NEEDS_CONFIRMATION,
  NOTHING_TO_COMPACT,
  REQUESTED_BASE,
  REQUESTED_FOLLOW_UP,
  REQUESTED_TAIL,
  UNCONFIRMED_REPEAT,
} from "./compaction-messages.js";

import { skillTools } from "./skill-tools.js";
import { schedulerTools } from "./scheduler-tools.js";
import { todoTools } from "./todo-tools.js";

// Re-exported so this module's public surface is unchanged: every symbol that
// could be imported from here before the split can still be imported from here.
export { skillTools, schedulerTools, todoTools };

/** Convert a §5 ToolDef + its handler into a CustomToolDef. */
function fromDef(
  def: ToolDef,
  execute: CustomToolDef["execute"],
): CustomToolDef {
  return {
    name: def.name,
    description: def.description,
    inputSchema: def.inputSchema,
    promptSnippet: def.promptSnippet,
    execute,
  };
}

/** wait — an unconditional pause. Stays in core (007 decision 4). */
export function waitTools(): CustomToolDef[] {
  return [fromDef(WAIT_DEF, runWait)];
}

/** get_time — reads the clock. One optional IANA `timezone`; the system zone
 *  when it is omitted. Uses only the runtime's Intl, so it adds no dependency. */
export function timeTools(): CustomToolDef[] {
  return [getTimeTool];
}

/** list_data_sources, get_field_details, sample_field_values, query_data. */
export function dataTools(): CustomToolDef[] {
  return [
    fromDef(LIST_DATA_SOURCES_DEF, runListDataSources),
    fromDef(GET_FIELD_DETAILS_DEF, runGetFieldDetails),
    fromDef(SAMPLE_FIELD_VALUES_DEF, runSampleFieldValues),
    fromDef(QUERY_DATA_DEF, runQueryData),
  ];
}

/** show_generative_ui (stays in core). No prompt snippet (matches current). */
export function genuiTools(): CustomToolDef[] {
  return [
    {
      name: "show_generative_ui",
      description:
        "Present an interactive generative-UI block to the user at the current turn position. " +
        'Use type="buttons" for up to 6 quick-reply buttons, or type="form" for an input form. ' +
        "On invalid input the tool returns a precise error so you can fix and retry.",
      inputSchema: SHOW_GENERATIVE_UI_SCHEMA,
      execute: runShowGenerativeUi,
    },
  ];
}

/** compact_conversation (108/001) — the model-facing half of the same
 *  compaction action `/compact` runs. Two OPTIONAL inputs: `confirmation`
 *  gates the action behind an explicit request from the user or a skill, and
 *  `followUp` is the work to carry on with once the context is compacted.
 *  The two-property schema was probed against the real Messages endpoint on
 *  2026-09-05 (HTTP 200, and the model filled both fields in one call).
 *  Reads `ctx._requestCompaction` at execute time, so a context with no
 *  controller behind it reports the tool as unavailable instead of throwing.
 *  The tool renders a verdict; it never decides one — the controller is the
 *  only place that can see all four conditions. */
export function compactionTools(): CustomToolDef[] {
  const compactionSchema: JsonSchemaObject = {
    type: "object",
    properties: {
      confirmation: {
        type: "boolean",
        description:
          "Set true ONLY when the user or a skill explicitly asked you to " +
          "compact. Leave unset if compacting is your own idea.",
      },
      followUp: {
        type: "string",
        description:
          "What to do once the context has been compacted. Runs as the next " +
          "turn, with the compacted context. Use this to carry on with the " +
          "work you needed the room for.",
      },
    },
    additionalProperties: false,
  };
  return [
    {
      name: "compact_conversation",
      description:
        "Summarise the conversation so far to free up context. Compaction is " +
        "lossy, so call it ONLY when the user or a skill explicitly asked for " +
        "it, and set confirmation to true when they did. If freeing room is " +
        "your own idea, do not call this tool. Pass followUp to say what " +
        "should happen in the next turn, once the context has been compacted.",
      inputSchema: compactionSchema,
      execute: async (input, ctx) => {
        // `require-await`: no internal await, but dropping `async` would turn a
        // throw from the host-supplied seam into a synchronous throw instead of
        // a rejection — the same reason search_skills is async.
        await Promise.resolve();
        if (!ctx._requestCompaction)
          return { content: COMPACTION_NOT_AVAILABLE, isError: true };

        const followUp =
          typeof input.followUp === "string" ? input.followUp : undefined;
        // The controller trims before recording, so the message uses the SAME
        // trim test — a whitespace-only followUp must not be announced.
        const hasFollowUp = (followUp ?? "").trim().length > 0;

        switch (ctx._requestCompaction(input.confirmation === true, followUp)) {
          case "needs-confirmation":
            return { content: NEEDS_CONFIRMATION };
          case "unconfirmed-repeat":
            return { content: UNCONFIRMED_REPEAT, isError: true };
          case "requested":
            return {
              content:
                REQUESTED_BASE +
                (hasFollowUp ? REQUESTED_FOLLOW_UP : "") +
                REQUESTED_TAIL,
            };
          case "already-requested":
            return { content: ALREADY_REQUESTED, isError: true };
          case "nothing-to-compact":
            return { content: NOTHING_TO_COMPACT, isError: true };
          case "in-progress":
            return { content: COMPACTION_IN_PROGRESS, isError: true };
        }
      },
    },
  ];
}

/** The default preset: every tool group this module exports. */
export function defaultTools(ctx: ToolContext): CustomToolDef[] {
  return [
    ...waitTools(),
    ...timeTools(),
    ...dataTools(),
    ...genuiTools(),
    ...skillTools(ctx),
    ...compactionTools(),
    ...schedulerTools(ctx),
    ...todoTools(ctx),
  ];
}
