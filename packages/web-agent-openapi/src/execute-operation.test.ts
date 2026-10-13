import { describe, it, expect, vi } from "vitest";
import {
  buildApiRequest,
  createApiOperationExecutor,
  buildApiTool,
} from "./execute-operation.js";
import { operationToToolDef } from "./operation-to-tool-def.js";
import type {
  ApiSourceConfig,
  ApiOperationDescriptor,
  ApiToolParameterLocationMap,
} from "./types.js";
import type { ToolContext } from "@cuatoi/web-agent-core";

const CTX = { signal: new AbortController().signal } as unknown as ToolContext;

function makeSource(overrides?: Partial<ApiSourceConfig>): ApiSourceConfig {
  return {
    name: "cat-store",
    description: "Cat store backend API",
    specUrl: "http://localhost:28780/cat-store/openapi.json",
    operations: ["getOrder"],
    credentials: "same-origin",
    required: true,
    ...overrides,
  };
}

function makeDescriptor(overrides?: Partial<ApiOperationDescriptor>): ApiOperationDescriptor {
  return {
    operationId: "getOrder",
    method: "get",
    path: "/api/orders/{id}",
    parameters: [
      { name: "id", in: "path", required: true, schema: { type: "string" } },
      { name: "q", in: "query", required: false, schema: { type: "string" } },
    ],
    ...overrides,
  };
}

const LOCATIONS: ApiToolParameterLocationMap = { path: ["id"], query: ["q"], hasBody: false };

describe("buildApiRequest — path binding", () => {
  it("substitutes a path parameter into the fixed template", () => {
    const source = makeSource();
    const descriptor = makeDescriptor();
    const { url, init } = buildApiRequest(source, descriptor, LOCATIONS, { id: "ORD-1001" });
    expect(url).toBe("http://localhost:28780/api/orders/ORD-1001");
    expect(init.method).toBe("GET");
  });

  it("percent-encodes path values", () => {
    const source = makeSource();
    const descriptor = makeDescriptor();
    const { url } = buildApiRequest(source, descriptor, LOCATIONS, { id: "a b/c" });
    expect(url.endsWith("/api/orders/a%20b%2Fc")).toBe(true);
  });

  it("cannot escape the fixed path with a traversal value", () => {
    const source = makeSource();
    const descriptor = makeDescriptor();
    const { url } = buildApiRequest(source, descriptor, LOCATIONS, { id: "../../etc/passwd" });
    expect(url.startsWith("http://localhost:28780/api/orders/")).toBe(true);
    expect(url.includes("/../")).toBe(false);
    expect(url.includes("..%2F..%2Fetc%2Fpasswd")).toBe(true);
  });

  it("cannot escape the fixed path with a pre-encoded traversal value", () => {
    const source = makeSource();
    const descriptor = makeDescriptor();
    const { url } = buildApiRequest(source, descriptor, LOCATIONS, { id: "%2e%2e%2f%2e%2e%2fetc" });
    expect(url.startsWith("http://localhost:28780/api/orders/")).toBe(true);
    expect(url.includes("%252e%252e%252f")).toBe(true);
  });

  it("keeps a leading slash inside the segment", () => {
    const source = makeSource();
    const descriptor = makeDescriptor();
    const { url } = buildApiRequest(source, descriptor, LOCATIONS, { id: "/admin" });
    expect(url.endsWith("/api/orders/%2Fadmin")).toBe(true);
  });

  it("throws when a required path parameter is missing", () => {
    const source = makeSource();
    const descriptor = makeDescriptor();
    expect(() => buildApiRequest(source, descriptor, LOCATIONS, {})).toThrow(
      /missing required path parameter "id"/,
    );
  });

  it("throws when a path parameter is an empty string", () => {
    const source = makeSource();
    const descriptor = makeDescriptor();
    expect(() => buildApiRequest(source, descriptor, LOCATIONS, { id: "" })).toThrow(
      /empty path parameter "id"/,
    );
  });

  it("throws when the template has an unfilled placeholder", () => {
    const source = makeSource();
    const descriptor = makeDescriptor({ path: "/api/orders/{id}/{missing}" });
    expect(() => buildApiRequest(source, descriptor, LOCATIONS, { id: "1" })).toThrow(/\{missing\}/);
  });
});

