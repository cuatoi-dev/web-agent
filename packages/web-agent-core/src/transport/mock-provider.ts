import type {
  LanguageModel,
  ProviderCallOptions,
  ProviderResult,
  FinishReason,
  NormalizedUsage,
} from "./provider.types.js";
import type { ResponseBlock } from "../types.js";
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
  };
}

// ---------------------------------------------------------------------------
// Default script — used by registry when no script is set
// ---------------------------------------------------------------------------

export const ECHO_SCRIPT: MockScript = (): MockResponse => ({
  text: "[mock] ok",
  finishReason: "stop",
});
