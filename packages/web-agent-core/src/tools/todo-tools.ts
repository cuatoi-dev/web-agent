import type { CustomToolDef, ToolContext } from "./types.js";
import type { JsonSchemaObject } from "../types.js";

const TODO_DISABLED_MESSAGE = "Todo tracking is turned off in this app.";

/** todoTools — todo_write, todo_read.
 *  Reads the ctx._todos seam off ToolContext. Mirrors schedulerTools: the two
 *  tools are OMITTED when the seam is absent, so a host with todo turned off
 *  never offers the model a tool that can only fail. Called with no ctx, it
 *  returns nothing. The TODO_DISABLED_MESSAGE guards inside each execute stay
 *  for the same reason as SCHEDULER_DISABLED_MESSAGE in scheduler-tools.ts: a host may build
 *  the tools from a context that has the seam and later run them against one
 *  where it has gone. */
export function todoTools(ctx?: ToolContext): CustomToolDef[] {
  if (!ctx?._todos) return [];

  const todoWriteSchema: JsonSchemaObject = {
    type: "object",
    properties: {
      items: {
        type: "array",
        description: "A full replacement list of todo items to set a new plan. Provide either items or updates, not both.",
        items: {
          type: "object",
          properties: {
            text: { type: "string", description: "One line of plan text." },
            status: {
              type: "string",
              enum: ["pending", "in_progress", "done"],
              description: "Defaults to 'pending' when omitted.",
            },
          },
          required: ["text"],
        },
      },
      updates: {
        type: "array",
        description: "Patches for existing items by id. Provide either items or updates, not both.",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "The id of the item to patch, from a previous todo_write or todo_read result." },
            text: { type: "string", description: "New text for the item. Omit to leave it unchanged." },
            status: {
              type: "string",
              enum: ["pending", "in_progress", "done"],
              description: "New status for the item. Omit to leave it unchanged.",
            },
          },
          required: ["id"],
        },
      },
    },
    additionalProperties: false,
  };

  const todoReadSchema: JsonSchemaObject = {
    type: "object",
    properties: {},
    additionalProperties: false,
  };

  return [
    {
      name: "todo_write",
      description: "Set or update the agent's multi-step plan. Pass 'items' to replace the full plan, or 'updates' to modify status or text of existing items by id.",
      inputSchema: todoWriteSchema,
      execute: async (input, ctx) => {
        await Promise.resolve();
        if (!ctx._todos) return { content: TODO_DISABLED_MESSAGE, isError: true };
        return ctx._todos.write(input);
      },
    },
    {
      name: "todo_read",
      description: "Read the current list of todos, showing each item's id, status, and description.",
      inputSchema: todoReadSchema,
      execute: async (_input, ctx) => {
        await Promise.resolve();
        if (!ctx._todos) return { content: TODO_DISABLED_MESSAGE, isError: true };
        return ctx._todos.read();
      },
    },
  ];
}
