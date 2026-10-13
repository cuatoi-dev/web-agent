// `PageAgent` is what `createPageAgent` returns, so this file reads that
// function's type. It is kept apart from `loop/types.ts` for exactly that
// reason: `agent.ts` imports `loop/types.ts`, and a shape derived from
// `agent.ts` therefore cannot live there.
import type { createPageAgent } from "./agent.js";
import type { ContextManager } from "./context-manager.js";
import type { AgentConfig } from "../config.types.js";

/** The page agent instance (`createPageAgent`'s return), the seam compaction
 *  uses to build and send its request — see `summariseInCachedConversation`. */
export type PageAgent = ReturnType<typeof createPageAgent>;

export type SummarizeFn = (
  cm: ContextManager,
  agent: PageAgent,
  cfg: AgentConfig,
  opts?: { signal?: AbortSignal },
) => Promise<string>;
