// The gateway accepts only each route's own auth header, so a
// request to an LLM route carries the key in that header. Any other path
// (orders, MCP, genui) is sent unchanged.

/** The auth header name and value for `url`, or null when `url` is not a
 *  gateway LLM route on this page's origin. */
export function gatewayAuthHeader(url: string | URL, key: string): [string, string] | null {
  let parsed: URL;
  try {
    const base = typeof location !== "undefined" && location.href ? location.href : "http://localhost";
    parsed = new URL(url, base);
  } catch {
    return null;
  }
  const pageOrigin = typeof location !== "undefined" && location.origin
    ? location.origin
    : (typeof location !== "undefined" && location.href ? new URL(location.href).origin : "http://localhost");
  if (parsed.origin !== pageOrigin) return null;
  if (parsed.pathname.startsWith("/api/openai/")) return ["Authorization", `Bearer ${key}`];
  if (parsed.pathname.startsWith("/api/anthropic/")) return ["x-api-key", key];
  if (parsed.pathname.startsWith("/api/gemini/")) return ["x-goog-api-key", key];
  return null;
}

/** Wraps `impl` so each gateway LLM request carries its route's auth header,
 *  unless the caller already set that header (in any letter case). */
export function withGatewayAuth(impl: typeof fetch, key: string): typeof fetch {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const auth = gatewayAuthHeader(url, key);
    if (!auth) return impl(input, init);

    let headers: Headers;
    if (init?.headers !== undefined) {
      headers = new Headers(init.headers);
    } else if (typeof input === "object" && "headers" in input && input.headers) {
      headers = new Headers(input.headers);
    } else {
      headers = new Headers();
    }

    if (!headers.has(auth[0])) {
      headers.set(auth[0], auth[1]);
    }
    return impl(input, { ...init, headers });
  };
}
