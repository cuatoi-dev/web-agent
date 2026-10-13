import type {
  AgentHooks, HookEvent, HookPayloads, HookResults, PreToolDecision,
  PreToolResult, PostToolResult, UserPromptResult, PreCompactResult,
} from "./types.js";
import { ATTACHMENT_CHIPS_KEY } from "../attachments/types.js";

/** Normalize a `HookEntry` (handler-or-array-or-undefined) into an array. */
export function toHookArray(entry: unknown): Array<(p: unknown) => unknown> {
  if (!entry) return [];
  return (Array.isArray(entry) ? entry : [entry]) as Array<(p: unknown) => unknown>;
}

/**
 * Run every handler registered for `event`, in registration order, awaited inline
 * with NO timeout, and merge their results.
 *
 * A handler that throws is logged and treated as "no opinion" — the remaining
 * handlers still run and the turn is never broken.
 */
export async function runHooks<E extends HookEvent>(
  hooks: AgentHooks | undefined,
  event: E,
  payload: HookPayloads[E],
): Promise<HookResults[E]> {
  const handlers = toHookArray(hooks?.[event]);

  const call = async (i: number, p: unknown): Promise<unknown> => {
    try {
      return await handlers[i](p);
    } catch (err) {
      console.error(`[hooks] ${event} handler #${i} threw — ignored:`, err);
      return undefined;
    }
  };

  switch (event) {
    case "onPreTool": {
      const p = payload as HookPayloads["onPreTool"];
      let input = p.input;
      let decision: PreToolDecision["decision"] = "allow";
      let reason: string | undefined;
      for (let i = 0; i < handlers.length; i++) {
        // Each handler sees the input as composed by the handlers before it.
        const r = (await call(i, { ...p, input })) as PreToolResult | undefined;
        if (!r) continue;
        if (r.modifiedInput) input = r.modifiedInput;
        if (r.decision === "deny") {
          decision = "deny";
          reason = r.reason;
          break;                       // first deny short-circuits the chain
        }
        if (r.decision === "ask" && decision === "allow") decision = "ask";
      }
      return { decision, reason, input } as HookResults[E];
    }

    case "onPostTool": {
      const p = payload as HookPayloads["onPostTool"];
      let outcome = p.outcome;
      for (let i = 0; i < handlers.length; i++) {
        const r = (await call(i, { ...p, outcome })) as PostToolResult | undefined;
        if (r?.outcome) outcome = r.outcome;   // rewrites compose in order
      }
      return outcome as HookResults[E];
    }

    case "onUserPrompt": {
      const p = payload as HookPayloads["onUserPrompt"];
      let parts = p.parts;
      let userDisplayText: string | undefined;
      let meta: Record<string, unknown> | undefined;
      for (let i = 0; i < handlers.length; i++) {
        const r = (await call(i, {
          parts,
          sessionId: p.sessionId,
          firstInChat: p.firstInChat,
          displayText: p.displayText,
        })) as UserPromptResult | undefined;
        if (!r) continue;
        if (r.parts) parts = r.parts;                       // compose in order
        if (r.userDisplayText !== undefined) userDisplayText = r.userDisplayText;
        if (r.meta) {
          if (!meta) {
            meta = { ...r.meta };
          } else {
            for (const [key, value] of Object.entries(r.meta)) {
              if (key === ATTACHMENT_CHIPS_KEY && Array.isArray(meta[key]) && Array.isArray(value)) {
                meta[key] = [...(meta[key] as unknown[]), ...(value as unknown[])];
              } else {
                meta[key] = value;
              }
            }
          }
        }
      }
      return { parts, userDisplayText, meta } as HookResults[E];
    }

    case "onPreCompact": {
      let veto = false;
      for (let i = 0; i < handlers.length; i++) {
        const r = (await call(i, payload)) as PreCompactResult | undefined;
        if (r?.veto) veto = true;      // any veto wins; every handler still runs
      }
      return { veto } as HookResults[E];
    }

    default: {
      // onTurnEnd, onPostCompact, onSessionStart — observe only.
      for (let i = 0; i < handlers.length; i++) await call(i, payload);
      return undefined as HookResults[E];
    }
  }
}
