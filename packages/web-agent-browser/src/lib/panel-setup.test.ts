import { describe, it, expect, vi } from "vitest";
import { applyPanelSettings, createDirectFetch, type PanelLike } from "./panel-setup";
import type { ResolvedProvider } from "./types";
import { createAgentSession, setMockScript } from "@cuatoi/web-agent-core";
import { PANEL_SESSION_NAMESPACE } from "./constants";
import { EMPTY_BRAND } from "./brand";

function makeProv(over: Partial<ResolvedProvider> = {}): ResolvedProvider {
  return {
    id: "p1",
    kind: "brand",
    name: "Gateway",
    endpoint: "https://example.test/api/openai/v1",
    wireFormat: "openai",
    apiKey: "",
    headers: [],
    ...over,
  };
}

describe("panel-setup", () => {
  describe("applyPanelSettings", () => {
    it("writes fetch and config and leaves path, type, and model undefined", () => {
      const panel: PanelLike = {};
      const prov = makeProv();
      applyPanelSettings(panel, () => prov, EMPTY_BRAND);

      expect(panel.path).toBeUndefined();
      expect(panel.type).toBeUndefined();
      expect(panel.model).toBeUndefined();
      expect(typeof panel.fetch).toBe("function");
      expect(panel.config).toMatchObject({
        persist: true,
        sessionNamespace: "web-agent-extension-panel",
      });
    });

    it("writes a sessionNamespace distinct from cat-store and web-agent-docs", () => {
      expect(PANEL_SESSION_NAMESPACE).not.toBe("cat-store");
      expect(PANEL_SESSION_NAMESPACE).not.toBe("web-agent-docs");
    });

    it("the config it writes turns todo and scheduler tools on in a real core session", async () => {
      const panel: PanelLike = {};
      const prov = makeProv();
      applyPanelSettings(panel, () => prov, EMPTY_BRAND);

      setMockScript({ text: "ok" });
      const session = createAgentSession({
        ...panel.config,
        persist: false,
        model: "test-model",
        endpointType: "mock",
      });
      await session.send([{ type: "text", text: "hi" }]);

      const names = session.availableTools().map((t) => t.name);
      expect(names).toContain("todo_write");
      expect(names).toContain("todo_read");
      expect(names).toContain("set_schedule");
      expect(names).toContain("list_schedules");
      expect(names).toContain("cancel_schedule");
      session.dispose();
    });

    it("a config without the todo flag offers neither tool", async () => {
      setMockScript({ text: "ok" });
      const session = createAgentSession({
        persist: false,
        model: "test-model",
        endpointType: "mock",
      });
      await session.send([{ type: "text", text: "hi" }]);

      const names = session.availableTools().map((t) => t.name);
      expect(names).not.toContain("todo_write");
      expect(names).not.toContain("todo_read");
      session.dispose();
    });

    it("tools: { todo: { enabled: false } } removes todo_write and todo_read from a real session", async () => {
      const panel: PanelLike = {};
      const prov = makeProv();
      applyPanelSettings(panel, () => prov, {
        ...EMPTY_BRAND,
        tools: { todo: { enabled: false } },
      });

      setMockScript({ text: "ok" });
      const session = createAgentSession({
        ...panel.config,
        persist: false,
        model: "test-model",
        endpointType: "mock",
      });
      await session.send([{ type: "text", text: "hi" }]);

      const names = session.availableTools().map((t) => t.name);
      expect(names).not.toContain("todo_write");
      expect(names).not.toContain("todo_read");
      session.dispose();
    });

    it("tools: { scheduler: { enabled: false } } removes scheduler tools from a real session", async () => {
      const panel: PanelLike = {};
      const prov = makeProv();
      applyPanelSettings(panel, () => prov, {
        ...EMPTY_BRAND,
        tools: { scheduler: { enabled: false } },
      });
      setMockScript({ text: "ok" });
      const session = createAgentSession({
        ...panel.config,
        persist: false,
        model: "test-model",
        endpointType: "mock",
      });
      await session.send([{ type: "text", text: "hi" }]);
      const names = session.availableTools().map((t) => t.name);
      expect(names).not.toContain("set_schedule");
      expect(names).not.toContain("list_schedules");
      expect(names).not.toContain("cancel_schedule");
      expect(names).toContain("todo_write");
      session.dispose();
    });

    it("writes maxIterations 1000, with and without a brand tools block", () => {
      const plain: PanelLike = {};
      const prov = makeProv();
      applyPanelSettings(plain, () => prov, EMPTY_BRAND);
      const branded: PanelLike = {};
      applyPanelSettings(branded, () => prov, {
        ...EMPTY_BRAND,
        tools: { scheduler: { enabled: false }, todo: { enabled: false } },
      });
      expect(plain.config?.maxIterations).toBe(1000);
      expect(branded.config?.maxIterations).toBe(plain.config?.maxIterations);
    });

    it("tools: { data: { enabled: false } } removes the data tools but keeps get_time", async () => {
      const panel: PanelLike = {};
      const prov = makeProv();
      applyPanelSettings(panel, () => prov, {
        ...EMPTY_BRAND,
        tools: { data: { enabled: false } },
      });

      setMockScript({ text: "ok" });
      const session = createAgentSession({
        ...panel.config,
        persist: false,
        model: "test-model",
        endpointType: "mock",
      });
      await session.send([{ type: "text", text: "hi" }]);

      const names = session.availableTools().map((t) => t.name);
      expect(names).not.toContain("list_data_sources");
      expect(names).not.toContain("get_field_details");
      expect(names).not.toContain("sample_field_values");
      expect(names).not.toContain("query_data");
      expect(names).toContain("get_time");
      session.dispose();
    });
  });

  describe("createDirectFetch", () => {
    it("adds no auth header when the provider has no key", async () => {
      const spy = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(new Response("ok"));
      const prov = makeProv({ apiKey: "", endpoint: "https://api.example.com" });
      const customFetch = createDirectFetch(() => prov, spy);

      await customFetch("https://api.example.com/chat", { method: "POST" });

      expect(spy).toHaveBeenCalledOnce();
      const [, init] = spy.mock.calls[0];
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBeNull();
      expect(headers.get("x-web-agent-token")).toBeNull();
    });

    it("adds Authorization: Bearer <key> for openai with filled apiKey and no X-Web-Agent-Token", async () => {
      const spy = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(new Response("ok"));
      const prov = makeProv({
        wireFormat: "openai",
        apiKey: "sk-openai-key",
        endpoint: "https://api.openai.com/v1",
      });
      const customFetch = createDirectFetch(() => prov, spy);

      await customFetch("https://api.openai.com/v1/chat", { method: "POST" });

      expect(spy).toHaveBeenCalledOnce();
      const [, init] = spy.mock.calls[0];
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBe("Bearer sk-openai-key");
      expect(headers.get("x-web-agent-token")).toBeNull();
    });

    it("adds x-api-key and anthropic headers for anthropic wireFormat with filled apiKey", async () => {
      const spy = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(new Response("ok"));
      const prov = makeProv({
        wireFormat: "anthropic",
        apiKey: "sk-ant-key",
        endpoint: "https://api.anthropic.com/v1",
      });
      const customFetch = createDirectFetch(() => prov, spy);

      await customFetch("https://api.anthropic.com/v1/messages", { method: "POST" });

      const [, init] = spy.mock.calls[0];
      const headers = new Headers(init?.headers);
      expect(headers.get("x-api-key")).toBe("sk-ant-key");
      expect(headers.get("anthropic-version")).toBe("2023-06-01");
      expect(headers.get("anthropic-dangerous-direct-browser-access")).toBe("true");
    });

    it("adds x-goog-api-key for gemini wireFormat with filled apiKey", async () => {
      const spy = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(new Response("ok"));
      const prov = makeProv({
        wireFormat: "gemini",
        apiKey: "gemini-key-123",
        endpoint: "https://generativelanguage.googleapis.com/v1",
      });
      const customFetch = createDirectFetch(() => prov, spy);

      await customFetch("https://generativelanguage.googleapis.com/v1", { method: "POST" });

      const [, init] = spy.mock.calls[0];
      const headers = new Headers(init?.headers);
      expect(headers.get("x-goog-api-key")).toBe("gemini-key-123");
    });

    it("adds no auth header when request URL is to another origin", async () => {
      const spy = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(new Response("ok"));
      const prov = makeProv({
        wireFormat: "openai",
        apiKey: "sk-secret-key",
        endpoint: "https://provider.example/v1",
      });
      const customFetch = createDirectFetch(() => prov, spy);

      await customFetch("https://unrelated.example/collect", { method: "POST" });

      expect(spy).toHaveBeenCalledOnce();
      const [, init] = spy.mock.calls[0];
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBeNull();
    });

    it("adds no auth header when request URL path is outside provider endpoint path", async () => {
      const spy = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(new Response("ok"));
      const prov = makeProv({
        wireFormat: "openai",
        apiKey: "sk-secret-key",
        endpoint: "https://provider.example/v1",
      });
      const customFetch = createDirectFetch(() => prov, spy);

      await customFetch("https://provider.example/other/path", { method: "POST" });

      expect(spy).toHaveBeenCalledOnce();
      const [, init] = spy.mock.calls[0];
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBeNull();
    });

    it("reads provider at request time so changed provider does not send key to old endpoint", async () => {
      const spy = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(new Response("ok"));
      const provA = makeProv({
        wireFormat: "openai",
        apiKey: "sk-key-a",
        endpoint: "https://provider-a.example/v1",
      });
      const provB = makeProv({
        wireFormat: "anthropic",
        apiKey: "sk-key-b",
        endpoint: "https://provider-b.example/v1",
      });
      let current = provA;
      const customFetch = createDirectFetch(() => current, spy);

      current = provB;
      await customFetch("https://provider-a.example/v1/chat", { method: "POST" });

      const [, init] = spy.mock.calls[0];
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBeNull();
      expect(headers.get("x-api-key")).toBeNull();
    });

    it("preserves Request headers when input is a Request", async () => {
      const spy = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(new Response("ok"));
      const prov = makeProv({
        wireFormat: "openai",
        apiKey: "sk-key",
        endpoint: "https://api.openai.com/v1",
      });
      const customFetch = createDirectFetch(() => prov, spy);

      const req = new Request("https://api.openai.com/v1/chat", {
        headers: { "X-Caller": "caller-val" },
      });
      await customFetch(req);

      expect(spy).toHaveBeenCalledOnce();
      const [, init] = spy.mock.calls[0];
      const headers = new Headers(init?.headers);
      expect(headers.get("X-Caller")).toBe("caller-val");
      expect(headers.get("Authorization")).toBe("Bearer sk-key");
    });

    it("preserves URL, method, body, and caller headers", async () => {
      const spy = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(new Response("ok"));
      const prov = makeProv({ apiKey: "", endpoint: "https://gateway.example.com/v1" });
      const customFetch = createDirectFetch(() => prov, spy);

      const payload = JSON.stringify({ prompt: "hello" });
      await customFetch("https://gateway.example.com/v1/query", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Custom-Header": "foo" },
        body: payload,
      });

      expect(spy).toHaveBeenCalledWith(
        "https://gateway.example.com/v1/query",
        expect.objectContaining({
          method: "POST",
          body: payload,
        }),
      );
      const [, init] = spy.mock.calls[0];
      const headers = new Headers(init?.headers);
      expect(headers.get("Content-Type")).toBe("application/json");
      expect(headers.get("X-Custom-Header")).toBe("foo");
      expect(headers.get("Authorization")).toBeNull();
    });

    it("per-request getter call reads provider A then provider B", async () => {
      const spy = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(new Response("ok"));
      const provA = makeProv({ wireFormat: "openai", apiKey: "key-a", endpoint: "https://test.com/a" });
      const provB = makeProv({ wireFormat: "anthropic", apiKey: "key-b", endpoint: "https://test.com/b" });
      let current = provA;
      const customFetch = createDirectFetch(() => current, spy);

      await customFetch("https://test.com/a");
      const headersA = new Headers(spy.mock.calls[0][1]?.headers);
      expect(headersA.get("Authorization")).toBe("Bearer key-a");

      current = provB;
      await customFetch("https://test.com/b");
      const headersB = new Headers(spy.mock.calls[1][1]?.headers);
      expect(headersB.get("x-api-key")).toBe("key-b");
    });
  });
});
