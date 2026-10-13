import { describe, it, expect, vi } from "vitest";
import type { Mock } from "vitest";
import { buildTools, executeToolByName } from "./build-tools.js";
import type { ToolContext, CustomToolDef, JsonSchemaObject, ToolOutcome } from "./build-tools.js";
import type { RenderableBlock } from "../ui-blocks/schema.js";
import type { PostToolPayload, PostToolResult } from "../hooks/types.js";
import { defaultTools } from "./builders.js";
import { coreSkills } from "../skills/default-skills.js";
import { TOOL_DEFS } from "./definitions.js";
import { z } from "zod";

/** The shape of a tool's `execute` mock in these tests. */
type ExecuteMock = Mock<[Record<string, unknown>, ToolContext], Promise<ToolOutcome>>;

function mockCtx(overrides?: Partial<ToolContext>): ToolContext {
  const ac = new AbortController();
  return {
    app: { appName: "test" },
    signal: ac.signal,
    ...overrides,
  };
}

describe("buildTools", () => {
  it("returns {tools, executors} with correct keys matching defaultTools()", () => {
    const ctx = mockCtx();
    const { tools, executors } = buildTools(ctx, defaultTools(ctx));
    const expectedNames = defaultTools(ctx).map((d) => d.name);
    const toolNames = tools.map((t) => t.name).sort();
    expect(toolNames).toEqual(expectedNames.sort());
    expect(executors.list_data_sources).toBeDefined();
    expect(executors.get_field_details).toBeDefined();
    expect(executors.sample_field_values).toBeDefined();
    expect(executors.query_data).toBeDefined();
  });

  it("each tool in tools array has name, description, input_schema with type object", () => {
    const ctx = mockCtx();
    const { tools } = buildTools(ctx, defaultTools(ctx));
    for (const t of tools) {
      expect(typeof t.name).toBe("string");
      expect(typeof t.description).toBe("string");
      expect(t.input_schema.type).toBe("object");
    }
  });

  it("each executor is a function", () => {
    const ctx = mockCtx();
    const { executors } = buildTools(ctx, defaultTools(ctx));
    for (const name of Object.keys(executors)) {
      expect(typeof executors[name]).toBe("function");
    }
  });

  // 007: `see`/DomAdapter-backed tools no longer live in core — the generic
  // tool-image path is covered instead with a plain custom tool below ("a tool
  // returning images returns them on the executor result").

  it("executor aborts immediately when signal is aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    const ctx = mockCtx({ signal: ac.signal });
    const { executors } = buildTools(ctx, defaultTools(ctx));
    const result = await executors.wait(
      { seconds: 5 },
      { abortSignal: ac.signal, toolCallId: "tc1" },
    );
    expect(result.content).toBe("Tool execution aborted.");
  });

  it("list_data_sources returns error when dataSource missing from context", async () => {
    const ctx = mockCtx();
    const { executors } = buildTools(ctx, defaultTools(ctx));
    const result = await executors.list_data_sources(
      {},
      { abortSignal: ctx.signal, toolCallId: "tc3" },
    );
    expect(result.content).toContain("dataSource not available");
  });

  it("query_data returns error when dataSource missing from context", async () => {
    const ctx = mockCtx();
    const { executors } = buildTools(ctx, defaultTools(ctx));
    const result = await executors.query_data(
      { source: "orders" },
      { abortSignal: ctx.signal, toolCallId: "tc4" },
    );
    expect(result.content).toContain("dataSource not available");
  });

  it("a tool returning images returns them on the executor result (003 U9)", async () => {
    const imageTool: CustomToolDef = {
      name: "image_tool",
      description: "returns an image",
      inputSchema: z.object({}).strict(),
      execute: () => Promise.resolve({
        content: "Screenshot captured.",
        images: [{ dataUrl: "data:image/png;base64,test123", mediaType: "image/png" }],
      }),
    };
    const ctx = mockCtx();
    const { executors } = buildTools(ctx, [imageTool]);
    const result = await executors.image_tool({}, { abortSignal: ctx.signal, toolCallId: "tc_img" });
    expect(result.content).toBe("Screenshot captured.");
    expect(result.images).toEqual([{ dataUrl: "data:image/png;base64,test123", mediaType: "image/png" }]);
    expect("_pendingImage" in ctx).toBe(false);
  });

  it("undecodable image is dropped with a warning (003 U10)", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(() => Promise.reject(new Error("bad"))));
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ blob: () => Promise.resolve(new Blob(["x"])) })));
    vi.stubGlobal("Image", class {
      onerror: (() => void) | null = null;
      onload = null;
      set src(_v: string) { queueMicrotask(() => this.onerror?.()); }
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    try {
      const imgTool: CustomToolDef = {
        name: "img_tool",
        description: "tool with bad image",
        inputSchema: z.object({}),
        execute: () => Promise.resolve({
          content: "text ok",
          images: [{ dataUrl: "data:image/png;base64,AAAA", mediaType: "image/png" }],
        }),
      };
      const ctx = mockCtx();
      const { executors } = buildTools(ctx, [imgTool]);
      const result = await executors.img_tool({}, { abortSignal: ctx.signal, toolCallId: "tc_bad" });
      expect(result).toEqual({ content: "text ok" });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toMatch(
        /^\[web-agent\] tool image dropped \(img_tool\): Failed to decode image for downscaling:/,
      );
    } finally {
      vi.unstubAllGlobals();
      warnSpy.mockRestore();
    }
  });

  it("one good and one empty image drops the empty one with warning (003 U11)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const imgTool: CustomToolDef = {
        name: "mixed_img_tool",
        description: "mixed images",
        inputSchema: z.object({}),
        execute: () => Promise.resolve({
          content: "mixed ok",
          images: [
            { dataUrl: "data:image/png;base64,AAAA", mediaType: "image/png" },
            { dataUrl: "data:,", mediaType: "image/png" },
          ],
        }),
      };
      const ctx = mockCtx();
      const { executors } = buildTools(ctx, [imgTool]);
      const result = await executors.mixed_img_tool({}, { abortSignal: ctx.signal, toolCallId: "tc_mix" });
      expect(result.images).toHaveLength(1);
      expect(result.images![0].dataUrl).toBe("data:image/png;base64,AAAA");
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain("Invalid image: base64 payload is empty");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("denied call has no images (003 U12)", async () => {
    const imgTool: CustomToolDef = {
      name: "denied_tool",
      description: "tool with images",
      inputSchema: z.object({}),
      execute: () => Promise.resolve({
        content: "should not run",
        images: [{ dataUrl: "data:image/png;base64,AAAA", mediaType: "image/png" }],
      }),
    };
    const ctx = mockCtx({
      hooks: {
        onPreTool: () => ({ decision: "deny", reason: "denied" }),
      },
    });
    const { executors } = buildTools(ctx, [imgTool]);
    const result = await executors.denied_tool({}, { abortSignal: ctx.signal, toolCallId: "tc_deny" });
    expect(result.images).toBeUndefined();
    expect(result.isError).toBe(true);
  });

  it("onPostTool can replace images (003 U12b)", async () => {
    const imgC = "data:image/png;base64,CCCC";
    const imgTool: CustomToolDef = {
      name: "hook_replace_tool",
      description: "tool with images",
      inputSchema: z.object({}),
      execute: () => Promise.resolve({
        content: "original",
        images: [{ dataUrl: "data:image/png;base64,AAAA", mediaType: "image/png" }],
      }),
    };
    const ctx = mockCtx({
      hooks: {
        onPostTool: ({ outcome }) => ({
          outcome: {
            ...outcome,
            images: [{ dataUrl: imgC, mediaType: "image/png" }],
          },
        }),
      },
    });
    const { executors } = buildTools(ctx, [imgTool]);
    const result = await executors.hook_replace_tool({}, { abortSignal: ctx.signal, toolCallId: "tc_post" });
    expect(result.images).toEqual([{ dataUrl: imgC, mediaType: "image/png" }]);
  });
});

