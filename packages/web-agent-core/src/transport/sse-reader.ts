import type { MessageStreamEvent, Message, ContentBlock, ToolUseBlock } from "./wire.types.js";
import { isStreamEventType } from "./wire.types.js";

/**
 * Incremental line buffer for a server-sent events (SSE) body. Feed it decoded
 * text; it returns the events completed by that chunk and keeps any partial
 * line for the next call.
 *
 * The tolerances below are a requirement, not a nicety. Some OpenAI-to-Anthropic
 * translating gateways emit non-specification SSE — a duplicate `message_delta`
 * or `message_stop` after the first `message_stop`, a trailing OpenAI-style
 * `data: [DONE]`, comment lines, or a truncated JSON payload. The Anthropic
 * SDK's stream accumulator throws on those (see the comment at
 * transport/anthropic-provider.ts:151-156). This reader must not.
 * Note: this reader also serves the OpenAI chunk stream, whose gateway sends
 * [DONE] twice with a chunk in between (live probe, 2026-08-14).
 */
export class SseReader<T = MessageStreamEvent> {
  private buffer = "";

  push(chunk: string): T[] {
    this.buffer += chunk;
    const out: T[] = [];
    let nl: number;
    while ((nl = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, nl).replace(/\r$/, "");
      this.buffer = this.buffer.slice(nl + 1);
      // Blank separators, `: comment` lines and `event:` name lines carry no
      // payload. Every Anthropic payload repeats its own `type`, so the
      // `event:` line is redundant.
      if (line === "" || line.startsWith(":") || line.startsWith("event:")) continue;
      if (!line.startsWith("data:")) continue;
      const payload = line.slice("data:".length).trim();
      if (payload === "" || payload === "[DONE]") continue;
      try {
        out.push(JSON.parse(payload) as T);
      } catch {
        // One malformed payload must not end an otherwise good answer.
      }
    }
    return out;
  }
}

/**
 * Reads an SSE response body and yields events as they arrive.
 *
 * Browser-safe by construction: Web Streams plus TextDecoder, no `node:stream`.
 * `getReader()` is used rather than `for await (… of body)` because browser
 * ReadableStream implementations generally do not expose Symbol.asyncIterator,
 * even though the jsdom test environment does — `for await` would pass every
 * test here and fail in a real browser.
 *
 * `{ stream: true }` on decode is required: a multi-byte character can land
 * across a chunk boundary (the project's own gateway returned an emoji in a
 * live probe on 2026-08-14).
 *
 * `onProgress`, if given, is called once per raw chunk read, before parsing —
 * so a keep-alive comment that parses to no event still counts as activity.
 */
export async function* readSseStream<T = MessageStreamEvent>(
  body: ReadableStream<Uint8Array>,
  onProgress?: () => void,
): AsyncGenerator<T, void, undefined> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseReader<T>();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // Before parsing: a `: PING` keep-alive parses to nothing (line 31)
      // but still proves the connection is alive. The gateway on this
      // project's route sends one every 5 s while the upstream is queued,
      // measured at 48 s of pings before the first content chunk
      // (2026-08-16). Reporting it here is what stops withRetry aborting a
      // healthy HTTP 200 stream.
      onProgress?.();
      for (const event of parser.push(decoder.decode(value, { stream: true }))) {
        yield event;
      }
    }
    // Flush any trailing bytes and a final line with no newline terminator.
    const tail = decoder.decode();
    for (const event of parser.push(tail + "\n")) yield event;
  } finally {
    reader.releaseLock();
  }
}

/**
 * Reassembles a stream of MessageStreamEvents into a single Message object.
 * This is the non-streaming fallback path: some gateways return a complete
 * SSE body instead of a JSON body even when streaming was not requested, so
 * the events still have to be folded into one Message.
 */
export function reassembleMessage(events: Iterable<MessageStreamEvent>): Message | null {
  let message: Message | null = null;
  const contentBlocks: ContentBlock[] = [];

  for (const event of events) {
    if (isStreamEventType(event, "message_start")) {
      message = { ...event.message, content: [] };
    } else if (isStreamEventType(event, "content_block_start")) {
      contentBlocks[event.index] = { ...event.content_block };
    } else if (isStreamEventType(event, "content_block_delta")) {
      const block = contentBlocks[event.index];
      if (block) {
        if (block.type === "text" && event.delta.type === "text_delta") {
          block.text = (block.text || "") + (event.delta.text || "");
        } else if (block.type === "thinking" && event.delta.type === "thinking_delta") {
          block.thinking = (block.thinking || "") + (event.delta.thinking || "");
        } else if (block.type === "tool_use" && event.delta.type === "input_json_delta") {
          const acc = block as ToolUseBlock & { partial_json?: string };
          acc.partial_json = (acc.partial_json || "") + (event.delta.partial_json || "");
        }
      }
    } else if (isStreamEventType(event, "message_delta")) {
      if (message) {
        if (event.delta.stop_reason) message.stop_reason = event.delta.stop_reason;
        if (event.delta.stop_sequence !== undefined) message.stop_sequence = event.delta.stop_sequence;
        if (event.usage) {
          message.usage.output_tokens = event.usage.output_tokens;
        }
      }
    }
  }

  if (message) {
    for (const block of contentBlocks) {
      if (block && block.type === "tool_use") {
        const acc = block as ToolUseBlock & { partial_json?: string };
        if (acc.partial_json) {
          try {
            block.input = JSON.parse(acc.partial_json) as Record<string, unknown>;
          } catch {
            block.input = {};
          }
          delete acc.partial_json;
        } else if (!block.input) {
          block.input = {};
        }
      }
    }
    message.content = contentBlocks.filter(Boolean);
  }
  return message;
}

/** Parses a complete SSE text string into a Message object. */
export function parseAnthropicSseText(text: string): Message | null {
  const reader = new SseReader();
  const events = reader.push(text.endsWith("\n") ? text : text + "\n");
  return reassembleMessage(events);
}
