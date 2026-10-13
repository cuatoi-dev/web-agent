import { SseReader, readSseStream, parseAnthropicSseText } from "./sse-reader.js";
import { isStreamEventType } from "./wire.types.js";

function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

describe("SseReader", () => {
  it("parses a complete data line into one event", () => {
    const reader = new SseReader();
    const events = reader.push('data: {"type":"message_start","message":{"id":"1"}}\n');
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("message_start");
  });

  it("holds a partial line until the newline arrives", () => {
    const reader = new SseReader();
    const events1 = reader.push('data: {"type":"message_stop"');
    expect(events1).toEqual([]);
    const events2 = reader.push("}\n");
    expect(events2).toHaveLength(1);
    expect(events2[0].type).toBe("message_stop");
  });

  it("skips comment lines, event-name lines and blank lines", () => {
    const reader = new SseReader();
    const events = reader.push(": PING\nevent: message_stop\n\n");
    expect(events).toEqual([]);
  });

  it("skips a [DONE] sentinel", () => {
    const reader = new SseReader();
    const events = reader.push("data: [DONE]\n");
    expect(events).toEqual([]);
  });

  it("skips a malformed payload without throwing and keeps the next event", () => {
    const reader = new SseReader();
    let events: ReturnType<typeof reader.push> = [];
    expect(() => {
      events = reader.push('data: {"type":"content_block_delta"\ndata: {"type":"message_stop"}\n');
    }).not.toThrow();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("message_stop");
  });

  it("strips a trailing carriage return", () => {
    const reader = new SseReader();
    const events = reader.push('data: {"type":"message_stop"}\r\n');
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("message_stop");
  });

  it("yields a duplicate message_delta after message_stop", () => {
    const reader = new SseReader();
    const input = [
      'data: {"type":"message_stop"}\n',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":10}}\n',
    ].join("");
    const events = reader.push(input);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("message_stop");
    expect(events[1].type).toBe("message_delta");
  });

  it("yields a duplicate message_stop", () => {
    const reader = new SseReader();
    const input = 'data: {"type":"message_stop"}\ndata: {"type":"message_stop"}\n';
    const events = reader.push(input);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("message_stop");
    expect(events[1].type).toBe("message_stop");
  });

  it("yields an unknown event type unchanged", () => {
    const reader = new SseReader();
    const input = 'data: {"type":"ping"}\nevent: error\ndata: {"type":"error","error":{"type":"overloaded_error"}}\n';
    const events = reader.push(input);
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("ping");
    expect(events[1].type).toBe("error");
  });
});

