import type {
  LanguageModel,
  ProviderCallOptions,
  ProviderResult,
  FinishReason,
  NormalizedUsage,
} from "./provider.types.js";
import type { ResponseBlock } from "../types.js";
import type { StreamPart } from "./provider.types.js";
import type { MockError, MockResponse, MockScript } from "./types.js";
export type { MockError, MockResponse, MockScript } from "./types.js";

// ---------------------------------------------------------------------------
// Mock errors
// ---------------------------------------------------------------------------

export class MockProviderError extends Error {
  status?: number;
  statusCode?: number;

  constructor(err: MockError) {
    super(err.message ?? "Mock provider error");
    this.name = err.name ?? "Error";
    if (err.status !== undefined) {
      this.status = err.status;
      this.statusCode = err.status;
    }
  }
}

export function makeMockError(e: MockError): MockProviderError {
  return new MockProviderError(e);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_USAGE: NormalizedUsage = { inputTokens: 0, outputTokens: 0 };

function buildContent(r: MockResponse): ResponseBlock[] {
  if (r.content) return r.content;
  const blocks: ResponseBlock[] = [];
  if (r.text != null) blocks.push({ type: "text", text: r.text });
  if (r.toolCalls) {
    for (const tc of r.toolCalls) {
      blocks.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.input });
    }
  }
  return blocks;
}

function defaultFinishReason(r: MockResponse, content: ResponseBlock[]): FinishReason {
  if (r.finishReason) return r.finishReason;
  return content.some(b => b.type === "tool_use") ? "tool-calls" : "stop";
}

function toResult(r: MockResponse): ProviderResult {
  const content = buildContent(r);
  const finishReason = defaultFinishReason(r, content);
  const result: ProviderResult = {
    content,
    finishReason,
    usage: r.usage ?? DEFAULT_USAGE,
    warnings: r.warnings ?? [],
  };
  if (r.providerMetadata !== undefined) result.providerMetadata = r.providerMetadata;
  return result;
}

function synthesizeStreamParts(content: ResponseBlock[]): StreamPart[] {
  const parts: StreamPart[] = [];
  for (const block of content) {
    if (block.type === "text") {
      parts.push({ type: "text-start", id: "t0" });
      parts.push({ type: "text-delta", id: "t0", delta: block.text });
      parts.push({ type: "text-end", id: "t0" });
    } else if (block.type === "thinking") {
      parts.push({ type: "reasoning-start", id: "r0", signature: block.signature });
      parts.push({ type: "reasoning-delta", id: "r0", delta: block.thinking });
      parts.push({ type: "reasoning-end", id: "r0", signature: block.signature });
    } else if (block.type === "tool_use") {
      const inputStr = JSON.stringify(block.input);
      parts.push({ type: "tool-input-start", id: block.id, toolName: block.name });
      parts.push({ type: "tool-input-delta", id: block.id, delta: inputStr });
      parts.push({ type: "tool-input-end", id: block.id });
      parts.push({ type: "tool-call", toolCallId: block.id, toolName: block.name, input: inputStr });
    }
  }
  return parts;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const id = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(id);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// ---------------------------------------------------------------------------
// createMockProvider
// ---------------------------------------------------------------------------

export function createMockProvider(
  script: MockScript,
  opts?: { provider?: string; modelId?: string },
): LanguageModel {
  const providerName = opts?.provider ?? "mock";
  const modelId = opts?.modelId ?? "mock-model";
  let callIndex = 0;

  function pick(callOpts: ProviderCallOptions): MockResponse {
    if (typeof script === "function") return script(callOpts);
    if (Array.isArray(script)) {
      const idx = Math.min(callIndex, script.length - 1);
      callIndex++;
      return script[idx];
    }
    return script;
  }

  return {
    provider: providerName,
    modelId,

    async generate(callOpts: ProviderCallOptions): Promise<ProviderResult> {
      if (callOpts.abortSignal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      const r = pick(callOpts);
      if (r.delayMs) await sleep(r.delayMs, callOpts.abortSignal);
      if (r.error) {
        throw makeMockError(r.error);
      }
      return toResult(r);
    },

    async doStream(callOpts: ProviderCallOptions): Promise<{ stream: AsyncIterable<StreamPart> }> {
      if (callOpts.abortSignal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      const r = pick(callOpts);
      if (r.delayMs) await sleep(r.delayMs, callOpts.abortSignal);
      if (r.error) {
        // Note: Mid-stream errors remain injectable via streamParts: [{ type: "error", error }].
        throw makeMockError(r.error);
      }
      const result = toResult(r);
      const streamParts: StreamPart[] = r.streamParts
        ? r.streamParts
        : synthesizeStreamParts(result.content);

      const warnings = result.warnings ?? [];
      const finishReason = result.finishReason;
      const usage = result.usage;
      const providerMetadata = result.providerMetadata;
      const signal = callOpts.abortSignal;

      async function* gen(): AsyncGenerator<StreamPart> {
        // `require-await`: this generator has no internal await, but it must stay
        // an async generator — middleware.ts:368 consumes the stream through an
        // explicit stream[Symbol.asyncIterator]() lookup, which a sync generator
        // does not implement. Task 018 broke five tests by converting one.
        await Promise.resolve();
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        yield { type: "stream-start", warnings };
        for (const part of streamParts) {
          if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
          yield part;
        }
        const finish: StreamPart = { type: "finish", finishReason, usage };
        if (providerMetadata !== undefined) {
          yield { type: "finish", finishReason, usage, providerMetadata };
        } else {
          yield finish;
        }
      }

      return { stream: gen() };
    },
  };
}

// ---------------------------------------------------------------------------
// Default script — used by registry when no script is set
// ---------------------------------------------------------------------------

export const ECHO_SCRIPT: MockScript = (): MockResponse => ({
  text: "[mock] ok",
  finishReason: "stop",
});
