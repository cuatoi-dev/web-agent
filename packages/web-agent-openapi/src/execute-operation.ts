import type { ToolContext, ToolOutcome } from "@cuatoi/web-agent-core";
import { resolveApiFetch, resolveApiSourceUrl } from "./fetch-seam.js";
import { operationToToolDef } from "./operation-to-tool-def.js";
import type {
  ApiOperationDescriptor,
  ApiRequestOptions,
  ApiSourceConfig,
  ApiToolDef,
  ApiToolParameterLocationMap,
} from "./types.js";

export type { ApiRequestOptions };

/**
 * Default response character cap, matching DomAdapter.snapshotMaxChars so an API
 * response can never cost more context than a page snapshot.
 */
export const DEFAULT_MAX_RESPONSE_CHARS = 12_000;

const JSON_CONTENT_TYPE = "application/json";

/** Stringify one agent-supplied parameter value for a URL path segment or query value. */
function toParamString(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value) ?? "";
}

/**
 * Bind validated arguments into the host-fixed URL and request init.
 * Throws on a path binding failure; the caller turns that into an error outcome.
 * ctx-free on purpose so it is directly unit-testable.
 */
export function buildApiRequest(
  source: ApiSourceConfig,
  descriptor: ApiOperationDescriptor,
  paramLocations: ApiToolParameterLocationMap,
  input: Record<string, unknown>,
  options?: ApiRequestOptions,
): { url: string; init: RequestInit } {
  // --- path: encodeURIComponent on every value, never raw interpolation ---
  let boundPath = descriptor.path;
  for (const name of paramLocations.path) {
    const raw = input[name];
    if (raw === undefined || raw === null) {
      throw new Error(
        `API operation "${descriptor.operationId}" is missing required path parameter "${name}".`,
      );
    }
    const asString = toParamString(raw);
    if (asString === "") {
      throw new Error(
        `API operation "${descriptor.operationId}" received an empty path parameter "${name}". An empty segment would change the fixed path.`,
      );
    }
    boundPath = boundPath.split(`{${name}}`).join(encodeURIComponent(asString));
  }
  const leftover = /\{[^}]*\}/.exec(boundPath);
  if (leftover) {
    throw new Error(
      `API operation "${descriptor.operationId}" path template "${descriptor.path}" has placeholder "${leftover[0]}" with no matching parameter.`,
    );
  }

  // --- query: URLSearchParams does the encoding; absent values are omitted ---
  const params = new URLSearchParams();
  for (const name of paramLocations.query) {
    const raw = input[name];
    if (raw === undefined || raw === null) continue;
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (item === undefined || item === null) continue;
        params.append(name, toParamString(item));
      }
      continue;
    }
    params.append(name, toParamString(raw));
  }

  const base = resolveApiSourceUrl(source.specUrl, options?.baseUrl);
  const resolved = new URL(boundPath, base);
  const query = params.toString();
  // Concatenated, not `resolved.search = query`, so the URL parser cannot re-encode
  // what URLSearchParams already encoded. boundPath cannot contain a raw "?" —
  // encodeURIComponent escapes it to %3F.
  const url = query ? `${resolved.href}?${query}` : resolved.href;

  const init: RequestInit = {
    method: descriptor.method.toUpperCase(),
    credentials: source.credentials,
  };
  if (paramLocations.hasBody && input.body !== undefined) {
    init.body = JSON.stringify(input.body);
    init.headers = { "Content-Type": JSON_CONTENT_TYPE };
  }

  return { url, init };
}

function capBody(body: string, maxChars: number): string {
  if (body.length <= maxChars) return body;
  return (
    body.slice(0, maxChars) +
    `\n… TRUNCATED (char cap ${maxChars}; full body was ${body.length} characters).`
  );
}

function statusLine(res: Response): string {
  return res.statusText ? `HTTP ${res.status} ${res.statusText}` : `HTTP ${res.status}`;
}

/** Build the execute handler for one whitelisted operation. */
export function createApiOperationExecutor(
  source: ApiSourceConfig,
  descriptor: ApiOperationDescriptor,
  paramLocations: ApiToolParameterLocationMap,
  options?: ApiRequestOptions,
): (input: Record<string, unknown>, ctx: ToolContext) => Promise<ToolOutcome> {
  const maxChars = source.maxResponseChars ?? DEFAULT_MAX_RESPONSE_CHARS;

  return async (input, ctx) => {
    let request: { url: string; init: RequestInit };
    try {
      request = buildApiRequest(source, descriptor, paramLocations, input, options);
    } catch (err: unknown) {
      return { content: err instanceof Error ? err.message : String(err), isError: true };
    }

    const fetchFn = resolveApiFetch(source);
    let res: Response;
    try {
      res = await fetchFn(request.url, { ...request.init, signal: ctx.signal });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        content: `Request failed: ${String(request.init.method)} ${request.url}: ${msg}`,
        isError: true,
      };
    }

    const raw = await res.text();
    const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
    const looksJson = contentType.includes(JSON_CONTENT_TYPE) || contentType.includes("+json");
    let body = raw;
    if (looksJson && raw !== "") {
      try {
        body = JSON.stringify(JSON.parse(raw));
      } catch {
        body = raw; // malformed JSON: hand the agent the real body, do not hide it
      }
    }

    const capped = capBody(body, maxChars);

    if (!res.ok) {
      return {
        content: capped === "" ? `${statusLine(res)} (empty response body)` : `${statusLine(res)}\n${capped}`,
        isError: true,
      };
    }
    return { content: capped === "" ? `${statusLine(res)} (empty response body)` : capped };
  };
}

/**
 * Compose the tool definition from `operationToToolDef` with the live executor from
 * `createApiOperationExecutor`. `loadApiSource` calls this for each whitelisted operation.
 */
export function buildApiTool(
  source: ApiSourceConfig,
  descriptor: ApiOperationDescriptor,
  options?: ApiRequestOptions,
): ApiToolDef {
  const def = operationToToolDef(source, descriptor);
  const execute = createApiOperationExecutor(source, descriptor, def.paramLocations, options);
  return { ...def, toolDef: { ...def.toolDef, execute } };
}