describe("readSseStream", () => {
  it("yields events in order from a single-chunk body", async () => {
    const body = sseStream([
      'event: message_start\ndata: {"type":"message_start","message":{"id":"1"}}\n\n' +
      'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n' +
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}\n\n' +
      'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n' +
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}\n\n' +
      'event: message_stop\ndata: {"type":"message_stop"}\n\n'
    ]);
    const types: string[] = [];
    for await (const ev of readSseStream(body)) {
      types.push(ev.type);
    }
    expect(types).toEqual([
      "message_start",
      "content_block_start",
      "content_block_delta",
      "content_block_stop",
      "message_delta",
      "message_stop",
    ]);
  });

  it("yields the first event before the second chunk is enqueued", async () => {
    const encoder = new TextEncoder();
    let controllerRef!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(ctrl) {
        controllerRef = ctrl;
      },
    });

    const gen = readSseStream(body);

    // Enqueue chunk 1
    controllerRef.enqueue(encoder.encode('data: {"type":"message_start","message":{"id":"1"}}\n'));

    let chunk2Enqueued = false;
    const nextPromise = gen.next().then((res) => {
      expect(chunk2Enqueued).toBe(false);
      return res;
    });

    const firstResult = await nextPromise;
    expect(firstResult.done).toBe(false);
    if (firstResult.done) throw new Error("expected a value, got done");
    expect(firstResult.value.type).toBe("message_start");

    // Enqueue chunk 2 and close
    chunk2Enqueued = true;
    controllerRef.enqueue(encoder.encode('data: {"type":"message_stop"}\n'));
    controllerRef.close();

    const secondResult = await gen.next();
    expect(secondResult.done).toBe(false);
    if (secondResult.done) throw new Error("expected a value, got done");
    expect(secondResult.value.type).toBe("message_stop");

    const finalResult = await gen.next();
    expect(finalResult.done).toBe(true);
  });

  it("decodes a multi-byte character split across chunk boundaries", async () => {
    const encoder = new TextEncoder();
    const fullLine = 'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi 👋"}}\n';
    const fullBytes = encoder.encode(fullLine);

    // Find byte index in the middle of 👋 emoji
    const emojiStr = "👋";
    const emojiBytes = encoder.encode(emojiStr);
    expect(emojiBytes.length).toBeGreaterThan(1);

    const splitIdx = fullBytes.length - 6; // splitting near the end where 👋 is located

    const chunk1 = fullBytes.subarray(0, splitIdx);
    const chunk2 = fullBytes.subarray(splitIdx);

    const body = new ReadableStream<Uint8Array>({
      start(ctrl) {
        ctrl.enqueue(chunk1);
        ctrl.enqueue(chunk2);
        ctrl.close();
      },
    });

    const events = [];
    for await (const ev of readSseStream(body)) {
      events.push(ev);
    }
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("content_block_delta");
    const first = events[0];
    if (isStreamEventType(first, "content_block_delta") && first.delta.type === "text_delta") {
      expect(first.delta.text).toBe("Hi 👋");
    }
  });

  it("yields a final event that has no trailing newline", async () => {
    const body = sseStream(['data: {"type":"message_stop"}']);
    const events = [];
    for await (const ev of readSseStream(body)) {
      events.push(ev);
    }
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("message_stop");
  });

  it("reports progress for a keep-alive comment chunk that yields no event", async () => {
    const body = sseStream([": PING\n\n", ": PING\n\n", 'data: {"type":"message_stop"}\n\n']);
    let progressCalls = 0;
    const events = [];
    for await (const ev of readSseStream(body, () => {
      progressCalls++;
    })) {
      events.push(ev);
    }
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("message_stop");
    expect(progressCalls).toBe(3);
  });

  it("works when no progress callback is supplied", async () => {
    const body = sseStream([": PING\n\n", 'data: {"type":"message_stop"}\n\n']);
    const events = [];
    for await (const ev of readSseStream(body)) {
      events.push(ev);
    }
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("message_stop");
  });
});

describe("parseAnthropicSseText", () => {
  it("parses a complete text and thinking SSE stream into one Message", () => {
    const sse = [
      `data: {"type":"message_start","message":{"id":"msg_123","type":"message","role":"assistant","content":[],"stop_reason":null,"usage":{"input_tokens":10}}}`,
      `data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":"sig_abc"}}`,
      `data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Deep thinking"}}`,
      `data: {"type":"content_block_stop","index":0}`,
      `data: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}`,
      `data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Hello world"}}`,
      `data: {"type":"content_block_stop","index":1}`,
      `data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":20}}`,
      `data: {"type":"message_stop"}`,
    ].join("\n");

    const message = parseAnthropicSseText(sse);
    expect(message).toBeDefined();
    expect(message!.id).toBe("msg_123");
    expect(message!.stop_reason).toBe("end_turn");
    expect(message!.content).toEqual([
      { type: "thinking", thinking: "Deep thinking", signature: "sig_abc" },
      { type: "text", text: "Hello world" },
    ]);
  });

  it("parses a tool_use SSE stream, assembling partial_json into input", () => {
    const sse = [
      `data: {"type":"message_start","message":{"id":"msg_456","type":"message","role":"assistant","content":[],"stop_reason":null,"usage":{"input_tokens":5}}}`,
      `data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"tu_999","name":"click","input":{}}}`,
      `data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"ref\\":\\""}}`,
      `data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"12\\"}"}}`,
      `data: {"type":"content_block_stop","index":0}`,
      `data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":5}}`,
      `data: {"type":"message_stop"}`,
    ].join("\n");

    const message = parseAnthropicSseText(sse);
    expect(message).toBeDefined();
    expect(message!.id).toBe("msg_456");
    expect(message!.stop_reason).toBe("tool_use");
    expect(message!.content).toEqual([
      { type: "tool_use", id: "tu_999", name: "click", input: { ref: "12" } },
    ]);
  });
});
