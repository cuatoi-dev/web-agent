import { describe, it, expect, vi } from "vitest";
import { gatewayAuthHeader, withGatewayAuth } from "./gateway-auth";

describe("gateway-auth", () => {
  it("gatewayAuthHeader maps LLM route URLs to respective auth headers", () => {
    expect(gatewayAuthHeader("/api/openai/v1/chat/completions", "k")).toEqual(["Authorization", "Bearer k"]);
    expect(gatewayAuthHeader("/api/anthropic/v1/messages", "k")).toEqual(["x-api-key", "k"]);
    expect(gatewayAuthHeader("/api/gemini/v1beta/models/x:generateContent", "k")).toEqual(["x-goog-api-key", "k"]);
    expect(gatewayAuthHeader("/api/orders", "k")).toBeNull();
    expect(gatewayAuthHeader("/mcp", "k")).toBeNull();
    expect(gatewayAuthHeader("https://example.test/v1", "k")).toBeNull();
  });

  it("gatewayAuthHeader rejects URLs from other origins", () => {
    expect(gatewayAuthHeader("https://unrelated.example/api/openai/v1/chat/completions", "k")).toBeNull();
    expect(gatewayAuthHeader("https://unrelated.example/api/anthropic/v1/messages", "k")).toBeNull();
    expect(gatewayAuthHeader("https://unrelated.example/api/gemini/v1beta/models/x:generateContent", "k")).toBeNull();
  });

  it("gatewayAuthHeader rejects paths containing the routes only as substrings", () => {
    expect(gatewayAuthHeader("/other/prefix/api/openai/v1/chat/completions", "k")).toBeNull();
    expect(gatewayAuthHeader("/api/other/api/anthropic/v1/messages", "k")).toBeNull();
  });

  it("withGatewayAuth injects format header and retains existing headers without x-web-agent-token", async () => {
    const spy = vi.fn();
    const wrapped = withGatewayAuth(spy as any, "k");

    await wrapped("/api/anthropic/v1/messages", { headers: { "content-type": "application/json" } });

    expect(spy).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = spy.mock.calls[0];
    expect(calledUrl).toBe("/api/anthropic/v1/messages");
    const headers = calledInit.headers as Headers;
    expect(headers.get("x-api-key")).toBe("k");
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("x-web-agent-token")).toBeNull();
  });

  it("withGatewayAuth preserves caller header if already set", async () => {
    const spy = vi.fn();
    const wrapped = withGatewayAuth(spy as any, "k");

    await wrapped("/api/anthropic/v1/messages", { headers: { "x-api-key": "own" } });

    expect(spy).toHaveBeenCalledTimes(1);
    const [, calledInit] = spy.mock.calls[0];
    const headers = calledInit.headers as Headers;
    expect(headers.get("x-api-key")).toBe("own");
  });

  it("withGatewayAuth respects case-insensitive caller auth precedence", async () => {
    const spy = vi.fn();
    const wrapped = withGatewayAuth(spy as any, "k");

    await wrapped("/api/openai/v1/chat/completions", { headers: { "authorization": "Bearer own-token" } });

    expect(spy).toHaveBeenCalledTimes(1);
    const [, calledInit] = spy.mock.calls[0];
    const headers = calledInit.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer own-token");
  });

  it("withGatewayAuth preserves Request headers when input is a Request", async () => {
    const spy = vi.fn();
    const wrapped = withGatewayAuth(spy as any, "k");
    const req = new Request(`${location.origin}/api/openai/v1/chat/completions`, {
      headers: { "X-Caller": "test-val" },
    });

    await wrapped(req);

    expect(spy).toHaveBeenCalledTimes(1);
    const [calledInput, calledInit] = spy.mock.calls[0];
    expect(calledInput).toBe(req);
    const headers = calledInit.headers as Headers;
    expect(headers.get("X-Caller")).toBe("test-val");
    expect(headers.get("Authorization")).toBe("Bearer k");
  });

  it("withGatewayAuth preserves caller auth on Request input in any letter case", async () => {
    const spy = vi.fn();
    const wrapped = withGatewayAuth(spy as any, "k");
    const req = new Request(`${location.origin}/api/openai/v1/chat/completions`, {
      headers: { "AUTHORIZATION": "Bearer caller-auth", "X-Custom": "present" },
    });

    await wrapped(req);

    expect(spy).toHaveBeenCalledTimes(1);
    const [, calledInit] = spy.mock.calls[0];
    const headers = calledInit.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer caller-auth");
    expect(headers.get("X-Custom")).toBe("present");
  });

  it("withGatewayAuth leaves other paths untouched passing the same init reference", async () => {
    const spy = vi.fn();
    const wrapped = withGatewayAuth(spy as any, "k");
    const init = { headers: { "content-type": "application/json" } };

    await wrapped("/api/orders", init);

    expect(spy).toHaveBeenCalledWith("/api/orders", init);
  });

  it("withGatewayAuth handles URL instances", async () => {
    const spy = vi.fn();
    const wrapped = withGatewayAuth(spy as any, "k");
    const url = new URL("/api/openai/v1/models", location.href);

    await wrapped(url);

    expect(spy).toHaveBeenCalledTimes(1);
    const [calledInput, calledInit] = spy.mock.calls[0];
    expect(calledInput).toBe(url);
    const headers = calledInit.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer k");
  });
});
