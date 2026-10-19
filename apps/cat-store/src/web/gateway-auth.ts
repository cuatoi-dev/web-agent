// 137/001 — the gateway accepts only each route's own auth header, so a
// request to an LLM route carries the key in that header. Any other path
// (orders, MCP, genui) is sent unchanged.

/** The auth header name and value for `url`, or null when `url` is not a
 *  gateway LLM route. */
export function gatewayAuthHeader(url: string, key: string): [string, string] | null {
  if (url.includes("/api/openai/")) return ["Authorization", `Bearer ${key}`];
  if (url.includes("/api/anthropic/")) return ["x-api-key", key];
  if (url.includes("/api/gemini/")) return ["x-goog-api-key", key];
  return null;
}

/** Wraps `impl` so each gateway LLM request carries its route's auth header,
 *  unless the caller already set that header. */
export function withGatewayAuth(impl: typeof fetch, key: string): typeof fetch {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const auth = gatewayAuthHeader(url, key);
    if (!auth) return impl(input, init);
    const headers = new Headers(init?.headers);
    if (!headers.has(auth[0])) headers.set(auth[0], auth[1]);
    return impl(input, { ...init, headers });
  };
}
