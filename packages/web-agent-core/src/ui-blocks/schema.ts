import type { JsonSchemaObject } from "../types.js";
import type { RenderableBlock, UIBlock } from "./types.js";
export type {
  UIBlock,
  FormBlock,
  FormField,
  ButtonsBlock,
  ErrorCardBlock,
  PluginBlock,
  RenderableBlock,
} from "./types.js";

const SELECT_OPTIONS_SCHEMA = {
  anyOf: [
    { type: "array", items: { type: "string" } },
    {
      type: "object",
      properties: {
        item: {
          anyOf: [
            { type: "array", items: { type: "string" } },
            { type: "string" },
          ],
        },
      },
      required: ["item"],
      additionalProperties: false,
    },
  ],
};

export const FORM_FIELD_DEFS = {
  textField: {
    type: "object",
    properties: {
      kind: { const: "text" },
      name: { type: "string" },
      label: { type: "string" },
      placeholder: { type: "string" },
      required: { type: "boolean" },
    },
    required: ["kind", "name", "label"],
    additionalProperties: false,
  },
  numberField: {
    type: "object",
    properties: {
      kind: { const: "number" },
      name: { type: "string" },
      label: { type: "string" },
      min: { type: "number" },
      max: { type: "number" },
      required: { type: "boolean" },
    },
    required: ["kind", "name", "label"],
    additionalProperties: false,
  },
  selectField: {
    type: "object",
    properties: {
      kind: { const: "select" },
      name: { type: "string" },
      label: { type: "string" },
      options: SELECT_OPTIONS_SCHEMA,
      default: { type: "string" },
    },
    required: ["kind", "name", "label", "options"],
    additionalProperties: false,
  },
  checkboxField: {
    type: "object",
    properties: {
      kind: { const: "checkbox" },
      name: { type: "string" },
      label: { type: "string" },
      default: { type: "boolean" },
    },
    required: ["kind", "name", "label"],
    additionalProperties: false,
  },
  dateField: {
    type: "object",
    properties: {
      kind: { const: "date" },
      name: { type: "string" },
      label: { type: "string" },
      required: { type: "boolean" },
    },
    required: ["kind", "name", "label"],
    additionalProperties: false,
  },
  formField: {
    anyOf: [
      { $ref: "#/$defs/textField" },
      { $ref: "#/$defs/numberField" },
      { $ref: "#/$defs/selectField" },
      { $ref: "#/$defs/checkboxField" },
      { $ref: "#/$defs/dateField" },
    ],
  },
};

export const FormFieldSchema: JsonSchemaObject = {
  type: "object",
  $ref: "#/$defs/formField",
  $defs: FORM_FIELD_DEFS,
};

export const FormBlockSchema: JsonSchemaObject = {
  type: "object",
  properties: {
    type: { const: "form" },
    id: { type: "string" },
    title: { type: "string" },
    fields: {
      type: "array",
      items: { $ref: "#/$defs/formField" },
    },
    submit_label: { type: "string" },
  },
  required: ["type", "id", "fields"],
  additionalProperties: false,
  $defs: FORM_FIELD_DEFS,
};

export const ButtonsBlockSchema: JsonSchemaObject = {
  type: "object",
  properties: {
    type: { const: "buttons" },
    options: {
      type: "array",
      items: {
        type: "object",
        properties: {
          label: { type: "string" },
          prompt: { type: "string", maxLength: 500 },
        },
        required: ["label", "prompt"],
        additionalProperties: false,
      },
      maxItems: 6,
    },
  },
  required: ["type", "options"],
  additionalProperties: false,
};

// A block whose `type` core does not know (e.g. the chart block which lives
// in its own package). Validate only that it carries a string
// `type`; pass every other field through unchanged so a host/package-defined
// block flows through core → lit without core knowing its shape. Core-owned
// blocks keep their strong schemas above.
export const PluginBlockSchema: JsonSchemaObject = {
  type: "object",
  properties: {
    type: { type: "string" },
  },
  required: ["type"],
  additionalProperties: true,
};

