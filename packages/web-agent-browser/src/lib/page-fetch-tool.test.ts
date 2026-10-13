import { describe, it, expect, vi } from "vitest";
import type { ToolContext } from "@cuatoi/web-agent-core";
import { createPageFetchTool, pageFetchTools } from "./page-fetch-tool";

/** The minimum ToolContext the tools under test read. `app` and `signal` are
 *  the interface's only required fields (web-agent-core tool-hooks.types.ts);
 *  none of these tools touches the optional ones. */
function toolCtx(): ToolContext {
  return { app: {}, signal: new AbortController().signal };
}

describe("createPageFetchTool", () => {
  const currentOrigin = "http://localhost:10040";

  it("resolves relative URL paths against currentOrigin and passes credentials: same-origin", async () => {
    let calledUrl = "";
    let calledOptions: RequestInit | undefined;
    const fakeFetch = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      if (typeof url === "string") calledUrl = url;
      calledOptions = init;
      return Promise.resolve(new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        statusText: "OK",
        headers: { "Content-Type": "application/json" },
      }));
    });

    const tool = createPageFetchTool({ currentOrigin, fetch: fakeFetch });
    const result = await tool.execute({ url: "/api/inventory" }, toolCtx());

    expect(fakeFetch).toHaveBeenCalledOnce();
    expect(calledUrl).toBe("http://localhost:10040/api/inventory");
    expect(calledOptions?.credentials).toBe("same-origin");
    expect(calledOptions?.method).toBe("GET");
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain("Status: 200 OK");
    expect(result.content).toContain("Content-Type: application/json");
    expect(result.content).toContain('{"status":"ok"}');
  });

  it("allows absolute same-origin URLs", async () => {
    const fakeFetch = vi.fn(() => {
      return Promise.resolve(new Response("item data", { status: 200, headers: { "Content-Type": "text/plain" } }));
    });

    const tool = createPageFetchTool({ currentOrigin, fetch: fakeFetch });
    const result = await tool.execute({ url: "http://localhost:10040/api/items" }, toolCtx());

    expect(fakeFetch).toHaveBeenCalledOnce();
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain("Status: 200");
    expect(result.content).toContain("item data");
  });

  it("blocks cross-origin URLs with descriptive error naming both origins and does not call fetch", async () => {
    const fakeFetch = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>();
    const tool = createPageFetchTool({ currentOrigin, fetch: fakeFetch });

    const result = await tool.execute({ url: "https://example.com/api/test" }, toolCtx());

    expect(fakeFetch).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.content).toContain('Cross-origin request blocked: requested origin "https://example.com" does not match page origin "http://localhost:10040".');
    expect(result.content).toContain("The page_fetch tool only allows same-origin requests.");
  });

  it("blocks different port as cross-origin", async () => {
    const fakeFetch = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>();
    const tool = createPageFetchTool({ currentOrigin, fetch: fakeFetch });

    const result = await tool.execute({ url: "http://localhost:20000/api" }, toolCtx());

    expect(fakeFetch).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.content).toContain('requested origin "http://localhost:20000" does not match page origin "http://localhost:10040"');
  });

  it("passes method, headers, and body to fetch", async () => {
    let calledOptions: RequestInit | undefined;
    const fakeFetch = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      calledOptions = init;
      return Promise.resolve(new Response(JSON.stringify({ echo: init?.body }), {
        status: 201,
        statusText: "Created",
        headers: { "Content-Type": "application/json" },
      }));
    });

    const tool = createPageFetchTool({ currentOrigin, fetch: fakeFetch });
    const result = await tool.execute(
      {
        url: "/api/create",
        method: "POST",
        headers: { "X-Custom": "header-val", "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Widget" }),
      },
      toolCtx(),
    );

    expect(fakeFetch).toHaveBeenCalledOnce();
    expect(calledOptions?.method).toBe("POST");
    expect(calledOptions?.headers).toEqual({ "X-Custom": "header-val", "Content-Type": "application/json" });
    expect(calledOptions?.body).toBe(JSON.stringify({ name: "Widget" }));
    expect(result.content).toContain("Status: 201 Created");
    expect(result.content).toContain('{"echo":"{\\"name\\":\\"Widget\\"}"}');
  });

  it("returns formatted status and body for HTTP 404/500 with isError: false / falsy", async () => {
    const fakeFetch = vi.fn(() => {
      return Promise.resolve(new Response(JSON.stringify({ error: "Not Found" }), {
        status: 404,
        statusText: "Not Found",
        headers: { "Content-Type": "application/json" },
      }));
    });

    const tool = createPageFetchTool({ currentOrigin, fetch: fakeFetch });
    const result = await tool.execute({ url: "/api/missing" }, toolCtx());

    expect(result.isError).toBeFalsy();
    expect(result.content).toContain("Status: 404 Not Found");
    expect(result.content).toContain('{"error":"Not Found"}');
  });

  it("truncates body exceeding maxChars with visible marker", async () => {
    const longString = "X".repeat(100);
    const fakeFetch = vi.fn(() => {
      return Promise.resolve(new Response(longString, {
        status: 200,
        statusText: "OK",
        headers: { "Content-Type": "text/plain" },
      }));
    });

    const tool = createPageFetchTool({ currentOrigin, fetch: fakeFetch, maxChars: 50 });
    const result = await tool.execute({ url: "/api/large" }, toolCtx());

    expect(result.content).toContain("…(output truncated)");
    // The truncated body slice is 50 - 22 = 28 characters
    expect(result.content).toContain("X".repeat(28) + "\n…(output truncated)");
    expect(result.content).not.toContain("X".repeat(35));
  });

  it("catches network/fetch exceptions and returns isError: true", async () => {
    const fakeFetch = vi.fn(() => {
      throw new Error("Failed to fetch / Connection refused");
    });

    const tool = createPageFetchTool({ currentOrigin, fetch: fakeFetch });
    const result = await tool.execute({ url: "/api/down" }, toolCtx());

    expect(result.isError).toBe(true);
    expect(result.content).toContain('Network error while fetching "http://localhost:10040/api/down": Failed to fetch / Connection refused');
  });

  it("handles empty or invalid URLs with isError: true", async () => {
    const fakeFetch = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>();
    const tool = createPageFetchTool({ currentOrigin, fetch: fakeFetch });

    const emptyResult = await tool.execute({ url: "" }, toolCtx());
    expect(emptyResult.isError).toBe(true);
    expect(emptyResult.content).toContain("No URL or path provided");

    const nullResult = await tool.execute({}, toolCtx());
    expect(nullResult.isError).toBe(true);
    expect(nullResult.content).toContain("No URL or path provided");
  });

  it("summarizes input accurately", () => {
    const tool = createPageFetchTool({ currentOrigin });
    expect(tool.summarize?.({ method: "POST", url: "/api/save" }, toolCtx())).toBe("POST /api/save");
    expect(tool.summarize?.({ url: "/api/get" }, toolCtx())).toBe("GET /api/get");
    expect(tool.summarize?.({}, toolCtx())).toBe("GET");
  });
});

describe("pageFetchTools", () => {
  it("returns ToolProvider that loads createPageFetchTool", async () => {
    const providers = pageFetchTools();
    expect(providers).toHaveLength(1);
    expect(providers[0].name).toBe("page-fetch-tools");
    expect(providers[0].required).toBe(false);

    const tools = await providers[0].load();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("page_fetch");
  });
});
