import type { LanguageModel, ProviderCallOptions, ProviderResult } from "./provider.types.js";
import type { StreamPart } from "./provider.types.js";
import type { AgentConfig } from "../config.types.js";
import type { LanguageModelMiddleware } from "./types.js";
export type { LanguageModelMiddleware } from "./types.js";
import type { ResponseBlock } from "../types.js";
import { AgentError, mapToAgentError } from "../loop/errors.js";

// ---------------------------------------------------------------------------
// wrapProvider — compose one or more middleware layers around a LanguageModel
// First middleware in the array is the outermost wrapper (AI SDK semantics).
// ---------------------------------------------------------------------------

export function wrapProvider(
  model: LanguageModel,
  middleware: LanguageModelMiddleware | LanguageModelMiddleware[],
): LanguageModel {
  const mws: LanguageModelMiddleware[] = Array.isArray(middleware) ? middleware : [middleware];

  // Compute provider/modelId overrides (last override wins per layer, applied outside-in)
  const resolvedProvider = mws.reduce<string>(
    (p, mw) => (mw.overrideProvider ? mw.overrideProvider({ model }) : p),
    model.provider,
  );
  const resolvedModelId = mws.reduce<string>(
    (id, mw) => (mw.overrideModelId ? mw.overrideModelId({ model }) : id),
    model.modelId,
  );

  async function applyTransformParams(
    type: "generate" | "stream",
    params: ProviderCallOptions,
  ): Promise<ProviderCallOptions> {
    let p = params;
    for (const mw of mws) {
      if (mw.transformParams) p = await mw.transformParams({ type, params: p });
    }
    return p;
  }

  const wrapped: LanguageModel = {
    provider: resolvedProvider,
    modelId: resolvedModelId,
    supportedUrls: model.supportedUrls,

    async generate(opts: ProviderCallOptions): Promise<ProviderResult> {
      const params = await applyTransformParams("generate", opts);

      // Build the innermost doGenerate; accepts an optional params override so
      // middleware can re-issue the call with mutated options (e.g. new signal).
      let doGenerate = (p: ProviderCallOptions = params) => model.generate(p);

      // Wrap from innermost out: apply mws in reverse so mws[0] is outermost
      for (let i = mws.length - 1; i >= 0; i--) {
        const mw = mws[i];
        if (mw.wrapGenerate) {
          const prev = doGenerate;
          const capture = mw.wrapGenerate;
          doGenerate = (p: ProviderCallOptions = params) =>
            capture({ doGenerate: prev, params: p, model });
        }
      }

      return doGenerate(params);
    },
  };

  if (model.doStream) {
    wrapped.doStream = async function (opts: ProviderCallOptions) {
      const params = await applyTransformParams("stream", opts);

      let doStream = (p: ProviderCallOptions = params) => model.doStream!(p);

      for (let i = mws.length - 1; i >= 0; i--) {
        const mw = mws[i];
        if (mw.wrapStream) {
          const prev = doStream;
          const capture = mw.wrapStream;
          doStream = (p: ProviderCallOptions = params) =>
            capture({ doStream: prev, params: p, model });
        }
      }

      return doStream(params);
    };
  }

  // Transparent seam: forward the `_client` property to the inner provider so
  // existing test/debug seams (e.g. `agent._client = mock`) keep working through
  // the wrapper instead of silently writing to a dead property.
  const inner = model as { _client?: unknown };
  if (inner && "_client" in inner) {
    Object.defineProperty(wrapped, "_client", {
      configurable: true,
      enumerable: false,
      get() { return inner._client; },
      set(v) { inner._client = v; },
    });
  }

  return wrapped;
}

// ---------------------------------------------------------------------------
// withRetry — transport resilience middleware.
//
// Retries empty/dead streams (SSE returning only `[DONE]` or closing without
// any content) and transient network/parse failures up to `cfg.maxRetries`
// times with backoff delays from BACKOFF_SEQ. Deterministic client errors
// (400/401/403) and user aborts are never retried.
//
// Each attempt is bounded by `cfg.requestTimeoutMs` as an IDLE window: the
// clock restarts every time the transport reports bytes through
// `ProviderCallOptions.onTransportProgress`, which includes SSE keep-alive
// comments that parse to no event. A stream that keeps sending is never
// aborted for being slow; a stream that sends nothing for the window is
// aborted and retried. This exists because the project's gateway sends
// `: PING` every 5 s while an upstream request is queued — measured at 48 s
// of pings before the first content chunk on 2026-08-16 — and the previous
// time-to-first-content deadline aborted those live HTTP 200 streams and
// re-issued them as new billed calls.
//
// Once the first content part arrives, `cfg.requestTimeoutMs` stops applying
// and `cfg.streamIdleTimeoutMs` (default 120000, 2 minutes) takes over for the
// rest of the attempt: the same idea, restarted on every further content part,
// so a gateway that sends one word and then goes quiet without closing the
// connection doesn't hang forever. A stall past this deadline is a retryable
// failure that goes through the same attempt loop and backoff as any other
// transport error — the caller sees one continuous stream and never learns a
// retry happened mid-flight, unless every attempt is exhausted.
// ---------------------------------------------------------------------------

