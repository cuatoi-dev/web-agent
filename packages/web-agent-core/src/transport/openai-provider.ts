import type { AgentConfig } from "../config.types.js";
import { getAbsoluteBaseURL } from "./provider.js";
import type {
  LanguageModel,
  ProviderCallOptions,
  ProviderResult,
  NormalizedUsage,
  ProviderWarning,
} from "./provider.types.js";
import { reassembleStream } from "./stream-parts.js";
import type { StreamPart } from "./provider.types.js";
import { fromAnthropicResponse } from "./message-converter.js";
import type { MessageStreamEvent } from "./wire.types.js";
import { isStreamEventType } from "./wire.types.js";
import type { OpenAIBlockState } from "./types.js";
import { requestJson, requestStream } from "./anthropic-request.js";
import {
  toOpenAIMessages,
  toOpenAIToolChoice,
  toOpenAITools,
  fromOpenAIResponse,
  OpenAIStreamTranslator,
} from "./openai-to-anthropic.js";
import { modelSupportsVision } from "./vision.js";
import type {
  OpenAIChatCompletion,
  OpenAIChatCompletionChunk,
  OpenAIChatCompletionCreateParams,
  OpenAIReasoningEffort,
} from "./openai-wire.types.js";

export class OpenAILanguageModel implements LanguageModel {
  readonly provider = "openai";
  readonly supportedUrls = {
    "image/*": [/^https?:\/\/.*$/],
  };
  get modelId() {
    return this._cfg.model;
  }

  /**
   * Back-compat test seam only. Real requests never set this — see generate()
   * and doStream() below. When a test assigns a
   * `{ chat: { completions: { create } } }` shape here, that mock is used
   * instead of a real fetch call, so the existing SDK-shaped test suites keep
   * working unmodified.
   */
  // Method-shorthand syntax (not a property holding an arrow type) so the
  // parameter stays bivariantly checked — existing test suites assign a
  // vi.fn() typed against the real OpenAI SDK's params shape here, which is
  // narrower than Record<string, unknown> and would otherwise fail strict
  // contravariant assignability.
  public _client?: {
    chat: {
      completions: {
        create(params: Record<string, unknown>, opts?: { signal?: AbortSignal }): unknown;
      };
    };
  };
  private _fetch?: typeof fetch;
  private _cfg: AgentConfig;

  constructor(cfg: AgentConfig, opts?: { fetch?: typeof fetch }) {
    this._cfg = cfg;
    this._fetch = opts?.fetch;
    // Explicit assignment (not just a field declaration) so `_client` is a real
    // own property from construction on. tsconfig.base.json sets
    // useDefineForClassFields:false, so an unassigned optional field never
    // materializes at runtime — middleware.ts:92 checks `"_client" in inner`
    // to decide whether to wire up the back-compat forwarding property, and
    // that check needs this to exist.
    this._client = undefined;
  }

  // The configured baseURL already ends in "/v1" for this endpoint type
  // (config.ts:28 -> "/api/openai/v1"), and the vendor path is
  // "/chat/completions", so only a trailing slash needs normalising.
  private requestBaseURL(): string {
    return getAbsoluteBaseURL(this._cfg.baseURL).replace(/\/$/, "");
  }

