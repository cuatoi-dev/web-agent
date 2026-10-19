import { describe, it, expect, vi } from "vitest";
import { handleRelayRequest, urlMatchesProvider } from "./relay-handler";
import { listModels, EMPTY_MODEL_STORE } from "./model-store";
import { bytesToBase64 } from "./relay-protocol";
import type { AgentBrand, RelayRequest, RelayHandlerDeps } from "./types";

function brandWith(endpoint: string): AgentBrand {
  return {
    agents: [],
    defaultAgent: "a",
    prompts: {},
    tools: {},
    skills: {},
    options: {},
    models: [
      {
        id: "a",
        label: "Model A",
        endpoint,
        wireFormat: "anthropic",
        model: "claude-a",
        vision: true,
      },
    ],
  };
}

describe("relay-handler", () => {
  it("rejects request URL that does not match the model provider endpoint", async () => {
    const brand = brandWith("http://gw.test/api/anthropic");
    const entries = listModels(brand, EMPTY_MODEL_STORE);
    const readModels = vi.fn().mockResolvedValue({ entries, token: "tok" });
    const fetchImpl = vi.fn();
    const post = vi.fn();
    const deps: RelayHandlerDeps = {
      readModels,
      fetchImpl,
      post,
      signal: new AbortController().signal,
    };

    const req: RelayRequest = {
      type: "request",
      url: "http://other.test/v1/messages",
      method: "POST",
      headers: {},
      body: null,
      modelRef: "brand:a",
    };
    await handleRelayRequest(req, deps);

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith({
      type: "error",
      message: "The request URL does not match the model's provider.",
    });
  });

  it("rejects prefix attacks (anthropicevil) and directory traversal", async () => {
    const brand = brandWith("http://gw.test/api/anthropic");
    const entries = listModels(brand, EMPTY_MODEL_STORE);
    const readModels = vi.fn().mockResolvedValue({ entries, token: "tok" });
    const fetchImpl = vi.fn();
    const post = vi.fn();
    const deps: RelayHandlerDeps = {
      readModels,
      fetchImpl,
      post,
      signal: new AbortController().signal,
    };

    // Prefix match without boundary
    await handleRelayRequest(
      {
        type: "request",
        url: "http://gw.test/api/anthropicevil/x",
        method: "POST",
        headers: {},
        body: null,
        modelRef: "brand:a",
      },
      deps,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith({
      type: "error",
      message: "The request URL does not match the model's provider.",
    });

    // Directory traversal
    post.mockClear();
    await handleRelayRequest(
      {
        type: "request",
        url: "http://gw.test/api/anthropic/../../other",
        method: "POST",
        headers: {},
        body: null,
        modelRef: "brand:a",
      },
      deps,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith({
      type: "error",
      message: "The request URL does not match the model's provider.",
    });
  });

  it("rejects unknown or empty modelRef", async () => {
    const brand = brandWith("http://gw.test/api/anthropic");
    const entries = listModels(brand, EMPTY_MODEL_STORE);
    const readModels = vi.fn().mockResolvedValue({ entries, token: "tok" });
    const fetchImpl = vi.fn();
    const post = vi.fn();
    const deps: RelayHandlerDeps = {
      readModels,
      fetchImpl,
      post,
      signal: new AbortController().signal,
    };

    await handleRelayRequest(
      {
        type: "request",
        url: "http://gw.test/api/anthropic/v1/messages",
        method: "POST",
        headers: {},
        body: null,
        modelRef: "brand:nope",
      },
      deps,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith({ type: "error", message: "Unknown model." });

    post.mockClear();
    await handleRelayRequest(
      {
        type: "request",
        url: "http://gw.test/api/anthropic/v1/messages",
        method: "POST",
        headers: {},
        body: null,
        modelRef: "",
      },
      deps,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith({ type: "error", message: "Unknown model." });
  });

  it("attaches auth headers and streams head, chunks, and end in order", async () => {
    const brand = brandWith("http://gw.test/api/anthropic");
    const entries = listModels(brand, EMPTY_MODEL_STORE);
    const readModels = vi.fn().mockResolvedValue({ entries, token: "tok" });

    const encoder = new TextEncoder();
    const chunkBytes = encoder.encode("hello");
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(chunkBytes);
        controller.close();
      },
    });

    const mockResponse = new Response(stream, {
      status: 200,
      headers: { "content-type": "text/plain" },
    });

    const fetchImpl = vi.fn().mockResolvedValue(mockResponse);
    const post = vi.fn();
    const deps: RelayHandlerDeps = {
      readModels,
      fetchImpl,
      post,
      signal: new AbortController().signal,
    };

    const req: RelayRequest = {
      type: "request",
      url: "http://gw.test/api/anthropic/v1/messages",
      method: "POST",
      headers: { "content-type": "application/json", "x-web-agent-token": "fake" },
      body: null,
      modelRef: "brand:a",
    };

    await handleRelayRequest(req, deps);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [callUrl, callInit] = fetchImpl.mock.calls[0];
    expect(callUrl).toBe("http://gw.test/api/anthropic/v1/messages");
    const headers = new Headers(callInit.headers);
    expect(headers.get("x-web-agent-token")).toBe("tok");
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("anthropic-version")).toBe("2023-06-01");

    expect(post.mock.calls).toEqual([
      [{ type: "head", status: 200, statusText: "", contentType: "text/plain" }],
      [{ type: "chunk", b64: bytesToBase64(chunkBytes) }],
      [{ type: "end" }],
    ]);
  });

  it("posts error message if fetchImpl rejects", async () => {
    const brand = brandWith("http://gw.test/api/anthropic");
    const entries = listModels(brand, EMPTY_MODEL_STORE);
    const readModels = vi.fn().mockResolvedValue({ entries, token: "tok" });
    const fetchImpl = vi.fn().mockRejectedValue(new Error("boom"));
    const post = vi.fn();
    const deps: RelayHandlerDeps = {
      readModels,
      fetchImpl,
      post,
      signal: new AbortController().signal,
    };

    await handleRelayRequest(
      {
        type: "request",
        url: "http://gw.test/api/anthropic/v1/messages",
        method: "POST",
        headers: {},
        body: null,
        modelRef: "brand:a",
      },
      deps,
    );

    expect(post).toHaveBeenCalledWith({ type: "error", message: "boom" });
  });

  it("urlMatchesProvider tests", () => {
    expect(urlMatchesProvider("http://gw.test/api/anthropic/v1/messages", "http://gw.test/api/anthropic/")).toBe(true);
    expect(urlMatchesProvider("http://gw.test/api/anthropic", "http://gw.test/api/anthropic")).toBe(true);
    expect(urlMatchesProvider("not a url", "http://gw.test/api")).toBe(false);
  });
});
