import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  UIBlockSchema,
  RenderableBlockSchema,
  validateUIBlock,
  validateRenderableBlock,
} from "./schema.js";
import Ajv2020 from "ajv/dist/2020.js";

const Ctor = (Ajv2020 as unknown as { default?: typeof Ajv2020 }).default ?? Ajv2020;
const ajv = new (Ctor as unknown as new (opts: object) => {
  compile: (schema: object) => (data: unknown) => boolean;
})({ strict: false });

// Pre-migration baseline Zod schema for UIBlock
function preprocessSelectOptions(val: unknown): unknown {
  if (typeof val === "object" && val !== null && !Array.isArray(val)) {
    const keys = Object.keys(val);
    if (keys.length === 1 && keys[0] === "item") {
      const itemVal = (val as Record<string, unknown>).item;
      return Array.isArray(itemVal) ? itemVal : [itemVal];
    }
  }
  return val;
}

const BaselineFormFieldSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"),
    name: z.string(),
    label: z.string(),
    placeholder: z.string().optional(),
    required: z.boolean().optional(),
  }).strict(),
  z.object({
    kind: z.literal("number"),
    name: z.string(),
    label: z.string(),
    min: z.number().optional(),
    max: z.number().optional(),
    required: z.boolean().optional(),
  }).strict(),
  z.object({
    kind: z.literal("select"),
    name: z.string(),
    label: z.string(),
    options: z.preprocess(preprocessSelectOptions, z.array(z.string())),
    default: z.string().optional(),
  }).strict(),
  z.object({
    kind: z.literal("checkbox"),
    name: z.string(),
    label: z.string(),
    default: z.boolean().optional(),
  }).strict(),
  z.object({
    kind: z.literal("date"),
    name: z.string(),
    label: z.string(),
    required: z.boolean().optional(),
  }).strict(),
]);

const BaselineFormBlockSchema = z.object({
  type: z.literal("form"),
  id: z.string(),
  title: z.string().optional(),
  fields: z.array(BaselineFormFieldSchema),
  submit_label: z.string().optional(),
}).strict();

const BaselineButtonsBlockSchema = z.object({
  type: z.literal("buttons"),
  options: z.array(
    z.object({
      label: z.string(),
      prompt: z.string().max(500),
    }).strict()
  ).max(6),
}).strict();

const BaselineUIBlockSchema = z.discriminatedUnion("type", [
  BaselineFormBlockSchema,
  BaselineButtonsBlockSchema,
]);

const BaselinePluginBlockSchema = z
  .object({
    type: z.string().refine((t) => t !== "form" && t !== "buttons"),
  })
  .passthrough();
const BaselineRenderableBlockSchema = z.union([BaselineUIBlockSchema, BaselinePluginBlockSchema]);

interface TestCase {
  label: string;
  block: unknown;
  validCoreUI: boolean;
  validRenderable: boolean;
}

