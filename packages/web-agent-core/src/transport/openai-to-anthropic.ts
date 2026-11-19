import type {
  Message,
  ContentBlock,
  StopReason,
} from "./wire.types.js";
import type { FinishReason, ProviderWarning, ToolChoice, Tool } from "./provider.types.js";
import type { ModelMessage } from "../types.js";
import type {
  OpenAIChatCompletion,
  OpenAIContentPart,
  OpenAIMessageParam,
  OpenAITool,
  OpenAIToolCall,
  OpenAIToolChoice,
} from "./openai-wire.types.js";
import { assertImagePayload } from "../utils/image.js";
import { imageReachesModel } from "./vision.js";
import { safeJsonParse } from "./tool-arguments.js";
import { dropEmptyAssistantMessages } from "./message-filters.js";
import type { OpenAITranslatedResponse } from "./types.js";
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
    // This conversion preserves the parsed input; diagnostic markers are not
    // copied into vendor content blocks.
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
    // reported as a cache miss.
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
