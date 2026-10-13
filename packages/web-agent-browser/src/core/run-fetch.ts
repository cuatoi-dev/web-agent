import { errorMessage } from "../lib/error-message";
import { thrownName, truncate } from "./run-eval";
import type { PageFetchArgs, PageFetchResult, RunPageFetchOptions } from "./types";

export type { PageFetchArgs, PageFetchMethod, PageFetchResult, RunPageFetchOptions } from "./types";

/**
 * Execute an HTTP request in the current page realm using the browser session.
 * Transport-free: does not know about chrome.* or window.postMessage.
 * Returns structured result shape.
 */
export async function runPageFetch(
  args: PageFetchArgs,
  options: RunPageFetchOptions = {},
): Promise<PageFetchResult> {
  const fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis);
  const origin =
    options.currentOrigin ??
    (typeof location !== "undefined" && location.origin ? location.origin : "http://localhost");

  const rawUrl = typeof args.url === "string" ? args.url.trim() : "";
  if (!rawUrl) {
    return { kind: "invalid-url", url: "", message: "No URL or path provided to page_fetch." };
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(rawUrl, origin);
  } catch (e) {
    return {
      kind: "invalid-url",
      url: rawUrl,
      message: `Invalid URL "${rawUrl}": ${errorMessage(e)}`,
    };
  }

  if (targetUrl.origin !== origin) {
    return {
      kind: "cross-origin",
      requested: targetUrl.origin,
      pageOrigin: origin,
    };
  }

  try {
    const res = await fetchFn(targetUrl.href, {
      method: typeof args.method === "string" && args.method ? args.method : "GET",
      headers: args.headers,
      body: args.body,
      credentials: "same-origin",
    });

    const contentType = res.headers.get("content-type") || "(unknown)";
    const rawBody = await res.text();
    const maxChars = options.maxChars;
    const body = maxChars !== undefined && rawBody.length > maxChars ? truncate(rawBody, maxChars) : rawBody;

    return {
      kind: "response",
      status: res.status,
      statusText: res.statusText || "",
      contentType,
      body,
    };
  } catch (err) {
    return {
      kind: "throw",
      name: thrownName(err),
      message: errorMessage(err),
      url: targetUrl.href,
    };
  }
}