  // ---------------------------------------------------------------------------
  // buildBaseParams — shared param builder for both generate() and doStream()
  // ---------------------------------------------------------------------------
  private buildBaseParams(
    opts: ProviderCallOptions,
    warnings: ProviderWarning[]
  ): OpenAIChatCompletionCreateParams {
    if (opts.topK !== undefined) {
      warnings.push({
        type: "unsupported",
        feature: "topK",
        details: "OpenAI models do not support topK",
      });
    }

    const openaiMsgs = toOpenAIMessages(opts.messages, warnings, {
      modelId: opts.model,
      imageInputEnabled: this._cfg.imageInput,
      modelSupportsVision: modelSupportsVision("openai", opts.model),
    });

    const systemPrompt = opts.systemPrompt || "";
    if (systemPrompt) {
      const isReasoning =
        opts.model.startsWith("o1") || opts.model.startsWith("o3");
      openaiMsgs.unshift({
        role: isReasoning ? "developer" : ("system" as const),
        content: systemPrompt,
      });
    }

    const isReasoningModel =
      opts.model.startsWith("o1") || opts.model.startsWith("o3");
    const resolvedReasoningEffort = opts.providerOptions?.["openai"]?.[
      "reasoning_effort"
    ] as OpenAIReasoningEffort | undefined;

    return {
      model: opts.model,
      messages: openaiMsgs,
      ...(opts.tools?.length ? { tools: toOpenAITools(opts.tools) } : {}),
      ...(opts.toolChoice ? { tool_choice: toOpenAIToolChoice(opts.toolChoice) } : {}),
      ...(isReasoningModel
        ? {
            max_completion_tokens: opts.maxOutputTokens,
            ...(resolvedReasoningEffort
              ? { reasoning_effort: resolvedReasoningEffort }
              : {}),
          }
        : {
            max_tokens: opts.maxOutputTokens,
            ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
            ...(opts.topP !== undefined ? { top_p: opts.topP } : {}),
          }),
      ...(opts.stopSequences ? { stop: opts.stopSequences } : {}),
      ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
    };
  }

