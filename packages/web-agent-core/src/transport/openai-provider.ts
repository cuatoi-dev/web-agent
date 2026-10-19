import type { AgentConfig } from "../config.types.js";
import { getAbsoluteBaseURL } from "./provider.js";
import type {
  LanguageModel,
  ProviderCallOptions,
  ProviderResult,
  NormalizedUsage,
  ProviderWarning,
} from "./provider.types.js";
import { fromAnthropicResponse } from "./message-converter.js";
import { requestJson } from "./anthropic-request.js";
import {
  toOpenAIMessages,
  toOpenAIToolChoice,
  toOpenAITools,
  fromOpenAIResponse,
} from "./openai-to-anthropic.js";
import { modelSupportsVision } from "./vision.js";
import type {
  OpenAIChatCompletion,
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
   * below. When a test assigns a
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
  // buildBaseParams — param builder for generate()
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
  // generate — one request, one complete result
  // ---------------------------------------------------------------------------
  async generate(opts: ProviderCallOptions): Promise<ProviderResult> {
    const warnings: ProviderWarning[] = [];
    // `stream: false` is sent EXPLICITLY — see the matching note in
    // anthropic-provider.ts. A gateway may read a missing `stream` field as a
    // request for an event stream (one gateway did, verified 2026-09-10),
    // which hands this JSON path an SSE body it cannot parse.
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

}

export function createOpenAILanguageModel(
  cfg: AgentConfig,
  opts?: { fetch?: typeof fetch }
): OpenAILanguageModel {
  return new OpenAILanguageModel(cfg, opts);
}


