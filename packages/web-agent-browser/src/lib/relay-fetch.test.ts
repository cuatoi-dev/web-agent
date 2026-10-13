import { describe, it, expect } from "vitest";
import { createRelayFetch, type RelayFetchContext } from "./relay-fetch";
import { bytesToBase64, type RelayToPage, type RelayToWorker } from "./relay-protocol";

/** The one shape `createRelayFetch` posts: a relay request or an abort. */
interface PostedRelayMessage {
  type: "wa-relay-req" | "wa-relay-abort";
  reqId: string;
  request?: RelayToWorker;
}

function createFakeContext() {
  const listeners = new Set<(event: MessageEvent) => void>();
  const postedMessages: PostedRelayMessage[] = [];

  const ctx: RelayFetchContext = {
    postMessage(msg: unknown) {
      postedMessages.push(msg as PostedRelayMessage);
    },
    addEventListener(_type: string, listener: (event: MessageEvent) => void) {
      listeners.add(listener);
    },
    removeEventListener(_type: string, listener: (event: MessageEvent) => void) {
      listeners.delete(listener);
    },
  };

  const emit = (reqId: string, msg: RelayToPage) => {
    const event = new MessageEvent("message", {
      source: window,
      data: { type: "wa-relay-res", reqId, msg },
    });
    for (const l of Array.from(listeners)) l(event);
  };

  return { ctx, postedMessages, emit };
}

describe("createRelayFetch", () => {
  it("posts one request message carrying URL, method, headers, and body", async () => {
    const fake = createFakeContext();
    const relayFetch = createRelayFetch(fake.ctx);

    const fetchPromise = relayFetch("https://example.com/api/test", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Custom": "123" },
      body: '{"query":"hi"}',
    });

    expect(fake.postedMessages).toHaveLength(1);
    const req = fake.postedMessages[0];
    expect(req.type).toBe("wa-relay-req");
    expect(req.request).toEqual({
      type: "request",
      url: "https://example.com/api/test",
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-custom": "123",
      },
      body: '{"query":"hi"}',
    });

    fake.emit(req.reqId, { type: "head", status: 200, statusText: "OK", contentType: "application/json" });
    fake.emit(req.reqId, { type: "end" });
    const res = await fetchPromise;
    expect(res.status).toBe(200);
  });

  it("resolves Response as soon as head arrives before chunks", async () => {
    const fake = createFakeContext();
    const relayFetch = createRelayFetch(fake.ctx);

    const fetchPromise = relayFetch("https://example.com/api");
    const req = fake.postedMessages[0];
    fake.emit(req.reqId, { type: "head", status: 200, statusText: "OK", contentType: "text/event-stream" });

    const res = await fetchPromise;
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");

    const reader = res.body!.getReader();
    const chunkBytes = new TextEncoder().encode("data: hello\n\n");
    fake.emit(req.reqId, { type: "chunk", b64: bytesToBase64(chunkBytes) });
    fake.emit(req.reqId, { type: "end" });

    const { value, done } = await reader.read();
    expect(done).toBe(false);
    expect(new TextDecoder().decode(value)).toBe("data: hello\n\n");
    const end = await reader.read();
    expect(end.done).toBe(true);
  });

  it("res.text() on a two-chunk payload returns chunks concatenated", async () => {
    const fake = createFakeContext();
    const relayFetch = createRelayFetch(fake.ctx);

    const fetchPromise = relayFetch("https://example.com/api");
    const req = fake.postedMessages[0];
    fake.emit(req.reqId, { type: "head", status: 200, statusText: "OK", contentType: "text/plain" });

    const chunk1 = new TextEncoder().encode("part1-");
    const chunk2 = new TextEncoder().encode("part2");
    fake.emit(req.reqId, { type: "chunk", b64: bytesToBase64(chunk1) });
    fake.emit(req.reqId, { type: "chunk", b64: bytesToBase64(chunk2) });
    fake.emit(req.reqId, { type: "end" });

    const res = await fetchPromise;
    const text = await res.text();
    expect(text).toBe("part1-part2");
  });

  it("rejects when error message arrives before head", async () => {
    const fake = createFakeContext();
    const relayFetch = createRelayFetch(fake.ctx);

    const fetchPromise = relayFetch("https://example.com/api");
    const req = fake.postedMessages[0];
    fake.emit(req.reqId, { type: "error", message: "Network failure" });

    await expect(fetchPromise).rejects.toThrow("Network failure");
  });

  it("errors the stream when error message arrives after head", async () => {
    const fake = createFakeContext();
    const relayFetch = createRelayFetch(fake.ctx);

    const fetchPromise = relayFetch("https://example.com/api");
    const req = fake.postedMessages[0];
    fake.emit(req.reqId, { type: "head", status: 200, statusText: "OK", contentType: "text/plain" });
    const res = await fetchPromise;
    const reader = res.body!.getReader();

    fake.emit(req.reqId, { type: "error", message: "Stream severed" });
    await expect(reader.read()).rejects.toThrow("Stream severed");
  });

  it("posts abort and rejects with AbortError when signal is aborted", async () => {
    const fake = createFakeContext();
    const relayFetch = createRelayFetch(fake.ctx);
    const controller = new AbortController();

    const fetchPromise = relayFetch("https://example.com/api", { signal: controller.signal });
    const req = fake.postedMessages[0];
    controller.abort();

    expect(fake.postedMessages).toContainEqual({ type: "wa-relay-abort", reqId: req.reqId });
    await expect(fetchPromise).rejects.toThrowError();
  });

  it("resolves status 204 with null body", async () => {
    const fake = createFakeContext();
    const relayFetch = createRelayFetch(fake.ctx);

    const fetchPromise = relayFetch("https://example.com/api");
    const req = fake.postedMessages[0];
    fake.emit(req.reqId, { type: "head", status: 204, statusText: "No Content", contentType: null });
    fake.emit(req.reqId, { type: "end" });

    const res = await fetchPromise;
    expect(res.status).toBe(204);
    expect(res.body).toBeNull();
  });
});
