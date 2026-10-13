import type { AgentConfig } from "../config.types.js";
import { getAbsoluteBaseURL } from "./provider.js";
import { toAnthropicMessages } from "./message-converter.js";
import type {
  LanguageModel, ProviderCallOptions, ProviderResult,
  ProviderWarning, Tool,
} from "./provider.types.js";
import { reassembleStream, isParsableJson } from "./stream-parts.js";
import type { StreamPart } from "./provider.types.js";
import type {
  TextBlockParam,
  Message, MessageStreamEvent, StopReason,
} from "./wire.types.js";
import { isStreamEventType } from "./wire.types.js";
import type { AnthropicBlockState } from "./types.js";
import { requestJson, requestStream } from "./anthropic-request.js";
import { modelSupportsVision } from "./vision.js";
import { applyRollingCacheBreakpoint } from "./anthropic-cache.js";
import {
  requiredArgsByTool, mapToolChoice, fromAnthropicMessage, mapFinishReason,
} from "./anthropic-mapping.js";

export class AnthropicLanguageModel implements LanguageModel {
  readonly provider = "anthropic";
  readonly supportedUrls = {};
  get modelId() { return this._cfg.model; }

  /**
   * Back-compat test seam only. Real requests never set this — see generate()
   * and doStream() below. When a test assigns a `{ messages: { create } }`
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
  // buildParams — shared param builder for both generate() and doStream()
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
  // generate — non-streaming path unchanged; streaming delegates to doStream()
  // ---------------------------------------------------------------------------
  async generate(opts: ProviderCallOptions): Promise<ProviderResult> {
    if (opts.streaming) {
      const { stream } = await this.doStream(opts);
      return reassembleStream(stream);
    }

    const warnings: ProviderWarning[] = [];
    // `stream: false` is sent EXPLICITLY, not left to the default. The real
    // Anthropic API treats a missing `stream` as false and the SDK therefore
    // omits it, but a gateway may read "absent" as "streaming" — one gateway did,
    // verified 2026-09-10: omitting the field returns `text/event-stream`,
    // sending `stream:false` returns `application/json`. The non-streaming
    // parser then gets SSE, throws, and the turn retries to exhaustion and
    // shows the red error. One explicit field costs nothing upstream and makes
    // the request unambiguous to anything in between.
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

  // ---------------------------------------------------------------------------
  // doStream — iterates MessageStreamEvents and emits parts as they arrive
  // ---------------------------------------------------------------------------
  async doStream(opts: ProviderCallOptions): Promise<{ stream: AsyncIterable<StreamPart> }> {
    const warnings: ProviderWarning[] = [];
    const params = this.buildParams(opts, warnings);
    // Uses readSseStream via requestStream (or the injected _client mock in
    // tests). The SSE reader tolerates gateway non-spec SSE anomalies —
    // duplicate message_delta/message_stop after the first message_stop, or a
    // trailing OpenAI-style `data: [DONE]` sentinel — that some
    // OpenAI-to-Anthropic translating gateways emit. msgToParts only reacts to
    // the event types it knows, so those anomalies pass through harmlessly.
    const rawStream: AsyncIterable<MessageStreamEvent> = this._client
      ? (await this._client.messages.create({ ...params, stream: true }, { signal: opts.abortSignal })) as AsyncIterable<MessageStreamEvent>
      : await requestStream({
          baseURL: this.requestBaseURL(),
          path: "/v1/messages",
          headers: { "Content-Type": "application/json" },
          body: { ...params, stream: true },
          fetch: this._fetch,
          signal: opts.abortSignal,
          onProgress: opts.onTransportProgress,
        });
    return { stream: this.msgToParts(rawStream, warnings, opts.tools) };
  }

  // Normalizes a trailing "/v1" or "/v1/" off cfg.baseURL so a request always
  // builds ".../api/anthropic/v1/messages" and never doubles it — both
  // "/api/anthropic" and "/api/anthropic/v1" resolve to the same URL.
  private requestBaseURL(): string {
    return getAbsoluteBaseURL(this._cfg.baseURL).replace(/\/v1\/?$/, "");
  }

  // ---------------------------------------------------------------------------
  // msgToParts — async generator: iterates MessageStreamEvents incrementally.
  // Emits each text/thinking/tool delta as it arrives; never buffers a whole
  // message before yielding.
  // ---------------------------------------------------------------------------
  private async *msgToParts(messageStream: AsyncIterable<MessageStreamEvent>, warnings: ProviderWarning[], tools?: Tool[]): AsyncGenerator<StreamPart> {
    yield { type: "stream-start", warnings };

    const blocks = new Map<number, AnthropicBlockState>();

    // Tool blocks in content_block_start order that have not yet been given a
    // completed argument payload. A stream can deliver a payload on an index
    // that is not the one the payload belongs to (see the reattribution note
    // in the input_json_delta branch), so ownership is resolved from this
    // queue in start order rather than from the index the delta arrived on.
    const pendingTools: AnthropicBlockState[] = [];

    // Built once per stream and read only by the end-of-stream flush below.
    const requiredArgs = requiredArgsByTool(tools);

    let stopReason: StopReason = null;
    let inputTokens = 0;
    let outputTokens = 0;
    let cachedInputTokens: number | undefined;
    let cacheCreationTokens: number | undefined;

    for await (const event of messageStream) {
      if (isStreamEventType(event, "message_start")) {
        const u = event.message.usage;
        inputTokens = u.input_tokens;
        cachedInputTokens = u.cache_read_input_tokens ?? undefined;
        cacheCreationTokens = u.cache_creation_input_tokens ?? undefined;
      } else if (isStreamEventType(event, "content_block_start")) {
        const { index, content_block: cb } = event;
        if (cb.type === "text") {
          const id = `block_${index}`;
          blocks.set(index, { kind: "text", id, accInput: "", signature: "" });
          yield { type: "text-start", id };
        } else if (cb.type === "thinking") {
          const id = `block_${index}`;
          blocks.set(index, { kind: "thinking", id, accInput: "", signature: "" });
          yield { type: "reasoning-start", id };
        } else if (cb.type === "tool_use") {
          const state: AnthropicBlockState = { kind: "tool_use", id: cb.id, toolName: cb.name, accInput: "", signature: "" };
          blocks.set(index, state);
          pendingTools.push(state);
          yield { type: "tool-input-start", id: cb.id, toolName: cb.name };
        }
        // redacted_thinking: no normalized representation — silently skip
      } else if (isStreamEventType(event, "content_block_delta")) {
        const { index, delta } = event;
        const block = blocks.get(index);
        if (block) {
          if (delta.type === "text_delta") {
            yield { type: "text-delta", id: block.id, delta: delta.text };
          } else if (delta.type === "thinking_delta") {
            yield { type: "reasoning-delta", id: block.id, delta: delta.thinking };
          } else if (delta.type === "signature_delta") {
            block.signature += delta.signature;
          } else if (delta.type === "input_json_delta") {
            block.accInput += delta.partial_json;
            yield { type: "tool-input-delta", id: block.id, delta: delta.partial_json };
            // Live evidence (task 002, response #52 of the frame trace): a
            // gateway can deliver BOTH tool calls' argument payloads on the
            // same index, one after the other, while the other block ends
            // empty:
            //
            //   content_block_start index=1 id=call_78…  name=query_data
            //   content_block_start index=2 id=call_39…  name=query_data
            //   content_block_delta index=2 {"aggregate":…,"source":"orders"}
            //   content_block_stop  index=1                  <- ends empty
            //   content_block_delta index=2 {"select":…,"source":"products"}
            //   content_block_stop  index=2
            //
            // Both payloads are on the wire; only the index tagging is wrong.
            // Task 002 finalized this block and dropped the later payload,
            // which stopped the two from concatenating into unparsable JSON
            // but threw away arguments belonging to the block sitting empty
            // next to it — the empty-tool-call bug.
            //
            // Keep the payload with the block it was tagged to whenever that
            // block is still waiting for one — the tag is only ever wrong for
            // the EXTRA payloads, so trusting it first is what keeps a normal
            // stream (and a correctly-tagged first payload) untouched.
            // Reattribute only an overflow payload: one arriving on an index
            // that has already produced a complete set of arguments. It goes
            // to the tool block that started earliest and is still empty.
            //
            // The first version of this reattributed by start order alone and
            // handed a list_data_sources payload to a load_skill block that
            // merely started earlier (live run, 2026-09-04) — the tag is good
            // evidence, just not sufficient on its own.
            //
            // Resetting accInput lets a second payload on the same index
            // accumulate cleanly, keeping task 002's protection against two
            // payloads concatenating into unparsable JSON.
            if (block.kind === "tool_use" && isParsableJson(block.accInput)) {
              const payload = block.accInput;
              block.accInput = "";
              // An overflow payload may only move to a block for the SAME
              // tool. The misrouting seen live always duplicates one tool's
              // index (two query_data calls, two load_skill calls), so the
              // tool name is the one piece of the payload's identity that
              // survives. Without this guard a query_data payload landed in a
              // calc block (live run, 2026-09-04) and calc answered "Invalid
              // input … unrecognized key 'source'" — turning a misroute into
              // a failed tool call, which is worse than dropping it.
              const owner = block.emitted
                ? pendingTools.find(b => !b.emitted && b.toolName === block.toolName)
                : block;
              if (!owner) {
                // No same-tool block is waiting, so this payload cannot be
                // placed without guessing. Drop it, as task 002 did for the
                // duplicate replay seen on the shared dev proxy.
                console.warn(
                  `[web-agent] Ignoring an unplaceable tool argument payload on content block index ${index} (tool "${block.toolName}"): that call already has its arguments and no other "${block.toolName}" call is waiting for any.`,
                );
              } else {
                if (owner !== block) {
                  console.warn(
                    `[web-agent] A second tool argument payload arrived on content block index ${index} (tool "${block.toolName}"), which already has its arguments. Reattributing it to tool "${owner.toolName}" (id ${owner.id}), which started earlier and is still empty.`,
                  );
                }
                const at = pendingTools.indexOf(owner);
                if (at !== -1) pendingTools.splice(at, 1);
                owner.emitted = true;
                yield { type: "tool-input-end", id: owner.id };
                yield { type: "tool-call", toolCallId: owner.id, toolName: owner.toolName!, input: payload };
              }
            }
          }
        }
      } else if (isStreamEventType(event, "content_block_stop")) {
        const block = blocks.get(event.index);
        if (block) {
          if (block.kind === "text") {
            yield { type: "text-end", id: block.id };
          } else if (block.kind === "thinking") {
            yield { type: "reasoning-end", id: block.id, ...(block.signature ? { signature: block.signature } : {}) };
          } else if (block.kind === "tool_use" && !block.emitted) {
            // A tool block can be stopped before its arguments have been
            // delivered, because the payload is still queued behind another
            // index (see the reattribution note above). Finalizing it here
            // with an empty accInput is what produced the empty tool calls:
            // the model gets `input: {}` for a call it did ask for properly.
            // Defer instead while another tool block is still open and could
            // carry the payload; the end-of-stream flush finalizes whatever
            // never arrived. With no other tool block open there is nothing
            // left to wait for, so emit as before.
            const anotherToolOpen = [...blocks].some(
              ([i, b]) => i !== event.index && b.kind === "tool_use",
            );
            if (!anotherToolOpen || block.accInput !== "") {
              const at = pendingTools.indexOf(block);
              if (at !== -1) pendingTools.splice(at, 1);
              block.emitted = true;
              yield { type: "tool-input-end", id: block.id };
              yield { type: "tool-call", toolCallId: block.id, toolName: block.toolName!, input: block.accInput };
            }
          }
          // Some gateways (observed on the shared dev proxy) replay the tail of
          // a block — a duplicate content_block_delta/content_block_stop for
          // the same index — after message_stop. Deleting the entry here makes
          // that replay a no-op (blocks.get returns undefined, guarded above)
          // instead of double-appending into accInput and corrupting tool
          // input into two concatenated JSON objects. Mirrors
          // openai-provider.ts's streamToParts, which already does this.
          blocks.delete(event.index);
        }
      } else if (isStreamEventType(event, "message_delta")) {
        stopReason = event.delta.stop_reason;
        outputTokens = event.usage.output_tokens;
        // The gateway sends message_start with usage.input_tokens = 0 and the
        // real prompt count on message_delta (live probe through the reverse
        // proxy route, 2026-08-15). Reading it only from message_start reported 0
        // input tokens for every Anthropic streaming turn, which also froze
        // the context-window meter at 0. Guarded so a stream that omits the
        // field keeps the message_start value. Mirrors openai-provider.ts:300-301.
        if (event.usage.input_tokens !== undefined) {
          inputTokens = event.usage.input_tokens;
        }
      }
      // message_stop and any unknown event type: no action needed
    }

    // Any tool block deferred by content_block_stop whose payload never
    // showed up on another index. Emit it with whatever it has, which is
    // exactly what content_block_stop used to do.
    //
    // An empty payload here is NOT necessarily a defect: a tool that takes no
    // parameters (get_theme, list_data_sources) streams no input_json_delta
    // at all, and `{}` is the correct input for it. Dropping these instead
    // cost the model two legitimate calls in the 2026-09-04 live run, so the
    // deferral only ever delays a call — it never removes one.
    //
    // It IS a defect when the tool's own schema says it cannot be called with
    // no arguments. `{}` can never be what the model composed for load_skill
    // (required: ["name"]), so emitting it sends a call the model did not
    // make and buys a guaranteed-useless round trip: the tool answers "the
    // name argument is required" and the model asks again. Measured on the
    // panel-chart-live audit trace, 2026-09-08: 4 such calls on a passing
    // run, 9 on a retry, ~50 on a run that failed outright. Drop those and
    // warn; the model still has the turn and re-asks if it needs the tool.
    for (const state of pendingTools) {
      if (state.emitted) continue;
      state.emitted = true;

      const required = state.toolName ? requiredArgs.get(state.toolName) : undefined;
      if (state.accInput === "" && required) {
        const message =
          `[web-agent] Tool call "${state.toolName}" (id ${state.id}) reached end of stream ` +
          `with no arguments, but its schema requires ${required.join(", ")}. The gateway did ` +
          `not deliver its argument payload. Dropping the call.`;
        console.warn(message);
        warnings.push({ type: "other", message });
        continue;
      }

      yield { type: "tool-input-end", id: state.id };
      yield { type: "tool-call", toolCallId: state.id, toolName: state.toolName!, input: state.accInput };
    }

    yield {
      type: "finish",
      finishReason: mapFinishReason(stopReason),
      usage: { inputTokens, outputTokens, cachedInputTokens, cacheCreationTokens },
    };
  }
}

export function createAnthropicLanguageModel(
  cfg: AgentConfig,
  opts?: { fetch?: typeof fetch },
): AnthropicLanguageModel {
  return new AnthropicLanguageModel(cfg, opts);
}

