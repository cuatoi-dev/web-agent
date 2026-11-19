import type { AnthropicRequestOptions } from "./types.js";
export type { AnthropicRequestOptions } from "./types.js";

/** An HTTP failure, carrying the status under both names the existing error
 *  mapping reads (middleware.ts:203-205, loop/errors.ts:50-51). */
export class AnthropicHttpError extends Error {
  readonly status: number;
  readonly statusCode: number;
  readonly body: string;
  constructor(status: number, body: string) {
    super(`Anthropic request failed with HTTP ${status}`);
    this.name = "AnthropicHttpError";
    this.status = status;
    this.statusCode = status;
    this.body = body;
  }
}

function resolveFetch(injected?: typeof fetch): typeof fetch {
  // `unbound-method`: an unbound `window.fetch` throws "Illegal invocation" in
  // a browser when called without `window` as its receiver, so `.bind(window)`
  // is the correct call here, not just a type-only fix — proven live by the
  // browser check (see anthropic-request.test.ts).
  const f =
    injected ||
    (typeof window !== "undefined" && window.fetch ? window.fetch.bind(window) : undefined) ||
    (globalThis as { fetch?: typeof fetch }).fetch;
  if (!f) throw new Error("No fetch implementation available.");
  return f;
}

/**
 * Rejects with a standard AbortError as soon as `signal` fires. Belt and
 * braces alongside passing `signal` to fetch itself: an injected fetch (a
 * test double, or a host's own polyfill) is not guaranteed to honor
 * AbortSignal the way a real browser fetch does, and a request that is
 * supposed to have been cancelled must not hang forever.
 */
function abortSignalPromise(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const onAbort = () => reject(new DOMException("The operation was aborted.", "AbortError"));
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * The single place this module calls fetch, so an injected fetch cannot be
 * bypassed by accident. A non-2xx response throws AnthropicHttpError; an abort
 * propagates unwrapped so its `AbortError` name survives.
 */
async function send(opts: AnthropicRequestOptions): Promise<Response> {
  const doFetch = resolveFetch(opts.fetch);
  const fetchPromise = doFetch(`${opts.baseURL}${opts.path}`, {
    method: "POST",
    headers: opts.headers,
    body: JSON.stringify(opts.body),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  const res = await (opts.signal ? Promise.race([fetchPromise, abortSignalPromise(opts.signal)]) : fetchPromise);
  if (!res.ok) {
    let text = "";
    try {
      text = await res.text();
    } catch {
      // A body that cannot be read must not mask the status.
    }
    throw new AnthropicHttpError(res.status, text);
  }
  return res;
}

/** One request: returns the parsed JSON body. */
export async function requestJson<T>(opts: AnthropicRequestOptions): Promise<T> {
  const res = await send(opts);
  return (await res.json()) as T;
}
