import type {
  Message,
  ContentBlock,
  StopReason,
} from "./wire.types.js";
import type { FinishReason, ProviderWarning, ToolChoice, Tool } from "./provider.types.js";
import type { ModelMessage } from "../types.js";
import type {
  GeminiContent,
  GeminiGenerateContentResponse,
  GeminiPart,
  GeminiTool,
  GeminiToolConfig,
} from "./gemini-wire.types.js";
import { assertImagePayload } from "../utils/image.js";
import { imageReachesModel } from "./vision.js";
import type { GeminiTranslatedResponse, ToGeminiContentsOptions } from "./types.js";
export type { GeminiTranslatedResponse, ToGeminiContentsOptions } from "./types.js";

// --- request direction ----------------------------------------------------

export function toGeminiContents(
  messages: ModelMessage[],
  warnings: ProviderWarning[],
  options?: ToGeminiContentsOptions
): GeminiContent[] {
  const result: GeminiContent[] = [];
  const isLegacy = options === undefined;
  const { imageInputEnabled, modelSupportsVision, thoughtSignatures } = options || {};

  for (const msg of messages) {
    if (msg.role === "system") {
      // Handled separately as systemInstruction
      continue;
    }

    if (msg.role === "user") {
      if (typeof msg.content === "string") {
        if (msg.content !== "") {
          result.push({ role: "user", parts: [{ text: msg.content }] });
        }
      } else {
        const parts: GeminiPart[] = [];
        for (const part of msg.content) {
          if (part.type === "text") {
            if (part.text !== "") {
              parts.push({ text: part.text });
            }
          } else if (part.type === "image" || part.type === "file") {
            if (isLegacy) {
              warnings.push({
                type: "unsupported",
                feature: "image-input",
                details: "Images are not supported on this path",
              });
              const rawData = part.type === "image" ? part.image : part.data;
              if (rawData.startsWith("http://") || rawData.startsWith("https://")) {
                warnings.push({
                  type: "unsupported",
                  feature: "image-input",
                  details: "Gemini cannot take an image by URL; only inline base64 is supported.",
                });
                continue;
              }
              assertImagePayload(rawData);
              const commaAt = rawData.indexOf(",");
              const data = rawData.startsWith("data:") ? rawData.slice(commaAt + 1) : rawData;
              if (!data || data.trim().length === 0) {
                throw new Error("Invalid image: base64 payload is empty");
              }
              parts.push({ inlineData: { mimeType: part.mediaType, data } });
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

            const rawData = part.type === "image" ? part.image : part.data;
            if (rawData.startsWith("http://") || rawData.startsWith("https://")) {
              warnings.push({
                type: "unsupported",
                feature: "image-input",
                details: "Gemini cannot take an image by URL; only inline base64 is supported.",
              });
              continue;
            }

            assertImagePayload(rawData);
            const commaAt = rawData.indexOf(",");
            const data = rawData.startsWith("data:") ? rawData.slice(commaAt + 1) : rawData;
            if (!data || data.trim().length === 0) {
              throw new Error("Invalid image: base64 payload is empty");
            }
            parts.push({ inlineData: { mimeType: part.mediaType, data } });
          }
        }
        if (parts.length > 0) {
          result.push({ role: "user", parts });
        }
      }
    } else if (msg.role === "assistant") {
      if (typeof msg.content === "string") {
        if (msg.content !== "") {
          result.push({ role: "model", parts: [{ text: msg.content }] });
        }
      } else {
        const parts: GeminiPart[] = [];
        for (const part of msg.content) {
          if (part.type === "text") {
            if (part.text !== "") {
              parts.push({ text: part.text });
            }
          } else if (part.type === "tool-call") {
            const tc = part;
            const sig = thoughtSignatures?.[tc.toolCallId];
            parts.push({
              functionCall: {
                id: tc.toolCallId,
                name: tc.toolName,
                args: tc.input ?? {},
              },
              ...(sig ? { thoughtSignature: sig } : {}),
            });
          }
        }
        if (parts.length > 0) {
          result.push({ role: "model", parts });
        }
      }
    } else if (msg.role === "tool") {
      const parts: GeminiPart[] = [];
      for (const part of msg.content) {
        if (part.type === "tool-result") {
          const tr = part;
          const response =
            tr.output !== null && typeof tr.output === "object"
              ? (tr.output as Record<string, unknown>)
              : { output: tr.output ?? "" };
          parts.push({
            functionResponse: {
              id: tr.toolCallId,
              name: tr.toolName,
              response,
            },
          });
        }
      }
      if (parts.length > 0) {
        result.push({ role: "user", parts });
      }
    }
  }

  return result;
}

/** Returns undefined for an empty prompt so the field is omitted, not sent empty. */
export function toGeminiSystemInstruction(systemPrompt?: string): GeminiContent | undefined {
  return systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined;
}

export function toGeminiTools(tools: Tool[]): GeminiTool[] {
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        ...(t.description ? { description: t.description } : {}),
        // parametersJsonSchema, not parameters: see GeminiFunctionDeclaration.
        parametersJsonSchema: t.input_schema,
      })),
    },
  ];
}

