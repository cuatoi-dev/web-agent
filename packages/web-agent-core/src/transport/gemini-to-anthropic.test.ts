import { describe, it, expect } from "vitest";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  toGeminiContents,
  toGeminiSystemInstruction,
  toGeminiTools,
  toGeminiToolConfig,
  fromGeminiStopReason,
  fromGeminiFinishReason,
  fromGeminiResponse,
  GeminiStreamTranslator,
} from "./gemini-to-anthropic.js";
import type { GeminiTranslatedResponse } from "./gemini-to-anthropic.js";
import type { ProviderWarning, Tool } from "./provider.types.js";
import type { ModelMessage, ToolCallPart, ToolResultPart } from "../types.js";
import type {
  GeminiGenerateContentResponse,
  GeminiStreamChunk,
} from "./gemini-wire.types.js";
import type { MessageStreamEvent, ToolUseBlock } from "./wire.types.js";
import { isStreamEventType } from "./wire.types.js";

// ---------------------------------------------------------------------------
// toGeminiContents tests
// ---------------------------------------------------------------------------
describe("toGeminiContents", () => {
  it("skips system messages", () => {
    const warnings: ProviderWarning[] = [];
    const msgs: ModelMessage[] = [
      { role: "system", content: "You are a system" },
      { role: "user", content: "hello" },
    ];
    const result = toGeminiContents(msgs, warnings);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      role: "user",
      parts: [{ text: "hello" }],
    });
  });

  it("maps assistant to the model role", () => {
    const warnings: ProviderWarning[] = [];
    const msgs: ModelMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ];
    const result = toGeminiContents(msgs, warnings);
    expect(result).toHaveLength(2);
    expect(result[1].role).toBe("model");
    expect(result[1].parts).toEqual([{ text: "hello" }]);
  });

  it("maps a tool result to a functionResponse on a user turn", () => {
    const warnings: ProviderWarning[] = [];
    const trPart: ToolResultPart = {
      type: "tool-result",
      toolCallId: "call_1",
      toolName: "get_weather",
      output: { tempC: 31 },
    };
    const msgs: ModelMessage[] = [{ role: "tool", content: [trPart] }];
    const result = toGeminiContents(msgs, warnings);
    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("user");
    expect(result[0].parts).toHaveLength(1);
    expect(result[0].parts[0].functionResponse).toEqual({
      id: "call_1",
      name: "get_weather",
      response: { tempC: 31 },
    });
  });

  it("wraps a non-object tool output", () => {
    const warnings: ProviderWarning[] = [];
    const trPart: ToolResultPart = {
      type: "tool-result",
      toolCallId: "call_1",
      toolName: "get_weather",
      output: "31C",
    };
    const msgs: ModelMessage[] = [{ role: "tool", content: [trPart] }];
    const result = toGeminiContents(msgs, warnings);
    expect(result).toHaveLength(1);
    expect(result[0].parts[0].functionResponse?.response).toEqual({
      output: "31C",
    });
  });

  it("strips a data: URL prefix", () => {
    const warnings: ProviderWarning[] = [];
    const msgs: ModelMessage[] = [
      {
        role: "user",
        content: [
          {
            type: "image",
            image: "data:image/png;base64,AAA",
            mediaType: "image/png",
          },
        ],
      },
    ];
    const result = toGeminiContents(msgs, warnings, {
      modelSupportsVision: true,
    });
    expect(result).toHaveLength(1);
    expect(result[0].parts[0].inlineData).toEqual({
      mimeType: "image/png",
      data: "AAA",
    });
    expect(result[0].parts[0].inlineData?.data).not.toContain("base64,");
  });

  it("passes bare base64 through unchanged", () => {
    const warnings: ProviderWarning[] = [];
    const msgs: ModelMessage[] = [
      {
        role: "user",
        content: [
          {
            type: "image",
            image: "AAA",
            mediaType: "image/png",
          },
        ],
      },
    ];
    const result = toGeminiContents(msgs, warnings, {
      modelSupportsVision: true,
    });
    expect(result).toHaveLength(1);
    expect(result[0].parts[0].inlineData?.data).toBe("AAA");
  });

  it("throws an error when image part has empty payload", () => {
    const warnings: ProviderWarning[] = [];
    const msgs: ModelMessage[] = [
      {
        role: "user",
        content: [{ type: "image", image: "data:,", mediaType: "image/png" }],
      },
    ];
    expect(() =>
      toGeminiContents(msgs, warnings, { modelSupportsVision: true })
    ).toThrow("Invalid image: base64 payload is empty");
  });

  it("throws an error when image data URL has empty base64 content", () => {
    const warnings: ProviderWarning[] = [];
    const msgs: ModelMessage[] = [
      {
        role: "user",
        content: [
          { type: "image", image: "data:image/png;base64,", mediaType: "image/png" },
        ],
      },
    ];
    expect(() =>
      toGeminiContents(msgs, warnings, { modelSupportsVision: true })
    ).toThrow("Invalid image: base64 payload is empty");
  });

  it("warns and drops an https image", () => {
    const warnings: ProviderWarning[] = [];
    const msgs: ModelMessage[] = [
      {
        role: "user",
        content: [
          {
            type: "image",
            image: "https://example.com/photo.png",
            mediaType: "image/png",
          },
        ],
      },
    ];
    const result = toGeminiContents(msgs, warnings, {
      modelSupportsVision: true,
    });
    expect(result).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    const w = warnings[0];
    expect(w.type).toBe("unsupported");
    if (w.type === "unsupported") expect(w.feature).toBe("image-input");
  });

  it("drops empty text parts", () => {
    const warnings: ProviderWarning[] = [];
    const msgs: ModelMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "" }],
      },
      {
        role: "assistant",
        content: "",
      },
    ];
    const result = toGeminiContents(msgs, warnings);
    expect(result).toHaveLength(0);
  });

  it("attaches a thoughtSignature when supplied", () => {
    const warnings: ProviderWarning[] = [];
    const tcPart: ToolCallPart = {
      type: "tool-call",
      toolCallId: "call_1",
      toolName: "get_weather",
      input: {},
    };
    const msgs: ModelMessage[] = [
      {
        role: "assistant",
        content: [tcPart],
      },
    ];
    const result = toGeminiContents(msgs, warnings, {
      thoughtSignatures: { call_1: "SIG" },
    });
    expect(result).toHaveLength(1);
    const part = result[0].parts[0];
    expect(part.functionCall).toEqual({
      id: "call_1",
      name: "get_weather",
      args: {},
    });
    expect(part.thoughtSignature).toBe("SIG");
    expect("thoughtSignature" in (part.functionCall as unknown as Record<string, unknown>)).toBe(false);
  });

  it("omits the field when no signature is supplied", () => {
    const warnings: ProviderWarning[] = [];
    const tcPart: ToolCallPart = {
      type: "tool-call",
      toolCallId: "call_1",
      toolName: "get_weather",
      input: {},
    };
    const msgs: ModelMessage[] = [
      {
        role: "assistant",
        content: [tcPart],
      },
    ];
    const result = toGeminiContents(msgs, warnings);
    expect(result).toHaveLength(1);
    const part = result[0].parts[0];
    expect("thoughtSignature" in part).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// toGeminiSystemInstruction tests
// ---------------------------------------------------------------------------
describe("toGeminiSystemInstruction", () => {
  it("returns undefined for empty or undefined prompt", () => {
    expect(toGeminiSystemInstruction(undefined)).toBeUndefined();
    expect(toGeminiSystemInstruction("")).toBeUndefined();
  });

  it("returns systemInstruction object for prompt", () => {
    expect(toGeminiSystemInstruction("You are terse.")).toEqual({
      parts: [{ text: "You are terse." }],
    });
  });
});

// ---------------------------------------------------------------------------
// toGeminiTools / toGeminiToolConfig tests
// ---------------------------------------------------------------------------
describe("toGeminiTools / toGeminiToolConfig", () => {
  const tools: Tool[] = [
    {
      name: "tool_a",
      description: "desc a",
      input_schema: { type: "object", properties: { a: { type: "string" } } },
    },
    {
      name: "tool_b",
      description: "desc b",
      input_schema: { type: "object", properties: { b: { type: "number" } } },
    },
  ];

  it("collapses two tools into one entry", () => {
    const result = toGeminiTools(tools);
    expect(result).toHaveLength(1);
    expect(result[0].functionDeclarations).toHaveLength(2);
  });

  it("lands input_schema on parametersJsonSchema", () => {
    const result = toGeminiTools(tools);
    expect(result[0].functionDeclarations[0].parametersJsonSchema).toEqual(
      tools[0].input_schema
    );
    expect(result[0].functionDeclarations[1].parametersJsonSchema).toEqual(
      tools[1].input_schema
    );
  });

  // Regression for the 2026-08-15 live 400: "Unknown name \"additionalProperties\"
  // … Cannot find field" / "Unknown name \"$ref\" … Cannot find field". `parameters`
  // (a restricted OpenAPI 3.0 subset) rejects both keywords; `parametersJsonSchema`
  // accepts standard JSON Schema. Built from a REAL zod-to-json-schema() output —
  // not hand-written — because a hand-written flat schema is exactly what let the
  // original bug through 41 unit tests and two review stages: it never contained
  // the keywords the live API actually rejects.
  it("preserves additionalProperties and $ref from real zod-to-json-schema output", () => {
    const filterSchema = z.object({ q: z.string() });
    const zodSchema = z.object({
      // Reusing the same schema instance for two properties makes
      // zod-to-json-schema hoist it behind a $ref instead of inlining it twice.
      filter: filterSchema,
      fallbackFilter: filterSchema,
      seconds: z.number().int().min(1).max(30),
    });
    const raw = zodToJsonSchema(zodSchema) as Record<string, unknown>;
    // matches build-tools.ts's zodToInputSchema
    const input_schema = { ...raw };
    delete input_schema.$schema;
    expect(input_schema.additionalProperties).toBe(false);
    const filterProp = (input_schema.properties as Record<string, unknown>).filter as Record<
      string,
      unknown
    >;
    expect(filterProp.additionalProperties).toBe(false);
    const fallbackFilterProp = (input_schema.properties as Record<string, unknown>)
      .fallbackFilter as Record<string, unknown>;
    expect(fallbackFilterProp.$ref).toBeDefined();

    const realTools: Tool[] = [
      { name: "search_docs", description: "Search docs", input_schema: input_schema as Tool["input_schema"] },
    ];
    const result = toGeminiTools(realTools);
    const decl = result[0].functionDeclarations[0];

    // `parameters` isn't part of GeminiFunctionDeclaration (see the type's own
    // comment) — this cast keeps the regression check that a future change
    // doesn't accidentally reintroduce the restricted-schema field.
    expect((decl as { parameters?: unknown }).parameters).toBeUndefined();
    expect(decl.parametersJsonSchema).toEqual(input_schema);
    // Explicit on the keywords that 400'd on `parameters`, so a future change
    // that starts stripping them regresses visibly instead of via a live probe.
    const schema = decl.parametersJsonSchema as Record<string, unknown>;
    expect(schema.additionalProperties).toBe(false);
    const props = schema.properties as Record<string, unknown>;
    expect((props.fallbackFilter as Record<string, unknown>).$ref).toBeDefined();
  });

  it("maps tool choice correctly", () => {
    expect(toGeminiToolConfig({ type: "auto" })).toEqual({
      functionCallingConfig: { mode: "AUTO" },
    });
    expect(toGeminiToolConfig({ type: "required" })).toEqual({
      functionCallingConfig: { mode: "ANY" },
    });
    expect(toGeminiToolConfig({ type: "none" })).toEqual({
      functionCallingConfig: { mode: "NONE" },
    });
    expect(
      toGeminiToolConfig({ type: "tool", toolName: "get_weather" })
    ).toEqual({
      functionCallingConfig: {
        mode: "ANY",
        allowedFunctionNames: ["get_weather"],
      },
    });
  });
});

// ---------------------------------------------------------------------------
// fromGeminiStopReason / fromGeminiFinishReason tests
// ---------------------------------------------------------------------------
describe("fromGeminiStopReason / fromGeminiFinishReason", () => {
  it("maps ('STOP', true) to tool_use / tool-calls", () => {
    expect(fromGeminiStopReason("STOP", true)).toBe("tool_use");
    expect(fromGeminiFinishReason("STOP", true)).toBe("tool-calls");
  });

  it("maps ('STOP', false) to end_turn / stop", () => {
    expect(fromGeminiStopReason("STOP", false)).toBe("end_turn");
    expect(fromGeminiFinishReason("STOP", false)).toBe("stop");
  });

  it("maps ('MAX_TOKENS', false) to max_tokens / length", () => {
    expect(fromGeminiStopReason("MAX_TOKENS", false)).toBe("max_tokens");
    expect(fromGeminiFinishReason("MAX_TOKENS", false)).toBe("length");
  });

  it("maps ('MAX_TOKENS', true) to tool_use / tool-calls", () => {
    expect(fromGeminiStopReason("MAX_TOKENS", true)).toBe("tool_use");
    expect(fromGeminiFinishReason("MAX_TOKENS", true)).toBe("tool-calls");
  });

  it("maps (undefined, false) to null / unknown", () => {
    expect(fromGeminiStopReason(undefined, false)).toBeNull();
    expect(fromGeminiFinishReason(undefined, false)).toBe("unknown");
  });

  it("maps ('SOMETHING_NEW', false) to null / other", () => {
    expect(fromGeminiStopReason("SOMETHING_NEW", false)).toBeNull();
    expect(fromGeminiFinishReason("SOMETHING_NEW", false)).toBe("other");
  });
});

// ---------------------------------------------------------------------------
// fromGeminiResponse tests
// ---------------------------------------------------------------------------
describe("fromGeminiResponse", () => {
  const TOOL_CALL_BODY: GeminiGenerateContentResponse = {
    candidates: [
      {
        content: {
          role: "model",
          parts: [
            {
              functionCall: {
                name: "get_weather",
                args: { city: "Singapore" },
                id: "call_286085",
              },
              thoughtSignature: "El4KXAERTTIPkbR4M...",
            },
          ],
        },
        finishReason: "STOP",
        index: 0,
        finishMessage: "Model generated function call(s).",
      },
    ],
    usageMetadata: {
      promptTokenCount: 59,
      candidatesTokenCount: 16,
      totalTokenCount: 75,
    },
    modelVersion: "gemini-3.5-flash-lite",
    responseId: "Fet_aujiKsWbjuMPvfK3wAk",
  };

  const THINKING_BODY: GeminiGenerateContentResponse = {
    candidates: [
      {
        content: {
          role: "model",
          parts: [
            {
              text: "Thinking process...",
              thought: true,
              thoughtSignature: "SIG_THINK",
            },
            { text: "Here is the answer." },
          ],
        },
        finishReason: "STOP",
        index: 0,
      },
    ],
    usageMetadata: {
      promptTokenCount: 3,
      candidatesTokenCount: 1,
      totalTokenCount: 63,
      thoughtsTokenCount: 59,
      cachedContentTokenCount: 10,
    },
    modelVersion: "gemini-flash-latest",
    responseId: "resp_123",
  };

  it("infers tool_use from the part, not the finish reason", () => {
    const result = fromGeminiResponse(TOOL_CALL_BODY);
    expect(TOOL_CALL_BODY.candidates?.[0]?.finishReason).toBe("STOP");
    expect(result.message.stop_reason).toBe("tool_use");
    expect(result.finishReason).toBe("tool-calls");
  });

  it("creates a complete tool-use block", () => {
    const result = fromGeminiResponse(TOOL_CALL_BODY);
    expect(result.message.content).toEqual([
      {
        type: "tool_use",
        id: "call_286085",
        name: "get_weather",
        input: { city: "Singapore" },
      },
    ]);
  });

  it("returns the thought signature keyed by tool-call id", () => {
    const result = fromGeminiResponse(TOOL_CALL_BODY);
    expect(result.thoughtSignatures).toEqual({
      call_286085: "El4KXAERTTIPkbR4M...",
    });
  });

  it("sets output_tokens to candidatesTokenCount, not totalTokenCount", () => {
    const result = fromGeminiResponse(TOOL_CALL_BODY);
    expect(result.message.usage.output_tokens).toBe(16);
    expect(result.message.usage.output_tokens).not.toBe(75);
  });

  it("omits reasoningTokens key when thoughtsTokenCount is absent", () => {
    expect(() => fromGeminiResponse(TOOL_CALL_BODY)).not.toThrow();
    const result = fromGeminiResponse(TOOL_CALL_BODY);
    expect("reasoningTokens" in result).toBe(false);
  });

  it("maps thoughtsTokenCount to reasoningTokens without leaking into output_tokens", () => {
    const result = fromGeminiResponse(THINKING_BODY);
    expect(result.reasoningTokens).toBe(59);
    expect(result.message.usage.output_tokens).toBe(1);
    expect(result.message.usage.input_tokens).toBe(3);
  });

  it("maps cachedContentTokenCount and keeps cache_creation_input_tokens absent", () => {
    const res1 = fromGeminiResponse(THINKING_BODY);
    expect(res1.message.usage.cache_read_input_tokens).toBe(10);
    expect("cache_creation_input_tokens" in res1.message.usage).toBe(false);

    const res2 = fromGeminiResponse(TOOL_CALL_BODY);
    expect("cache_creation_input_tokens" in res2.message.usage).toBe(false);
  });

  it("maps text-only response to end_turn", () => {
    const body: GeminiGenerateContentResponse = {
      candidates: [
        {
          content: {
            role: "model",
            parts: [{ text: "Hello there!" }],
          },
          finishReason: "STOP",
        },
      ],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3 },
    };
    const result = fromGeminiResponse(body);
    expect(result.message.content).toEqual([
      { type: "text", text: "Hello there!" },
    ]);
    expect(result.message.stop_reason).toBe("end_turn");
    expect(result.finishReason).toBe("stop");
  });

  it("skips empty text parts", () => {
    const body: GeminiGenerateContentResponse = {
      candidates: [
        {
          content: {
            role: "model",
            parts: [{ text: "" }],
          },
          finishReason: "STOP",
        },
      ],
    };
    const result = fromGeminiResponse(body);
    expect(result.message.content).toHaveLength(0);
  });

  it("handles candidate with no content without throwing", () => {
    const body: GeminiGenerateContentResponse = {
      candidates: [
        {
          finishReason: "SAFETY",
        },
      ],
    };
    let result: GeminiTranslatedResponse;
    expect(() => {
      result = fromGeminiResponse(body);
    }).not.toThrow();
    expect(result!.message.content).toEqual([]);
    expect(result!.message.stop_reason).toBe("refusal");
  });

  it("generates a stable id for functionCall with no id", () => {
    const body: GeminiGenerateContentResponse = {
      candidates: [
        {
          content: {
            role: "model",
            parts: [
              {
                functionCall: {
                  name: "lookup",
                  args: {},
                },
              },
            ],
          },
          finishReason: "STOP",
        },
      ],
    };
    const result = fromGeminiResponse(body);
    const block = result.message.content[0] as ToolUseBlock;
    expect(block.type).toBe("tool_use");
    expect(block.id).toBe("lookup_0");
  });
});

// ---------------------------------------------------------------------------
// GeminiStreamTranslator tests
// ---------------------------------------------------------------------------
describe("GeminiStreamTranslator", () => {
  const F1: GeminiStreamChunk = {
    candidates: [
      {
        content: {
          role: "model",
          parts: [{ text: "One\nTwo\nThree\nFour\nFive\nSix\nSeven" }],
        },
        index: 0,
      },
    ],
    usageMetadata: {
      promptTokenCount: 16,
      candidatesTokenCount: 13,
      totalTokenCount: 29,
    },
  };
  const F2: GeminiStreamChunk = {
    candidates: [
      {
        content: { role: "model", parts: [{ text: "\nEight" }] },
        index: 0,
      },
    ],
    usageMetadata: {
      promptTokenCount: 16,
      candidatesTokenCount: 15,
      totalTokenCount: 31,
    },
  };
  const F3: GeminiStreamChunk = {
    candidates: [
      {
        content: {
          role: "model",
          parts: [{ text: "", thoughtSignature: "El4KXAER..." }],
        },
        finishReason: "STOP",
        index: 0,
      },
    ],
    usageMetadata: {
      promptTokenCount: 16,
      candidatesTokenCount: 15,
      totalTokenCount: 31,
    },
  };

  it("streams text as deltas", () => {
    const translator = new GeminiStreamTranslator();
    const e1 = translator.push(F1);
    const e2 = translator.push(F2);
    const e3 = translator.push(F3);
    const eEnd = translator.end();

    const allEvents: MessageStreamEvent[] = [...e1, ...e2, ...e3, ...eEnd];
    const blockStarts = allEvents.filter(
      (e) => e.type === "content_block_start" && e.index === 0
    );
    expect(blockStarts).toHaveLength(1);

    const deltas = allEvents.filter(
      (e): e is Extract<MessageStreamEvent, { type: "content_block_delta" }> =>
        isStreamEventType(e, "content_block_delta") &&
        e.index === 0 &&
        e.delta.type === "text_delta"
    );
    const text = deltas
      .map((d) => (d.delta.type === "text_delta" ? d.delta.text : ""))
      .join("");
    expect(text).toBe("One\nTwo\nThree\nFour\nFive\nSix\nSeven\nEight");

    const blockStops = allEvents.filter(
      (e) => e.type === "content_block_stop" && e.index === 0
    );
    expect(blockStops).toHaveLength(1);
  });

  it("does not open a block or delta for empty final text", () => {
    const translator = new GeminiStreamTranslator();
    translator.push(F1);
    translator.push(F2);
    const e3 = translator.push(F3);

    const emptyDeltas = e3.filter(
      (e) =>
        isStreamEventType(e, "content_block_delta") && e.delta.type === "text_delta" && e.delta.text === ""
    );
    expect(emptyDeltas).toHaveLength(0);

    const extraStarts = e3.filter((e) => e.type === "content_block_start");
    expect(extraStarts).toHaveLength(0);
  });

  it("overwrites usage instead of summing", () => {
    const translator = new GeminiStreamTranslator();
    translator.push(F1);
    translator.push(F2);
    const e3 = translator.push(F3);

    const messageDeltas = e3.filter((e) => isStreamEventType(e, "message_delta"));
    expect(messageDeltas).toHaveLength(1);
    const usage = messageDeltas[0].usage;
    expect(usage.output_tokens).toBe(15);
    expect(usage.output_tokens).not.toBe(43); // 13 + 15 + 15
  });

  it("does not zero out usage in the finish frame", () => {
    const translator = new GeminiStreamTranslator();
    const allEvents = [
      ...translator.push(F1),
      ...translator.push(F2),
      ...translator.push(F3),
    ];

    const messageDeltas = allEvents.filter(
      (e): e is Extract<typeof e, { type: "message_delta" }> =>
        e.type === "message_delta"
    );
    for (const md of messageDeltas) {
      expect(md.usage.output_tokens).not.toBe(0);
    }
    const lastDelta = messageDeltas[messageDeltas.length - 1];
    expect(lastDelta.delta.stop_reason).toBe("end_turn");
    expect(lastDelta.usage.output_tokens).toBe(15);
  });

  it("streams function call complete in one frame", () => {
    const translator = new GeminiStreamTranslator();
    const toolChunk: GeminiStreamChunk = {
      candidates: [
        {
          content: {
            role: "model",
            parts: [
              {
                functionCall: {
                  name: "get_weather",
                  args: { city: "Singapore" },
                  id: "call_343748",
                },
                thoughtSignature: "SIG123",
              },
            ],
          },
          index: 0,
        },
      ],
    };

    const events = translator.push(toolChunk);
    const start = events.find((e) => e.type === "content_block_start") as
      | Extract<MessageStreamEvent, { type: "content_block_start" }>
      | undefined;
    const delta = events.find((e) => e.type === "content_block_delta") as
      | Extract<MessageStreamEvent, { type: "content_block_delta" }>
      | undefined;
    const stop = events.find((e) => e.type === "content_block_stop") as
      | Extract<MessageStreamEvent, { type: "content_block_stop" }>
      | undefined;

    expect(start).toBeDefined();
    expect(start!.content_block).toEqual({
      type: "tool_use",
      id: "call_343748",
      name: "get_weather",
      input: {},
    });
    expect(delta).toBeDefined();
    expect(delta!.delta.type).toBe("input_json_delta");
    if (delta!.delta.type === "input_json_delta") {
      expect(typeof delta!.delta.partial_json).toBe("string");
      expect(JSON.parse(delta!.delta.partial_json)).toEqual({
        city: "Singapore",
      });
    }
    expect(stop).toBeDefined();
    expect(start!.index).toBe(delta!.index);
    expect(delta!.index).toBe(stop!.index);
    expect(translator.thoughtSignatures).toEqual({ call_343748: "SIG123" });
  });

  it("sets stop reason to tool_use even though finish frame says STOP", () => {
    const translator = new GeminiStreamTranslator();
    const toolChunk: GeminiStreamChunk = {
      candidates: [
        {
          content: {
            role: "model",
            parts: [
              {
                functionCall: {
                  name: "get_weather",
                  args: { city: "Singapore" },
                  id: "call_1",
                },
              },
            ],
          },
          index: 0,
        },
      ],
    };
    const finishChunk: GeminiStreamChunk = {
      candidates: [
        {
          finishReason: "STOP",
          index: 0,
        },
      ],
    };

    translator.push(toolChunk);
    const finishEvents = translator.push(finishChunk);
    const md = finishEvents.find((e) => isStreamEventType(e, "message_delta"));
    expect(md!.delta.stop_reason).toBe("tool_use");
    expect(translator.finishReason).toBe("tool-calls");
  });

  it("assigns separate blocks and indices >= 2 for parallel calls", () => {
    const translator = new GeminiStreamTranslator();
    const toolChunk1: GeminiStreamChunk = {
      candidates: [
        {
          content: {
            role: "model",
            parts: [
              {
                functionCall: {
                  name: "tool_a",
                  args: {},
                  id: "call_a",
                },
              },
            ],
          },
          index: 0,
        },
      ],
    };
    const toolChunk2: GeminiStreamChunk = {
      candidates: [
        {
          content: {
            role: "model",
            parts: [
              {
                functionCall: {
                  name: "tool_b",
                  args: {},
                  id: "call_b",
                },
              },
            ],
          },
          index: 0,
        },
      ],
    };

    const e1 = translator.push(toolChunk1);
    const e2 = translator.push(toolChunk2);

    const start1 = e1.find((e) => isStreamEventType(e, "content_block_start"));
    const start2 = e2.find((e) => isStreamEventType(e, "content_block_start"));

    expect(start1!.index).toBeGreaterThanOrEqual(2);
    expect(start2!.index).toBeGreaterThanOrEqual(2);
    expect(start1!.index).not.toBe(start2!.index);
  });

  it("produces agreeing tool-use blocks in streaming and non-streaming", () => {
    const TOOL_CALL_BODY: GeminiGenerateContentResponse = {
      candidates: [
        {
          content: {
            role: "model",
            parts: [
              {
                functionCall: {
                  name: "get_weather",
                  args: { city: "Singapore" },
                  id: "call_286085",
                },
                thoughtSignature: "SIG_TEST",
              },
            ],
          },
          finishReason: "STOP",
          index: 0,
        },
      ],
    };

    const nonStream = fromGeminiResponse(TOOL_CALL_BODY);
    const nonStreamTool = nonStream.message.content[0] as ToolUseBlock;

    const translator = new GeminiStreamTranslator();
    const streamEvents = translator.push(TOOL_CALL_BODY);
    const streamStart = streamEvents.find(
      (e) => e.type === "content_block_start"
    ) as Extract<MessageStreamEvent, { type: "content_block_start" }> | undefined;
    const streamDelta = streamEvents.find(
      (e) => e.type === "content_block_delta"
    ) as Extract<MessageStreamEvent, { type: "content_block_delta" }> | undefined;

    expect(streamStart!.content_block).toMatchObject({ id: nonStreamTool.id, name: nonStreamTool.name });
    if (streamDelta!.delta.type === "input_json_delta") {
      expect(JSON.parse(streamDelta!.delta.partial_json)).toEqual(
        nonStreamTool.input,
      );
    }
  });

  it("closes open text block on end() and is idempotent for tool blocks", () => {
    const translator = new GeminiStreamTranslator();
    translator.push(F1); // opens text at index 0
    const endEvents1 = translator.end();
    expect(endEvents1).toEqual([
      { type: "content_block_stop", index: 0 },
    ]);

    const endEvents2 = translator.end();
    expect(endEvents2).toEqual([]);
  });
});