const EXHAUSTED_MESSAGE =
  "Model returned no response or request timed out after multiple retries. Please try again.";

/** Backoff delays (ms) between retry attempts, indexed by attempt number. */
const BACKOFF_SEQ = [1000, 1000, 2000, 3000, 5000];

/** Content-bearing stream parts — seeing one means the attempt produced output. */
export const CONTENT_PARTS = new Set<StreamPart["type"]>([
  "text-start",
  "text-delta",
  "reasoning-start",
  "reasoning-delta",
  "tool-input-start",
  "tool-input-delta",
  "tool-call",
]);

/** Abort-aware sleep that rejects immediately if the signal aborts. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("The user aborted a request.", "AbortError"));
      return;
    }
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException("The user aborted a request.", "AbortError"));
    };
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function isUserAbort(err: unknown): boolean {
  return (
    (err instanceof Error && err.name === "AbortError") ||
    (err as { name?: unknown } | null | undefined)?.name === "AbortError" ||
    (err instanceof AgentError && err.kind === "aborted")
  );
}

/** An attempt exceeded requestTimeoutMs or streamIdleTimeoutMs — retryable, not a user abort. */
class TimeoutError extends Error {
  constructor() {
    super("Request timed out");
    this.name = "TimeoutError";
  }
}

/** No content was produced (empty/dead stream or whitespace-only response). */
class EmptyResponseError extends Error {
  constructor() {
    super("Model returned an empty response");
    this.name = "EmptyResponseError";
  }
}

/**
 * False for user aborts, deterministic 400/401/403, and terminal `AgentError`
 * kinds (`fatal_auth`/`bad_request`/`aborted`/`max_iterations`); true for
 * `AgentError` kinds `rate_limit`/`network` and for raw errors otherwise.
 */
export function isRetryableError(err: unknown): boolean {
  if (isUserAbort(err)) return false;
  if (err instanceof AgentError) {
    return err.kind === "rate_limit" || err.kind === "network";
  }
  const errObj = err as { statusCode?: number; status?: number; lastError?: { statusCode?: number } } | null | undefined;
  const status: number | undefined =
    errObj?.statusCode ?? errObj?.status ?? errObj?.lastError?.statusCode;
  if (status === 400 || status === 401 || status === 403) return false;
  return true;
}

function isEmptyResult(result: ProviderResult): boolean {
  // A turn the model deliberately ended is a COMPLETED turn, whatever it
  // contains. Retrying it re-bills the same call and cannot change the
  // answer, and reporting it as a timeout is wrong: nothing timed out.
  // `"stop"` is what `mapFinishReason` returns for Anthropic `end_turn` and
  // `stop_sequence` (anthropic-mapping.ts:67-77). Every other reason —
  // `"length"`, `"unknown"` from a `[DONE]`-only stream, `"error"` — falls
  // through to the checks below and keeps today's retry.
  if (result.finishReason === "stop") return false;
  const content: ResponseBlock[] = result.content ?? [];
  if (content.length === 0) return true;
  // Empty when every block is a whitespace-only text block (no tool_use / thinking / real text).
  return content.every(
    (b) => b.type === "text" && (!b.text || b.text.trim().length === 0),
  );
}

/**
 * On exhausted retries, surface a useful AgentError: preserve the classified
 * kind of a real provider failure (e.g. rate_limit on 429) so the rest of the
 * app can branch on it; fall back to the friendly message only when the failure
 * was an empty/dead response or a timeout (no actionable upstream error).
 */
function exhaustedError(lastErr: unknown): AgentError {
  if (lastErr === undefined || lastErr instanceof EmptyResponseError || lastErr instanceof TimeoutError) {
    return new AgentError(EXHAUSTED_MESSAGE, "network");
  }
  return mapToAgentError(lastErr);
}

/**
 * Per-attempt scope: a combined abort signal (user-abort + timeout), a `race`
 * helper that bounds a promise by the timeout, and timer/cleanup controls. The
 * timeout aborts the controller (best-effort cancellation of the underlying
 * request) AND rejects the race with a TimeoutError, so a hung request can
 * never block forever even if the provider ignores the signal.
 */
