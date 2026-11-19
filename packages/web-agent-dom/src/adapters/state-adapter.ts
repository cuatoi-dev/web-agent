// state-adapter.ts — StateAdapter with JSONPath query + describeShape.
// Query rules (Q1–Q5), describeShape, and the invalid-JSONPath message.
import { JSONPath } from "jsonpath-plus";
import { invalidJsonPath } from "../tools/error-messages.js";
import type { QueryInput } from "./types.js";

// Re-exported so importers of this module keep their existing import path.
export type { QueryInput } from "./types.js";

const DEFAULT_QUERY_RESULT_MAX_CHARS = 6000;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const DEPTH_LIMIT = 6;
const LEAF_CHAR_LIMIT = 300;
const DESCRIBE_SHAPE_MAX_CHARS = 1000;

/** Serialize a value with depth cap + leaf char cap + non-serializable markers. */
function serializeValue(
  val: unknown,
  depth: number,
  depthLimit: number,
  leafCharLimit: number,
): string {
  if (depth > depthLimit) return '"…"';

  if (val === null) return "null";
  if (val === undefined) return "undefined";
  if (typeof val === "string") {
    if (val.length > leafCharLimit) return `"${val.slice(0, leafCharLimit)}…"`;
    return JSON.stringify(val);
  }
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  if (typeof val === "function") return "[Function]";
  if (typeof val === "symbol") return "[Symbol]";

  if (Array.isArray(val)) {
    if (val.length === 0) return "[]";
    const items = val.slice(0, 20).map((v) => serializeValue(v, depth + 1, depthLimit, leafCharLimit));
    if (val.length > 20) {
      return `[${items.join(", ")} …+${val.length - 20} more]`;
    }
    return `[${items.join(", ")}]`;
  }

  // Object (including Element, Map, Set, etc.)
  if (val instanceof Element) return "[Element]";
  if (val instanceof Map) return `[Map size=${val.size}]`;
  if (val instanceof Set) return `[Set size=${val.size}]`;
  if (val instanceof Date) return `[Date: ${val.toISOString()}]`;
  if (val instanceof RegExp) return `[RegExp: ${val.toString()}]`;
  if (val instanceof Error) return `[Error: ${val.message}]`;

  if (typeof val === "object") {
    const entries = Object.entries(val as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    const serializedEntries: string[] = [];
    for (const [k, v] of entries) {
      const sv = serializeValue(v, depth + 1, depthLimit, leafCharLimit);
      serializedEntries.push(`${JSON.stringify(k)}: ${sv}`);
    }
    return `{${serializedEntries.join(", ")}}`;
  }

  // Fallback
  return JSON.stringify(val);
}

/** Extract nested type info from a value (shallow, for describeShape). */
function extractType(val: unknown): string {
  if (val === null) return "null";
  if (val === undefined) return "undefined";
  if (Array.isArray(val)) return "array";
  if (typeof val === "object") {
    if (val instanceof Map) return "map";
    if (val instanceof Set) return "set";
    if (val instanceof Date) return "date";
    if (val instanceof Error) return "error";
    return "object";
  }
  return typeof val;
}

/** Build types-only shape summary of top-level + one nested level. */
function buildShapeSummary(state: unknown, maxChars: number): string {
  if (typeof state !== "object" || state === null) {
    return `state: ${extractType(state)}`;
  }

  const lines: string[] = [];
  const obj = state as Record<string, unknown>;
  const topKeys = Object.keys(obj);

  for (const key of topKeys) {
    const val = obj[key];
    const topType = extractType(val);

    if (topType === "object" && val !== null) {
      // One level of nesting
      const nestedObj = val as Record<string, unknown>;
      const nestedKeys = Object.keys(nestedObj).slice(0, 10); // cap nested keys
      const nestedParts = nestedKeys.map((nk) => {
        const nt = extractType(nestedObj[nk]);
        return `${nk}: ${nt}`;
      });
      lines.push(`${key}: { ${nestedParts.join(", ")} }`);
    } else if (topType === "array") {
      const arr = val as unknown[];
      const firstItem = arr[0];
      const itemType = firstItem !== undefined ? extractType(firstItem) : "unknown";
      lines.push(`${key}: ${topType}<${itemType}>`);
    } else {
      lines.push(`${key}: ${topType}`);
    }
  }

  let result = lines.join("\n");
  if (result.length > maxChars) {
    result = result.slice(0, maxChars - 3) + "…";
  }
  return result;
}

/**
 * Evaluate a JSONPath expression against state.
 * Returns matches or the error message string.
 */
export function evaluateJsonPath(
  state: unknown,
  path: string,
): { matches: unknown[] } | { error: string } {
  // Validate path starts with $
  if (!path.startsWith("$")) {
    return { error: invalidJsonPath("Path must start with $") };
  }

  try {
    const result: unknown = JSONPath({
      path,
      resultType: "value",
      json: state as object,
    });
    // resultType: "value" returns array of values directly (not {value} wrapper)
    const matches = result as unknown[];
    return { matches };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return { error: invalidJsonPath(reason) };
  }
}

export class StateAdapter {
  private getState: () => unknown;
  private queryResultMaxChars: number;

  constructor(
    getState: () => unknown,
    opts?: {
      queryResultMaxChars?: number;
    },
  ) {
    this.getState = getState;
    this.queryResultMaxChars = opts?.queryResultMaxChars ?? DEFAULT_QUERY_RESULT_MAX_CHARS;
  }

  /**
   * Query state with JSONPath.
   * Q1: reads fresh state per call (never caches/clones).
   * Q2: returns { total_matches, returned, results }.
   * Q3: uses keys_only to return only keys.
   * Q4: depth/leaf caps + non-serializable markers.
   * Q5: invalid path returns the standard error message.
   */
  query(input: QueryInput): Promise<string> {
    const path = input.path;
    const keysOnly = input.keys_only ?? false;
    const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT);

    // Q5: Validate path
    if (!path.startsWith("$")) {
      return Promise.resolve(invalidJsonPath("Path must start with $"));
    }

    // Q1: Fresh state per call
    const state = this.getState();

    // Evaluate
    const evalResult = evaluateJsonPath(state, path);
    if ("error" in evalResult) {
      return Promise.resolve(evalResult.error);
    }

    let matches = evalResult.matches;

    // Q3: keys_only
    if (keysOnly) {
      matches = matches.map((m) => {
        if (typeof m === "object" && m !== null) {
          return Object.keys(m);
        }
        return [];
      });
    }

    const totalMatches = matches.length;
    const returned = Math.min(limit, totalMatches);
    const limitedMatches = matches.slice(0, returned);

    // Q4: Serialize with depth/leaf caps
    const serializedResults = limitedMatches.map((m) =>
      serializeValue(m, 0, DEPTH_LIMIT, LEAF_CHAR_LIMIT),
    );

    // Build output manually to avoid double-encoding serialized strings
    let output = `{\n  "total_matches": ${totalMatches},\n  "returned": ${returned},\n  "results": [\n${serializedResults.map((r: string) => "    " + r).join(",\n")}\n  ]\n}`;

    // Enforce queryResultMaxChars
    if (output.length > this.queryResultMaxChars) {
      // Re-serialize with fewer results
      const dropCount = Math.floor(returned * 0.8); // drop 80% of results
      const newReturned = Math.max(1, returned - dropCount);
      const newResults = serializedResults.slice(0, newReturned);
      output = `{\n  "total_matches": ${totalMatches},\n  "returned": ${newReturned},\n  "results": [\n${newResults.map((r: string) => "    " + r).join(",\n")}\n  ]\n}`;

      if (output.length > this.queryResultMaxChars) {
        // Final fallback: truncate
        output = output.slice(0, this.queryResultMaxChars - 24) + '"…(output truncated)"';
      }
    }

    return Promise.resolve(output);
  }

  /**
   * Describe the shape of the state — types only.
   * Used by `domTools()` for `query_state`'s prompt snippet.
   */
  describeShape(): string {
    const state = this.getState();
    return buildShapeSummary(state, DESCRIBE_SHAPE_MAX_CHARS);
  }

  async waitForPathTruthy(path: string, timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
    if (signal?.aborted) {
      return false;
    }

    return new Promise<boolean>((resolve) => {
      let intervalTimer: NodeJS.Timeout | null = null;
      let timeoutTimer: NodeJS.Timeout | null = null;

      const cleanup = () => {
        if (intervalTimer) {
          clearInterval(intervalTimer);
          intervalTimer = null;
        }
        if (timeoutTimer) {
          clearTimeout(timeoutTimer);
          timeoutTimer = null;
        }
        signal?.removeEventListener("abort", onAbort);
      };

      const onAbort = () => {
        cleanup();
        resolve(false);
      };

      if (signal) {
        signal.addEventListener("abort", onAbort);
      }

      const check = () => {
        const state = this.getState();
        const evalResult = evaluateJsonPath(state, path);
        if ("matches" in evalResult && evalResult.matches.length > 0) {
          const isTruthy = evalResult.matches.some((m) => !!m);
          if (isTruthy) {
            cleanup();
            resolve(true);
          }
        }
      };

      // Set timeout fallback
      timeoutTimer = setTimeout(() => {
        cleanup();
        resolve(false);
      }, timeoutMs);

      // Check initially
      check();

      // Poll every 500ms
      intervalTimer = setInterval(check, 500);
    });
  }
}