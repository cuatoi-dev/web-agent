import type { CustomToolDef } from "@cuatoi/web-agent-core";

/**
 * Configuration for a single declarative OpenAPI backend source.
 *
 * `credentials` is required with no default ("omit" | "same-origin" | "include"),
 * forcing the host to explicitly declare credential handling intent.
 *
 * This package performs no authentication. `securitySchemes`/`security` in the OpenAPI
 * document are ignored; `fetch` is a host-owned request-customization hook, not
 * an auth mechanism.
 */
export interface ApiSourceConfig {
  /** Short id; also used as tool-name prefix after sanitization ("cat-store" -> "cat_store_"). */
  name: string;
  /** Describes what this API source provides; becomes the promptSnippet. */
  description: string;
  /** OpenAPI 3.x document URL. Absolute, or relative to `baseUrl` (default `window.location.href`). */
  specUrl: string;
  /** Whitelist of operationIds to generate concrete tools for. */
  operations: string[];
  /** Credentials mode for fetch requests. Required, no default. */
  credentials: "omit" | "same-origin" | "include";
  /** true -> any failure to load this source is a hard startup error; false -> log a warning and skip it. */
  required: boolean;
  /** Optional custom fetch override for spec fetching and operation requests. */
  fetch?: typeof fetch;
  /** Optional per-source response character cap. Defaults to `DEFAULT_MAX_RESPONSE_CHARS`. */
  maxResponseChars?: number;
}

/** Parameter locations this package supports. Header and cookie are rejected at parse time. */
export type ApiParameterLocation = "path" | "query";

/** HTTP methods recognised as operation keys inside an OpenAPI path item. */
export type ApiHttpMethod =
  | "get"
  | "put"
  | "post"
  | "delete"
  | "options"
  | "head"
  | "patch"
  | "trace";

/** One `path` or `query` parameter of an operation, as declared by the spec. */
export interface ApiOperationParameter {
  name: string;
  in: ApiParameterLocation;
  /** The spec's `required` flag, as written. */
  required: boolean;
  /** The dereferenced JSON Schema for this parameter. `{}` when the spec omits it. */
  schema: Record<string, unknown>;
  description?: string;
}

/** The operation's `application/json` request body, when it declares one. */
export interface ApiOperationRequestBody {
  required: boolean;
  /** The dereferenced JSON Schema of the `application/json` media type. */
  schema: Record<string, unknown>;
}

/**
 * One whitelisted operation, with method and path fixed by the spec.
 * The agent never supplies or sees `method` or `path` — only parameter values.
 */
export interface ApiOperationDescriptor {
  operationId: string;
  method: ApiHttpMethod;
  /** Path template exactly as written in the spec, e.g. "/cats/{id}". */
  path: string;
  summary?: string;
  description?: string;
  parameters: ApiOperationParameter[];
  requestBody?: ApiOperationRequestBody;
}

/** Metadata mapping property names in inputSchema to their OpenAPI location (path, query, body). */
export interface ApiToolParameterLocationMap {
  path: string[];
  query: string[];
  hasBody: boolean;
}

/** Container holding the CustomToolDef for the agent plus descriptor and parameter location metadata. */
export interface ApiToolDef {
  toolDef: CustomToolDef;
  source: ApiSourceConfig;
  descriptor: ApiOperationDescriptor;
  paramLocations: ApiToolParameterLocationMap;
}

/** Options shared by every request this package makes — spec fetch and operation call alike. */
export interface ApiRequestOptions {
  /** Base URL the source's specUrl resolves against. Defaults to window.location.href. */
  baseUrl?: string;
}

/** One API source that failed to load, paired with the error that stopped it. */
export interface ApiSourceFailure {
  source: ApiSourceConfig;
  error: unknown;
}

/** The result of loading every configured API source. */
export interface ConnectApiSourcesResult {
  /** Tools from every source that loaded, in configured source order. */
  tools: CustomToolDef[];
  /** Every source that failed (optional ones only — a required failure throws). */
  failures: ApiSourceFailure[];
}
// NOTE: deliberately no `sessions` field — an API source holds no persistent
// connection, so there is nothing for the caller to close on dispose.

/** One operation found in the document, with the path-item context it inherits. */
export interface IndexedOperation {
  method: ApiHttpMethod;
  path: string;
  operation: Record<string, unknown>;
  /** Path-item-level `parameters`, which apply to every operation under that path. */
  pathItemParameters: unknown[];
}

/** A plain JSON object node inside an OpenAPI document. */
export type JsonRecord = Record<string, unknown>;
