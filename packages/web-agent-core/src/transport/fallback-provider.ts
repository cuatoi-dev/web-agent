import type { AgentConfig } from "../config.types.js";
import type {
  LanguageModel,
  ProviderCallOptions,
  ProviderResult,
} from "./provider.types.js";
import type { FallbackChainEntry, ProviderFallbackNotice } from "./fallback-provider.types.js";
export type { FallbackChainEntry, ProviderFallbackNotice } from "./fallback-provider.types.js";
import { providerRegistry, type ProviderFactory } from "./registry.js";
import { AgentError, mapToAgentError } from "../loop/errors.js";

function describe(e: FallbackChainEntry) {
  return { provider: e.endpointType, model: e.model };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** A user abort must never burn through the chain: rethrow it untouched and
 *  leave the cursor where it is. A timeout is NOT a user abort — `withRetry`
 *  reports that as a plain error, so it falls back normally. */
function isUserAbort(err: unknown, opts: ProviderCallOptions): boolean {
  if (opts.abortSignal?.aborted) return true;
  if (err instanceof AgentError) return err.kind === "aborted";
  return (err as { name?: unknown } | null | undefined)?.name === "AbortError";
}

/**
 * Build a `ProviderFactory` that tries `entries` in order and returns the first
 * success.
 *
 * The cursor lives in THIS closure, not in the returned model, and that is
 * deliberate: `createPageAgent` builds a fresh `LanguageModel` on every
 * `updateConfig()` (`loop/agent.ts:148` via `controller-config.ts:234`), so a cursor
 * held inside a model instance would silently reset whenever a host wrote any
 * panel property. Register the factory once and the cursor lives for the page
 * load — sticky across new chat sessions, back to entry 1 only by wrapping all
 * the way around or by reloading. It is never persisted.
 */
export function createFallbackProviderFactory(
  entries: FallbackChainEntry[],
): ProviderFactory {
  let cursor = 0;
  const advance = () => { cursor = (cursor + 1) % entries.length; };

  return (cfg: AgentConfig, opts?: { fetch?: typeof fetch }): LanguageModel => {
    const fetchImpl = opts?.fetch ?? cfg.fetch;

    /** One attempt per entry: `maxRetries: 0` keeps `withRetry`'s per-request
     *  hard deadline (`requestTimeoutMs`, default 15 min) while removing every retry. */
    const modelFor = (entry: FallbackChainEntry): LanguageModel =>
      providerRegistry.get(
        {
          ...cfg,
          endpointType: entry.endpointType,
          model: entry.model,
          baseURL: entry.baseURL,
          maxRetries: 0,
        },
        { fetch: fetchImpl },
      );

    const callOptionsFor = (
      entry: FallbackChainEntry,
      o: ProviderCallOptions,
    ): ProviderCallOptions => ({
      ...o,
      model: entry.model,
    });

    const notify = (
      failed: ProviderFallbackNotice["failed"],
      answered?: FallbackChainEntry,
    ) => {
      if (failed.length === 0) return;
      cfg.onProviderFallback?.({
        failed,
        ...(answered ? { answered: describe(answered) } : {}),
      });
    };

    return {
      provider: "fallback",
      get modelId() { return entries[cursor]?.model ?? cfg.model; },

      async generate(o: ProviderCallOptions): Promise<ProviderResult> {
        const failed: ProviderFallbackNotice["failed"] = [];
        let lastErr: unknown;
        for (let tried = 0; tried < entries.length; tried++) {
          const entry = entries[cursor];
          try {
            const result = await modelFor(entry).generate(callOptionsFor(entry, o));
            notify(failed, entry);
            return result;
          } catch (err) {
            if (isUserAbort(err, o)) throw err;
            failed.push({ ...describe(entry), message: messageOf(err) });
            lastErr = err;
            advance();
          }
        }
        notify(failed);
        throw mapToAgentError(lastErr);
      },
    };
  };
}
