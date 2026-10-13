import type { ToolOutcome } from "./types.js";
import type { JsonSchemaObject } from "../types.js";
import type { RenderableBlock } from "../ui-blocks/types.js";
import { validateUIBlock } from "../ui-blocks/schema.js";

export const SHOW_GENERATIVE_UI_SCHEMA: JsonSchemaObject = {
  type: "object",
  properties: {
    type: {
      type: "string",
      description: 'Block type: "buttons" or "form"',
    },
    options: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          prompt: { type: "string" },
        },
        required: ["label", "prompt"],
        additionalProperties: false,
      },
      description:
        'For type="buttons": up to 6 quick-reply buttons; each {label, prompt} — prompt is the message sent when the button is clicked',
    },
    id: {
      type: "string",
      description: 'For type="form": unique form id',
    },
    title: {
      type: "string",
      description: "Optional title (form)",
    },
    fields: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: {},
      },
      description:
        'For type="form": field defs — each {kind: "text"|"number"|"select"|"checkbox"|"date", name, label, ...}',
    },
    submit_label: {
      type: "string",
      description: 'For type="form": submit button label',
    },
  },
  required: ["type"],
  additionalProperties: false,
};

export async function runShowGenerativeUi(
  input: Record<string, unknown>,
): Promise<ToolOutcome> {
  const check = await validateUIBlock(input);
  if (!check.ok) {
    return { content: check.message, isError: true };
  }

  const block: RenderableBlock = check.value;
  return { content: "ui rendered", block };
}