function makeAttemptScope(userSignal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const onUserAbort = () => controller.abort();
  if (userSignal) {
    if (userSignal.aborted) controller.abort();
    else userSignal.addEventListener("abort", onUserAbort, { once: true });
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  let armed = true;
  let fire!: () => void;
  const timeout = new Promise<never>((_, reject) => {
    fire = () => {
      timedOut = true;
      controller.abort();
      reject(new TimeoutError());
    };
    timer = setTimeout(fire, timeoutMs);
  });
  return {
    signal: controller.signal,
    race: <T>(p: Promise<T>): Promise<T> => Promise.race([p, timeout]),
    /** True once the timeout fired — used to distinguish a timeout-driven abort from a user abort. */
    timedOut: () => timedOut,
    /**
     * The transport received bytes: restart the deadline. This is what makes
     * `requestTimeoutMs` an idle window rather than a time-to-first-content
     * window, so a gateway heartbeating every 5 s while its upstream is
     * queued is never mistaken for a hung request.
     */
    noteProgress: () => {
      if (!armed || timedOut) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(fire, timeoutMs);
    },
    /** Stop the timeout (e.g. once a stream's first content has arrived) but keep user-abort linkage. */
    clearTimer: () => { armed = false; if (timer) clearTimeout(timer); },
    cleanup: () => {
      armed = false;
      if (timer) clearTimeout(timer);
      userSignal?.removeEventListener("abort", onUserAbort);
    },
    /**
     * Force-close the underlying request. Used when this attempt is being
     * abandoned for a reason the transport itself doesn't know about yet
     * (e.g. a stream-idle-timeout raised independently of this scope's own
     * timer) so a stalled-but-still-open connection doesn't linger. A no-op
     * if the request already ended or was already aborted.
     */
    abortNow: () => controller.abort(),
  };
}

/**
 * Race one `iterator.next()` call against an idle timeout. The timer is
 * always cleared before the returned promise settles, whichever side wins,
 * so nothing leaks past a single await — callers get a fresh window on every
 * call, which is what makes the deadline reset on every content part.
 */
export function nextWithIdleTimeout<T>(
  iterator: AsyncIterator<T, void, undefined>,
  idleTimeoutMs: number,
): Promise<IteratorResult<T, void>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError()), idleTimeoutMs);
    iterator.next().then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e: unknown) => { clearTimeout(timer); const err = e as Error; reject(err); },
    );
  });
}

/**
 * Decide how to treat a caught attempt error. Returns a normalized error to use
 * as `lastErr`, and whether the loop should stop and surface it as a user abort.
 * Only an abort caused by OUR timeout (scope.timedOut()) is retryable; every
 * other abort (user signal, or an abort thrown mid-stream) is surfaced as
 * `aborted` and not retried.
 */
function classifyAttemptError(
  err: unknown,
  scope: { timedOut: () => boolean },
): { error: unknown; userAborted: boolean } {
  if (isUserAbort(err)) {
    if (scope.timedOut()) return { error: new TimeoutError(), userAborted: false };
    return { error: err, userAborted: true };
  }
  return { error: err, userAborted: false };
}

/**
 * Run the withRetry attempt loop as an async generator, so a stall detected
 * AFTER the first content part (the stream-idle-timeout) triggers a fresh
 * attempt the same way an empty/dead stream does before any content —
 * without ending the turn or keeping only the partial text. Each attempt:
 * acquire the stream up to the first content part (bounded by `timeoutMs`), then stream
 * live with every further part bounded by `streamIdleTimeoutMs` since the
 * last one. A stall or failure at either stage is classified and retried
 * with backoff exactly like `wrapGenerate`; only a user abort or exhausted
 * retries end iteration.
 */