describe("custom tools via buildTools(customTools)", () => {
  function makeCustomTool(name: string, execute?: CustomToolDef["execute"]): CustomToolDef {
    return {
      name,
      description: `${name} tool`,
      inputSchema: z.object({}).strict(),
      execute: execute ?? (() => Promise.resolve({ content: "pong" })),
    };
  }

  it("returns core tools plus custom tools when customTools provided", () => {
    const custom = makeCustomTool("ping");
    const ctx = mockCtx();
    const { tools, executors } = buildTools(ctx, [...defaultTools(ctx), custom]);
    const toolNames = tools.map((t) => t.name);
    for (const d of defaultTools(ctx)) expect(toolNames).toContain(d.name);
    expect(toolNames).toContain("ping");
    expect(executors.ping).toBeDefined();
  });

  it("custom tool executor returns expected content", async () => {
    const custom = makeCustomTool("ping");
    const ctx = mockCtx();
    const { executors } = buildTools(ctx, [...defaultTools(ctx), custom]);
    const result = await executors.ping(
      {},
      { abortSignal: ctx.signal, toolCallId: "tc_ping" },
    );
    expect(result.content).toBe("pong");
  });

  it("custom tool executor wraps errors (no stack leak)", async () => {
    const custom = makeCustomTool("boom", () => Promise.reject(new Error("custom error")));
    const ctx = mockCtx();
    const { executors } = buildTools(ctx, [...defaultTools(ctx), custom]);
    const result = await executors.boom(
      {},
      { abortSignal: ctx.signal, toolCallId: "tc_boom" },
    );
    expect(result.content).toBe("custom error");
    expect(result.content).not.toContain("at ");
  });

  it("custom tool respects abort signal", async () => {
    const custom = makeCustomTool("noop");
    const ac = new AbortController();
    ac.abort();
    const ctx = mockCtx();
    const { executors } = buildTools(ctx, [...defaultTools(ctx), custom]);
    const result = await executors.noop(
      {},
      { abortSignal: ac.signal, toolCallId: "tc_noop" },
    );
    expect(result.content).toBe("Tool execution aborted.");
  });

  it("name collision skips custom tool with warning", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const custom = makeCustomTool("wait");
    const ctx = mockCtx();
    const { tools, executors } = buildTools(ctx, [...defaultTools(ctx), custom]);
    expect(tools.filter((t) => t.name === "wait").length).toBe(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("wait"));
    expect(executors.wait).toBeDefined();
    warnSpy.mockRestore();
  });

  it("custom tool with a renderer builds without affecting tools/executors", () => {
    const custom: CustomToolDef = {
      name: "renderer_tool",
      description: "renderer test",
      inputSchema: z.object({}).strict(),
      renderer: (input) => `Rendered <b>${JSON.stringify(input)}</b>`,
      execute: () => Promise.resolve({ content: "done" }),
    };
    const ctx = mockCtx();
    const { tools, executors } = buildTools(ctx, [custom]);
    const tool = tools.find((t) => t.name === "renderer_tool");
    expect(tool).toBeDefined();
    expect(tool!.input_schema).toBeDefined();
    expect(executors.renderer_tool).toBeDefined();
    // renderer is display-only — NOT in model-facing Tool
    expect((tool as unknown as { renderer?: unknown }).renderer).toBeUndefined();
  });

  it("undefined/empty customTools returns only core tools", () => {
    const ctx = mockCtx();
    const { tools: t1 } = buildTools(ctx, defaultTools(ctx));
    const { tools: t2 } = buildTools(ctx, defaultTools(ctx));
    expect(t1.map((t) => t.name).sort()).toEqual(t2.map((t) => t.name).sort());
  });

  it("custom executor receives ToolContext with signal property", async () => {
    let receivedCtx: ToolContext | undefined;
    const custom: CustomToolDef = {
      name: "ctx_check",
      description: "ctx check",
      inputSchema: z.object({}).strict(),
      execute: (_input, ctx) => { receivedCtx = ctx; return Promise.resolve({ content: "ok" }); },
    };
    const ctx = mockCtx();
    const { executors } = buildTools(ctx, [...defaultTools(ctx), custom]);
    const ac = new AbortController();
    await executors.ctx_check(
      {},
      { abortSignal: ac.signal, toolCallId: "tc_ctx" },
    );
    expect(receivedCtx).toBeDefined();
    expect("signal" in receivedCtx!).toBe(true);
  });

  it("query_data takes the JSON-Schema branch — input_schema carries $defs", () => {
    const ctx = mockCtx();
    const { tools } = buildTools(ctx, defaultTools(ctx));
    const qd = tools.find((t) => t.name === "query_data");
    expect(qd).toBeDefined();
    expect(qd!.input_schema).toHaveProperty("$defs");
  });

  it("query_data is validated by ajv, not skipped", async () => {
    const ctx = mockCtx();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { executors } = buildTools(ctx, defaultTools(ctx));
    const badInput: Record<string, unknown> = { source: 42 };
    const result = await executors.query_data(
      badInput,
      { abortSignal: ctx.signal, toolCallId: "tc_ajv" },
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain("Invalid input for query_data:");
    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining("JSON Schema validation unavailable"),
    );
    warnSpy.mockRestore();
  });
});



