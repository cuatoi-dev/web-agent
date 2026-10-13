// The shapes the transport-free evaluator in this directory declares. Nothing
// here knows about chrome, the bridge or the side panel, which is what lets
// the in-page bubble and the side panel share one evaluator.
// This file imports nothing, so no sibling can close a cycle through it.

/** One serialized value: a short type label and the text to show. Moved here
 *  from `src/lib/types.ts` by 118/001, with `describeValue`. `src/lib/types.ts`
 *  re-exports it, so every existing import path still resolves. */
export interface DescribedValue {
  kind: string;
  text: string;
}

/** What `runInPageRealm` reports. Three outcomes, no transport and no wording:
 *  each caller writes its own message, which is why the in-page bubble and the
 *  side panel can say different things about the same CSP refusal. */
export type EvalResult =
  | { kind: "value"; value: unknown }
  | { kind: "throw"; name: string; message: string }
  | { kind: "csp"; policy: string; message: string };

/** HTTP methods supported by page_fetch. */
export type PageFetchMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

/** Transport-free arguments for runPageFetch. `method` is a plain string:
 *  the tools validate the known verbs in their zod schemas. */
export interface PageFetchArgs {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

/** Transport-free outcomes from runPageFetch. */
export type PageFetchResult =
  | { kind: "response"; status: number; statusText: string; contentType: string; body: string }
  | { kind: "cross-origin"; requested: string; pageOrigin: string }
  | { kind: "invalid-url"; url: string; message: string }
  | { kind: "throw"; name: string; message: string; url?: string };

/** Test and caller seams for runPageFetch. Lives here (not in run-fetch.ts)
 *  per the repo rule that types live in `types.ts`. */
export interface RunPageFetchOptions {
  currentOrigin?: string;
  fetch?: typeof fetch;
  maxChars?: number;
}

/** Console log levels captured by the ring buffer. */
export type ConsoleLogLevel = "log" | "info" | "warn" | "error";

/** One entry captured in the console ring buffer. */
export interface ConsoleEntry {
  level: ConsoleLogLevel;
  text: string;
  ts: number;
}

/** Arguments for reading the console buffer. */
export interface ReadConsoleArgs {
  level?: string;
  limit?: number;
}

/** Result of reading the console buffer. */
export interface ReadConsoleResult {
  documentId: string;
  dropped: number;
  total: number;
  entries: ConsoleEntry[];
}
