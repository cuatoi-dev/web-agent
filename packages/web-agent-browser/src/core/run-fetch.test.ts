import { describe, it, expect, vi } from "vitest";
import { runPageFetch } from "./run-fetch";

interface CapturedCall {
  url: string;
  options?: RequestInit;
}

function fakeFetch(response: { status?: number; statusText?: string; contentType?: string; body?: string }) {
  const calls: CapturedCall[] = [];
  const fn = vi.fn((url: string, options?: RequestInit) => {
    calls.push({ url, options });
    return Promise.resolve({
      status: response.status ?? 200,
      statusText: response.statusText ?? "OK",
      headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? (response.contentType ?? "text/plain") : null) },
      text: () => Promise.resolve(response.body ?? "ok"),
    } as unknown as Response);
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

describe("runPageFetch", () => {
  it("resolves relative URL against currentOrigin and passes credentials: same-origin", async () => {
    const { fn, calls } = fakeFetch({ contentType: "application/json" });
    const result = await runPageFetch(
      { url: "/api/inventory" },
      { currentOrigin: "http://localhost:10040", fetch: fn },
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://localhost:10040/api/inventory");
    expect((calls[0].options as RequestInit)?.credentials).toBe("same-origin");
    expect(result.kind).toBe("response");
    if (result.kind === "response") expect(result.status).toBe(200);
  });

  it("allows absolute same-origin URL", async () => {
    const { fn } = fakeFetch({});
    const result = await runPageFetch(
      { url: "http://localhost:10040/api/inventory" },
      { currentOrigin: "http://localhost:10040", fetch: fn },
    );
    expect(result.kind).toBe("response");
    if (result.kind === "response") expect(result.status).toBe(200);
  });

  it("blocks cross-origin host without calling fetch", async () => {
    const { fn } = fakeFetch({});
    const result = await runPageFetch(
      { url: "https://example.com/api" },
      { currentOrigin: "http://localhost:10040", fetch: fn },
    );
    expect(result.kind).toBe("cross-origin");
    if (result.kind === "cross-origin") {
      expect(result.requested).toBe("https://example.com");
      expect(result.pageOrigin).toBe("http://localhost:10040");
    }
    expect(fn).not.toHaveBeenCalled();
  });

  it("blocks different port as cross-origin without calling fetch", async () => {
    const { fn } = fakeFetch({});
    const result = await runPageFetch(
      { url: "http://localhost:20000/api" },
      { currentOrigin: "http://localhost:10040", fetch: fn },
    );
    expect(result.kind).toBe("cross-origin");
    expect(fn).not.toHaveBeenCalled();
  });

  it("passes method, headers, and body", async () => {
    const { fn, calls } = fakeFetch({});
    await runPageFetch(
      { url: "/api/create", method: "POST", headers: { "X-Test": "1" }, body: "data" },
      { currentOrigin: "http://localhost:10040", fetch: fn },
    );
    expect(calls).toHaveLength(1);
    const options = calls[0].options as RequestInit;
    expect(options.method).toBe("POST");
    expect(options.headers).toEqual({ "X-Test": "1" });
    expect(options.body).toBe("data");
  });

  it("returns 404 response normally without throwing", async () => {
    const { fn } = fakeFetch({ status: 404, statusText: "Not Found", body: '{"error":"nope"}' });
    const result = await runPageFetch(
      { url: "/api/missing" },
      { currentOrigin: "http://localhost:10040", fetch: fn },
    );
    expect(result.kind).toBe("response");
    if (result.kind === "response") expect(result.status).toBe(404);
  });

  it("truncates response body exceeding maxChars", async () => {
    const { fn } = fakeFetch({ body: "A".repeat(100) });
    const result = await runPageFetch(
      { url: "/api/large" },
      { currentOrigin: "http://localhost:10040", fetch: fn, maxChars: 50 },
    );
    expect(result.kind).toBe("response");
    if (result.kind === "response") {
      expect(result.body.endsWith("\n…(output truncated)")).toBe(true);
      // truncate() slices to maxChars-22 then appends the 20-char marker,
      // so the result lands at maxChars-2, not exactly maxChars.
      expect(result.body.length).toBeLessThanOrEqual(50);
    }
  });

  it("catches network error and returns throw kind", async () => {
    const fn = vi.fn(() => Promise.reject(new Error("Failed to fetch"))) as unknown as typeof fetch;
    const result = await runPageFetch(
      { url: "/api/inventory" },
      { currentOrigin: "http://localhost:10040", fetch: fn },
    );
    expect(result.kind).toBe("throw");
    if (result.kind === "throw") {
      expect(result.message).toBe("Failed to fetch");
      expect(result.name).toBe("Error");
    }
  });

  it("handles empty or invalid URL", async () => {
    const { fn } = fakeFetch({});
    const empty = await runPageFetch({ url: "" }, { currentOrigin: "http://localhost:10040", fetch: fn });
    expect(empty.kind).toBe("invalid-url");
    const bad = await runPageFetch({ url: "http://[::1::bad" }, { currentOrigin: "http://localhost:10040", fetch: fn });
    expect(bad.kind).toBe("invalid-url");
    expect(fn).not.toHaveBeenCalled();
  });
});