describe("custom tools with a raw JSON Schema inputSchema", () => {
  const PLACE_ORDER_SCHEMA = {
    type: "object",
    properties: {
      customer: { type: "string" },
      category: { type: "string" },
      total: { type: "number" },
      status: { type: "string" },
      itemCount: { type: "integer" },
      items: { type: "string" },
    },
    additionalProperties: false,
    $schema: "http://json-schema.org/draft-07/schema#",
  } as const;

  function jsonSchemaTool(execute: ExecuteMock): CustomToolDef {
    return {
      name: "place_order",
      description: "place an order",
      inputSchema: PLACE_ORDER_SCHEMA as JsonSchemaObject,
      execute,
    };
  }

  it("registers a JSON-Schema tool and strips $schema", () => {
    const ctx = mockCtx();
    const execute: ExecuteMock = vi.fn();
    const { tools, executors } = buildTools(ctx, [jsonSchemaTool(execute)]);
    expect(tools[0].input_schema).toEqual({
      type: "object",
      properties: {
        customer: { type: "string" },
        category: { type: "string" },
        total: { type: "number" },
        status: { type: "string" },
        itemCount: { type: "integer" },
        items: { type: "string" },
      },
      additionalProperties: false,
    });
    expect("$schema" in tools[0].input_schema).toBe(false);
    expect(typeof executors.place_order).toBe("function");
  });

  it("valid arguments reach execute", async () => {
    const ctx = mockCtx();
    const execute: ExecuteMock = vi.fn<[Record<string, unknown>, ToolContext], Promise<ToolOutcome>>(() => Promise.resolve({ content: "ok" }));
    const { executors } = buildTools(ctx, [jsonSchemaTool(execute)]);
    await expect(
      executors.place_order(
        { customer: "Ann", total: 12 },
        { abortSignal: ctx.signal, toolCallId: "tc1" },
      ),
    ).resolves.toEqual({ content: "ok" });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toEqual({ customer: "Ann", total: 12 });
  });

  it("wrong argument type is rejected before execute", async () => {
    const ctx = mockCtx();
    const execute: ExecuteMock = vi.fn<[Record<string, unknown>, ToolContext], Promise<ToolOutcome>>(() => Promise.resolve({ content: "ok" }));
    const { executors } = buildTools(ctx, [jsonSchemaTool(execute)]);
    await expect(
      executors.place_order(
        { total: "twelve" },
        { abortSignal: ctx.signal, toolCallId: "tc1" },
      ),
    ).resolves.toEqual({ content: "Invalid input for place_order: data/total must be number.", isError: true });
    expect(execute).not.toHaveBeenCalled();
  });

  it("unknown argument is rejected before execute", async () => {
    const ctx = mockCtx();
    const execute: ExecuteMock = vi.fn<[Record<string, unknown>, ToolContext], Promise<ToolOutcome>>(() => Promise.resolve({ content: "ok" }));
    const { executors } = buildTools(ctx, [jsonSchemaTool(execute)]);
    await expect(
      executors.place_order(
        { bogus: true },
        { abortSignal: ctx.signal, toolCallId: "tc1" },
      ),
    ).resolves.toEqual({ content: "Invalid input for place_order: data must NOT have additional properties.", isError: true });
    expect(execute).not.toHaveBeenCalled();
  });

  it("missing required argument is rejected before execute", async () => {
    const ctx = mockCtx();
    const execute: ExecuteMock = vi.fn<[Record<string, unknown>, ToolContext], Promise<ToolOutcome>>(() => Promise.resolve({ content: "ok" }));
    const reqTool: CustomToolDef = {
      name: "req_tool",
      description: "required prop tool",
      inputSchema: {
        type: "object",
        properties: { a: { type: "string" } },
        required: ["a"],
        additionalProperties: false,
      },
      execute,
    };
    const { executors } = buildTools(ctx, [reqTool]);
    await expect(
      executors.req_tool({}, { abortSignal: ctx.signal, toolCallId: "tc1" }),
    ).resolves.toEqual({ content: "Invalid input for req_tool: data must have required property 'a'.", isError: true });
    expect(execute).not.toHaveBeenCalled();
  });

  it("draft-07 tuple is converted to prefixItems", () => {
    const ctx = mockCtx();
    const execute: ExecuteMock = vi.fn();
    const tupleTool: CustomToolDef = {
      name: "tuple_tool",
      description: "tuple tool",
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
      execute,
    };
    const { tools } = buildTools(ctx, [tupleTool]);
    const schema = tools[0].input_schema as unknown as {
      properties: { range: { prefixItems?: unknown[]; items?: unknown } };
    };
    expect(schema.properties.range.prefixItems).toHaveLength(2);
    expect(Array.isArray(schema.properties.range.items)).toBe(false);
  });

  it("abort wins over validation", async () => {
    const ctx = mockCtx();
    const ac = new AbortController();
    ac.abort();
    const execute: ExecuteMock = vi.fn<[Record<string, unknown>, ToolContext], Promise<ToolOutcome>>(() => Promise.resolve({ content: "ok" }));
    const { executors } = buildTools(ctx, [jsonSchemaTool(execute)]);
    await expect(
      executors.place_order(
        { total: "twelve" },
        { abortSignal: ac.signal, toolCallId: "tc1" },
      ),
    ).resolves.toEqual({ content: "Tool execution aborted." });
    expect(execute).not.toHaveBeenCalled();
  });

  it("a malformed JSON Schema still executes — Ajv compile failure is non-fatal (004)", async () => {
    // Was "reported as a tool error, execute never called" before 004. Changed
    // deliberately: a live run found ajv's own dynamic import can throw for
    // reasons that have nothing to do with any one schema (a webpack
    // module-id collision — docs/tests/0167), and before this tool's schema
    // moved to JSON Schema it ran with no validation at all. Failing every
    // ajv-load/compile failure closed would regress previously-working tools
    // whenever ajv is unavailable, so any such failure — a malformed schema
    // included — now warns and runs the call unvalidated instead.
    const ctx = mockCtx();
    const execute: ExecuteMock = vi.fn<[Record<string, unknown>, ToolContext], Promise<ToolOutcome>>(() => Promise.resolve({ content: "ok" }));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const badTool: CustomToolDef = {
      name: "bad_tool",
      description: "bad schema tool",
      inputSchema: {
        type: "object",
        properties: { a: { type: "not-a-type" } },
      },
      execute,
    };
    const { executors } = buildTools(ctx, [badTool]);
    const res = await executors.bad_tool({}, { abortSignal: ctx.signal, toolCallId: "tc1" });
    expect(res).toEqual({ content: "ok" });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('JSON Schema validation unavailable for "bad_tool"'));
    warnSpy.mockRestore();
  });

  it("a zod-authored tool is argument-validated before execute (003)", async () => {
    const ctx = mockCtx();
    const execute: ExecuteMock = vi.fn<[Record<string, unknown>, ToolContext], Promise<ToolOutcome>>(() => Promise.resolve({ content: "pong" }));
    const zodTool: CustomToolDef = {
      name: "zod_tool",
      description: "zod tool",
      inputSchema: z.object({ a: z.string() }).strict(),
      execute,
    };
    const { executors } = buildTools(ctx, [zodTool]);
    await expect(
      executors.zod_tool({}, { abortSignal: ctx.signal, toolCallId: "tc1" }),
    ).resolves.toEqual({ content: "Invalid input for zod_tool: a: Required.", isError: true });
    expect(execute).not.toHaveBeenCalled();
  });

  it("a valid zod call passes the model's own object through (003)", async () => {
    const ctx = mockCtx();
    const execute: ExecuteMock = vi.fn<[Record<string, unknown>, ToolContext], Promise<ToolOutcome>>(() => Promise.resolve({ content: "pong" }));
    const zodTool: CustomToolDef = {
      name: "zod_tool",
      description: "zod tool",
      inputSchema: z.object({ a: z.string() }).strict(),
      execute,
    };
    const { executors } = buildTools(ctx, [zodTool]);
    const inputObj = { a: "x" };
    const res = await executors.zod_tool(inputObj, { abortSignal: ctx.signal, toolCallId: "tc1" });
    expect(res).toEqual({ content: "pong" });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toBe(inputObj);
  });

  it("a schema with defaults does not rewrite the input (003)", async () => {
    const ctx = mockCtx();
    const execute: ExecuteMock = vi.fn<[Record<string, unknown>, ToolContext], Promise<ToolOutcome>>(() => Promise.resolve({ content: "pong" }));
    const zodTool: CustomToolDef = {
      name: "zod_tool",
      description: "zod tool",
      inputSchema: z.object({ n: z.number().default(5) }),
      execute,
    };
    const { executors } = buildTools(ctx, [zodTool]);
    const inputObj = {};
    const res = await executors.zod_tool(inputObj, { abortSignal: ctx.signal, toolCallId: "tc1" });
    expect(res).toEqual({ content: "pong" });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toEqual({});
  });

  it("wait_for with timeout_ms: 3600000 is rejected before the wait (003)", async () => {
    const ctx = mockCtx();
    const execute = vi.fn();
    const waitForDef: CustomToolDef = {
      name: "wait_for",
      description: TOOL_DEFS.wait_for.description,
      inputSchema: TOOL_DEFS.wait_for.inputSchema,
      execute,
    };
    const { executors } = buildTools(ctx, [waitForDef]);
    const res = await executors.wait_for(
      { condition: "dom_idle", timeout_ms: 3600000 },
      { abortSignal: ctx.signal, toolCallId: "tc-wait-for" },
    );
    expect(res.isError).toBe(true);
    expect(res.content).toContain("data/timeout_ms must be <= 15000");
    expect(execute).not.toHaveBeenCalled();
  });

  it("JSON-Schema and zod branch both produce schema-violation prefix and isError (003)", async () => {
    const ctx = mockCtx();
    const execute: ExecuteMock = vi.fn();
    const zodTool: CustomToolDef = {
      name: "z_tool",
      description: "zod tool",
      inputSchema: z.object({ a: z.string() }).strict(),
      execute,
    };
    const jsonTool: CustomToolDef = {
      name: "j_tool",
      description: "json schema tool",
      inputSchema: {
        type: "object",
        properties: { a: { type: "string" } },
        required: ["a"],
      },
      execute,
    };
    const { executors } = buildTools(ctx, [zodTool, jsonTool]);
    const rZ = await executors.z_tool({}, { abortSignal: ctx.signal, toolCallId: "tc-z" });
    const rJ = await executors.j_tool({}, { abortSignal: ctx.signal, toolCallId: "tc-j" });
    expect(rZ.content).toMatch(/^Invalid input for z_tool: /);
    expect(rZ.isError).toBe(true);
    expect(rJ.content).toMatch(/^Invalid input for j_tool: /);
    expect(rJ.isError).toBe(true);
  });

  it("a JSON-Schema tool whose schema fails to compile still executes — validation failure is non-fatal (004)", async () => {
    // Live proof on 2026-09-03 found a webpack-bundling-specific failure inside
    // ajv's own module graph (a module-id collision — see docs/tests/0167):
    // the dynamic `import("./validate-json-schema.js")` chain can throw before
    // ever returning a validation verdict. Before this tool's schema moved to
    // JSON Schema it ran with no validation at all, so when ajv itself is
    // unavailable the call must still run — failing it closed would be a
    // regression versus pre-migration behaviour. This reproduces that class
    // of failure with a schema ajv itself refuses to compile (an invalid
    // regex) and proves the call still reaches `execute`, unvalidated, with a
    // console.warn instead of a fatal isError.
    const ctx = mockCtx();
    const execute: ExecuteMock = vi.fn<[Record<string, unknown>, ToolContext], Promise<ToolOutcome>>(() =>
      Promise.resolve({ content: "ran anyway" }),
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const brokenSchemaTool: CustomToolDef = {
      name: "broken_schema_tool",
      description: "a tool whose schema ajv cannot compile",
      inputSchema: {
        type: "object",
        properties: { a: { type: "string", pattern: "(unterminated" } },
      },
      execute,
    };
    const { executors } = buildTools(ctx, [brokenSchemaTool]);
    const res = await executors.broken_schema_tool(
      { a: "x" },
      { abortSignal: ctx.signal, toolCallId: "tc-broken" },
    );
    expect(res).toEqual({ content: "ran anyway" });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toEqual({ a: "x" });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('JSON Schema validation unavailable for "broken_schema_tool"'),
    );
    warnSpy.mockRestore();
  });

  it("abort wins over zod validation (003)", async () => {
    const ctx = mockCtx();
    const execute: ExecuteMock = vi.fn();
    const zodTool: CustomToolDef = {
      name: "zod_tool",
      description: "zod tool",
      inputSchema: z.object({ a: z.string() }).strict(),
      execute,
    };
    const { executors } = buildTools(ctx, [zodTool]);
    const controller = new AbortController();
    controller.abort();
    const res = await executors.zod_tool({}, { abortSignal: controller.signal, toolCallId: "tc1" });
    expect(res).toEqual({ content: "Tool execution aborted." });
    expect(execute).not.toHaveBeenCalled();
  });

  it("a rejected zod call never reaches onPreTool hooks (003)", async () => {
    const onPreTool = vi.fn();
    const ctx = mockCtx({ hooks: { onPreTool } });
    const execute: ExecuteMock = vi.fn();
    const zodTool: CustomToolDef = {
      name: "zod_tool",
      description: "zod tool",
      inputSchema: z.object({ a: z.string() }).strict(),
      execute,
    };
    const { executors } = buildTools(ctx, [zodTool]);
    const res = await executors.zod_tool({}, { abortSignal: ctx.signal, toolCallId: "tc1" });
    expect(res.isError).toBe(true);
    expect(onPreTool).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
});

describe("skills via buildTools(skills)", () => {
  const testSkills = [
    { name: "test_skill", description: "A test skill", definition: "# Test\nHello." },
    { name: "data_guide", description: "Data querying guide", definition: "# Data\nUse filters." },
  ];

  it("skills threaded onto ctx and tools registered", () => {
    const ctx = mockCtx({ skills: testSkills });
    const { tools, executors } = buildTools(ctx, defaultTools(ctx));
    expect(tools.find((t) => t.name === "search_skills")).toBeDefined();
    expect(tools.find((t) => t.name === "load_skill")).toBeDefined();
    expect(executors.search_skills).toBeDefined();
    expect(executors.load_skill).toBeDefined();
  });

  it("search_skills matches by name", async () => {
    const ctx = mockCtx({ skills: testSkills });
    const { executors } = buildTools(ctx, defaultTools(ctx));
    const result = await executors.search_skills(
      { query: "data" },
      { abortSignal: ctx.signal, toolCallId: "tc1" },
    );
    expect(result.content).toContain("data_guide");
  });

  it("search_skills matches by description", async () => {
    const ctx = mockCtx({ skills: testSkills });
    const { executors } = buildTools(ctx, defaultTools(ctx));
    const result = await executors.search_skills(
      { query: "querying" },
      { abortSignal: ctx.signal, toolCallId: "tc2" },
    );
    expect(result.content).toContain("data_guide");
  });

  it("search_skills returns no match message when nothing found", async () => {
    const ctx = mockCtx({ skills: testSkills });
    const { executors } = buildTools(ctx, defaultTools(ctx));
    const result = await executors.search_skills(
      { query: "zzznomatch" },
      { abortSignal: ctx.signal, toolCallId: "tc3" },
    );
    expect(result.content).toBe("No skills matched the query.");
  });

  it("load_skill returns definition when found", async () => {
    const ctx = mockCtx({ skills: testSkills });
    const { executors } = buildTools(ctx, defaultTools(ctx));
    const result = await executors.load_skill(
      { name: "data_guide" },
      { abortSignal: ctx.signal, toolCallId: "tc4" },
    );
    expect(result.content).toBe("# Data\nUse filters.");
    expect(result.isError).toBeUndefined();
  });

  it("load_skill returns not found message when missing", async () => {
    const ctx = mockCtx({ skills: testSkills });
    const { executors } = buildTools(ctx, defaultTools(ctx));
    const result = await executors.load_skill(
      { name: "missing" },
      { abortSignal: ctx.signal, toolCallId: "tc5" },
    );
    expect(result.content).toContain("not found");
    expect(result.isError).toBe(true);
  });

  it("load_skill with no name is rejected by the schema before the tool runs (003)", async () => {
    const ctx = mockCtx({ skills: testSkills });
    const { executors } = buildTools(ctx, defaultTools(ctx));
    const result = await executors.load_skill(
      {},
      { abortSignal: ctx.signal, toolCallId: "tc-missing" },
    );
    expect(result.isError).toBe(true);
    expect(result.content).toBe("Invalid input for load_skill: data must have required property 'name'.");
  });

  it("load_skill with a blank name still reaches the tool's own guard (003)", async () => {
    const ctx = mockCtx({ skills: testSkills });
    const { executors } = buildTools(ctx, defaultTools(ctx));
    const result = await executors.load_skill(
      { name: "   " },
      { abortSignal: ctx.signal, toolCallId: "tc-blank" },
    );
    expect(result.isError).toBe(true);
    expect(result.content).toContain("without a skill name");
  });

  it("search_skills finds both core and host-registered skills when composed via coreSkills()", async () => {
    const ctx = mockCtx({ skills: [...coreSkills(), ...testSkills] });
    const { executors } = buildTools(ctx, defaultTools(ctx));
    const coreResult = await executors.search_skills(
      { query: "present" },
      { abortSignal: ctx.signal, toolCallId: "tc-core" },
    );
    expect(coreResult.content).toContain("present_to_user");
    const customResult = await executors.search_skills(
      { query: "test_skill" },
      { abortSignal: ctx.signal, toolCallId: "tc-custom" },
    );
    expect(customResult.content).toContain("test_skill");
  });

  it("search_skills works with no skills configured", async () => {
    const ctx = mockCtx();
    const { executors } = buildTools(ctx, defaultTools(ctx));
    const result = await executors.search_skills(
      { query: "anything" },
      { abortSignal: ctx.signal, toolCallId: "tc6" },
    );
    expect(result.content).toBe("No skills matched the query.");
  });

  it("load_skill works with no skills configured", async () => {
    const ctx = mockCtx();
    const { executors } = buildTools(ctx, defaultTools(ctx));
    const result = await executors.load_skill(
      { name: "anything" },
      { abortSignal: ctx.signal, toolCallId: "tc7" },
    );
    expect(result.content).toContain("not found");
    expect(result.isError).toBe(true);
  });

  it("custom tool cannot shadow search_skills", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ctx = mockCtx();
    const { executors } = buildTools(ctx, [
      ...defaultTools(ctx),
      {
        name: "search_skills",
        description: "shadow",
        inputSchema: z.object({}).strict(),
        execute: () => Promise.resolve({ content: "shadowed" }),
      },
    ]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("search_skills"));
    expect(executors.search_skills).toBeDefined();
    warnSpy.mockRestore();
  });

  it("custom tool cannot shadow load_skill", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ctx = mockCtx();
    const { executors } = buildTools(ctx, [
      ...defaultTools(ctx),
      {
        name: "load_skill",
        description: "shadow",
        inputSchema: z.object({}).strict(),
        execute: () => Promise.resolve({ content: "shadowed" }),
      },
    ]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("load_skill"));
    expect(executors.load_skill).toBeDefined();
    warnSpy.mockRestore();
  });
});