  // ---------------------------------------------------------------------------
  // generate — non-streaming path; streaming delegates to doStream()
  // ---------------------------------------------------------------------------
  async generate(opts: ProviderCallOptions): Promise<ProviderResult> {
    if (opts.streaming) {
      const { stream } = await this.doStream(opts);
      return reassembleStream(stream);
    }

    const warnings: ProviderWarning[] = [];
    // `stream: false` is sent EXPLICITLY — see the matching note in
    // anthropic-provider.ts. A gateway may read a missing `stream` field as
    // streaming (one gateway did, verified 2026-09-10), which hands this
    // non-streaming path an SSE body it cannot parse.
    const params = { ...this.buildBaseParams(opts, warnings), stream: false as const };

    const response: OpenAIChatCompletion = this._client
      ? ((await this._client.chat.completions.create(params, {
          signal: opts.abortSignal,
        })) as OpenAIChatCompletion)
      : await requestJson<OpenAIChatCompletion>({
          baseURL: this.requestBaseURL(),
          path: "/chat/completions",
          headers: { "Content-Type": "application/json" },
          body: params,
          fetch: this._fetch,
          signal: opts.abortSignal,
        });

    const { message, finishReason, reasoningTokens } =
      fromOpenAIResponse(response);
    const usage: NormalizedUsage = {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
      ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    };
    const result: ProviderResult = {
      // The one shared Anthropic-to-internal content conversion, reused
      // unchanged from the Anthropic leg (message-converter.ts:191).
      content: fromAnthropicResponse(message).content,
      finishReason,
      usage,
      warnings: [],
    };
    if (warnings.length > 0) {
      result.warnings = [...(result.warnings || []), ...warnings];
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // doStream — streaming via POST /chat/completions ({stream:true, include_usage})
  // ---------------------------------------------------------------------------
  async doStream(
    opts: ProviderCallOptions
  ): Promise<{ stream: AsyncIterable<StreamPart> }> {
    const warnings: ProviderWarning[] = [];
    const baseParams = this.buildBaseParams(opts, warnings);

    const streamParams = {
      ...baseParams,
      stream: true as const,
      stream_options: { include_usage: true },
    };

    const chunks: AsyncIterable<OpenAIChatCompletionChunk> = this._client
      ? ((await this._client.chat.completions.create(streamParams, {
          signal: opts.abortSignal,
        })) as AsyncIterable<OpenAIChatCompletionChunk>)
      : await requestStream<OpenAIChatCompletionChunk>({
          baseURL: this.requestBaseURL(),
          path: "/chat/completions",
          headers: { "Content-Type": "application/json" },
          body: streamParams,
          fetch: this._fetch,
          signal: opts.abortSignal,
          onProgress: opts.onTransportProgress,
        });

    return { stream: this.streamToParts(chunks, warnings) };
  }

  // ---------------------------------------------------------------------------
  // streamToParts — async generator mapping OpenAI chunks → StreamPart sequence
  // ---------------------------------------------------------------------------
  private async *streamToParts(
    chunks: AsyncIterable<OpenAIChatCompletionChunk>,
    warnings: ProviderWarning[]
  ): AsyncGenerator<StreamPart> {
    yield { type: "stream-start", warnings };

    const TEXT_ID = "text_0";
    const REASON_ID = "reasoning_0";
    const translator = new OpenAIStreamTranslator();

    const blocks = new Map<number, OpenAIBlockState>();
    let inputTokens = 0;
    let outputTokens = 0;

    const handle = function* (
      events: MessageStreamEvent[]
    ): Generator<StreamPart> {
      for (const event of events) {
        if (isStreamEventType(event, "content_block_start")) {
          const { index, content_block: cb } = event;
          if (cb.type === "text") {
            blocks.set(index, { kind: "text", id: TEXT_ID, accInput: "" });
            yield { type: "text-start", id: TEXT_ID };
          } else if (cb.type === "thinking") {
            blocks.set(index, { kind: "thinking", id: REASON_ID, accInput: "" });
            yield { type: "reasoning-start", id: REASON_ID };
          } else if (cb.type === "tool_use") {
            blocks.set(index, {
              kind: "tool_use",
              id: cb.id,
              toolName: cb.name,
              accInput: "",
              extra_content: cb.extra_content,
            });
            yield { type: "tool-input-start", id: cb.id, toolName: cb.name };
          }
        } else if (isStreamEventType(event, "content_block_delta")) {
          const block = blocks.get(event.index);
          if (!block) continue;
          if (event.delta.type === "text_delta") {
            yield { type: "text-delta", id: block.id, delta: event.delta.text };
          } else if (event.delta.type === "thinking_delta") {
            yield {
              type: "reasoning-delta",
              id: block.id,
              delta: event.delta.thinking,
            };
          } else if (event.delta.type === "input_json_delta") {
            block.accInput += event.delta.partial_json;
            yield {
              type: "tool-input-delta",
              id: block.id,
              delta: event.delta.partial_json,
            };
          }
        } else if (isStreamEventType(event, "content_block_stop")) {
          const block = blocks.get(event.index);
          if (!block) continue;
          if (block.kind === "text") yield { type: "text-end", id: block.id };
          else if (block.kind === "thinking")
            yield { type: "reasoning-end", id: block.id };
          else {
            yield { type: "tool-input-end", id: block.id };
            yield {
              type: "tool-call",
              toolCallId: block.id,
              toolName: block.toolName!,
              input: block.accInput,
              ...(block.extra_content ? { extra_content: block.extra_content } : {}),
            };
          }
          blocks.delete(event.index);
        } else if (isStreamEventType(event, "message_delta")) {
          outputTokens = event.usage.output_tokens;
          if (event.usage.input_tokens !== undefined)
            inputTokens = event.usage.input_tokens;
        }
      }
    };

    for await (const chunk of chunks) yield* handle(translator.push(chunk));
    yield* handle(translator.end());

    yield {
      type: "finish",
      finishReason: translator.finishReason,
      // Cache fields are intentionally absent. reasoningTokens only when the
      // stream reported it.
      usage: {
        inputTokens,
        outputTokens,
        ...(translator.reasoningTokens !== undefined
          ? { reasoningTokens: translator.reasoningTokens }
          : {}),
      },
    };
  }
}

export function createOpenAILanguageModel(
  cfg: AgentConfig,
  opts?: { fetch?: typeof fetch }
): OpenAILanguageModel {
  return new OpenAILanguageModel(cfg, opts);
}


