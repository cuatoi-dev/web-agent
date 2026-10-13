/**
 * OpenAPI 3.x document parsing: whitelist of operationIds -> operation descriptors.
 *
 * `$ref` resolution is done by `./resolve-local-refs.js`, a module inside this
 * package. There is no third-party parser: this package has one runtime
 * dependency, `@cuatoi/web-agent-core`.
 *
 * THE AIRGAP GUARANTEE IS STRUCTURAL. The resolver follows a `$ref` only when it
 * starts with `#`, and resolves it against the same in-memory document. It holds
 * no `fetch`, no `import()`, no file API and no URL handling, so an external
 * `https://` `$ref` cannot be followed — it is left untouched in the document
 * and rejected below by `findUnresolvedRef` if a whitelisted operation reaches
 * it. The "never fetches" test in `parse-openapi.test.ts` asserts
 * `globalThis.fetch` is called zero times; keep it.
 */
import type {
  ApiHttpMethod,
  ApiOperationDescriptor,
  ApiOperationParameter,
  ApiOperationRequestBody,
  ApiParameterLocation,
  ApiSourceConfig,
  IndexedOperation,
} from "./types.js";
import { resolveLocalRefs } from "./resolve-local-refs.js";

const HTTP_METHODS: readonly ApiHttpMethod[] = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
];

const SUPPORTED_LOCATIONS: readonly ApiParameterLocation[] = ["path", "query"];

const JSON_MEDIA_TYPE = "application/json";

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Find any residual `$ref` inside an already-dereferenced schema. Local refs are
 * materialized by the parser, so anything left is unresolved (external).
 * `seen` is required: a self-referential local `$ref` produces a real object cycle
 * (measured 2026-08-07 — JSON.stringify throws on it).
 */
function findUnresolvedRef(value: unknown, seen: Set<object>): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findUnresolvedRef(item, seen);
      if (found) return found;
    }
    return null;
  }
  const record = asRecord(value);
  if (!record) return null;
  if (seen.has(record)) return null;
  seen.add(record);
  const ref = asString(record["$ref"]);
  if (ref) return ref;
  for (const entry of Object.values(record)) {
    const found = findUnresolvedRef(entry, seen);
    if (found) return found;
  }
  return null;
}

function indexOperations(doc: Record<string, unknown>): Map<string, IndexedOperation> {
  const index = new Map<string, IndexedOperation>();
  const paths = asRecord(doc["paths"]);
  if (!paths) return index;
  for (const [path, rawPathItem] of Object.entries(paths)) {
    const pathItem = asRecord(rawPathItem);
    if (!pathItem) continue;
    const pathItemParameters = asArray(pathItem["parameters"]);
    for (const method of HTTP_METHODS) {
      const operation = asRecord(pathItem[method]);
      if (!operation) continue;
      const operationId = asString(operation["operationId"]);
      if (!operationId) continue;
      // First occurrence in document order wins; a duplicate id is not a rejection case.
      if (index.has(operationId)) continue;
      index.set(operationId, { method, path, operation, pathItemParameters });
    }
  }
  return index;
}

function effectiveParameters(indexed: IndexedOperation): unknown[] {
  const merged = new Map<string, unknown>();
  const keyOf = (raw: unknown): string | null => {
    const record = asRecord(raw);
    if (!record) return null;
    return `${asString(record["in"]) ?? ""} ${asString(record["name"]) ?? ""}`;
  };
  for (const raw of [...indexed.pathItemParameters, ...asArray(indexed.operation["parameters"])]) {
    const key = keyOf(raw);
    if (key) merged.set(key, raw); // operation-level entries overwrite path-item ones
  }
  return [...merged.values()];
}

/**
 * Resolve a source's `operations` whitelist against a fetched OpenAPI 3.x document.
 * Returns one descriptor per whitelisted operationId, in whitelist order.
 * Operations that are not whitelisted are never turned into descriptors.
 */
export function parseOpenApiOperations(
  source: ApiSourceConfig,
  doc: Record<string, unknown>,
): Promise<ApiOperationDescriptor[]> {
  try {
    // Local `$ref`s only, resolved against a copy so the caller's document is not
    // modified. An external ref, or a pointer that addresses nothing, is left in
    // place; only refs reached by a whitelisted operation are rejected, via
    // findUnresolvedRef below.
    const schema = resolveLocalRefs(doc);

    const index = indexOperations(schema);
    const descriptors: ApiOperationDescriptor[] = [];

    for (const operationId of source.operations) {
      const indexed = index.get(operationId);
      if (!indexed) {
        throw new Error(
          `API source "${source.name}" whitelists operation "${operationId}", which the OpenAPI document does not define.`,
        );
      }

      const parameters: ApiOperationParameter[] = [];
      for (const raw of effectiveParameters(indexed)) {
        const param = asRecord(raw);
        if (!param) continue;
        const name = asString(param["name"]) ?? "";
        const location = asString(param["in"]) ?? "";
        if (!SUPPORTED_LOCATIONS.includes(location as ApiParameterLocation)) {
          throw new Error(
            `API source "${source.name}" operation "${operationId}" uses unsupported parameter location "${location}" for parameter "${name}". Only "path" and "query" parameters and an application/json request body are supported.`,
          );
        }
        parameters.push({
          name,
          in: location as ApiParameterLocation,
          required: param["required"] === true,
          schema: asRecord(param["schema"]) ?? {},
          ...(asString(param["description"]) !== undefined
            ? { description: asString(param["description"]) }
            : {}),
        });
      }

      let requestBody: ApiOperationRequestBody | undefined;
      const rawBody = asRecord(indexed.operation["requestBody"]);
      if (rawBody) {
        const content = asRecord(rawBody["content"]);
        const mediaTypes = content ? Object.keys(content) : [];
        if (mediaTypes.length > 0) {
          const json = asRecord(content?.[JSON_MEDIA_TYPE]);
          if (!json) {
            throw new Error(
              `API source "${source.name}" operation "${operationId}" has a request body with no "${JSON_MEDIA_TYPE}" media type (found: ${mediaTypes.join(", ")}). Only JSON request bodies are supported.`,
            );
          }
          requestBody = {
            required: rawBody["required"] === true,
            schema: asRecord(json["schema"]) ?? {},
          };
        }
      }

      const seen = new Set<object>();
      const unresolved =
        findUnresolvedRef(
          parameters.map((p) => p.schema),
          seen,
        ) ?? (requestBody ? findUnresolvedRef(requestBody.schema, seen) : null);
      if (unresolved) {
        throw new Error(
          `API source "${source.name}" operation "${operationId}" references an unresolved external $ref "${unresolved}". External references are not fetched.`,
        );
      }

      descriptors.push({
        operationId,
        method: indexed.method,
        path: indexed.path,
        ...(asString(indexed.operation["summary"]) !== undefined
          ? { summary: asString(indexed.operation["summary"]) }
          : {}),
        ...(asString(indexed.operation["description"]) !== undefined
          ? { description: asString(indexed.operation["description"]) }
          : {}),
        parameters,
        ...(requestBody ? { requestBody } : {}),
      });
    }

    return Promise.resolve(descriptors);
  } catch (err: unknown) {
    return Promise.reject(err instanceof Error ? err : new Error(String(err)));
  }
}