describe("tool outcome block side-channel", () => {
  it("fires ctx._onToolBlock with toolCallId and block when outcome.block is set", async () => {
    const captured: Array<[string, RenderableBlock]> = [];
    const ctx = mockCtx({
      _onToolBlock: (id, block) => captured.push([id, block]),
    });
    const custom: CustomToolDef = {
      name: "show_ui",
      description: "show ui",
      inputSchema: z.object({}).strict(),
      execute: () => Promise.resolve({
        content: "shown",
        block: { type: "buttons", options: [{ label: "Go", prompt: "go" }] },
      }),
    };
    const { executors } = buildTools(ctx, [custom]);
    await executors.show_ui(
      {},
      { abortSignal: ctx.signal, toolCallId: "tc-1" },
    );
    expect(captured).toHaveLength(1);
    expect(captured[0][0]).toBe("tc-1");
    expect(captured[0][1].type).toBe("buttons");
  });

  it("does not fire _onToolBlock when outcome.block is absent", async () => {
    let called = false;
    const ctx = mockCtx({
      _onToolBlock: () => { called = true; },
    });
    const custom: CustomToolDef = {
      name: "no_block_tool",
      description: "no block",
      inputSchema: z.object({}).strict(),
      execute: () => Promise.resolve({ content: "ok" }),
    };
    const { executors } = buildTools(ctx, [custom]);
    await executors.no_block_tool(
      {},
      { abortSignal: ctx.signal, toolCallId: "tc-2" },
    );
    expect(called).toBe(false);
  });

  it("does not throw when outcome.block is set but _onToolBlock is not wired", async () => {
    const ctx = mockCtx();
    const custom: CustomToolDef = {
      name: "block_tool",
      description: "block",
      inputSchema: z.object({}).strict(),
      execute: () => Promise.resolve({
        content: "shown",
        block: { type: "buttons", options: [] },
      }),
    };
    const { executors } = buildTools(ctx, [custom]);
    const result = await executors.block_tool(
      {},
      { abortSignal: ctx.signal, toolCallId: "tc-3" },
    );
    expect(result.content).toBe("shown");
  });
});

