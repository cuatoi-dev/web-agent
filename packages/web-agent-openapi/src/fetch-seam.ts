import type { ApiSourceConfig } from "./types.js";
import { resolveRelativeUrl } from "@cuatoi/web-agent-core";

/** Resolve relative or absolute OpenAPI spec URL against base URL or window.location. */
export function resolveApiSourceUrl(url: string, baseUrl?: string): string {
  return resolveRelativeUrl(url, baseUrl);
}

/** Resolve host-supplied fetch or default global fetch bound to context. */
export function resolveApiFetch(source: ApiSourceConfig): typeof fetch {
  if (source.fetch) {
    return source.fetch;
  }
  if (typeof window !== "undefined" && typeof window.fetch === "function") {
    return window.fetch.bind(window);
  }
  return globalThis.fetch.bind(globalThis);
}

/**
 * Fetch an OpenAPI spec JSON document for a given API source.
 * Throws descriptive errors with source name and spec URL on a network error, non-2xx or invalid JSON.
 */
export async function fetchOpenApiDocument(
  source: ApiSourceConfig,
  options?: { baseUrl?: string },
): Promise<Record<string, unknown>> {
  const resolvedUrl = resolveApiSourceUrl(source.specUrl, options?.baseUrl);
  const fetchFn = resolveApiFetch(source);

  let res: Response;
  try {
    res = await fetchFn(resolvedUrl, { credentials: source.credentials });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to fetch OpenAPI document for API source "${source.name}" from "${resolvedUrl}": ${msg}`,
      { cause: err },
    );
  }

  if (!res.ok) {
    throw new Error(
      `Failed to fetch OpenAPI document for API source "${source.name}" from "${resolvedUrl}": HTTP ${res.status} ${res.statusText}`,
    );
  }

  try {
    const json = (await res.json()) as Record<string, unknown>;
    return json;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to parse OpenAPI document JSON for API source "${source.name}" from "${resolvedUrl}": ${msg}`,
      { cause: err },
    );
  }
}
