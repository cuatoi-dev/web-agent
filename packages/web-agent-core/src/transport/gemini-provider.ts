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
import type { GeminiBlockState } from "./types.js";
import { requestJson, requestStream } from "./anthropic-request.js";
import {
  toGeminiContents,
  toGeminiSystemInstruction,
  toGeminiTools,
  toGeminiToolConfig,
  fromGeminiResponse,
  GeminiStreamTranslator,
} from "./gemini-to-anthropic.js";
import { modelSupportsVision } from "./vision.js";
import type {
  GeminiGenerateContentRequest,
  GeminiGenerateContentResponse,
  GeminiStreamChunk,
  GeminiGenerationConfig,
} from "./gemini-wire.types.js";

export class GeminiLanguageModel implements LanguageModel {
  readonly provider = "gemini";
  // Gemini only accepts inline base64 image data — toGeminiContents drops an
  // http(s) image and pushes a ProviderWarning instead of sending it. No URL
  // pattern is advertised here, so no false capability is claimed.
  readonly supportedUrls = {};
  get modelId() {
    return this._cfg.model;
  }

  private _fetch?: typeof fetch;
  private _cfg: AgentConfig;
  private _thoughtSignatures = new Map<string, string>();

  constructor(cfg: AgentConfig, opts?: { fetch?: typeof fetch }) {
    this._cfg = cfg;
    this._fetch = opts?.fetch;
  }

  private requestBaseURL(): string {
    return getAbsoluteBaseURL(this._cfg.baseURL).replace(/\/$/, "");
  }

  private buildBaseParams(
    opts: ProviderCallOptions,
    warnings: ProviderWarning[]
  ): GeminiGenerateContentRequest {
    const contents = toGeminiContents(opts.messages, warnings, {
      imageInputEnabled: this._cfg.imageInput,
      modelSupportsVision: modelSupportsVision("gemini", opts.model),
      thoughtSignatures: Object.fromEntries(this._thoughtSignatures),
    });

    const systemInstruction = toGeminiSystemInstruction(opts.systemPrompt);
    const tools = opts.tools?.length ? toGeminiTools(opts.tools) : undefined;
    const toolConfig = opts.toolChoice ? toGeminiToolConfig(opts.toolChoice) : undefined;

    const generationConfig: GeminiGenerationConfig = {
      ...(opts.maxOutputTokens !== undefined ? { maxOutputTokens: opts.maxOutputTokens } : {}),
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      ...(opts.topP !== undefined ? { topP: opts.topP } : {}),
      ...(opts.topK !== undefined ? { topK: opts.topK } : {}),
      ...(opts.stopSequences?.length ? { stopSequences: opts.stopSequences } : {}),
      ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
    };

    return {
      contents,
      ...(systemInstruction ? { systemInstruction } : {}),
      ...(tools ? { tools } : {}),
      ...(toolConfig ? { toolConfig } : {}),
      ...(Object.keys(generationConfig).length > 0 ? { generationConfig } : {}),
    };
  }

  async generate(opts: ProviderCallOptions): Promise<ProviderResult> {
    if (opts.streaming) {
      const { stream } = await this.doStream(opts);
      return reassembleStream(stream);
    }

    const warnings: ProviderWarning[] = [];
    const params = this.buildBaseParams(opts, warnings);
    const modelParam = encodeURIComponent(opts.model);
    const path = `/v1beta/models/${modelParam}:generateContent`;

    const response = await requestJson<GeminiGenerateContentResponse>({
      baseURL: this.requestBaseURL(),
      path,
      headers: { "Content-Type": "application/json" },
      body: params,
      fetch: this._fetch,
      signal: opts.abortSignal,
    });

    const translated = fromGeminiResponse(response);

    if (translated.thoughtSignatures) {
      for (const [id, sig] of Object.entries(translated.thoughtSignatures)) {
        this._thoughtSignatures.set(id, sig);
      }
    }

    const usage: NormalizedUsage = {
      inputTokens: translated.message.usage.input_tokens,
      outputTokens: translated.message.usage.output_tokens,
      ...(translated.reasoningTokens !== undefined
        ? { reasoningTokens: translated.reasoningTokens }
        : {}),
      ...(translated.message.usage.cache_read_input_tokens != null
        ? { cachedInputTokens: translated.message.usage.cache_read_input_tokens }
        : {}),
    };

    const result: ProviderResult = {
      content: fromAnthropicResponse(translated.message).content,
      finishReason: translated.finishReason,
      usage,
      warnings: [],
    };

    if (warnings.length > 0) {
      result.warnings = [...(result.warnings || []), ...warnings];
    }

    return result;
  }

  async doStream(
    opts: ProviderCallOptions
  ): Promise<{ stream: AsyncIterable<StreamPart> }> {
    const warnings: ProviderWarning[] = [];
    const params = this.buildBaseParams(opts, warnings);
    const modelParam = encodeURIComponent(opts.model);
    const path = `/v1beta/models/${modelParam}:streamGenerateContent?alt=sse`;

    const chunks = await requestStream<GeminiStreamChunk>({
      baseURL: this.requestBaseURL(),
      path,
      headers: { "Content-Type": "application/json" },
      body: params,
      fetch: this._fetch,
      signal: opts.abortSignal,
      onProgress: opts.onTransportProgress,
    });

    return { stream: this.streamToParts(chunks, warnings) };
  }

  private async *streamToParts(
    chunks: AsyncIterable<GeminiStreamChunk>,
    warnings: ProviderWarning[]
  ): AsyncGenerator<StreamPart> {
    yield { type: "stream-start", warnings };

    const TEXT_ID = "text_0";
    const REASON_ID = "reasoning_0";
    const translator = new GeminiStreamTranslator();

    const blocks = new Map<number, GeminiBlockState>();
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

    for (const [id, sig] of Object.entries(translator.thoughtSignatures)) {
      this._thoughtSignatures.set(id, sig);
    }

    yield {
      type: "finish",
      finishReason: translator.finishReason,
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

export function createGeminiLanguageModel(
  cfg: AgentConfig,
  opts?: { fetch?: typeof fetch }
): GeminiLanguageModel {
  return new GeminiLanguageModel(cfg, opts);
}