export const UIBlockSchema: JsonSchemaObject = {
  type: "object",
  anyOf: [
    {
      properties: {
        type: { const: "form" },
        id: { type: "string" },
        title: { type: "string" },
        fields: {
          type: "array",
          items: { $ref: "#/$defs/formField" },
        },
        submit_label: { type: "string" },
      },
      required: ["type", "id", "fields"],
      additionalProperties: false,
    },
    {
      properties: {
        type: { const: "buttons" },
        options: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              prompt: { type: "string", maxLength: 500 },
            },
            required: ["label", "prompt"],
            additionalProperties: false,
          },
          maxItems: 6,
        },
      },
      required: ["type", "options"],
      additionalProperties: false,
    },
  ],
  $defs: FORM_FIELD_DEFS,
};

// Full renderable-block validator. Strong core schemas for form and buttons,
// plugin passthrough for unknown types.
export const RenderableBlockSchema: JsonSchemaObject = {
  type: "object",
  properties: {
    type: { type: "string" },
  },
  required: ["type"],
  allOf: [
    {
      if: { properties: { type: { const: "form" } } },
      then: {
        properties: {
          type: { const: "form" },
          id: { type: "string" },
          title: { type: "string" },
          fields: {
            type: "array",
            items: { $ref: "#/$defs/formField" },
          },
          submit_label: { type: "string" },
        },
        required: ["type", "id", "fields"],
        additionalProperties: false,
      },
    },
    {
      if: { properties: { type: { const: "buttons" } } },
      then: {
        properties: {
          type: { const: "buttons" },
          options: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                prompt: { type: "string", maxLength: 500 },
              },
              required: ["label", "prompt"],
              additionalProperties: false,
            },
            maxItems: 6,
          },
        },
        required: ["type", "options"],
        additionalProperties: false,
      },
    },
  ],
  $defs: FORM_FIELD_DEFS,
};

function normalizeBlockOutput<T extends Record<string, unknown>>(raw: T): T {
  if (raw.type === "form" && Array.isArray(raw.fields)) {
    const fields = raw.fields.map((f: Record<string, unknown>) => {
      if (f && f.kind === "select" && f.options && typeof f.options === "object" && !Array.isArray(f.options)) {
        const item = (f.options as Record<string, unknown>).item;
        return {
          ...f,
          options: Array.isArray(item) ? item : [item],
        };
      }
      return f;
    });
    return { ...raw, fields };
  }
  return raw;
}

/**
 * Validates a core UI block (form or buttons). Fails closed on any schema violation.
 */
export async function validateUIBlock(
  raw: unknown,
): Promise<{ ok: true; value: UIBlock } | { ok: false; message: string }> {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, message: "Invalid UI block: input must be an object." };
  }
  try {
    const { validateJsonSchemaInput } = await import("../tools/validate-json-schema.js");
    const error = await validateJsonSchemaInput("show_generative_ui", UIBlockSchema, raw as Record<string, unknown>);
    if (error) return { ok: false, message: error };
    return { ok: true, value: normalizeBlockOutput(raw as Record<string, unknown>) as unknown as UIBlock };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Failed to validate UI block: ${msg}` };
  }
}

/**
 * Validates an extensible renderable block (core form/buttons or plugin block).
 */
export async function validateRenderableBlock(
  raw: unknown,
): Promise<{ ok: true; value: RenderableBlock } | { ok: false; message: string }> {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, message: "Invalid renderable block: input must be an object." };
  }
  try {
    const { validateJsonSchemaInput } = await import("../tools/validate-json-schema.js");
    const error = await validateJsonSchemaInput("renderable_block", RenderableBlockSchema, raw as Record<string, unknown>);
    if (error) return { ok: false, message: error };
    return { ok: true, value: normalizeBlockOutput(raw as Record<string, unknown>) as unknown as RenderableBlock };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Failed to validate renderable block: ${msg}` };
  }
}
