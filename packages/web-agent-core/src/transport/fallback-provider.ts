import type { AgentConfig } from "../config.types.js";
import type {
  LanguageModel,
  ProviderCallOptions,
  ProviderResult,
} from "./provider.types.js";
import type { StreamPart } from "./provider.types.js";
import type { FallbackChainEntry, ProviderFallbackNotice } from "./fallback-provider.types.js";
export type { FallbackChainEntry, ProviderFallbackNotice } from "./fallback-provider.types.js";
import { providerRegistry, type ProviderFactory } from "./registry.js";
import { CONTENT_PARTS, nextWithIdleTimeout } from "./middleware.js";
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

/** Turn a completed non-streaming result into the stream parts a consumer
 *  expects, so a `streaming: false` entry can serve a `doStream` call. */
function resultToStreamParts(result: ProviderResult): StreamPart[] {
  const parts: StreamPart[] = [{ type: "stream-start", warnings: result.warnings ?? [] }];
  for (const block of result.content) {
    if (block.type === "text") {
      parts.push({ type: "text-start", id: "t0" });
      parts.push({ type: "text-delta", id: "t0", delta: block.text });
      parts.push({ type: "text-end", id: "t0" });
    } else if (block.type === "thinking") {
      parts.push({ type: "reasoning-start", id: "r0", signature: block.signature });
      parts.push({ type: "reasoning-delta", id: "r0", delta: block.thinking });
      parts.push({ type: "reasoning-end", id: "r0", signature: block.signature });
    } else if (block.type === "tool_use") {
      const input = JSON.stringify(block.input);
      parts.push({ type: "tool-input-start", id: block.id, toolName: block.name });
      parts.push({ type: "tool-input-delta", id: block.id, delta: input });
      parts.push({ type: "tool-input-end", id: block.id });
      parts.push({ type: "tool-call", toolCallId: block.id, toolName: block.name, input });
    }
  }
  parts.push({
    type: "finish",
    finishReason: result.finishReason,
    usage: result.usage,
    ...(result.providerMetadata !== undefined
      ? { providerMetadata: result.providerMetadata }
      : {}),
  });
  return parts;
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
     *  timeout (`requestTimeoutMs`, default 5 min) while removing every retry. */
    const modelFor = (entry: FallbackChainEntry): LanguageModel =>
      providerRegistry.get(
        {
          ...cfg,
          endpointType: entry.endpointType,
          model: entry.model,
          baseURL: entry.baseURL,
          streaming: entry.streaming ?? false,
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
      streaming: entry.streaming ?? false,
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

      async doStream(o: ProviderCallOptions) {
        const failed: ProviderFallbackNotice["failed"] = [];
        const streamIdleTimeoutMs = cfg.streamIdleTimeoutMs ?? 120_000;
        let lastErr: unknown;
        for (let tried = 0; tried < entries.length; tried++) {
          const entry = entries[cursor];
          try {
            // Acquire up to (and including) the first content part. Nothing has
            // been handed to the consumer yet, so a failure here falls back
            // silently.
            const { buffered, iterator } = await acquire(entry, o);
            notify(failed, entry);
            const failedEntry = entry;
            const stream = (async function* () {
              try {
                for (const p of buffered) yield p;
                if (!iterator) return;
                for (;;) {
                  // Bounded by the stream idle deadline, restarted on every
                  // part — a chunk that goes silent this long is treated the
                  // same as any other mid-stream failure below: advance the
                  // cursor and throw.
                  const { done, value } = await nextWithIdleTimeout(iterator, streamIdleTimeoutMs);
                  if (done) break;
                  if (value.type === "error") throw (value.error ?? new Error("Stream error")) as Error;
                  yield value;
                }
              } catch (err) {
                // After the first content part: advance the cursor FIRST, so a
                // manual retry starts on the next entry, then throw. No replay.
                if (!isUserAbort(err, o)) {
                  advance();
                  cfg.onProviderFallback?.({
                    failed: [{ ...describe(failedEntry), message: messageOf(err) }],
                  });
                }
                throw err;
              }
            })();
            return { stream };
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

    /** Pull an entry until its first content part arrives. A `streaming: false`
     *  entry is called with `generate()` and its result converted, so the entry
     *  behaves exactly as its mode says. */
    async function acquire(
      entry: FallbackChainEntry,
      o: ProviderCallOptions,
    ): Promise<{ buffered: StreamPart[]; iterator?: AsyncIterator<StreamPart, void, undefined> }> {
      const model = modelFor(entry);
      if (entry.streaming !== true || !model.doStream) {
        const result = await model.generate(callOptionsFor(entry, o));
        return { buffered: resultToStreamParts(result) };
      }
      const { stream } = await model.doStream(callOptionsFor(entry, o));
      const iterator = stream[Symbol.asyncIterator]() as AsyncIterator<StreamPart, void, undefined>;
      const buffered: StreamPart[] = [];
      let sawContent = false;
      while (!sawContent) {
        const { done, value } = await iterator.next();
        if (done) break;
        buffered.push(value);
        if (value.type === "error") throw (value.error ?? new Error("Stream error")) as Error;
        if (CONTENT_PARTS.has(value.type)) sawContent = true;
        if (value.type === "finish" && value.finishReason === "stop") sawContent = true;
      }
      // Mirrors withRetry's own acquisition (middleware.ts:371-384): a stream
      // that ends without content is a failed attempt, not an empty answer —
      // but a stream that says the model stopped normally is a finished turn,
      // and failing it over to the next model in the chain would bill a second
      // call for an answer that is already complete.
      if (!sawContent) throw new AgentError("Model returned an empty response", "network");
      return { buffered, iterator };
    }
  };
}
