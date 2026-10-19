import { AgentError } from "./errors.js";
import { ContextManager } from "./context-manager.js";
import type { TurnResult, UsageLike } from "./types.js";
export type { TurnResult } from "./types.js";
import type { ToolContext } from "../tools/types.js";

import type { createPageAgent } from "./agent.js";
import { AgentConfig } from "../config.js";
import { normaliseInput, buildUserContent, UserMessageInput } from "../utils/types.js";
import type { ContentPart } from "../types.js";
import { downscaleImage, DEFAULT_IMAGE_LIMITS } from "../utils/image.js";

export async function runTurn(
  agent: ReturnType<typeof createPageAgent>,
  cm: ContextManager,
  ctx: ToolContext,
  userInput: string | UserMessageInput,
  signal: AbortSignal,
  cfg: AgentConfig,
  onStep?: () => void,
): Promise<TurnResult> {
  // 1. Reassign signal per turn (F5)
  ctx.signal = signal;

  // 2. Normalise input, downscale images, build content, append user message
  const input = normaliseInput(userInput);
  if (input.images && input.images.length > 0) {
    input.images = await Promise.all(
      input.images.map((img) =>
        downscaleImage(img.dataUrl, DEFAULT_IMAGE_LIMITS).then((scaled) => ({
          ...img,
          dataUrl: scaled,
        }))
      )
    );
  }
  const content = buildUserContent(input);
  cm.appendUser(
    { role: "user", content: content as string | ContentPart[] },
    input.userDisplayText,
    input.promptMeta,
  );

  return driveGenerate(agent, cm, signal, cfg, onStep);
}

/**
 * 001 — continue the turn that is already open, instead of starting a new one.
 *
 * The difference from `runTurn` is the ABSENCE of `cm.appendUser`: the user
 * message and every completed step are already in the journal under a turnId
 * that is still open (a failed turn never reached `commitTurn`, so it is not in
 * the manager's completed set). `cm.#stepNo` therefore still holds the last
 * completed step and the resumed steps keep counting up from it.
 *
 * There is no `userInput` to normalise and no image to downscale — that work was
 * done when the turn first started and its result is in the journal.
 */
export async function resumeTurn(
  agent: ReturnType<typeof createPageAgent>,
  cm: ContextManager,
  ctx: ToolContext,
  signal: AbortSignal,
  cfg: AgentConfig,
  onStep?: () => void,
): Promise<TurnResult> {
  ctx.signal = signal;
  return driveGenerate(agent, cm, signal, cfg, onStep);
}

/**
 * Everything a turn does after its messages are in place: generate, commit,
 * compute the stop reason and the usage, and map a failure to a TurnResult.
 * Shared by `runTurn` and `resumeTurn` — the body is unchanged from when it
 * lived inside `runTurn`.
 *
 * `agent.generate()` takes `cm.compose()` as its STARTING working set
 * (loop/agent.ts:224) and journals only the new-message delta
 * (loop/agent.ts:371-377), so a resumed call sends the completed steps as
 * context and never records them a second time.
 */
async function driveGenerate(
  agent: ReturnType<typeof createPageAgent>,
  cm: ContextManager,
  signal: AbortSignal,
  cfg: AgentConfig,
  onStep?: () => void,
): Promise<TurnResult> {
  try {
    if (signal.aborted) {
      throw new DOMException("The user aborted a request.", "AbortError");
    }

    // 3. Generate
    const result = await agent.generate({
      messages: cm.compose(),
      abortSignal: signal,
      onStep,
    });

    // 4. Commit turn (idempotent additions)
    cm.commitTurn(result.response.messages);

    // Determine stopReason
    let stopReason: TurnResult["stopReason"] = "end_turn";
    if (result.steps && result.steps.length > 0) {
      const lastStep = result.steps[result.steps.length - 1];
      if (lastStep.finishReason === "tool-calls" && result.steps.length >= cfg.maxIterations) {
        stopReason = "max_iterations";
      }
    }

    // Extract token usage
    let promptTokens = 0;
    let completionTokens = 0;
    const resultUsage = (result as { usage?: UsageLike }).usage;
    if (result.steps && Array.isArray(result.steps)) {
      for (const step of result.steps) {
        const stepUsage = step.usage as UsageLike | undefined;
        if (stepUsage) {
          promptTokens += (stepUsage.inputTokens ?? 0) + (stepUsage.cacheReadTokens ?? 0) + (stepUsage.cacheCreationTokens ?? 0);
          completionTokens += stepUsage.outputTokens ?? stepUsage.completionTokens ?? 0;
        }
      }
    } else if (resultUsage) {
      promptTokens = (resultUsage.inputTokens ?? resultUsage.promptTokens ?? 0) + (resultUsage.cacheReadTokens ?? 0) + (resultUsage.cacheCreationTokens ?? 0);
      completionTokens = resultUsage.outputTokens ?? resultUsage.completionTokens ?? 0;
    }

    return {
      assistantText: result.text || "",
      blocks: [],
      stopReason,
      usage: { input: promptTokens, output: completionTokens }
    };
  } catch (err: unknown) {
    let isAbort = false;
    if (err instanceof DOMException && err.name === "AbortError") {
      isAbort = true;
    } else if (err instanceof Error && err.name === "AbortError") {
      isAbort = true;
    } else if (err && (err as { name?: unknown }).name === "AbortError") {
      isAbort = true;
    } else if (err instanceof AgentError && err.kind === "aborted") {
      isAbort = true;
    }

    if (isAbort) {
      return {
        assistantText: "",
        blocks: [],
        stopReason: "aborted",
        error: new AgentError("Turn was aborted.", "aborted")
      };
    }

    const agentErr = err instanceof AgentError
      ? err
      : new AgentError(err instanceof Error ? err.message : String(err), "network");

    return {
      assistantText: "",
      blocks: [],
      stopReason: "error",
      error: agentErr
    };
  }
}
