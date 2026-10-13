import type { FinishReason, NormalizedUsage, ProviderWarning, ProviderMetadata, ProviderResult, StreamPart } from "./provider.types.js";
import type { ResponseBlock } from "../types.js";
import type { BlockAcc, ReasoningAcc, TextAcc, ToolAcc, ToolArgumentContext, ToolArgumentParse, TrackedToolCall } from "./stream-parts.types.js";

// `StreamPart` is declared in `provider.types.ts` beside `LanguageModel`,
// whose `doStream` yields it. Re-exported here so this module keeps the
// import path it has always had.
export type { StreamPart } from "./provider.types.js";
export type { ToolArgumentContext, ToolArgumentParse } from "./stream-parts.types.js";

// ---------------------------------------------------------------------------
// safeJsonParse
// ---------------------------------------------------------------------------
/**
 * Parse accumulated tool-call arguments, substituting `{}` when that is not
 * possible. The substitution used to be silent, which made an unparsable
 * payload and a model that sent no arguments at all indistinguishable. Both
 * now warn, with different wording, so a live trace can tell them apart.
 */
export function safeJsonParse(
  s: string,
  context?: ToolArgumentContext,
): ToolArgumentParse {
  const where = `tool "${context?.toolName ?? "unknown"}" (id ${context?.toolCallId ?? "unknown"})`;

  if (s.trim() === "") {
    console.warn(
      `[web-agent] Empty tool arguments for ${where}: the model sent no argument JSON. Substituting {}.`,
    );
    return { input: {}, issue: "empty" };
  }

  try {
    return { input: JSON.parse(s) as Record<string, unknown> };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[web-agent] Tool arguments failed to parse for ${where}: ${message}. Payload: ${s}. Substituting {}.`,
    );
    return { input: {}, issue: "unparsable" };
  }
}

// ---------------------------------------------------------------------------
// isParsableJson — shared by StreamingToolCallTracker and any provider-level
// stream assembler that needs to detect a tool call's arguments are already
// complete (see anthropic-provider.ts's msgToParts).
// ---------------------------------------------------------------------------
export function isParsableJson(s: string): boolean {
  if (!s) return false;
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// StreamingToolCallTracker
// Minimal port of AI SDK streaming-tool-call-tracker. Accumulates OpenAI-style
// tool_call deltas (by id, or by index when a delta has no id) and emits
// tool-input-* + tool-call parts via an emit callback instead of a TransformStream controller.
// ---------------------------------------------------------------------------
export class StreamingToolCallTracker {
  // Keyed by the tool call's own id, not the frame index: an index can be
  // reused across two distinct parallel tool calls (observed live — a gateway
  // streaming multiple calls under `index: 0`, mirroring LiteLLM #21331), and
  // an array slot keyed by index would silently append the second call's
  // arguments onto the first's, producing a multi-root JSON string.
  private toolCallsById = new Map<string, TrackedToolCall>();
  // Routes a later delta that carries only `index` (no `id`) to the tool call
  // that index was last assigned to.
  private indexToId = new Map<number, string>();
  private toolCallOrder: TrackedToolCall[] = [];
  private readonly emit: (part: StreamPart) => void;

  constructor(emit: (part: StreamPart) => void) {
    this.emit = emit;
  }

  processDelta(delta: {
    index?: number | null;
    id?: string | null;
    type?: string | null;
    function?: { name?: string | null; arguments?: string | null } | null;
  }): void {
    let tc: TrackedToolCall | undefined;
    if (delta.id) {
      tc = this.toolCallsById.get(delta.id);
    } else if (delta.index != null) {
      const mappedId = this.indexToId.get(delta.index);
      if (mappedId) tc = this.toolCallsById.get(mappedId);
    }

    if (!tc) {
      // typeValidation: if-present — silently skip unknown types
      if (delta.type != null && delta.type !== "function") return;
      if (!delta.id || !delta.function?.name) return;

      const args = delta.function.arguments ?? "";
      this.emit({ type: "tool-input-start", id: delta.id, toolName: delta.function.name });

      tc = { id: delta.id, name: delta.function.name, args, hasFinished: false };
      this.toolCallsById.set(delta.id, tc);
      this.toolCallOrder.push(tc);
      if (delta.index != null) this.indexToId.set(delta.index, delta.id);

      if (args.length > 0) {
        this.emit({ type: "tool-input-delta", id: delta.id, delta: args });
      }
      if (isParsableJson(args)) {
        this.finishToolCall(tc);
      }
    } else {
      if (tc.hasFinished) return;

      const argsDelta = delta.function?.arguments;
      if (argsDelta != null) {
        tc.args += argsDelta;
        this.emit({ type: "tool-input-delta", id: tc.id, delta: argsDelta });
      }
      if (isParsableJson(tc.args)) {
        this.finishToolCall(tc);
      }
    }
  }

  flush(): void {
    for (const tc of this.toolCallOrder) {
      if (!tc.hasFinished) {
        this.finishToolCall(tc);
      }
    }
  }

  private finishToolCall(tc: TrackedToolCall): void {
    this.emit({ type: "tool-input-end", id: tc.id });
    this.emit({ type: "tool-call", toolCallId: tc.id, toolName: tc.name, input: tc.args });
    tc.hasFinished = true;
  }
}

// ---------------------------------------------------------------------------
// reassembleStream — the ONE shared reassembler.
// Consumes an AsyncIterable<StreamPart> and produces a ProviderResult.
// Preserves emission order of blocks so stream → reassembled == non-stream.
// ---------------------------------------------------------------------------
export async function reassembleStream(
  stream: AsyncIterable<StreamPart>,
): Promise<ProviderResult> {
  let warnings: ProviderWarning[] = [];
  let finishReason: FinishReason = "unknown";
  let usage: NormalizedUsage = { inputTokens: 0, outputTokens: 0 };
  let providerMetadata: ProviderMetadata | undefined;

  const blockMap = new Map<string, BlockAcc>();
  const seenIds = new Set<string>();
  const blockOrder: BlockAcc[] = [];

  /** Discard everything accumulated so far. Called on `stream-restart` only. */
  function resetBlocks(): void {
    blockMap.clear();
    seenIds.clear();
    blockOrder.length = 0;
  }

  function ensureText(id: string): TextAcc {
    if (!seenIds.has(id)) {
      const b: TextAcc = { kind: "text", id, text: "" };
      blockMap.set(id, b);
      seenIds.add(id);
      blockOrder.push(b);
    }
    return blockMap.get(id) as TextAcc;
  }

  function ensureReasoning(id: string, signature = ""): ReasoningAcc {
    if (!seenIds.has(id)) {
      const b: ReasoningAcc = { kind: "reasoning", id, text: "", signature };
      blockMap.set(id, b);
      seenIds.add(id);
      blockOrder.push(b);
    }
    return blockMap.get(id) as ReasoningAcc;
  }

  function ensureTool(id: string, name = ""): ToolAcc {
    if (!seenIds.has(id)) {
      const b: ToolAcc = { kind: "tool", id, name, input: "", complete: false };
      blockMap.set(id, b);
      seenIds.add(id);
      blockOrder.push(b);
    }
    return blockMap.get(id) as ToolAcc;
  }

  for await (const part of stream) {
    switch (part.type) {
      case "stream-start":
        warnings = part.warnings;
        break;
      case "stream-restart":
        // The attempt that produced everything above was abandoned mid-flight.
        // Text ids are positional (`block_${index}`, `text_0`), so without this
        // the next attempt's deltas append onto the dead attempt's blocks.
        resetBlocks();
        break;
      case "text-start":
        ensureText(part.id);
        break;
      case "text-delta":
        ensureText(part.id).text += part.delta;
        break;
      case "text-end":
        break;
      case "reasoning-start":
        ensureReasoning(part.id, part.signature ?? "");
        break;
      case "reasoning-delta":
        ensureReasoning(part.id).text += part.delta;
        break;
      case "reasoning-end":
        if (part.signature) ensureReasoning(part.id).signature = part.signature;
        break;
      case "tool-input-start":
        ensureTool(part.id, part.toolName);
        break;
      case "tool-input-delta":
        break;
      case "tool-input-end":
        break;
      case "tool-call": {
        const b = ensureTool(part.toolCallId, part.toolName);
        b.name = part.toolName;
        b.input = part.input;
        b.complete = true;
        if (part.extra_content) b.extra_content = part.extra_content;
        break;
      }
      case "finish":
        finishReason = part.finishReason;
        usage = part.usage;
        providerMetadata = part.providerMetadata;
        break;
      case "error":
        throw part.error;
    }
  }

  // A tool block that never received `tool-call` holds no arguments. Emitting it
  // would send the model a call it never finished asking for, with `input: {}`.
  for (const b of blockOrder) {
    if (b.kind === "tool" && !b.complete) {
      console.warn(
        `[web-agent] Dropping incomplete tool block for tool "${b.name || "unknown"}" (id ${b.id}): the stream ended before the arguments arrived.`,
      );
    }
  }

  const content: ResponseBlock[] = blockOrder
    .filter(b => b.kind !== "tool" || b.complete)
    .map(b => {
      if (b.kind === "text") return { type: "text" as const, text: b.text };
      if (b.kind === "reasoning") return { type: "thinking" as const, thinking: b.text, signature: b.signature };
      const parsed = safeJsonParse(b.input, { toolName: b.name, toolCallId: b.id });
      return {
        type: "tool_use" as const,
        id: b.id,
        name: b.name,
        input: parsed.input,
        ...(parsed.issue ? { argumentsIssue: parsed.issue } : {}),
        ...(b.extra_content ? { extra_content: b.extra_content } : {}),
      };
    });

  const result: ProviderResult = { content, finishReason, usage, warnings };
  if (providerMetadata !== undefined) result.providerMetadata = providerMetadata;
  return result;
}