describe("tool lifecycle hooks", () => {
  it("onPreTool deny returns the reason and never enters the tool", async () => {
    const executeSpy = vi.fn().mockResolvedValue({ content: "real output" });
    const toolDef: CustomToolDef = {
      name: "guarded_tool",
      description: "guarded",
      inputSchema: z.object({ msg: z.string() }),
      execute: executeSpy,
    };

    const ctx = mockCtx({
      hooks: {
        onPreTool: () => ({ decision: "deny", reason: "Access denied by hook" }),
      },
    });

    const { executors } = buildTools(ctx, [toolDef]);
    const res = await executors.guarded_tool(
      { msg: "hi" },
      { abortSignal: ctx.signal, toolCallId: "tc-deny" },
    );

    expect(res.content).toBe("Access denied by hook");
    expect(executeSpy).toHaveBeenCalledTimes(0);
  });

  it("onPreTool deny with no reason returns the default message", async () => {
    const executeSpy = vi.fn();
    const toolDef: CustomToolDef = {
      name: "silent_deny",
      description: "denied",
      inputSchema: z.object({}),
      execute: executeSpy,
    };
    const ctx = mockCtx({
      hooks: {
        onPreTool: () => ({ decision: "deny" }),
      },
    });
    const { executors } = buildTools(ctx, [toolDef]);
    const res = await executors.silent_deny({}, { abortSignal: ctx.signal, toolCallId: "tc-1" });
    expect(res.content).toBe('Tool "silent_deny" was denied.');
    expect(executeSpy).toHaveBeenCalledTimes(0);
  });

  it("onPreTool ask, unresolved, yields an unconfirmed error and never enters the tool (004)", async () => {
    // PreToolResult.reason is documented (tool-hooks.types.ts) as sent to the model only
    // for "deny" — the "ask"→unconfirmed path (below) always uses the default
    // wording, since run-hooks.ts's merge never captures `reason` for "ask".
    const executeSpy = vi.fn().mockResolvedValue({ content: "real output" });
    const toolDef: CustomToolDef = {
      name: "ask_tool",
      description: "ask",
      inputSchema: z.object({}),
      execute: executeSpy,
    };
    const ctx = mockCtx({
      hooks: {
        onPreTool: () => ({ decision: "ask", reason: "Needs shopper confirmation" }),
      },
    });

    const { executors } = buildTools(ctx, [toolDef]);
    const res = await executors.ask_tool({}, { abortSignal: ctx.signal, toolCallId: "tc-ask" });

    expect(res.content).toContain('no confirmation dialog was confirmed; not performed');
    expect(executeSpy).toHaveBeenCalledTimes(0);
  });

  it("onPreTool ask with no reason returns the default unconfirmed message (004)", async () => {
    const toolDef: CustomToolDef = {
      name: "ask_silent_tool",
      description: "ask",
      inputSchema: z.object({}),
      execute: vi.fn(),
    };
    const ctx = mockCtx({
      hooks: {
        onPreTool: () => ({ decision: "ask" }),
      },
    });

    const { executors } = buildTools(ctx, [toolDef]);
    const res = await executors.ask_silent_tool({}, { abortSignal: ctx.signal, toolCallId: "tc-ask-2" });

    expect(res.content).toContain('no confirmation dialog was confirmed; not performed');
  });

  it("onPreTool ask followed by a later handler's allow still enters the tool as allow (004)", async () => {
    // A later "allow" from a second handler doesn't matter — the merge in
    // run-hooks.ts is deny > ask > allow with no downgrade path; a handler
    // that resolves "ask" must do so via its OWN "allow"/"deny" return, not
    // by racing another handler's "ask". Exercises that a plain single-vote
    // "allow" (nothing ever asked) does reach the tool.
    const executeSpy = vi.fn().mockResolvedValue({ content: "clicked" });
    const toolDef: CustomToolDef = {
      name: "resolved_tool",
      description: "resolved",
      inputSchema: z.object({}),
      execute: executeSpy,
    };
    const ctx = mockCtx({
      hooks: {
        onPreTool: [
          () => ({ decision: "allow" }),
        ],
      },
    });

    const { executors } = buildTools(ctx, [toolDef]);
    const res = await executors.resolved_tool({}, { abortSignal: ctx.signal, toolCallId: "tc-resolved" });

    expect(res.content).toBe("clicked");
    expect(executeSpy).toHaveBeenCalledTimes(1);
  });

  it("onPreTool ask resolved by the SAME handler via modifiedInput lets a defensive second handler stand down (004)", async () => {
    // Mirrors chat-panel's default onPreTool (resolves ask via UI, marks
    // `__waConfirmed`) composed with cat-store's defensive fallback (only
    // flags "ask" when nothing has marked the ref confirmed yet).
    const executeSpy = vi.fn().mockResolvedValue({ content: "removed" });
    const toolDef: CustomToolDef = {
      name: "destructive_tool",
      description: "destructive",
      inputSchema: z.object({ ref: z.string() }),
      execute: executeSpy,
    };
    const ctx = mockCtx({
      hooks: {
        onPreTool: [
          (p) => ({ decision: "allow", modifiedInput: { ...p.input, __waConfirmed: true } }),
          (p) => (p.input.__waConfirmed ? undefined : { decision: "ask", reason: "unconfirmed" }),
        ],
      },
    });

    const { executors } = buildTools(ctx, [toolDef]);
    const res = await executors.destructive_tool({ ref: "5" }, { abortSignal: ctx.signal, toolCallId: "tc-destructive" });

    expect(res.content).toBe("removed");
    expect(executeSpy).toHaveBeenCalledWith({ ref: "5", __waConfirmed: true }, expect.anything());
  });

  it("onPreTool modifiedInput reaches execute", async () => {
    const executeSpy = vi.fn().mockResolvedValue({ content: "ok" });
    const toolDef: CustomToolDef = {
      name: "mod_tool",
      description: "mod",
      inputSchema: z.object({ count: z.number() }),
      execute: executeSpy,
    };

    const ctx = mockCtx({
      hooks: {
        onPreTool: (p) => ({ modifiedInput: { ...p.input, count: 99 } }),
      },
    });

    const { executors } = buildTools(ctx, [toolDef]);
    await executors.mod_tool({ count: 1 }, { abortSignal: ctx.signal, toolCallId: "tc-mod" });

    expect(executeSpy).toHaveBeenCalledWith({ count: 99 }, expect.anything());
  });

  it("summarize supplies the summary", async () => {
    let capturedSummary: string | undefined;
    const toolDef: CustomToolDef = {
      name: "sum_tool",
      description: "sum",
      inputSchema: z.object({ item: z.string() }),
      summarize: (input) => `Adding ${String(input.item)}`,
      execute: () => Promise.resolve({ content: "done" }),
    };

    const ctx = mockCtx({
      hooks: {
        onPreTool: (p) => { capturedSummary = p.summary; },
      },
    });

    const { executors } = buildTools(ctx, [toolDef]);
    await executors.sum_tool({ item: "apple" }, { abortSignal: ctx.signal, toolCallId: "tc-sum" });

    expect(capturedSummary).toBe("Adding apple");
  });

  it("a tool without summarize yields summary === undefined", async () => {
    let capturedSummary: string | undefined = "sentinel";
    const toolDef: CustomToolDef = {
      name: "no_sum_tool",
      description: "no sum",
      inputSchema: z.object({}),
      execute: () => Promise.resolve({ content: "done" }),
    };

    const ctx = mockCtx({
      hooks: {
        onPreTool: (p) => { capturedSummary = p.summary; },
      },
    });

    const { executors } = buildTools(ctx, [toolDef]);
    await executors.no_sum_tool({}, { abortSignal: ctx.signal, toolCallId: "tc-nosum" });

    expect(capturedSummary).toBeUndefined();
  });

  it("onPostTool rewrite changes what the executor returns", async () => {
    const toolDef: CustomToolDef = {
      name: "post_tool",
      description: "post",
      inputSchema: z.object({}),
      execute: () => Promise.resolve({ content: "original" }),
    };

    const ctx = mockCtx({
      hooks: {
        onPostTool: () => ({ outcome: { content: "rewritten" } }),
      },
    });

    const { executors } = buildTools(ctx, [toolDef]);
    const res = await executors.post_tool({}, { abortSignal: ctx.signal, toolCallId: "tc-post" });

    expect(res.content).toBe("rewritten");
  });

  it("onPostTool receives the modified input", async () => {
    let capturedInput: Record<string, unknown> | undefined;
    const toolDef: CustomToolDef = {
      name: "post_input_tool",
      description: "post input",
      inputSchema: z.object({ x: z.number() }),
      execute: () => Promise.resolve({ content: "ok" }),
    };

    const ctx = mockCtx({
      hooks: {
        onPreTool: () => ({ modifiedInput: { x: 42 } }),
        onPostTool: (p) => { capturedInput = p.input; },
      },
    });

    const { executors } = buildTools(ctx, [toolDef]);
    await executors.post_input_tool({ x: 1 }, { abortSignal: ctx.signal, toolCallId: "tc-pi" });

    expect(capturedInput).toEqual({ x: 42 });
  });

  it("a rewritten outcome carrying a block still reaches _onToolBlock", async () => {
    const blockSpy = vi.fn();
    const toolDef: CustomToolDef = {
      name: "block_rewrite_tool",
      description: "block rewrite",
      inputSchema: z.object({}),
      execute: () => Promise.resolve({ content: "ok" }),
    };

    const ctx = mockCtx({
      _onToolBlock: blockSpy,
      hooks: {
        onPostTool: () => ({
          outcome: {
            content: "rewritten",
            block: { type: "buttons", options: [] },
          },
        }),
      },
    });

    const { executors } = buildTools(ctx, [toolDef]);
    await executors.block_rewrite_tool({}, { abortSignal: ctx.signal, toolCallId: "tc-br" });

    expect(blockSpy).toHaveBeenCalledWith("tc-br", { type: "buttons", options: [] });
  });

  it("no hooks on ctx leaves the executor behaviour identical", async () => {
    const toolDef: CustomToolDef = {
      name: "plain_tool",
      description: "plain",
      inputSchema: z.object({}),
      execute: () => Promise.resolve({ content: "same output" }),
    };

    const ctx = mockCtx();
    const { executors } = buildTools(ctx, [toolDef]);
    const res = await executors.plain_tool({}, { abortSignal: ctx.signal, toolCallId: "tc-plain" });

    expect(res.content).toBe("same output");
  });

  it("onPostTool fires with isError true when execute throws (010)", async () => {
    const postSpy = vi.fn<[PostToolPayload], PostToolResult | void>();
    const toolDef: CustomToolDef = {
      name: "throw_tool",
      description: "throws an error",
      inputSchema: z.object({}),
      execute: () => Promise.reject(new Error("boom")),
    };

    const ctx = mockCtx({ hooks: { onPostTool: postSpy } });
    const { executors } = buildTools(ctx, [toolDef]);
    const res = await executors.throw_tool({}, { abortSignal: ctx.signal, toolCallId: "tc-throw" });

    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy.mock.calls[0][0].outcome).toEqual({ content: "boom", isError: true });
    expect(postSpy.mock.calls[0][0].name).toBe("throw_tool");
    expect(res.content).toBe("boom");
  });

  it("a hook cannot rewrite a failed tool call into a success (010)", async () => {
    const toolDef: CustomToolDef = {
      name: "throw_tool",
      description: "throws an error",
      inputSchema: z.object({}),
      execute: () => Promise.reject(new Error("boom")),
    };

    const ctx = mockCtx({
      hooks: {
        onPostTool: () => ({ outcome: { content: "swallowed", isError: false } }),
      },
    });
    const { executors } = buildTools(ctx, [toolDef]);
    const res = await executors.throw_tool({}, { abortSignal: ctx.signal, toolCallId: "tc-throw" });

    // 002: the hook may rewrite the error text; the flag stays forced true.
    expect(res.content).toBe("swallowed");
    expect(res.isError).toBe(true);
  });

  it("a hook that throws on the failure path still lets the error reach the agent (010)", async () => {
    const toolDef: CustomToolDef = {
      name: "throw_tool",
      description: "throws an error",
      inputSchema: z.object({}),
      execute: () => Promise.reject(new Error("boom")),
    };

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const ctx = mockCtx({
        hooks: {
          onPostTool: () => {
            throw new Error("hook exploded");
          },
        },
      });
      const { executors } = buildTools(ctx, [toolDef]);
      const res = await executors.throw_tool({}, { abortSignal: ctx.signal, toolCallId: "tc-throw" });

      expect(res.content).toBe("boom");
      expect(errSpy).toHaveBeenCalled();
    } finally {
      errSpy.mockRestore();
    }
  });

  it("a hook that returns nothing on the failure path leaves the error intact (010)", async () => {
    const toolDef: CustomToolDef = {
      name: "throw_tool",
      description: "throws an error",
      inputSchema: z.object({}),
      execute: () => Promise.reject(new Error("boom")),
    };

    const ctx = mockCtx({
      hooks: {
        onPostTool: () => undefined,
      },
    });
    const { executors } = buildTools(ctx, [toolDef]);
    const res = await executors.throw_tool({}, { abortSignal: ctx.signal, toolCallId: "tc-throw" });

    expect(res.content).toBe("boom");
  });

  it("a successful tool still fires onPostTool exactly once, not marked as an error (010 regression)", async () => {
    const postSpy = vi.fn<[PostToolPayload], PostToolResult | void>();
    const toolDef: CustomToolDef = {
      name: "ok_tool",
      description: "succeeds",
      inputSchema: z.object({}),
      execute: () => Promise.resolve({ content: "ok" }),
    };

    const ctx = mockCtx({ hooks: { onPostTool: postSpy } });
    const { executors } = buildTools(ctx, [toolDef]);
    const res = await executors.ok_tool({}, { abortSignal: ctx.signal, toolCallId: "tc-ok" });

    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy.mock.calls[0][0].outcome.isError).not.toBe(true);
    expect(res.content).toBe("ok");
  });

  it("the failure-path onPostTool receives the modified input (010)", async () => {
    const postSpy = vi.fn<[PostToolPayload], PostToolResult | void>();
    const toolDef: CustomToolDef = {
      name: "throw_tool_input",
      description: "throws with input",
      inputSchema: z.object({ x: z.number() }),
      execute: () => Promise.reject(new Error("boom with input")),
    };

    const ctx = mockCtx({
      hooks: {
        onPreTool: () => ({ modifiedInput: { x: 42 } }),
        onPostTool: postSpy,
      },
    });
    const { executors } = buildTools(ctx, [toolDef]);
    const res = await executors.throw_tool_input({ x: 1 }, { abortSignal: ctx.signal, toolCallId: "tc-throw-input" });

    expect(res.content).toBe("boom with input");
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy.mock.calls[0][0].input).toEqual({ x: 42 });
  });

  it("an onPreTool deny does not fire onPostTool (010 regression)", async () => {
    const postSpy = vi.fn<[PostToolPayload], PostToolResult | void>();
    const execSpy = vi.fn().mockRejectedValue(new Error("should not run"));
    const toolDef: CustomToolDef = {
      name: "denied_tool",
      description: "denied",
      inputSchema: z.object({}),
      execute: execSpy,
    };

    const ctx = mockCtx({
      hooks: {
        onPreTool: () => ({ decision: "deny", reason: "nope" }),
        onPostTool: postSpy,
      },
    });
    const { executors } = buildTools(ctx, [toolDef]);
    const res = await executors.denied_tool({}, { abortSignal: ctx.signal, toolCallId: "tc-deny" });

    expect(postSpy).not.toHaveBeenCalled();
    expect(execSpy).not.toHaveBeenCalled();
    expect(res.content).toBe("nope");

    // Unresolved ask
    const askCtx = mockCtx({
      hooks: {
        onPreTool: () => ({ decision: "ask", reason: "confirm please" }),
        onPostTool: postSpy,
      },
    });
    const { executors: askExecutors } = buildTools(askCtx, [toolDef]);
    const askRes = await askExecutors.denied_tool({}, { abortSignal: askCtx.signal, toolCallId: "tc-ask" });

    expect(postSpy).not.toHaveBeenCalled();
    expect(execSpy).not.toHaveBeenCalled();
    expect(askRes.content).toContain("Interaction required confirmation");
  });

  it("a throwing tool touches neither _onToolBlock nor images (010)", async () => {
    const blockSpy = vi.fn();
    const toolDef: CustomToolDef = {
      name: "throw_tool",
      description: "throws",
      inputSchema: z.object({}),
      execute: () => Promise.reject(new Error("boom")),
    };

    const ctx = mockCtx({
      _onToolBlock: blockSpy,
      hooks: {
        onPostTool: () => ({
          outcome: {
            content: "x",
            isError: false,
            block: { type: "buttons", options: [] },
            images: [{ dataUrl: "data:image/png;base64,AAA=", mediaType: "image/png" }],
          },
        }),
      },
    });

    const { executors } = buildTools(ctx, [toolDef]);
    const res = await executors.throw_tool({}, { abortSignal: ctx.signal, toolCallId: "tc-throw" });

    // 002: returned content is used, but a returned block/images are ignored.
    expect(res.content).toBe("x");
    expect(res.isError).toBe(true);
    expect(blockSpy).not.toHaveBeenCalled();
    expect(res.images).toBeUndefined();
  });
});

