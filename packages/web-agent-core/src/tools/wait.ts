import type { ToolOutcome, ToolContext } from "./types.js";
import { WAIT_MAX_SECONDS } from "./definitions.js";

export async function runWait(
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  const seconds = input.seconds as number;

  if (!Number.isFinite(seconds) || seconds < 1 || seconds > WAIT_MAX_SECONDS) {
    return {
      content: `Invalid seconds (${seconds}). Must be between 1 and ${WAIT_MAX_SECONDS}.`,
      isError: true,
    };
  }

  if (ctx.signal.aborted) {
    return { content: "Wait aborted before starting." };
  }

  const aborted = await new Promise<boolean>((resolve) => {
    const cleanup = () => {
      clearTimeout(timer);
      ctx.signal.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      resolve(true);
    };
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      cleanup();
      resolve(false);
    }, seconds * 1000);
    ctx.signal.addEventListener("abort", onAbort);
  });

  return aborted
    ? { content: `Wait aborted after less than ${seconds}s.` }
    : { content: `Waited ${seconds}s.` };
}
