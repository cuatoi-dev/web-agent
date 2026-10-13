import { z } from "zod";
import type { CustomToolDef, ToolProvider } from "@cuatoi/web-agent-core";
import { DEFAULT_PAGE_FETCH_MAX_CHARS } from "./constants";
import { runPageFetch } from "../core/run-fetch";
import type { PageFetchToolsOptions } from "./types";

export type { PageFetchToolsOptions } from "./types";
export { runPageFetch } from "../core/run-fetch";

/** True when `value` is a plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function createPageFetchTool(options: PageFetchToolsOptions = {}): CustomToolDef {
  const fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
  const maxChars = options.maxChars ?? DEFAULT_PAGE_FETCH_MAX_CHARS;

  return {
    name: "page_fetch",
    description:
      "Perform an HTTP request to the current page's own origin using the browser session (cookies and credentials). Same-origin only: URLs or paths on other origins are rejected. Returns the HTTP status, content type, and response body.",
    inputSchema: z.object({
      url: z
        .string()
        .describe("The relative path (e.g. '/api/items') or same-origin URL (e.g. 'http://localhost:10040/api/items') to fetch."),
      method: z
        .enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])
        .optional()
        .default("GET")
        .describe("HTTP method to use. Defaults to GET."),
      headers: z
        .record(z.string())
        .optional()
        .describe("Optional HTTP headers as key-value pairs."),
      body: z
        .string()
        .optional()
        .describe("Optional request body string (e.g. JSON string)."),
    }),
    summarize: (input) => {
      const method = typeof input.method === "string" ? input.method : "GET";
      const url = typeof input.url === "string" ? input.url : "";
      return `${method} ${url}`.trim();
    },
    execute: async (input) => {
      const rawUrl = typeof input.url === "string" ? input.url.trim() : "";
      if (!rawUrl) {
        return { content: "No URL or path provided to page_fetch.", isError: true };
      }

      const method = typeof input.method === "string" ? input.method : "GET";
      const headers = isRecord(input.headers) ? (input.headers as Record<string, string>) : undefined;
      const body = typeof input.body === "string" ? input.body : undefined;

      const result = await runPageFetch(
        { url: rawUrl, method, headers, body },
        { currentOrigin: options.currentOrigin, fetch: fetchFn, maxChars },
      );

      if (result.kind === "invalid-url") {
        return { content: result.message, isError: true };
      }

      if (result.kind === "cross-origin") {
        return {
          content: `Cross-origin request blocked: requested origin "${result.requested}" does not match page origin "${result.pageOrigin}". The page_fetch tool only allows same-origin requests.`,
          isError: true,
        };
      }

      if (result.kind === "throw") {
        return {
          content: `Network error while fetching "${result.url ?? rawUrl}": ${result.message}`,
          isError: true,
        };
      }

      const statusLine = `Status: ${result.status} ${result.statusText || ""}`.trim();
      const output = `${statusLine}\nContent-Type: ${result.contentType}\n\n${result.body}`;
      return {
        content: output,
      };
    },
  };
}

export function pageFetchTools(options: PageFetchToolsOptions = {}): ToolProvider[] {
  return [
    {
      name: "page-fetch-tools",
      required: false,
      load: () => Promise.resolve([createPageFetchTool(options)]),
    },
  ];
}
