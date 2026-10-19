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
  toGeminiContents,
  toGeminiSystemInstruction,
  toGeminiTools,
  toGeminiToolConfig,
  fromGeminiResponse,
} from "./gemini-to-anthropic.js";
import { modelSupportsVision } from "./vision.js";
import type {
  GeminiGenerateContentRequest,
  GeminiGenerateContentResponse,
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
}

export function createGeminiLanguageModel(
  cfg: AgentConfig,
  opts?: { fetch?: typeof fetch }
): GeminiLanguageModel {
  return new GeminiLanguageModel(cfg, opts);
}


