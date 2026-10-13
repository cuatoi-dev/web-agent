import type {
  Message,
  ContentBlock,
  MessageStreamEvent,
  StopReason,
} from "./wire.types.js";
import type { FinishReason, ProviderWarning, ToolChoice, Tool } from "./provider.types.js";
import type { ModelMessage } from "../types.js";
import type {
  OpenAIChatCompletion,
  OpenAIChatCompletionChunk,
  OpenAIContentPart,
  OpenAIMessageParam,
  OpenAITool,
  OpenAIToolCall,
  OpenAIToolChoice,
} from "./openai-wire.types.js";
import { assertImagePayload } from "../utils/image.js";
import { imageReachesModel } from "./vision.js";
import { safeJsonParse } from "./stream-parts.js";
import { dropEmptyAssistantMessages } from "./message-filters.js";
import type { ActiveToolCall, OpenAITranslatedResponse } from "./types.js";
export type { OpenAITranslatedResponse } from "./types.js";

// --- request direction ----------------------------------------------------

export function toOpenAIMessages(
  messages: ModelMessage[],
  warnings: ProviderWarning[],
  options?: {
    modelId?: string;
    imageInputEnabled?: boolean;
    modelSupportsVision?: boolean;
  }
): OpenAIMessageParam[] {
  const result: OpenAIMessageParam[] = [];
  const isLegacy = options === undefined;
  const { imageInputEnabled, modelSupportsVision } = options || {};

  for (const msg of dropEmptyAssistantMessages(messages)) {
    if (msg.role === "system") {
      // Handled separately as prepended prompt
      continue;
    }

    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        result.push({ role: "user", content: msg.content });
      } else {
        const contentParts: OpenAIContentPart[] = [];
        for (const part of msg.content) {
          if (part.type === "text") {
            contentParts.push({ type: "text", text: part.text });
          } else if (part.type === "image" || part.type === "file") {
            if (isLegacy) {
              warnings.push({
                type: "unsupported",
                feature: "image-input",
                details: "Images are not supported on this path",
              });
              const rawData = part.type === "image" ? part.image : part.data;
              assertImagePayload(rawData);
              contentParts.push({
                type: "image_url",
                image_url: { url: rawData },
              });
              continue;
            }

            const isImageDisabledOrUnsupported = !imageReachesModel(imageInputEnabled, modelSupportsVision);

            if (isImageDisabledOrUnsupported) {
              warnings.push({
                type: "unsupported",
                feature: "image-input",
                details: "Images are not supported by the model or are disabled by config.",
              });
              continue;
            }

            const mediaType = part.mediaType;
            const imageData = part.type === "image" ? part.image : part.data;

            if (
              imageData.startsWith("http://") ||
              imageData.startsWith("https://")
            ) {
              if (imageData.trim().length === 0) {
                throw new Error("Invalid image: base64 payload is empty");
              }
              contentParts.push({ type: "image_url", image_url: { url: imageData } });
              continue;
            }

            assertImagePayload(imageData);

            let url = imageData;
            if (!imageData.startsWith("data:")) {
              url = `data:${mediaType};base64,${imageData}`;
            }

            contentParts.push({ type: "image_url", image_url: { url: url } });
          }
        }
        result.push({ role: "user", content: contentParts });
      }
    } else if (msg.role === "assistant") {
      if (typeof msg.content === "string") {
        result.push({ role: "assistant", content: msg.content });
      } else {
        const textParts = msg.content.filter(
          (p) => p.type === "text"
        );
        const textContent = textParts.map((p) => p.text).join("\n") || null;
        const toolCallParts = msg.content.filter(
          (p) => p.type === "tool-call"
        );

        const toolCalls: OpenAIToolCall[] | undefined =
          toolCallParts.length > 0
            ? toolCallParts.map((p) => ({
                id: p.toolCallId,
                type: "function" as const,
                function: {
                  name: p.toolName,
                  arguments: JSON.stringify(p.input ?? {}),
                },
                ...(p.extra_content ? { extra_content: p.extra_content } : {}),
              }))
            : undefined;

        result.push({
          role: "assistant",
          content: textContent,
          tool_calls: toolCalls,
        });
      }
    } else if (msg.role === "tool") {
      for (const part of msg.content) {
        if (part.type === "tool-result") {
          result.push({
            role: "tool",
            tool_call_id: part.toolCallId,
            content:
              typeof part.output === "string"
                ? part.output
                : JSON.stringify(part.output ?? ""),
          });
        }
      }
    }
  }

  return result;
}

export function toOpenAIToolChoice(tc: ToolChoice): OpenAIToolChoice {
  switch (tc.type) {
    case "auto":
      return "auto";
    case "required":
      return "required";
    case "none":
      return "none";
    case "tool":
      return { type: "function", function: { name: tc.toolName } };
  }
}