const TEST_CASES: TestCase[] = [
  {
    label: "valid form with text, number, date, checkbox, select (array)",
    block: {
      type: "form",
      id: "f_all",
      title: "Comprehensive Form",
      fields: [
        { kind: "text", name: "username", label: "Username", placeholder: "e.g. alex", required: true },
        { kind: "number", name: "age", label: "Age", min: 0, max: 120, required: false },
        { kind: "select", name: "role", label: "Role", options: ["admin", "user"], default: "user" },
        { kind: "checkbox", name: "subscribe", label: "Subscribe", default: true },
        { kind: "date", name: "dob", label: "Date of Birth", required: true },
      ],
      submit_label: "Save",
    },
    validCoreUI: true,
    validRenderable: true,
  },
  {
    label: "valid form with select XML { item: ['a', 'b'] }",
    block: {
      type: "form",
      id: "f_xml_arr",
      fields: [
        { kind: "select", name: "opt", label: "Options", options: { item: ["a", "b"] } },
      ],
    },
    validCoreUI: true,
    validRenderable: true,
  },
  {
    label: "valid form with select XML { item: 'a' }",
    block: {
      type: "form",
      id: "f_xml_single",
      fields: [
        { kind: "select", name: "opt", label: "Options", options: { item: "a" } },
      ],
    },
    validCoreUI: true,
    validRenderable: true,
  },
  {
    label: "form missing id",
    block: {
      type: "form",
      fields: [{ kind: "text", name: "n", label: "L" }],
    },
    validCoreUI: false,
    validRenderable: false,
  },
  {
    label: "form missing fields",
    block: {
      type: "form",
      id: "f_no_fields",
    },
    validCoreUI: false,
    validRenderable: false,
  },
  {
    label: "form with invalid field kind 'slider'",
    block: {
      type: "form",
      id: "f_bad_kind",
      fields: [{ kind: "slider", name: "val", label: "Value" }],
    },
    validCoreUI: false,
    validRenderable: false,
  },
  {
    label: "form field with unknown property",
    block: {
      type: "form",
      id: "f_extra_field_prop",
      fields: [{ kind: "text", name: "t", label: "T", extra: 123 }],
    },
    validCoreUI: false,
    validRenderable: false,
  },
  {
    label: "form with unknown top-level property",
    block: {
      type: "form",
      id: "f_extra_top",
      extra: true,
      fields: [],
    },
    validCoreUI: false,
    validRenderable: false,
  },
  {
    label: "valid buttons with 1 button",
    block: {
      type: "buttons",
      options: [{ label: "OK", prompt: "ok" }],
    },
    validCoreUI: true,
    validRenderable: true,
  },
  {
    label: "valid buttons with 6 buttons",
    block: {
      type: "buttons",
      options: [
        { label: "1", prompt: "p1" },
        { label: "2", prompt: "p2" },
        { label: "3", prompt: "p3" },
        { label: "4", prompt: "p4" },
        { label: "5", prompt: "p5" },
        { label: "6", prompt: "p6" },
      ],
    },
    validCoreUI: true,
    validRenderable: true,
  },
  {
    label: "buttons with 7 buttons (exceeds maxItems 6)",
    block: {
      type: "buttons",
      options: [
        { label: "1", prompt: "p1" },
        { label: "2", prompt: "p2" },
        { label: "3", prompt: "p3" },
        { label: "4", prompt: "p4" },
        { label: "5", prompt: "p5" },
        { label: "6", prompt: "p6" },
        { label: "7", prompt: "p7" },
      ],
    },
    validCoreUI: false,
    validRenderable: false,
  },
  {
    label: "buttons missing label",
    block: {
      type: "buttons",
      options: [{ prompt: "missing label" }],
    },
    validCoreUI: false,
    validRenderable: false,
  },
  {
    label: "buttons missing prompt",
    block: {
      type: "buttons",
      options: [{ label: "missing prompt" }],
    },
    validCoreUI: false,
    validRenderable: false,
  },
  {
    label: "buttons prompt over 500 chars",
    block: {
      type: "buttons",
      options: [{ label: "long", prompt: "a".repeat(501) }],
    },
    validCoreUI: false,
    validRenderable: false,
  },
  {
    label: "buttons button with unknown property",
    block: {
      type: "buttons",
      options: [{ label: "b", prompt: "p", extra: 1 }],
    },
    validCoreUI: false,
    validRenderable: false,
  },
  {
    label: "buttons with unknown top-level property",
    block: {
      type: "buttons",
      options: [{ label: "b", prompt: "p" }],
      extra: "bad",
    },
    validCoreUI: false,
    validRenderable: false,
  },
  {
    label: "plugin block 'kanban'",
    block: {
      type: "kanban",
      columns: [{ id: "c1", title: "Todo" }],
      title: "Project Board",
    },
    validCoreUI: false,
    validRenderable: true,
  },
  {
    label: "plugin block 'chart'",
    block: {
      type: "chart",
      query: { source: "orders" },
      encoding: { mark: "bar", x: { field: "cat" }, y: { field: "cnt" } },
    },
    validCoreUI: false,
    validRenderable: true,
  },
  {
    label: "block missing type",
    block: {
      options: [{ label: "b", prompt: "p" }],
    },
    validCoreUI: false,
    validRenderable: false,
  },
  {
    label: "block with numeric type",
    block: {
      type: 123,
      options: [],
    },
    validCoreUI: false,
    validRenderable: false,
  },
  {
    label: "malformed form where fields is string",
    block: {
      type: "form",
      id: "f_bad_fields",
      fields: "not-an-array",
    },
    validCoreUI: false,
    validRenderable: false,
  },
];

describe("UIBlock schema parity", () => {
  it("compiles UIBlockSchema and RenderableBlockSchema under Ajv 2020", () => {
    const validateUI = ajv.compile(UIBlockSchema);
    const validateRenderable = ajv.compile(RenderableBlockSchema);
    expect(typeof validateUI).toBe("function");
    expect(typeof validateRenderable).toBe("function");
  });

  for (const tc of TEST_CASES) {
    it(`UIBlock verdict matches for: ${tc.label}`, async () => {
      const baselineRes = BaselineUIBlockSchema.safeParse(tc.block).success;
      const candidateRes = (await validateUIBlock(tc.block)).ok;
      expect(candidateRes).toBe(tc.validCoreUI);
      expect(candidateRes).toBe(baselineRes);
    });

    it(`RenderableBlock verdict matches for: ${tc.label}`, async () => {
      const baselineRes = BaselineRenderableBlockSchema.safeParse(tc.block).success;
      const candidateRes = (await validateRenderableBlock(tc.block)).ok;
      expect(candidateRes).toBe(tc.validRenderable);
      expect(candidateRes).toBe(baselineRes);
    });
  }

  it("UIBlockSchema and RenderableBlockSchema use #/$defs/formField", () => {
    const uiStr = JSON.stringify(UIBlockSchema);
    const rendStr = JSON.stringify(RenderableBlockSchema);
    expect(uiStr).toContain("#/$defs/formField");
    expect(rendStr).toContain("#/$defs/formField");
  });
});
