import type { LanguageModel, ProviderCallOptions, ProviderResult } from "./provider.types.js";
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
    type: "generate",
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
// Retries empty incomplete responses and transient network/parse failures up
// to `cfg.maxRetries` times with backoff delays from BACKOFF_SEQ. Deterministic
// client errors (400/401/403) and user aborts are never retried. A normal
// empty stop is a completed turn and is returned as is.
//
// Each attempt has one hard deadline, `cfg.requestTimeoutMs` (default 900000
// ms, 15 minutes). Nothing restarts the timer: no progress hook, no body-byte
// reset. A timeout is retryable and each retry gets its own full deadline.
// No partial response is ever returned.
// ---------------------------------------------------------------------------

const EXHAUSTED_MESSAGE =
  "Model returned no response or request timed out after multiple retries. Please try again.";

/** Backoff delays (ms) between retry attempts, indexed by attempt number. */
const BACKOFF_SEQ = [1000, 1000, 2000, 3000, 5000];

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

/** An attempt exceeded requestTimeoutMs — retryable, not a user abort. */
class TimeoutError extends Error {
  constructor() {
    super("Request timed out");
    this.name = "TimeoutError";
  }
}

/** No content was produced (empty or whitespace-only incomplete response). */
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
  // `"length"`, `"unknown"`, `"error"` — falls
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
 * was an empty response or a timeout (no actionable upstream error).
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
  let fire!: () => void;
  const timeout = new Promise<never>((_, reject) => {
    fire = () => {
      timedOut = true;
      const error = new TimeoutError();
      controller.abort(error);
      reject(error);
    };
    timer = setTimeout(fire, timeoutMs);
  });
  return {
    signal: controller.signal,
    race: <T>(p: Promise<T>): Promise<T> => Promise.race([p, timeout]),
    /** True once the timeout fired — used to distinguish a timeout-driven abort from a user abort. */
    timedOut: () => timedOut,
    cleanup: () => {
      if (timer) clearTimeout(timer);
      userSignal?.removeEventListener("abort", onUserAbort);
    },
  };
}

/**
 * Decide how to treat a caught attempt error. Returns a normalized error to use
 * as `lastErr`, and whether the loop should stop and surface it as a user abort.
 * Only an abort caused by OUR timeout (scope.timedOut()) is retryable; every
 * other abort (user signal, or an abort thrown by the provider) is surfaced as
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

export function withRetry(cfg: AgentConfig): LanguageModelMiddleware {
  const maxRetries = cfg.maxRetries ?? 5;
  const timeoutMs = cfg.requestTimeoutMs ?? 900_000;

  return {
    async wrapGenerate({ doGenerate, params }) {
      let lastErr: unknown;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const scope = makeAttemptScope(params.abortSignal, timeoutMs);
        try {
          const result = await scope.race(
            doGenerate({ ...params, abortSignal: scope.signal }),
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
  };
}
