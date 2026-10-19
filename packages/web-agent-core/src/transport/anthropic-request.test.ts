import {
  AnthropicHttpError,
  requestJson,
} from "./anthropic-request.js";
import { isRetryableError } from "./middleware.js";

describe("anthropic-request", () => {
  const originalGlobalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalGlobalFetch;
  });

  it("calls the injected fetch and never the global one", async () => {
    const globalFetchSpy = vi.fn().mockImplementation(() => {
      throw new Error("Global fetch was called");
    });
    globalThis.fetch = globalFetchSpy;

    const injectedFetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "msg_1", type: "message" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await requestJson({
      baseURL: "https://api.anthropic.com",
      path: "/v1/messages",
      headers: { "x-api-key": "secret" },
      body: { model: "claude-3" },
      fetch: injectedFetchSpy,
    });

    expect(result).toEqual({ id: "msg_1", type: "message" });
    expect(injectedFetchSpy).toHaveBeenCalledTimes(1);
    expect(globalFetchSpy).toHaveBeenCalledTimes(0);
  });

  it("posts to baseURL + path with the caller's headers and body", async () => {
    const injectedFetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    const reqHeaders = { "x-api-key": "test-key", "custom-header": "value" };
    const reqBody = { model: "claude-3", max_tokens: 100 };

    await requestJson({
      baseURL: "https://api.example.com",
      path: "/v1/messages",
      headers: reqHeaders,
      body: reqBody,
      fetch: injectedFetchSpy,
    });

    expect(injectedFetchSpy).toHaveBeenCalledWith(
      "https://api.example.com/v1/messages",
      {
        method: "POST",
        headers: reqHeaders,
        body: JSON.stringify(reqBody),
      },
    );
  });

  it("adds no headers of its own", async () => {
    let capturedHeaders: Record<string, string> | undefined;
    const injectedFetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      capturedHeaders = init?.headers as Record<string, string> | undefined;
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    });

    const passedHeaders = { "x-api-key": "k", "user-agent": "test" };
    await requestJson({
      baseURL: "http://localhost",
      path: "/messages",
      headers: passedHeaders,
      body: {},
      fetch: injectedFetch,
    });

    expect(Object.keys(capturedHeaders!).sort()).toEqual(
      Object.keys(passedHeaders).sort(),
    );
  });

  it("returns the parsed JSON body for one request", async () => {
    const injectedFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ res: "data" }), { status: 200 }),
    );

    const data = await requestJson<{ res: string }>({
      baseURL: "http://localhost",
      path: "/messages",
      headers: {},
      body: {},
      fetch: injectedFetch,
    });

    expect(data).toEqual({ res: "data" });
  });

  it("throws AnthropicHttpError carrying both status and statusCode", async () => {
    const injectedFetch = vi.fn().mockResolvedValue(
      new Response("Rate limit exceeded", { status: 429 }),
    );

    let caughtErr: AnthropicHttpError | undefined;
    try {
      await requestJson({
        baseURL: "http://localhost",
        path: "/messages",
        headers: {},
        body: {},
        fetch: injectedFetch,
      });
    } catch (err) {
      if (err instanceof AnthropicHttpError) {
        caughtErr = err;
      }
    }

    expect(caughtErr).toBeDefined();
    expect(caughtErr?.status).toBe(429);
    expect(caughtErr?.statusCode).toBe(429);
    expect(caughtErr?.body).toBe("Rate limit exceeded");
  });

  it("a 429 stays retryable and a 400 does not", () => {
    const err429 = new AnthropicHttpError(429, "Too Many Requests");
    const err400 = new AnthropicHttpError(400, "Bad Request");

    expect(isRetryableError(err429)).toBe(true);
    expect(isRetryableError(err400)).toBe(false);
  });

  it("propagates an AbortError unwrapped", async () => {
    const abortErr = new DOMException("The operation was aborted.", "AbortError");
    const injectedFetch = vi.fn().mockRejectedValue(abortErr);

    await expect(
      requestJson({
        baseURL: "http://localhost",
        path: "/messages",
        headers: {},
        body: {},
        fetch: injectedFetch,
      }),
    ).rejects.toThrow(expect.objectContaining({ name: "AbortError" }) as Error);
  });

  it("throws a clear error when no fetch exists", async () => {
    delete (globalThis as { fetch?: typeof fetch }).fetch;
    delete (window as { fetch?: typeof fetch }).fetch;

    await expect(
      requestJson({
        baseURL: "http://localhost",
        path: "/messages",
        headers: {},
        body: {},
      }),
    ).rejects.toThrow("No fetch implementation available.");
  });
});
