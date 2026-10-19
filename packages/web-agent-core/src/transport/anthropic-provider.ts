import type { AgentConfig } from "../config.types.js";
import { getAbsoluteBaseURL } from "./provider.js";
import { toAnthropicMessages } from "./message-converter.js";
import type {
  LanguageModel, ProviderCallOptions, ProviderResult, ProviderWarning,
} from "./provider.types.js";
import type { TextBlockParam, Message } from "./wire.types.js";
import { requestJson } from "./anthropic-request.js";
import { modelSupportsVision } from "./vision.js";
import { applyRollingCacheBreakpoint } from "./anthropic-cache.js";
import { mapToolChoice, fromAnthropicMessage } from "./anthropic-mapping.js";

export class AnthropicLanguageModel implements LanguageModel {
  readonly provider = "anthropic";
  readonly supportedUrls = {};
  get modelId() { return this._cfg.model; }

  /**
   * Back-compat test seam only. Real requests never set this — see generate()
   * below. When a test assigns a `{ messages: { create } }`
   * shape here (`agent.ts`'s `_client` getter/setter forwards to it), that
   * mock is used instead of a real fetch call, so the existing SDK-shaped
   * test suites keep working unmodified.
   */
  // Method-shorthand syntax (not a property holding an arrow type) so the
  // parameter stays bivariantly checked — existing test suites assign a
  // vi.fn() typed against the real Anthropic SDK's MessageCreateParams here,
  // which is narrower than Record<string, unknown> and would otherwise fail
  // strict contravariant assignability.
  public _client?: { messages: { create(params: Record<string, unknown>, opts?: { signal?: AbortSignal }): unknown } };
  private _fetch?: typeof fetch;
  private _cfg: AgentConfig;

  constructor(cfg: AgentConfig, opts?: { fetch?: typeof fetch }) {
    this._cfg = cfg;
    this._fetch = opts?.fetch;
    // Explicit assignment (not just a field declaration) so `_client` is a
    // real own property from construction on. tsconfig.base.json sets
    // useDefineForClassFields:false, so an unassigned optional field never
    // materializes at runtime — middleware.ts's wrapProvider() checks
    // `"_client" in inner` to decide whether to wire up the back-compat
    // forwarding property, and that check needs this to exist.
    this._client = undefined;
  }

  // ---------------------------------------------------------------------------
  // buildParams — param builder for generate()
  // ---------------------------------------------------------------------------
  private buildParams(opts: ProviderCallOptions, warnings: ProviderWarning[]): Record<string, unknown> {
    const { system: extractedSystem, messages: anthropicMsgs } =
      toAnthropicMessages(opts.messages, warnings, {
        modelId: opts.model,
        imageInputEnabled: this._cfg.imageInput,
        modelSupportsVision: modelSupportsVision("anthropic", opts.model),
      });
    // Rolling history cache: one breakpoint on the last block of the last
    // message so a turn's tool-loop steps re-read prior history from cache.
    // (Budget: A+B on system [task 001] + this 1 = 3 of Anthropic's 4.)
    applyRollingCacheBreakpoint(anthropicMsgs);
    const systemPrompt = opts.systemPrompt || extractedSystem || "";
    const anthropicPO = opts.providerOptions?.["anthropic"];
    const systemStatic = anthropicPO?.["systemStatic"] as string | undefined;
    const systemDynamic = anthropicPO?.["systemDynamic"] as string | undefined;

    // Breakpoint A on STATIC (caches tools + static system), B on DYNAMIC.
    let system: string | TextBlockParam[] | undefined;
    if (systemStatic) {
      system = [
        { type: "text", text: systemStatic, cache_control: { type: "ephemeral" } },
        ...(systemDynamic
          ? [{ type: "text", text: systemDynamic, cache_control: { type: "ephemeral" } } as TextBlockParam]
          : []),
      ];
    } else if (systemPrompt) {
      system = systemPrompt;
    }

    const thinkingOpt = opts.providerOptions?.["anthropic"]?.["thinking"] as
      | { type: string; budget_tokens?: number } | undefined;
    const thinkingEnabled = !!thinkingOpt;

    return {
      model: opts.model,
      max_tokens: opts.maxOutputTokens ?? 4096,
      ...(system ? { system } : {}),
      messages: anthropicMsgs,
      ...(opts.tools?.length ? { tools: opts.tools } : {}),
      ...(opts.toolChoice ? { tool_choice: mapToolChoice(opts.toolChoice) } : {}),
      ...(thinkingEnabled
        ? { thinking: { type: "enabled", budget_tokens: thinkingOpt.budget_tokens ?? 1024 } }
        : {
            ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
            ...(opts.topP !== undefined ? { top_p: opts.topP } : {}),
            ...(opts.topK !== undefined ? { top_k: opts.topK } : {}),
          }),
      ...(opts.stopSequences ? { stop_sequences: opts.stopSequences } : {}),
    };
  }

  // ---------------------------------------------------------------------------
  // generate — one request, one complete result
  // ---------------------------------------------------------------------------
  async generate(opts: ProviderCallOptions): Promise<ProviderResult> {
    const warnings: ProviderWarning[] = [];
    // `stream: false` is sent EXPLICITLY, not left to the default. The real
    // Anthropic API treats a missing `stream` as false and the SDK therefore
    // omits it, but a gateway may read "absent" as a request for an event
    // stream — one gateway did, verified 2026-09-10: omitting the field
    // returns `text/event-stream`, sending `stream:false` returns
    // `application/json`. The JSON parser then gets SSE, throws, and the turn
    // retries to exhaustion and shows the red error. One explicit field costs
    // nothing upstream and makes the request unambiguous to anything between.
    const params = { ...this.buildParams(opts, warnings), stream: false as const };
    const anthropicResp: Message = this._client
      ? (await this._client.messages.create(params, { signal: opts.abortSignal })) as Message
      : await requestJson<Message>({
          baseURL: this.requestBaseURL(),
          path: "/v1/messages",
          headers: { "Content-Type": "application/json" },
          body: params,
          fetch: this._fetch,
          signal: opts.abortSignal,
        });
    const result = fromAnthropicMessage(anthropicResp);
    if (warnings.length > 0) {
      result.warnings = [...(result.warnings || []), ...warnings];
    }
    return result;
  }

  // Normalizes a trailing "/v1" or "/v1/" off cfg.baseURL so a request always
  // builds ".../api/anthropic/v1/messages" and never doubles it — both
  // "/api/anthropic" and "/api/anthropic/v1" resolve to the same URL.
  private requestBaseURL(): string {
    return getAbsoluteBaseURL(this._cfg.baseURL).replace(/\/v1\/?$/, "");
  }
}

export function createAnthropicLanguageModel(
  cfg: AgentConfig,
  opts?: { fetch?: typeof fetch },
): AnthropicLanguageModel {
  return new AnthropicLanguageModel(cfg, opts);
}
