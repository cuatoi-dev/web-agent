import type { ModelMessage, ContentPart, GenerateResult, ResponseBlock, StopReason } from "../types.js";
import type { ProviderWarning } from "./provider.types.js";
import type {
  MessageParam, ContentBlockParam, ToolResultBlockParam, ImageBlockParam,
  Message,
} from "./wire.types.js";
import { assertImagePayload } from "../utils/image.js";
import { imageReachesModel } from "./vision.js";
import { dropEmptyAssistantMessages } from "./message-filters.js";

// ---------------------------------------------------------------------------
// ours → Anthropic
// ---------------------------------------------------------------------------

export function toAnthropicMessages(
  messages: ModelMessage[],
  warnings: ProviderWarning[],
  options?: {
    modelId?: string;
    imageInputEnabled?: boolean;
    modelSupportsVision?: boolean;
  }
): {
  system?: string;
  messages: MessageParam[];
} {
  let system: string | undefined;
  const result: MessageParam[] = [];

  const { imageInputEnabled, modelSupportsVision } = options || {};

  for (const msg of dropEmptyAssistantMessages(messages)) {
    switch (msg.role) {
      case "system":
        system = contentToString(msg.content);
        break;
      case "user":
        result.push(convertUserMessage(msg, warnings, imageInputEnabled, modelSupportsVision));
        break;
      case "assistant":
        result.push(convertAssistantMessage(msg));
        break;
      case "tool":
        result.push(convertToolMessage(msg));
        break;
    }
  }

  return system !== undefined ? { system, messages: result } : { messages: result };
}

function convertUserMessage(
  msg: Extract<ModelMessage, { role: "user" }>,
  warnings: ProviderWarning[],
  imageInputEnabled?: boolean,
  modelSupportsVision?: boolean,
): MessageParam {
  if (typeof msg.content === "string") {
    return { role: "user", content: msg.content };
  }
  const blocks: ContentBlockParam[] = [];
  for (const part of msg.content) {
    if (part.type === "text") {
      blocks.push({ type: "text", text: part.text });
    } else if (part.type === "image" || part.type === "file") {
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

      // Validate if image data is a URL (starts with http:// or https://)
      if (imageData.startsWith("http://") || imageData.startsWith("https://")) {
        warnings.push({
          type: "unsupported",
          feature: "image-url",
          details: "Anthropic does not support image URLs directly; only base64 data is supported.",
        });
        continue;
      }

      assertImagePayload(imageData);
      blocks.push(imagePartToBlock(imageData, mediaType));
    }
    // tool-call / tool-result in a user message are unexpected — silently skip
  }
  return { role: "user", content: blocks };
}

function convertAssistantMessage(msg: Extract<ModelMessage, { role: "assistant" }>): MessageParam {
  if (typeof msg.content === "string") {
    return { role: "assistant", content: msg.content };
  }
  const blocks: ContentBlockParam[] = [];
  for (const part of msg.content) {
    if (part.type === "text") {
      blocks.push({ type: "text", text: part.text });
    } else if (part.type === "tool-call") {
      blocks.push({
        type: "tool_use",
        id: part.toolCallId,
        name: part.toolName,
        input: part.input,
      });
    } else if (part.type === "thinking") {
      blocks.push({
        type: "thinking",
        thinking: part.thinking,
        signature: part.signature,
      });
    } else if (part.type === "redacted_thinking") {
      blocks.push({
        type: "redacted_thinking",
        data: part.data,
      });
    }
    // image / tool-result parts in assistant messages are unexpected — skip
  }
  return { role: "assistant", content: blocks };
}

function convertToolMessage(msg: Extract<ModelMessage, { role: "tool" }>): MessageParam {
  // Anthropic has no "tool" role — tool results go as user messages with tool_result blocks.
  const blocks: ToolResultBlockParam[] = [];
  for (const part of msg.content) {
    if (part.type === "tool-result") {
      const block: ToolResultBlockParam = {
        type: "tool_result",
        tool_use_id: part.toolCallId,
        content: outputToString(part.output),
      };
      if (part.isError) block.is_error = true;
      blocks.push(block);
    }
  }
  return { role: "user", content: blocks };
}

// Split "data:<media_type>;base64,<data>" into the Anthropic base64 image block.
function imagePartToBlock(dataUrl: string, fallbackMediaType: string): ImageBlockParam {
  const commaIdx = dataUrl.indexOf(",");
  let media_type = fallbackMediaType;
  let data = dataUrl;

  if (commaIdx !== -1) {
    const header = dataUrl.slice(0, commaIdx);                  // "data:image/png;base64"
    const rawType = header.replace(/^data:/, "").replace(/;base64$/, "");
    if (rawType) media_type = rawType;
    data = dataUrl.slice(commaIdx + 1);
  }

  if (!data || data.trim().length === 0) {
    throw new Error("Invalid image: base64 payload is empty");
  }

  return { type: "image", source: { type: "base64", media_type, data } };
}

function outputToString(output: unknown): string {
  if (typeof output === "string") return output;
  if (output !== null && typeof output === "object") {
    const o = output as Record<string, unknown>;
    if (typeof o["value"] === "string") return o["value"];
    if (typeof o["content"] === "string") return o["content"];
    return JSON.stringify(output);
  }
  const safeOutput = (output ?? "") as { toString(): string };
  return String(safeOutput);
}

function contentToString(content: string | ContentPart[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((p): p is Extract<ContentPart, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Anthropic → ours
// ---------------------------------------------------------------------------

export function fromAnthropicResponse(response: Message): GenerateResult {
  const content: ResponseBlock[] = [];
  for (const block of response.content) {
    if (block.type === "text") {
      content.push({ type: "text", text: block.text });
    } else if (block.type === "tool_use") {
      content.push({
        type: "tool_use",
        id: block.id,
        name: block.name,
        input: block.input as Record<string, unknown>,
      });
    } else if (block.type === "thinking") {
      content.push({
        type: "thinking",
        thinking: block.thinking,
        signature: block.signature,
      });
    } else if (block.type === "redacted_thinking") {
      content.push({
        type: "redacted_thinking",
        data: block.data,
      });
    }
  }

  return {
    content,
    stopReason: mapStopReason(response.stop_reason),
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? undefined,
      cacheCreationTokens: response.usage.cache_creation_input_tokens ?? undefined,
    },
  };
}

function mapStopReason(raw: Message["stop_reason"]): StopReason {
  switch (raw) {
    case "end_turn":      return "end_turn";
    case "tool_use":      return "tool_use";
    case "max_tokens":    return "max_tokens";
    case "stop_sequence": return "stop_sequence";
    default:              return "end_turn"; // pause_turn, refusal, null
  }
}