// 002: the payload carries the call identifier and the throw path never emits a stack.
describe("post-tool payload call id (002)", () => {
  it("the success path passes toolCallId to onPostTool", async () => {
    const postSpy = vi.fn<[PostToolPayload], PostToolResult | void>();
    const toolDef: CustomToolDef = {
      name: "ok_tool",
      description: "ok",
      inputSchema: z.object({}),
      execute: () => Promise.resolve({ content: "ok" }),
    };
    const ctx = mockCtx({ hooks: { onPostTool: postSpy } });
    const { executors } = buildTools(ctx, [toolDef]);
    await executors.ok_tool({}, { abortSignal: ctx.signal, toolCallId: "tc-success-id" });

    expect(postSpy.mock.calls[0][0].toolCallId).toBe("tc-success-id");
  });

  it("the throw path passes toolCallId to onPostTool", async () => {
    const postSpy = vi.fn<[PostToolPayload], PostToolResult | void>();
    const toolDef: CustomToolDef = {
      name: "throw_tool",
      description: "throws",
      inputSchema: z.object({}),
      execute: () => Promise.reject(new Error("boom")),
    };
    const ctx = mockCtx({ hooks: { onPostTool: postSpy } });
    const { executors } = buildTools(ctx, [toolDef]);
    await executors.throw_tool({}, { abortSignal: ctx.signal, toolCallId: "tc-throw-id" });

    expect(postSpy.mock.calls[0][0].toolCallId).toBe("tc-throw-id");
  });

  it("a thrown stack is never sent — only the message", async () => {
    const toolDef: CustomToolDef = {
      name: "throw_tool",
      description: "throws",
      inputSchema: z.object({}),
      execute: () => {
        const e = new Error("message only");
        e.stack = "STACK-SENTINEL";
        return Promise.reject(e);
      },
    };
    const ctx = mockCtx();
    const { executors } = buildTools(ctx, [toolDef]);
    const res = await executors.throw_tool({}, { abortSignal: ctx.signal, toolCallId: "tc-stack" });
    expect(res.content).toBe("message only");
    expect(res.content).not.toContain("STACK-SENTINEL");
  });

  it("a hook that rewrites a thrown message has its content sent with the flag forced true", async () => {
    const toolDef: CustomToolDef = {
      name: "throw_tool",
      description: "throws",
      inputSchema: z.object({}),
      execute: () => Promise.reject(new Error("raw boom")),
    };
    const ctx = mockCtx({
      hooks: { onPostTool: () => ({ outcome: { content: "friendly failure" } }) },
    });
    const { executors } = buildTools(ctx, [toolDef]);
    const res = await executors.throw_tool({}, { abortSignal: ctx.signal, toolCallId: "tc-rw" });
    expect(res).toEqual({ content: "friendly failure", isError: true });
  });
});

