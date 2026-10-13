import { describe, it, expect } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import { buildTools, draft07ToDraft2020 } from "./build-tools.js";
import type { ToolContext, CustomToolDef } from "./build-tools.js";
import { defaultTools, skillTools } from "./builders.js";
import { WAIT_MAX_SECONDS } from "./definitions.js";
import { z } from "zod";

function mockCtx(overrides?: Partial<ToolContext>): ToolContext {
  const ac = new AbortController();
  return {
    app: { appName: "test" },
    signal: ac.signal,
    ...overrides,
  };
}

describe("JSON Schema Draft 2020-12 Validation", () => {
  it("every built tool input_schema is valid draft 2020-12", () => {
    const customTupleTool: CustomToolDef = {
      name: "custom_tuple_tool",
      description: "A custom tool with a tuple parameter",
      inputSchema: z.object({
        range: z.tuple([z.string(), z.number()]),
      }).strict(),
      execute: () => Promise.resolve({ content: "ok" }),
    };
    const jsonSchemaTupleTool: CustomToolDef = {
      name: "json_schema_tuple_tool",
      description: "A custom tool with a tuple parameter via raw JSON schema",
      inputSchema: {
        type: "object",
        properties: {
          range: {
            type: "array",
            minItems: 2,
            maxItems: 2,
            items: [{ type: "string" }, { type: "number" }],
          },
        },
      },
      execute: () => Promise.resolve({ content: "ok" }),
    };

    const ctx = mockCtx();
    const { tools } = buildTools(ctx, [...defaultTools(ctx), customTupleTool, jsonSchemaTupleTool]);

    for (const t of tools) {
      const ajv = new Ajv2020({ strict: false });
      let compiled;
      expect(() => {
        compiled = ajv.compile(t.input_schema);
      }, `Schema for tool ${t.name} should compile successfully under Draft 2020-12`).not.toThrow();
      expect(compiled).toBeDefined();
    }
  });

  it("zod and JSON-Schema branches produce identical input_schema", () => {
    const ctx = mockCtx();
    const zodToolDef: CustomToolDef = {
      name: "zod_tool",
      description: "test",
      inputSchema: z.object({ name: z.string(), count: z.number().optional() }).strict(),
      execute: () => Promise.resolve({ content: "ok" }),
    };
    const jsonToolDef: CustomToolDef = {
      name: "json_tool",
      description: "test",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          count: { type: "number" },
        },
        required: ["name"],
        additionalProperties: false,
        $schema: "http://json-schema.org/draft-07/schema#",
      },
      execute: () => Promise.resolve({ content: "ok" }),
    };
    const { tools } = buildTools(ctx, [zodToolDef, jsonToolDef]);
    const zodTool = tools.find((t) => t.name === "zod_tool")!;
    const jsonTool = tools.find((t) => t.name === "json_tool")!;

    expect(jsonTool.input_schema).toEqual(zodTool.input_schema);
    expect(zodTool.input_schema).toEqual({
      type: "object",
      properties: { name: { type: "string" }, count: { type: "number" } },
      required: ["name"],
      additionalProperties: false,
    });
  });

  it("query_data regression: no array-valued items anywhere", () => {
    const ctx = mockCtx();
    const { tools } = buildTools(ctx, defaultTools(ctx));
    const queryDataTool = tools.find((t) => t.name === "query_data");
    expect(queryDataTool).toBeDefined();

    const schema = queryDataTool!.input_schema;

    // Helper to walk the schema and ensure no items key has an array value
    function walkAndAssert(node: unknown) {
      if (Array.isArray(node)) {
        for (const item of node) {
          walkAndAssert(item);
        }
      } else if (node !== null && typeof node === "object") {
        const obj = node as Record<string, unknown>;
        if ("items" in obj) {
          expect(Array.isArray(obj.items)).toBe(false);
        }
        for (const key of Object.keys(obj)) {
          walkAndAssert(obj[key]);
        }
      }
    }

    walkAndAssert(schema);

    // Deep check to make sure $between has prefixItems of length 2
    function findNode(node: unknown, targetKey: string): unknown {
      if (node !== null && typeof node === "object") {
        const obj = node as Record<string, unknown>;
        if (targetKey in obj) {
          return obj[targetKey];
        }
        for (const key of Object.keys(obj)) {
          const found = findNode(obj[key], targetKey);
          if (found) return found;
        }
      }
      return null;
    }

    const betweenNode = findNode(schema, "$between") as { prefixItems?: unknown } | null;
    expect(betweenNode).toBeDefined();
    expect(betweenNode).not.toBeNull();
    expect(betweenNode!.prefixItems).toBeDefined();
    expect(Array.isArray(betweenNode!.prefixItems)).toBe(true);
    expect(betweenNode!.prefixItems).toHaveLength(2);
  });

  it("draft07ToDraft2020 converts a draft-07 tuple fragment", () => {
    const input = {
      type: "array",
      minItems: 2,
      maxItems: 2,
      items: [
        { type: "string" },
        { type: "number" }
      ],
      additionalItems: false
    };
    
    // Test that the input is not mutated
    const inputCopy = JSON.parse(JSON.stringify(input)) as unknown;
    const output = draft07ToDraft2020(input);
    
    expect(input).toEqual(inputCopy); // pure test
    expect(output).toEqual({
      type: "array",
      minItems: 2,
      maxItems: 2,
      prefixItems: [
        { type: "string" },
        { type: "number" }
      ],
      items: false
    });

    // Single schema items should be unchanged
    const singleItems = {
      type: "array",
      items: { type: "string" }
    };
    const outputSingle = draft07ToDraft2020(singleItems);
    expect(outputSingle).toEqual(singleItems);
  });

  it("every tool has input_schema type object", () => {
    const ctx = mockCtx();
    const { tools } = buildTools(ctx, defaultTools(ctx));
    for (const t of tools) {
      expect(t.input_schema.type).toBe("object");
    }
  });
});