export function toOpenAITools(tools: Tool[]): OpenAITool[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

// --- response direction ---------------------------------------------------

export function toFinishReason(raw: string | null | undefined): FinishReason {
  switch (raw) {
    case "stop":
      return "stop";
    case "length":
      return "length";
    case "tool_calls":
      return "tool-calls";
    case "content_filter":
      return "content-filter";
    case "error":
      return "error";
    default:
      return raw ? "other" : "unknown";
  }
}

export function toAnthropicStopReason(raw: string | null | undefined): StopReason {
  switch (raw) {
    case "stop":
      return "end_turn";
    case "length":
      return "max_tokens";
    case "tool_calls":
      return "tool_use";
    case "content_filter":
      return "refusal";
    default:
      return null;
  }
}

export function fromOpenAIResponse(
  resp: OpenAIChatCompletion
): OpenAITranslatedResponse {
  const choice = resp.choices[0];
  const usage = resp.usage ?? undefined;
  const content: ContentBlock[] = [];

  if (choice?.message?.content) {
    content.push({ type: "text", text: choice.message.content });
  }

  const toolCalls = (choice?.message?.tool_calls ?? []).filter((tc) => tc.type === "function");
  for (const tc of toolCalls) {
    // `?? ""` rather than `|| "{}"`: absent arguments must reach safeJsonParse
    // as an empty string so they are reported as "the model sent no argument
    // JSON" instead of being quietly turned into a valid empty object.
    // Only `.input` is used here: this path builds SDK `ContentBlock`s, not our
    // `ToolUseBlock`, so there is nowhere to carry the marker. Task 001 scopes
    // the marker to the streaming reassembler.
    const { input } = safeJsonParse(tc.function.arguments ?? "", {
      toolName: tc.function.name,
      toolCallId: tc.id,
    });
    content.push({
      type: "tool_use",
      id: tc.id,
      name: tc.function.name,
      input,
      ...(tc.extra_content ? { extra_content: tc.extra_content } : {}),
    });
  }

  const hasToolCalls = toolCalls.length > 0;
  const rawFinish = choice?.finish_reason;
  // If finish_reason is "stop" (or omitted/null) but tool calls are present (e.g. Gemini OpenAI proxy quirk),
  // treat it as tool_calls so the agent loop knows to execute tools.
  // Real truncations ("length") or "content_filter" must be preserved.
  const normalizedFinish =
    hasToolCalls && (rawFinish === "stop" || rawFinish == null)
      ? "tool_calls"
      : rawFinish;

  const message: Message = {
    id: resp.id ?? "",
    type: "message",
    role: "assistant",
    model: resp.model ?? "",
    content,
    stop_reason: toAnthropicStopReason(normalizedFinish),
    // Cache fields are intentionally absent — OpenAI's zero must not be
    // reported as a cache miss. See "Cache tokens" in task file.
    usage: {
      input_tokens: usage?.prompt_tokens ?? 0,
      output_tokens: usage?.completion_tokens ?? 0,
    },
  };

  const reasoningTokens = usage?.completion_tokens_details?.reasoning_tokens;
  return {
    message,
    finishReason: toFinishReason(normalizedFinish),
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
  };
}

export class OpenAIStreamTranslator {
  private textStarted = false;
  private reasoningStarted = false;
  // Keyed by the tool call's own id, not the wire `index`: a gateway may
  // stream multiple parallel tool calls under the same index (observed live;
  // mirrors LiteLLM #21331), and an index-keyed map would route the second
  // call's argument deltas onto the first call's block, concatenating two
  // JSON objects into one unparsable string.
  private activeToolCallsById = new Map<string, ActiveToolCall>();
  // Routes a later delta that carries only `index` (no `id`, as OpenAI's wire
  // format omits `id` after the first chunk of a call) to the right call.
  private indexToId = new Map<number, string>();
  private nextToolBlockIndex = 2; // index 0 reserved for text, 1 for reasoning
  private lastFinishReason: FinishReason = "unknown";
  private lastReasoningTokens: number | undefined = undefined;

  get finishReason(): FinishReason {
    return this.lastFinishReason;
  }

  get reasoningTokens(): number | undefined {
    return this.lastReasoningTokens;
  }

  push(chunk: OpenAIChatCompletionChunk): MessageStreamEvent[] {
    const events: MessageStreamEvent[] = [];

    if (chunk.usage) {
      if (chunk.usage.completion_tokens_details?.reasoning_tokens !== undefined) {
        this.lastReasoningTokens = chunk.usage.completion_tokens_details.reasoning_tokens;
      }
      events.push({
        type: "message_delta",
        delta: { stop_reason: toAnthropicStopReason(null) },
        usage: {
          output_tokens: chunk.usage.completion_tokens ?? 0,
          ...(chunk.usage.prompt_tokens !== undefined
            ? { input_tokens: chunk.usage.prompt_tokens }
            : {}),
        },
      });
    }

    const choice = chunk.choices?.[0];
    if (!choice) return events;

    if (choice.finish_reason != null) {
      const hasToolCalls = this.activeToolCallsById.size > 0;
      const normalizedFinish =
        hasToolCalls && choice.finish_reason === "stop"
          ? "tool_calls"
          : choice.finish_reason;
      this.lastFinishReason = toFinishReason(normalizedFinish);
      if (this.textStarted) {
        events.push({ type: "content_block_stop", index: 0 });
        this.textStarted = false;
      }
      if (this.reasoningStarted) {
        events.push({ type: "content_block_stop", index: 1 });
        this.reasoningStarted = false;
      }
      for (const active of this.activeToolCallsById.values()) {
        if (!active.finished) {
          active.finished = true;
          events.push({ type: "content_block_stop", index: active.blockIndex });
        }
      }
      events.push({
        type: "message_delta",
        delta: { stop_reason: toAnthropicStopReason(normalizedFinish) },
        usage: { output_tokens: 0 },
      });
    }

    const delta = choice.delta;
    if (!delta) return events;

    if (delta.content) {
      if (!this.textStarted) {
        events.push({
          type: "content_block_start",
          index: 0,
          content_block: { type: "text", text: "" },
        });
        this.textStarted = true;
      }
      events.push({
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: delta.content },
      });
    }

    const reasoningContent = delta.reasoning ?? delta.reasoning_content;
    if (reasoningContent) {
      if (!this.reasoningStarted) {
        events.push({
          type: "content_block_start",
          index: 1,
          content_block: { type: "thinking", thinking: "" },
        });
        this.reasoningStarted = true;
      }
      events.push({
        type: "content_block_delta",
        index: 1,
        delta: { type: "thinking_delta", thinking: reasoningContent },
      });
    }

    if (delta.tool_calls) {
      for (const tcDelta of delta.tool_calls) {
        // Resolve by id first — the only identifier that is unique per call.
        // Fall back to the index->id map for a later delta that omits `id`.
        // Never look the call up by raw index directly: that is what let a
        // second call sharing `index: 0` with the first find (and corrupt)
        // the first call's block.
        let active: ActiveToolCall | undefined;
        if (tcDelta.id) {
          active = this.activeToolCallsById.get(tcDelta.id);
        } else if (tcDelta.index != null) {
          const mappedId = this.indexToId.get(tcDelta.index);
          if (mappedId) active = this.activeToolCallsById.get(mappedId);
        }

        const rawIndex =
          tcDelta.index ?? (active ? active.rawIndex : this.activeToolCallsById.size);

        if (!active) {
          if (tcDelta.type && tcDelta.type !== "function") continue;
          // A gateway anomaly could in principle omit `id` on the first
          // chunk of a call (OpenAI's own wire format never does); fall back
          // to a synthetic id keyed on block index rather than dropping the
          // call, since dropping loses the arguments silently.
          const id = tcDelta.id ?? `call_unnamed_${this.nextToolBlockIndex}`;
          const name = tcDelta.function?.name;
          if (!name) continue;

          const blockIndex = this.nextToolBlockIndex++;
          active = {
            rawIndex,
            blockIndex,
            id,
            name,
            accArguments: "",
            finished: false,
            extra_content: tcDelta.extra_content,
          };
          this.activeToolCallsById.set(id, active);
          if (tcDelta.index != null) this.indexToId.set(tcDelta.index, id);

          events.push({
            type: "content_block_start",
            index: blockIndex,
            content_block: {
              type: "tool_use",
              id,
              name,
              input: {},
              ...(tcDelta.extra_content ? { extra_content: tcDelta.extra_content } : {}),
            },
          });
        }

        if (tcDelta.extra_content && !active.extra_content) {
          active.extra_content = tcDelta.extra_content;
        }

        if (active.finished) continue;

        const argDelta = tcDelta.function?.arguments;
        if (argDelta) {
          active.accArguments += argDelta;
          events.push({
            type: "content_block_delta",
            index: active.blockIndex,
            delta: {
              type: "input_json_delta",
              partial_json: argDelta,
            },
          });
        }
      }
    }

    return events;
  }

  end(): MessageStreamEvent[] {
    const events: MessageStreamEvent[] = [];

    if (this.textStarted) {
      this.textStarted = false;
      events.push({ type: "content_block_stop", index: 0 });
    }
    if (this.reasoningStarted) {
      this.reasoningStarted = false;
      events.push({ type: "content_block_stop", index: 1 });
    }
    for (const active of this.activeToolCallsById.values()) {
      if (!active.finished) {
        active.finished = true;
        events.push({ type: "content_block_stop", index: active.blockIndex });
      }
    }

    return events;
  }
}