// 001: the executor's result object carries the tool's error verdict to the loop.
describe("executor error flag (001)", () => {
  it("a throwing tool resolves with isError true and the same message", async () => {
    const custom: CustomToolDef = {
      name: "throw_tool",
      description: "throws",
      inputSchema: z.object({}),
      execute: () => Promise.reject(new Error("boom")),
    };
    const ctx = mockCtx();
    const { executors } = buildTools(ctx, [custom]);
    const res = await executors.throw_tool({}, { abortSignal: ctx.signal, toolCallId: "tc-flag-1" });

    expect(res).toEqual({ content: "boom", isError: true });
  });

  it("a succeeding tool resolves with no isError key", async () => {
    const custom: CustomToolDef = {
      name: "ok_tool",
      description: "succeeds",
      inputSchema: z.object({}),
      execute: () => Promise.resolve({ content: "ok" }),
    };
    const ctx = mockCtx();
    const { executors } = buildTools(ctx, [custom]);
    const res = await executors.ok_tool({}, { abortSignal: ctx.signal, toolCallId: "tc-flag-2" });

    expect(Object.prototype.hasOwnProperty.call(res, "isError")).toBe(false);
  });

  it("a tool returning isError true keeps the flag through the wrapper", async () => {
    const custom: CustomToolDef = {
      name: "guard_tool",
      description: "declares an error outcome",
      inputSchema: z.object({}),
      execute: () => Promise.resolve({ content: "guardrail text", isError: true }),
    };
    const ctx = mockCtx();
    const { executors } = buildTools(ctx, [custom]);
    const res = await executors.guard_tool({}, { abortSignal: ctx.signal, toolCallId: "tc-flag-3" });

    expect(res).toEqual({ content: "guardrail text", isError: true });
  });

  it("onPostTool can rewrite content but cannot clear isError", async () => {
    const custom: CustomToolDef = {
      name: "fail_tool",
      description: "fails",
      inputSchema: z.object({}),
      execute: () => Promise.resolve({ content: "real failure", isError: true }),
    };
    const ctx = mockCtx({
      hooks: {
        onPostTool: () => ({ outcome: { content: "all good" } }),
      },
    });
    const { executors } = buildTools(ctx, [custom]);
    const res = await executors.fail_tool({}, { abortSignal: ctx.signal, toolCallId: "tc-flag-4" });

    expect(res.content).toBe("all good");
    expect(res.isError).toBe(true);
  });

  it("onPostTool cannot set isError on a successful tool", async () => {
    const custom: CustomToolDef = {
      name: "win_tool",
      description: "succeeds",
      inputSchema: z.object({}),
      execute: () => Promise.resolve({ content: "ok" }),
    };
    const ctx = mockCtx({
      hooks: {
        onPostTool: () => ({ outcome: { content: "ok", isError: true } }),
      },
    });
    const { executors } = buildTools(ctx, [custom]);
    const res = await executors.win_tool({}, { abortSignal: ctx.signal, toolCallId: "tc-flag-5" });

    expect(res).toEqual({ content: "ok" });
  });

  it("a denied and an unconfirmed-ask call both resolve with isError true", async () => {
    const toolDef: CustomToolDef = {
      name: "guarded_tool",
      description: "guarded",
      inputSchema: z.object({}),
      execute: vi.fn(),
    };

    const denyCtx = mockCtx({
      hooks: { onPreTool: () => ({ decision: "deny" as const, reason: "Access denied by hook" }) },
    });
    const { executors } = buildTools(denyCtx, [toolDef]);
    const denyRes = await executors.guarded_tool({}, { abortSignal: denyCtx.signal, toolCallId: "tc-deny" });
    expect(denyRes.content).toBe("Access denied by hook");
    expect(denyRes.isError).toBe(true);

    const askCtx = mockCtx({
      hooks: { onPreTool: () => ({ decision: "ask" as const }) },
    });
    const { executors: askExecutors } = buildTools(askCtx, [toolDef]);
    const askRes = await askExecutors.guarded_tool({}, { abortSignal: askCtx.signal, toolCallId: "tc-ask" });
    expect(askRes.content).toContain('no confirmation dialog was confirmed; not performed');
    expect(askRes.isError).toBe(true);
  });
});

describe("executeToolByName", () => {
  it("returns {content, isError:true} when ctx.signal is aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    const ctx = mockCtx({ signal: ac.signal });
    const out = await executeToolByName("wait", { seconds: 5 }, ctx);
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/aborted/i);
  });

  it("returns {content} from list_data_sources when a dataSource is missing", async () => {
    const ctx = mockCtx();
    const out = await executeToolByName("list_data_sources", {}, ctx);
    expect(out.content).toContain("dataSource not available");
  });

  it("throws on unknown tool name", async () => {
    const ctx = mockCtx();
    await expect(
      executeToolByName("nonexistent", {}, ctx),
    ).rejects.toThrow(/Unknown tool/);
  });
});