describe("Core tool schemas — Draft 2020-12 structural invariants (004)", () => {
  // Task 004 migrated these off Zod onto raw JSON Schema. These assertions
  // check the DECLARED constraints — type, required list, additionalProperties,
  // bounds — not a frozen copy of the emitted blob, so a deliberate schema
  // change updates one assertion, not a pasted-value diff.
  const ctx = mockCtx();
  const { tools } = buildTools(ctx, [...defaultTools(ctx), ...skillTools(ctx)]);
  const ajv = new Ajv2020({ strict: false });

  function schemaOf(name: string): Record<string, unknown> {
    const tool = tools.find((t) => t.name === name);
    if (!tool) throw new Error(`tool ${name} not found in built tools`);
    return tool.input_schema;
  }

  it.each([
    "wait",
    "list_data_sources",
    "get_field_details",
    "sample_field_values",
    "show_generative_ui",
    "search_skills",
    "load_skill",
  ])("%s compiles as a valid Draft 2020-12 schema", (name) => {
    expect(() => ajv.compile(schemaOf(name))).not.toThrow();
  });

  it("wait: seconds required, integer, bounded 1..WAIT_MAX_SECONDS", () => {
    const s = schemaOf("wait");
    expect(s.required).toEqual(["seconds"]);
    expect(s.additionalProperties).toBe(false);
    const seconds = (s.properties as Record<string, Record<string, unknown>>).seconds;
    expect(seconds.type).toBe("integer");
    expect(seconds.minimum).toBe(1);
    expect(seconds.maximum).toBe(WAIT_MAX_SECONDS);
  });

  it("list_data_sources: source optional string, no other properties", () => {
    const s = schemaOf("list_data_sources");
    expect(s.required).toBeUndefined();
    expect(s.additionalProperties).toBe(false);
    expect(Object.keys(s.properties as object)).toEqual(["source"]);
  });

  it("get_field_details: source required; filter/offset/limit optional with declared bounds", () => {
    const s = schemaOf("get_field_details");
    expect(s.required).toEqual(["source"]);
    expect(s.additionalProperties).toBe(false);
    const props = s.properties as Record<string, Record<string, unknown>>;
    expect(props.offset.minimum).toBe(0);
    expect(props.limit.minimum).toBe(1);
    expect(props.limit.maximum).toBe(500);
  });

  it("sample_field_values: source and field required; limit bounded 1..500", () => {
    const s = schemaOf("sample_field_values");
    expect(s.required).toEqual(["source", "field"]);
    expect(s.additionalProperties).toBe(false);
    const props = s.properties as Record<string, Record<string, unknown>>;
    expect(props.limit.minimum).toBe(1);
    expect(props.limit.maximum).toBe(500);
  });

  it("show_generative_ui: type required; options is an array of {label, prompt}", () => {
    const s = schemaOf("show_generative_ui");
    expect(s.required).toEqual(["type"]);
    expect(s.additionalProperties).toBe(false);
    const props = s.properties as Record<string, Record<string, unknown>>;
    expect(props.options.type).toBe("array");
    const optionItems = props.options.items as Record<string, unknown>;
    expect(optionItems.required).toEqual(["label", "prompt"]);
  });

  it("search_skills: query required string, no other properties", () => {
    const s = schemaOf("search_skills");
    expect(s.required).toEqual(["query"]);
    expect(s.additionalProperties).toBe(false);
    expect(Object.keys(s.properties as object)).toEqual(["query"]);
  });

  it("load_skill: name required string, no other properties", () => {
    const s = schemaOf("load_skill");
    expect(s.required).toEqual(["name"]);
    expect(s.additionalProperties).toBe(false);
    expect(Object.keys(s.properties as object)).toEqual(["name"]);
  });
});
