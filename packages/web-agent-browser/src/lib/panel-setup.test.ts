import { describe, it, expect, vi } from "vitest";
import { applyPanelSettings, createDirectFetch, type PanelLike } from "./panel-setup";
import type { AgentSettings } from "./settings";
import { createAgentSession, setMockScript } from "@cuatoi/web-agent-core";
import { PANEL_SESSION_NAMESPACE } from "./constants";
import { EMPTY_BRAND } from "./brand";

/** A filled AgentSettings. This test is about applyPanelSettings copying
 *  fields, so the values only need to be present and distinguishable. */
const SETTINGS: AgentSettings = {
  endpoint: "https://example.test/api/openai/v1",
  wireFormat: "openai",
  model: "test-model",
  apiKey: "",
  theme: "auto",
};

describe("panel-setup", () => {
  describe("applyPanelSettings", () => {
    it("copies endpoint, wireFormat, model and config onto panel object", () => {
      const panel: PanelLike = {};
      const settings: AgentSettings = {
        endpoint: "https://custom.gateway/v1",
        wireFormat: "anthropic",
        model: "claude-3-5-sonnet",
        apiKey: "",
        theme: "dark",
      };
      applyPanelSettings(panel, settings, "secret-token", EMPTY_BRAND);

      expect(panel.path).toBe("https://custom.gateway/v1");
      expect(panel.type).toBe("anthropic");
      expect(panel.model).toBe("claude-3-5-sonnet");
      expect(typeof panel.fetch).toBe("function");
      // `toMatchObject`, not `toEqual`: the panel's config carries host opt-in
      // flags too, and asserting those literals back would be a constant
      // equalling itself. What this case checks is that the endpoint settings
      // and the session namespace are written — the todo flag is proven by the
      // tool list the agent actually receives, in todo-tools.mock.spec.ts.
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
      applyPanelSettings(panel, SETTINGS, "token", EMPTY_BRAND);

      // The session is built from the SAME config object the side panel gets,
      // so this proves the wiring, not a literal. `availableTools()` is empty
      // until a turn has run (controller-turn.ts:71), hence the send().
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

    // W2 — criterion 6, side panel half.
    it("tools: { todo: { enabled: false } } removes todo_write and todo_read from a real session", async () => {
      const panel: PanelLike = {};
      applyPanelSettings(panel, SETTINGS, "token", {
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
      applyPanelSettings(panel, SETTINGS, "token", {
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
      applyPanelSettings(plain, SETTINGS, "token", EMPTY_BRAND);
      const branded: PanelLike = {};
      applyPanelSettings(branded, SETTINGS, "token", {
        ...EMPTY_BRAND,
        tools: { scheduler: { enabled: false }, todo: { enabled: false } },
      });
      expect(plain.config?.maxIterations).toBe(1000);
      expect(branded.config?.maxIterations).toBe(plain.config?.maxIterations);
    });

    // W4.
    it("tools: { data: { enabled: false } } removes the data tools but keeps get_time", async () => {
      const panel: PanelLike = {};
      applyPanelSettings(panel, SETTINGS, "token", {
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
    it("adds X-Web-Agent-Token when apiKey is empty", async () => {
      const spy = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(new Response("ok"));
      const settings: AgentSettings = { ...SETTINGS, apiKey: "" };
      const customFetch = createDirectFetch(settings, "my-shared-token", spy);

      await customFetch("https://api.example.com/chat", { method: "POST" });

      expect(spy).toHaveBeenCalledOnce();
      const [, init] = spy.mock.calls[0];
      const headers = new Headers(init?.headers);
      expect(headers.get("X-Web-Agent-Token")).toBe("my-shared-token");
      expect(headers.get("Authorization")).toBeNull();
    });

    it("adds Authorization: Bearer <key> for openai with filled apiKey and no X-Web-Agent-Token", async () => {
      const spy = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(new Response("ok"));
      const settings: AgentSettings = {
        ...SETTINGS,
        wireFormat: "openai",
        apiKey: "sk-openai-key",
      };
      const customFetch = createDirectFetch(settings, "my-shared-token", spy);

      await customFetch("https://api.openai.com/v1/chat", { method: "POST" });

      expect(spy).toHaveBeenCalledOnce();
      const [, init] = spy.mock.calls[0];
      const headers = new Headers(init?.headers);
      expect(headers.get("Authorization")).toBe("Bearer sk-openai-key");
      expect(headers.get("X-Web-Agent-Token")).toBeNull();
    });

    it("adds X-Api-Key for anthropic wireFormat with filled apiKey", async () => {
      const spy = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(new Response("ok"));
      const settings: AgentSettings = {
        ...SETTINGS,
        wireFormat: "anthropic",
        apiKey: "sk-ant-key",
      };
      const customFetch = createDirectFetch(settings, "my-shared-token", spy);

      await customFetch("https://api.anthropic.com/v1/messages", { method: "POST" });

      const [, init] = spy.mock.calls[0];
      const headers = new Headers(init?.headers);
      expect(headers.get("X-Api-Key")).toBe("sk-ant-key");
    });

    it("adds x-goog-api-key for gemini wireFormat with filled apiKey", async () => {
      const spy = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(new Response("ok"));
      const settings: AgentSettings = {
        ...SETTINGS,
        wireFormat: "gemini",
        apiKey: "gemini-key-123",
      };
      const customFetch = createDirectFetch(settings, "my-shared-token", spy);

      await customFetch("https://generativelanguage.googleapis.com/v1", { method: "POST" });

      const [, init] = spy.mock.calls[0];
      const headers = new Headers(init?.headers);
      expect(headers.get("x-goog-api-key")).toBe("gemini-key-123");
    });

    it("preserves URL, method, body, and caller headers", async () => {
      const spy = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(new Response("ok"));
      const settings: AgentSettings = { ...SETTINGS, apiKey: "" };
      const customFetch = createDirectFetch(settings, "token-1", spy);

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
      expect(headers.get("X-Web-Agent-Token")).toBe("token-1");
    });
  });
});