export function toGeminiToolConfig(tc: ToolChoice): GeminiToolConfig {
  switch (tc.type) {
    case "auto":
      return { functionCallingConfig: { mode: "AUTO" } };
    case "required":
      return { functionCallingConfig: { mode: "ANY" } };
    case "none":
      return { functionCallingConfig: { mode: "NONE" } };
    case "tool":
      return {
        functionCallingConfig: {
          mode: "ANY",
          allowedFunctionNames: [tc.toolName],
        },
      };
  }
}

// --- response direction ---------------------------------------------------

/**
 * `hasFunctionCall` comes first on purpose. Gemini reports finishReason "STOP"
 * on a function-calling turn (live probe 2026-08-15: finishReason "STOP" with
 * finishMessage "Model generated function call(s)."), so reading `raw` to decide
 * tool use ends every tool turn one step early.
 */
export function fromGeminiStopReason(
  raw: string | undefined,
  hasFunctionCall: boolean
): StopReason {
  if (hasFunctionCall) return "tool_use";
  switch (raw) {
    case "STOP":
      return "end_turn";
    case "MAX_TOKENS":
      return "max_tokens";
    case "SAFETY":
    case "PROHIBITED_CONTENT":
    case "BLOCKLIST":
      return "refusal";
    default:
      return null;
  }
}

export function fromGeminiFinishReason(
  raw: string | undefined,
  hasFunctionCall: boolean
): FinishReason {
  if (hasFunctionCall) return "tool-calls";
  switch (raw) {
    case "STOP":
      return "stop";
    case "MAX_TOKENS":
      return "length";
    case "SAFETY":
    case "PROHIBITED_CONTENT":
    case "BLOCKLIST":
      return "content-filter";
    default:
      return raw ? "other" : "unknown";
  }
}

export function fromGeminiResponse(
  resp: GeminiGenerateContentResponse
): GeminiTranslatedResponse {
  const candidate = resp.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const content: ContentBlock[] = [];
  const signatures: Record<string, string> = {};

  let toolCallIndex = 0;
  for (const part of parts) {
    if (part.thought === true && part.text) {
      content.push({
        type: "thinking",
        thinking: part.text,
        signature: part.thoughtSignature ?? "",
      });
    } else if (part.text) {
      content.push({
        type: "text",
        text: part.text,
      });
    } else if (part.functionCall) {
      const fc = part.functionCall;
      const id = fc.id ?? `${fc.name}_${toolCallIndex++}`;
      content.push({
        type: "tool_use",
        id,
        name: fc.name,
        input: fc.args ?? {},
      });
      if (part.thoughtSignature) {
        signatures[id] = part.thoughtSignature;
      }
    }
  }

  const hasFunctionCall = parts.some((p) => p.functionCall !== undefined);
  const u = resp.usageMetadata;

  const message: Message = {
    id: resp.responseId ?? "",
    type: "message",
    role: "assistant",
    model: resp.modelVersion ?? "",
    content,
    stop_reason: fromGeminiStopReason(candidate?.finishReason, hasFunctionCall),
    usage: {
      input_tokens: u?.promptTokenCount ?? 0,
      output_tokens: u?.candidatesTokenCount ?? 0,
      ...(u?.cachedContentTokenCount !== undefined
        ? { cache_read_input_tokens: u.cachedContentTokenCount }
        : {}),
    },
  };

  const reasoningTokens = resp.usageMetadata?.thoughtsTokenCount;
  return {
    message,
    finishReason: fromGeminiFinishReason(candidate?.finishReason, hasFunctionCall),
    ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
    ...(Object.keys(signatures).length > 0 ? { thoughtSignatures: signatures } : {}),
  };
}
