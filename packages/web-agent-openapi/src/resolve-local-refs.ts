/**
 * Local-only JSON Pointer `$ref` resolution for a single OpenAPI document.
 *
 * WHY THIS EXISTS: this package must install in an airgapped internal registry
 * where `@scalar/openapi-parser` is not published at all. This module replaces
 * the one `dereference(doc)` call that package used to provide.
 *
 * WHY IT IS AIRGAP-SAFE: a `$ref` is followed only when it starts with `#`, and
 * it is resolved against the same in-memory document. There is no `fetch`, no
 * `import()`, no file API and no URL handling anywhere in this file, so an
 * external reference cannot be followed. That is a property of the code, not of
 * how it is configured. A ref that is not local — an `https://` URL, another
 * file, or a pointer that addresses nothing — is left in the document exactly as
 * written. `findUnresolvedRef` in `parse-openapi.ts` is what rejects one that a
 * whitelisted operation reaches.
 *
 * ATTRIBUTION: the resolution algorithm (the `$ref` follow loop with its key
 * merge, the visited-object set, the local/external split, and the JSON Pointer
 * unescape order) is adapted from `@scalar/openapi-parser` 0.28.10, file
 * `dist/utils/resolve-references.js` — https://github.com/scalar/scalar — used
 * under the MIT licence:
 *
 *   MIT License
 *
 *   Copyright (c) 2023-present Scalar
 *
 *   Permission is hereby granted, free of charge, to any person obtaining a copy
 *   of this software and associated documentation files (the "Software"), to deal
 *   in the Software without restriction, including without limitation the rights
 *   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 *   copies of the Software, and to permit persons to whom the Software is
 *   furnished to do so, subject to the following conditions:
 *
 *   The above copyright notice and this permission notice shall be included in all
 *   copies or substantial portions of the Software.
 *
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 *   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 *   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 *   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 *   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 *   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 *   SOFTWARE.
 */

import type { JsonRecord } from "./types.js";

function isObjectLike(value: unknown): boolean {
  return typeof value === "object" && value !== null;
}

/**
 * Deep copy of a JSON document, so the caller's object is never mutated —
 * matching what the previous parser did with `structuredClone`.
 *
 * Hand-written rather than calling `structuredClone` so this module assumes
 * nothing about the host environment; the package ships to browsers we do not
 * choose. The input always comes from `response.json()` in
 * `fetchOpenApiDocument`, so it is plain JSON data with no cycles and no
 * non-cloneable values.
 */
function cloneJson<T>(value: T): T {
  if (Array.isArray(value)) {
    return (value as unknown[]).map((entry) => cloneJson(entry)) as unknown as T;
  }
  if (isObjectLike(value)) {
    const copy: JsonRecord = {};
    for (const [key, entry] of Object.entries(value as JsonRecord)) {
      copy[key] = cloneJson(entry);
    }
    return copy as unknown as T;
  }
  return value;
}

/**
 * Unescape one JSON Pointer segment (RFC 6901). The order matters: `~1` becomes
 * `/` first, then `~0` becomes `~`. The other order turns `~01` into `/`.
 */
function unescapePointerSegment(segment: string): string {
  return decodeURI(segment.replace(/~1/g, "/").replace(/~0/g, "~"));
}

/** `"/paths/~1cats/get"` -> `["paths", "/cats", "get"]`. */
function pointerSegments(pointer: string): string[] {
  return pointer.split("/").slice(1).map(unescapePointerSegment);
}

/**
 * Resolve a local pointer against the document root. Returns `undefined` when
 * the ref is not local, or when the pointer addresses nothing — in both cases
 * the caller leaves the `$ref` in place.
 */
function resolveLocalPointer(ref: string, root: unknown): unknown {
  // Not local: another file or an absolute URL. Never followed, never fetched.
  if (!ref.startsWith("#")) return undefined;
  try {
    return pointerSegments(ref.slice(1)).reduce<unknown>((accumulator, key) => {
      if (!isObjectLike(accumulator) || !(key in (accumulator as object))) {
        throw new Error("unresolved pointer");
      }
      return (accumulator as JsonRecord)[key];
    }, root);
  } catch {
    // A malformed percent-escape also lands here, via `decodeURI`.
    return undefined;
  }
}

function resolveInto(node: unknown, root: unknown, visited: Set<object>): void {
  if (!isObjectLike(node)) return;
  const object = node as JsonRecord;
  if (visited.has(object)) return;
  visited.add(object);

  // Follow a chain of refs (`A` -> `B` -> a concrete schema). `followed` stops a
  // chain that loops back on itself from spinning forever.
  const followed = new Set<string>();
  while (typeof object["$ref"] === "string") {
    const ref = object["$ref"];
    if (followed.has(ref)) {
      delete object["$ref"];
      break;
    }
    followed.add(ref);
    const target = resolveLocalPointer(ref, root);
    // External, or a pointer that addresses nothing: leave the `$ref` in place.
    if (!isObjectLike(target)) break;
    delete object["$ref"];
    for (const [key, entry] of Object.entries(target as JsonRecord)) {
      // A key written next to the `$ref` wins over the target's key.
      if (object[key] === undefined) object[key] = entry;
    }
  }

  for (const entry of Object.values(object)) {
    resolveInto(entry, root, visited);
  }
}

/**
 * Resolve every local `$ref` in `document` and return the result. The input is
 * not modified. A recursive schema produces a real object cycle in the output,
 * which is why `findUnresolvedRef` in `parse-openapi.ts` carries a `seen` set.
 */
export function resolveLocalRefs(
  document: Record<string, unknown>,
): Record<string, unknown> {
  const resolved = cloneJson(document);
  resolveInto(resolved, resolved, new Set<object>());
  return resolved;
}
