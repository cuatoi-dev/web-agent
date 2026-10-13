import { describe, it, expect, vi, afterEach } from "vitest";
import { createAgentSession } from "@cuatoi/web-agent-core";
import { openApiToolProviders } from "./tool-providers.js";
import type { ApiSourceConfig } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SPEC = {
  openapi: "3.0.0",
  info: { title: "demo", version: "1" },
  paths: {
    "/cats": {
      get: {
        operationId: "listCats",
        summary: "List cats",
        parameters: [
          { name: "limit", in: "query", required: false, schema: { type: "integer" } },
        ],
      },
    },
    "/cats/{id}": {
      get: {
        operationId: "getCat",
        summary: "Get one cat",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
      },
    },
  },
};

const specFetch = (body: unknown = SPEC) =>
  vi.fn<[RequestInfo | URL, RequestInit?], Promise<Response>>((input: RequestInfo | URL) => {
    // Serve the OpenAPI document when asked for the spec, and the same body as
    // the operation response otherwise.
    const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
    if (url.endsWith("openapi.json")) {
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

const apiSource = (name: string, required: boolean, overrides: Partial<ApiSourceConfig> = {}): ApiSourceConfig => ({
  name,
  description: `desc-${name}`,
  specUrl: `http://x/${name}/openapi.json`,
  operations: ["listCats", "getCat"],
  credentials: "same-origin",
  required,
  ...overrides,
});

function mkTextResp(text: string) {
  return {
    id: "msg_x",
    type: "message",
    role: "assistant",
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    stop_sequence: null,
    model: "test-model",
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  };
}

function mkToolResp(id: string, name: string, input: Record<string, unknown> = {}) {
  return {
    id: "msg_x",
    type: "message",
    role: "assistant",
    content: [{ type: "tool_use", id, name, input }],
    stop_reason: "tool_use",
    stop_sequence: null,
    model: "test-model",
    usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  };
}

function mkSeqFetch(seq: unknown[]) {
  let idx = 0;
  return vi.fn<[RequestInfo | URL, RequestInit?], Promise<Response>>().mockImplementation(() => {
    const body = seq[idx] ?? seq[seq.length - 1];
    idx++;
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
}

describe("Controller — API source integration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a session with no tool providers makes no spec requests", async () => {
    const session = createAgentSession({ persist: false, model: "test-model" });
    await session.initPromise;
    expect(session.getState().error).toBeUndefined();
  });

  it("API tools are available on turn 1", async () => {
    const sourceFetch = specFetch();
    const fakeFetch = mkSeqFetch([mkTextResp("done")]);

    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:9999/v1",
      fetch: fakeFetch,
      toolProviders: openApiToolProviders([apiSource("demo", true, { fetch: sourceFetch })]),
    });
    await session.initPromise;

    await session.send([{ type: "text", text: "hi" }]);
    expect(fakeFetch).toHaveBeenCalled();
    const init0 = fakeFetch.mock.calls[0]?.[1];
    const bodyStr0 = typeof init0?.body === "string" ? init0.body : "{}";
    const body0 = JSON.parse(bodyStr0) as { tools?: Array<{ name: string }> };
    const toolNames = body0.tools?.map((t) => t.name) ?? [];
    expect(toolNames).toContain("demo_listCats");
    expect(toolNames).toContain("demo_getCat");
  });

  it("host tools, then API tools", async () => {
    const fakeFetch = mkSeqFetch([mkTextResp("done")]);

    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:9999/v1",
      fetch: fakeFetch,
      tools: () => [{
        name: "host_tool",
        description: "host",
        inputSchema: { type: "object", properties: {} },
        execute: vi.fn(() => Promise.resolve({ content: "ok" })),
      }],
      toolProviders: openApiToolProviders([apiSource("demo", true, { fetch: specFetch() })]),
    });
    await session.initPromise;

    await session.send([{ type: "text", text: "hi" }]);
    const initHost = fakeFetch.mock.calls[0]?.[1];
    const bodyStrHost = typeof initHost?.body === "string" ? initHost.body : "{}";
    const bodyHost = JSON.parse(bodyStrHost) as { tools?: Array<{ name: string }> };
    const names = bodyHost.tools?.map((t) => t.name) ?? [];
    expect(names.indexOf("host_tool")).toBeLessThan(names.indexOf("demo_listCats"));
  });

  it("a required source failure rejects initPromise and sets state.error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const sourceFetch = vi.fn(() => Promise.resolve(new Response("not found", { status: 404 })));

    const session = createAgentSession({
      persist: false,
      model: "test-model",
      toolProviders: openApiToolProviders([apiSource("demo", true, { fetch: sourceFetch })]),
    });

    await expect(session.initPromise).rejects.toThrow(/Required API source/);
    expect(session.getState().error).toBeDefined();
    expect(session.getState().error).toContain("demo");
    expect(errorSpy).toHaveBeenCalled();
  });

  it("an optional source failure leaves the session usable", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const sourceFetch = vi.fn(() => Promise.resolve(new Response("not found", { status: 404 })));
    const fakeFetch = mkSeqFetch([mkTextResp("ok")]);

    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:9999/v1",
      fetch: fakeFetch,
      toolProviders: openApiToolProviders([apiSource("demo", false, { fetch: sourceFetch })]),
    });

    await session.initPromise;
    expect(session.getState().error).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();

    await session.send([{ type: "text", text: "hi" }]);
    expect(fakeFetch).toHaveBeenCalled();
  });

  it("a new source list passed to updateConfig is loaded", async () => {
    const sourceFetch = specFetch();
    const fakeFetch = mkSeqFetch([mkTextResp("ok"), mkTextResp("ok")]);

    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:9999/v1",
      fetch: fakeFetch,
      toolProviders: openApiToolProviders([apiSource("demo", true, { fetch: sourceFetch })]),
    });
    await session.initPromise;
    const callsAfterInit = sourceFetch.mock.calls.length;

    session.updateConfig({
      toolProviders: openApiToolProviders([apiSource("other", false, { fetch: sourceFetch })]),
    });
    await vi.waitFor(() =>
      expect(session.availableTools().map((t) => t.name)).toContain("other_listCats"),
    );
    expect(sourceFetch.mock.calls.length).toBeGreaterThan(callsAfterInit);

    await session.send([{ type: "text", text: "hi" }]);
    const init = fakeFetch.mock.calls[0]?.[1];
    const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as { tools?: Array<{ name: string }> };
    const toolNames = body.tools?.map((t) => t.name) ?? [];
    expect(toolNames).toContain("other_listCats");
    expect(toolNames).not.toContain("demo_listCats");
  });

  it("a generated tool performs the real request", async () => {
    // source.fetch serves the spec on init and the fake operation response when
    // the getCat tool actually runs.
    const sourceFetch = vi.fn<[RequestInfo | URL, RequestInit?], Promise<Response>>((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
      if (url.endsWith("openapi.json")) {
        return Promise.resolve(
          new Response(JSON.stringify(SPEC), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ id: "c1" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });

    const fakeFetch = mkSeqFetch([
      mkToolResp("call-1", "demo_getCat", { id: "c1" }),
      mkTextResp("got the cat"),
    ]);

    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:9999/v1",
      fetch: fakeFetch,
      toolProviders: openApiToolProviders([
        apiSource("demo", true, { operations: ["getCat"], fetch: sourceFetch }),
      ]),
    });
    await session.initPromise;

    await session.send([{ type: "text", text: "fetch cat c1" }]);

    // The operation fetch happened: GET against the fixed path with the id bound.
    const opCall = sourceFetch.mock.calls.find(([input]) => {
      const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
      return url.endsWith("/cats/c1");
    });
    expect(opCall).toBeDefined();
    const opInit = opCall?.[1];
    expect(opInit?.method).toBe("GET");

    // The tool result carrying the response body was fed back to the LLM.
    const secondCallInit = fakeFetch.mock.calls[1]?.[1];
    const secondBodyStr = typeof secondCallInit?.body === "string" ? secondCallInit.body : "{}";
    const secondBody = JSON.stringify(JSON.parse(secondBodyStr));
    expect(secondBody).toContain('{"id":"c1"}');
  });
});