describe("buildApiRequest — query, body, method, credentials", () => {
  it("encodes query values with URLSearchParams", () => {
    const source = makeSource();
    const descriptor = makeDescriptor();
    const { url } = buildApiRequest(source, descriptor, LOCATIONS, { id: "ORD-1001", q: "a b&c=d" });
    expect(url.endsWith("?q=a+b%26c%3Dd")).toBe(true);
  });

  it("omits an absent optional query parameter", () => {
    const source = makeSource();
    const descriptor = makeDescriptor();
    const { url } = buildApiRequest(source, descriptor, LOCATIONS, { id: "ORD-1001" });
    expect(url.includes("?")).toBe(false);
  });

  it("omits a null query parameter", () => {
    const source = makeSource();
    const descriptor = makeDescriptor();
    const { url } = buildApiRequest(source, descriptor, LOCATIONS, { id: "ORD-1001", q: null });
    expect(url.includes("?")).toBe(false);
  });

  it("repeats an array query parameter", () => {
    const source = makeSource();
    const descriptor = makeDescriptor({
      parameters: [
        { name: "id", in: "path", required: true, schema: { type: "string" } },
        { name: "tags", in: "query", required: false, schema: { type: "array" } },
      ],
    });
    const locations: ApiToolParameterLocationMap = { path: ["id"], query: ["tags"], hasBody: false };
    const { url } = buildApiRequest(source, descriptor, locations, { id: "ORD-1001", tags: ["a", "b"] });
    expect(url.endsWith("?tags=a&tags=b")).toBe(true);
  });

  it("sends a JSON body with a Content-Type header", () => {
    const source = makeSource();
    const descriptor = makeDescriptor({ method: "post", path: "/api/orders" });
    const locations: ApiToolParameterLocationMap = { path: [], query: [], hasBody: true };
    const { init } = buildApiRequest(source, descriptor, locations, { body: { customer: "Ada" } });
    expect(init.body).toBe('{"customer":"Ada"}');
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("omits an absent optional body", () => {
    const source = makeSource();
    const descriptor = makeDescriptor({ method: "post", path: "/api/orders" });
    const locations: ApiToolParameterLocationMap = { path: [], query: [], hasBody: true };
    const { init } = buildApiRequest(source, descriptor, locations, {});
    expect(init.body).toBeUndefined();
    expect(init.headers).toBeUndefined();
  });

  it("passes the source credentials mode through", () => {
    const source = makeSource({ credentials: "include" });
    const descriptor = makeDescriptor();
    const { init } = buildApiRequest(source, descriptor, LOCATIONS, { id: "ORD-1001" });
    expect(init.credentials).toBe("include");
  });

  it("uses the method fixed by the spec and ignores an input method key", () => {
    const source = makeSource();
    const descriptor = makeDescriptor({ method: "post", path: "/api/orders" });
    const locations: ApiToolParameterLocationMap = { path: [], query: [], hasBody: false };
    const { init } = buildApiRequest(source, descriptor, locations, { method: "delete" });
    expect(init.method).toBe("POST");
  });
});

describe("createApiOperationExecutor — response handling", () => {
  it("returns compacted JSON for a JSON response", async () => {
    const fakeFetch = vi.fn().mockResolvedValue(
      new Response('{\n  "id": 1\n}', {
        headers: { "content-type": "application/json" },
      }),
    );
    const source = makeSource({ fetch: fakeFetch });
    const descriptor = makeDescriptor();
    const execute = createApiOperationExecutor(source, descriptor, LOCATIONS);

    const outcome = await execute({ id: "ORD-1001" }, CTX);
    expect(outcome.content).toBe('{"id":1}');
    expect(outcome.isError).toBeFalsy();
  });

  it("returns raw text for a non-JSON response", async () => {
    const fakeFetch = vi.fn().mockResolvedValue(
      new Response("plain body", {
        headers: { "content-type": "text/plain" },
      }),
    );
    const source = makeSource({ fetch: fakeFetch });
    const descriptor = makeDescriptor();
    const execute = createApiOperationExecutor(source, descriptor, LOCATIONS);

    const outcome = await execute({ id: "ORD-1001" }, CTX);
    expect(outcome.content).toBe("plain body");
    expect(outcome.isError).toBeFalsy();
  });

  it("returns the raw body when a JSON content type does not parse", async () => {
    const fakeFetch = vi.fn().mockResolvedValue(
      new Response("not json", {
        headers: { "content-type": "application/json" },
      }),
    );
    const source = makeSource({ fetch: fakeFetch });
    const descriptor = makeDescriptor();
    const execute = createApiOperationExecutor(source, descriptor, LOCATIONS);

    const outcome = await execute({ id: "ORD-1001" }, CTX);
    expect(outcome.content).toBe("not json");
    expect(outcome.isError).toBeFalsy();
  });

  it("parses a +json content type", async () => {
    const fakeFetch = vi.fn().mockResolvedValue(
      new Response('{"data":{"id":"1"}}', {
        headers: { "content-type": "application/vnd.api+json" },
      }),
    );
    const source = makeSource({ fetch: fakeFetch });
    const descriptor = makeDescriptor();
    const execute = createApiOperationExecutor(source, descriptor, LOCATIONS);

    const outcome = await execute({ id: "ORD-1001" }, CTX);
    expect(outcome.content).toBe('{"data":{"id":"1"}}');
    expect(outcome.isError).toBeFalsy();
  });

  it("parses a +json content type that carries a charset suffix", async () => {
    const fakeFetch = vi.fn().mockResolvedValue(
      new Response('{\n  "data" : {"id":"1"}\n}', {
        headers: { "content-type": "application/hal+json; charset=utf-8" },
      }),
    );
    const source = makeSource({ fetch: fakeFetch });
    const descriptor = makeDescriptor();
    const execute = createApiOperationExecutor(source, descriptor, LOCATIONS);

    const outcome = await execute({ id: "ORD-1001" }, CTX);
    expect(outcome.content).toBe('{"data":{"id":"1"}}');
    expect(outcome.isError).toBeFalsy();
  });

  it("truncates a body past maxResponseChars and says so", async () => {
    const rawBody = "x".repeat(200);
    const fakeFetch = vi.fn().mockResolvedValue(
      new Response(rawBody, {
        headers: { "content-type": "text/plain" },
      }),
    );
    const source = makeSource({ fetch: fakeFetch, maxResponseChars: 50 });
    const descriptor = makeDescriptor();
    const execute = createApiOperationExecutor(source, descriptor, LOCATIONS);

    const outcome = await execute({ id: "ORD-1001" }, CTX);
    expect(outcome.content.startsWith("x".repeat(50))).toBe(true);
    expect(outcome.content.includes("… TRUNCATED (char cap 50; full body was 200 characters).")).toBe(
      true,
    );
  });

  it("does not mark a body under the cap", async () => {
    const fakeFetch = vi.fn().mockResolvedValue(
      new Response("short", {
        headers: { "content-type": "text/plain" },
      }),
    );
    const source = makeSource({ fetch: fakeFetch, maxResponseChars: 50 });
    const descriptor = makeDescriptor();
    const execute = createApiOperationExecutor(source, descriptor, LOCATIONS);

    const outcome = await execute({ id: "ORD-1001" }, CTX);
    expect(outcome.content.includes("TRUNCATED")).toBe(false);
  });

  it("reports an empty 2xx body instead of an empty string", async () => {
    const fakeFetch = vi.fn().mockResolvedValue(
      new Response("", {
        status: 200,
        statusText: "OK",
      }),
    );
    const source = makeSource({ fetch: fakeFetch });
    const descriptor = makeDescriptor();
    const execute = createApiOperationExecutor(source, descriptor, LOCATIONS);

    const outcome = await execute({ id: "ORD-1001" }, CTX);
    expect(outcome.content).toBe("HTTP 200 OK (empty response body)");
    expect(outcome.isError).toBeFalsy();
  });

  it("surfaces a non-2xx status, status text and body as an error", async () => {
    const fakeFetch = vi.fn().mockResolvedValue(
      new Response('{"error":"nope"}', {
        status: 404,
        statusText: "Not Found",
        headers: { "content-type": "application/json" },
      }),
    );
    const source = makeSource({ fetch: fakeFetch });
    const descriptor = makeDescriptor();
    const execute = createApiOperationExecutor(source, descriptor, LOCATIONS);

    const outcome = await execute({ id: "ORD-1001" }, CTX);
    expect(outcome.isError).toBe(true);
    expect(outcome.content).toBe('HTTP 404 Not Found\n{"error":"nope"}');
  });

  it("omits the status text when the response has none", async () => {
    const fakeFetch = vi.fn().mockResolvedValue(
      new Response("error body", {
        status: 500,
        statusText: "",
        headers: { "content-type": "text/plain" },
      }),
    );
    const source = makeSource({ fetch: fakeFetch });
    const descriptor = makeDescriptor();
    const execute = createApiOperationExecutor(source, descriptor, LOCATIONS);

    const outcome = await execute({ id: "ORD-1001" }, CTX);
    expect(outcome.isError).toBe(true);
    expect(outcome.content.startsWith("HTTP 500\n")).toBe(true);
  });

  it("truncates a non-2xx body too", async () => {
    const rawBody = "e".repeat(100);
    const fakeFetch = vi.fn().mockResolvedValue(
      new Response(rawBody, {
        status: 500,
        statusText: "Internal Server Error",
        headers: { "content-type": "text/plain" },
      }),
    );
    const source = makeSource({ fetch: fakeFetch, maxResponseChars: 20 });
    const descriptor = makeDescriptor();
    const execute = createApiOperationExecutor(source, descriptor, LOCATIONS);

    const outcome = await execute({ id: "ORD-1001" }, CTX);
    expect(outcome.isError).toBe(true);
    expect(outcome.content.startsWith("HTTP 500 Internal Server Error\n" + "e".repeat(20))).toBe(
      true,
    );
    expect(outcome.content.includes("… TRUNCATED (char cap 20; full body was 100 characters).")).toBe(
      true,
    );
  });

  it("surfaces a fetch rejection as an error outcome", async () => {
    const fakeFetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const source = makeSource({ fetch: fakeFetch });
    const descriptor = makeDescriptor();
    const execute = createApiOperationExecutor(source, descriptor, LOCATIONS);

    const outcome = await execute({ id: "ORD-1001" }, CTX);
    expect(outcome.isError).toBe(true);
    expect(outcome.content).toBe(
      "Request failed: GET http://localhost:28780/api/orders/ORD-1001: Failed to fetch",
    );
  });

  it("returns an error outcome without calling fetch when binding fails", async () => {
    const fakeFetch = vi.fn();
    const source = makeSource({ fetch: fakeFetch });
    const descriptor = makeDescriptor();
    const execute = createApiOperationExecutor(source, descriptor, LOCATIONS);

    const outcome = await execute({}, CTX);
    expect(outcome.isError).toBe(true);
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it("passes the turn abort signal to fetch", async () => {
    const fakeFetch = vi.fn().mockResolvedValue(new Response("ok"));
    const source = makeSource({ fetch: fakeFetch });
    const descriptor = makeDescriptor();
    const execute = createApiOperationExecutor(source, descriptor, LOCATIONS);

    const controller = new AbortController();
    const customCtx = { signal: controller.signal } as unknown as ToolContext;
    await execute({ id: "ORD-1001" }, customCtx);

    expect(fakeFetch).toHaveBeenCalledWith(
      "http://localhost:28780/api/orders/ORD-1001",
      expect.objectContaining({ signal: controller.signal }),
    );
  });
});

describe("buildApiTool", () => {
  it("returns a tool whose execute performs the request", async () => {
    const fakeFetch = vi.fn().mockResolvedValue(
      new Response('{"ok":true}', {
        headers: { "content-type": "application/json" },
      }),
    );
    const source = makeSource({ fetch: fakeFetch });
    const descriptor = makeDescriptor();
    const apiTool = buildApiTool(source, descriptor);

    expect(apiTool.toolDef.execute).toBeDefined();
    const outcome = await apiTool.toolDef.execute({ id: "ORD-1001" }, CTX);
    expect(outcome.content).toBe('{"ok":true}');
    expect(outcome.content).not.toBe("API operation execution not implemented.");
  });

  it("keeps the definition produced by operationToToolDef", () => {
    const source = makeSource();
    const descriptor = makeDescriptor();
    const apiTool = buildApiTool(source, descriptor);

    expect(apiTool.toolDef.name).toBe("cat_store_getOrder");
    expect(apiTool.paramLocations).toEqual({ path: ["id"], query: ["q"], hasBody: false });
    expect(apiTool.descriptor).toBe(descriptor);
  });

  it("preserves operationToToolDef defaultExecute for un-composed calls", async () => {
    const source = makeSource();
    const descriptor = makeDescriptor();
    const rawDef = operationToToolDef(source, descriptor);

    expect(rawDef.toolDef.execute).toBeDefined();
    const outcome = await rawDef.toolDef.execute({ id: "ORD-1001" }, CTX);
    expect(outcome.content).toBe("API operation execution not implemented.");
  });
});
