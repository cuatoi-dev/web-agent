import type { CustomToolDef, ToolContext } from "./types.js";
import type { JsonSchemaObject } from "../types.js";

const SCHEDULER_DISABLED_MESSAGE = "Scheduling is turned off in this app.";

/** schedulerTools — set_schedule, list_schedules, cancel_schedule.
 *  Reads the ctx._scheduler seam off ToolContext. The three tools are OMITTED
 *  when the seam is absent, so a host with scheduling turned off never offers
 *  the model a tool that can only fail. Called with no ctx, it returns nothing.
 *  The SCHEDULER_DISABLED_MESSAGE guards inside each execute stay: a host may
 *  build the tools from a context that has the seam and later run them against
 *  one where it has gone. */
export function schedulerTools(ctx?: ToolContext): CustomToolDef[] {
  if (!ctx?._scheduler) return [];

  const setScheduleSchema: JsonSchemaObject = {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Unique name for the schedule or reminder. Used to cancel or list it.",
      },
      every: {
        type: "string",
        description: "Relative interval between runs, like '30s', '10m', or '2h'. Shortest interval is 1s.",
      },
      repeat: {
        type: "number",
        description: "How many times to run, from 1 to 36000. 1 creates a one-off reminder; 2 or more repeats.",
      },
      command: {
        type: "string",
        description: "A registered command name to run when it fires (e.g. 'compact'). Do not include the leading slash. Give either command or prompt, not both.",
      },
      prompt: {
        type: "string",
        description: "Literal prompt text to send to the agent when it fires. Give either command or prompt, not both.",
      },
    },
    required: ["name", "every", "repeat"],
    additionalProperties: false,
  };

  const listSchedulesSchema: JsonSchemaObject = {
    type: "object",
    properties: {},
    additionalProperties: false,
  };

  const cancelScheduleSchema: JsonSchemaObject = {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Exact name of the schedule to cancel.",
      },
    },
    required: ["name"],
    additionalProperties: false,
  };

  return [
    {
      name: "set_schedule",
      description: "Set a timer to repeat a prompt or command, or remind once. Give either a prompt or a command name, not both. Relative interval only (e.g. '30s', '10m', '2h').",
      inputSchema: setScheduleSchema,
      execute: async (input, ctx) => {
        await Promise.resolve();
        if (!ctx._scheduler) return { content: SCHEDULER_DISABLED_MESSAGE, isError: true };
        return ctx._scheduler.setSchedule(input);
      },
    },
    {
      name: "list_schedules",
      description: "List all scheduled jobs and reminders in this session, showing their name, kind, interval, target prompt or command, runs completed, and whether they are active or spent.",
      inputSchema: listSchedulesSchema,
      execute: async (_input, ctx) => {
        await Promise.resolve();
        if (!ctx._scheduler) return { content: SCHEDULER_DISABLED_MESSAGE, isError: true };
        return ctx._scheduler.listSchedules();
      },
    },
    {
      name: "cancel_schedule",
      description: "Cancel an active or spent schedule or reminder by name.",
      inputSchema: cancelScheduleSchema,
      execute: async (input, ctx) => {
        await Promise.resolve();
        if (!ctx._scheduler) return { content: SCHEDULER_DISABLED_MESSAGE, isError: true };
        return ctx._scheduler.cancelSchedule(input.name);
      },
    },
  ];
}