async function* runStreamAttempts(
  doStream: (params?: ProviderCallOptions) => Promise<{ stream: AsyncIterable<StreamPart> }>,
  params: ProviderCallOptions,
  cfg: AgentConfig,
  timeoutMs: number,
  streamIdleTimeoutMs: number,
  maxRetries: number,
): AsyncGenerator<StreamPart, void, undefined> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const scope = makeAttemptScope(params.abortSignal, timeoutMs);
    try {
      // Acquire the stream AND consume up to the first content event, all
      // bounded by the timeout — so an opened-but-silent stream still aborts.
      const acquire = (async () => {
        const { stream } = await doStream({
          ...params,
          abortSignal: scope.signal,
          onTransportProgress: scope.noteProgress,
        });
        const iterator = stream[Symbol.asyncIterator]() as AsyncIterator<StreamPart, void, undefined>;
        const buffered: StreamPart[] = [];
        let sawContent = false;
        while (!sawContent) {
          const { done, value } = await iterator.next();
          if (done) break;
          buffered.push(value);
          if (value.type === "error") throw (value.error ?? new Error("Stream error")) as Error;
          if (CONTENT_PARTS.has(value.type)) sawContent = true;
          // A stream that says the model stopped normally is finished, not
          // dead. `finish` is not in CONTENT_PARTS and never will be, so this
          // is the only thing that ends the drain without content. A dead
          // `[DONE]`-only stream carries `finishReason: "unknown"`
          // (anthropic-provider.ts:199,403) and still falls through to the
          // throw below.
          if (value.type === "finish" && value.finishReason === "stop") sawContent = true;
        }
        if (!sawContent) throw new EmptyResponseError();
        return { iterator, buffered };
      })();

      const { iterator, buffered } = await scope.race(acquire);
      // First content arrived — switch from the requestTimeoutMs acquisition
      // window to the streamIdleTimeoutMs deadline for the rest of this attempt.
      scope.clearTimer();
      // A retry that got this far is about to yield a second attempt's parts
      // into a consumer that is still holding the first attempt's half-built
      // blocks. Tell it to throw those away. Emitted here, after acquisition
      // succeeds, so a retry that itself fails never signals a reset.
      if (attempt > 0) yield { type: "stream-restart", attempt };
      for (const p of buffered) yield p;
      for (;;) {
        const { done, value } = await nextWithIdleTimeout(iterator, streamIdleTimeoutMs);
        if (done) break;
        yield value;
      }
      scope.cleanup();
      return;
    } catch (err) {
      scope.abortNow();
      scope.cleanup();
      const { error, userAborted } = classifyAttemptError(err, scope);
      if (userAborted) throw mapToAgentError(error);
      lastErr = error;
      if (attempt < maxRetries && isRetryableError(error)) {
        cfg.onRetryAttempt?.(attempt + 1, maxRetries, error);
        await sleep(BACKOFF_SEQ[Math.min(attempt, BACKOFF_SEQ.length - 1)], params.abortSignal);
        continue;
      }
      throw exhaustedError(lastErr);
    }
  }
  throw exhaustedError(lastErr);
}

export function withRetry(cfg: AgentConfig): LanguageModelMiddleware {
  const maxRetries = cfg.maxRetries ?? 5;
  const timeoutMs = cfg.requestTimeoutMs ?? 300_000;
  const streamIdleTimeoutMs = cfg.streamIdleTimeoutMs ?? 120_000;

  return {
    async wrapGenerate({ doGenerate, params }) {
      let lastErr: unknown;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const scope = makeAttemptScope(params.abortSignal, timeoutMs);
        try {
          const result = await scope.race(
            doGenerate({
              ...params,
              abortSignal: scope.signal,
              onTransportProgress: scope.noteProgress,
            }),
          );
          if (isEmptyResult(result)) throw new EmptyResponseError();
          return result;
        } catch (err) {
          const { error, userAborted } = classifyAttemptError(err, scope);
          if (userAborted) throw mapToAgentError(error);
          lastErr = error;
          if (attempt < maxRetries && isRetryableError(error)) {
            cfg.onRetryAttempt?.(attempt + 1, maxRetries, error);
            await sleep(BACKOFF_SEQ[Math.min(attempt, BACKOFF_SEQ.length - 1)], params.abortSignal);
            continue;
          }
          break;
        } finally {
          scope.cleanup();
        }
      }
      throw exhaustedError(lastErr);
    },

    async wrapStream({ doStream, params }) {
      const attempts = runStreamAttempts(doStream, params, cfg, timeoutMs, streamIdleTimeoutMs, maxRetries);

      // Prime the generator up to the first content-bearing part, buffering
      // what it yields along the way — this promise still doesn't resolve
      // until content exists (or every attempt is exhausted and it throws),
      // exactly as before the stream-idle-deadline was added.
      const buffered: StreamPart[] = [];
      let sawContent = false;
      while (!sawContent) {
        const { done, value } = await attempts.next();
        if (done) break;
        buffered.push(value);
        if (CONTENT_PARTS.has(value.type)) sawContent = true;
      }

      // Replay the buffered head, then hand off to the generator directly —
      // it keeps enforcing the idle deadline and silently retrying a stall
      // for the rest of the turn, so the caller sees one continuous stream.
      const merged = (async function* () {
        for (const p of buffered) yield p;
        yield* attempts;
      })();

      return { stream: merged };
    },
  };
}
