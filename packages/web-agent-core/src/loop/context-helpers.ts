import type { ModelMessage, ContentPart } from "../types.js";
import type { JournalEntry, PartKind } from "./types.js";

export const isDev = (() => {
  try {
    if (typeof process !== "undefined" && process.env && process.env.NODE_ENV) {
      return process.env.NODE_ENV !== "production";
    }
  } catch { /* process is not available in this runtime; fall through */ }
  try {
    if (typeof import.meta !== "undefined" && (import.meta as { env?: { DEV?: boolean } }).env) {
      return !!(import.meta as { env?: { DEV?: boolean } }).env?.DEV;
    }
  } catch { /* import.meta is not available in this runtime; fall through */ }
  return true;
})();

/** Helper to extract raw text from tool result output. */
function getOutputText(output: unknown): string {
  if (typeof output === "string") return output;
  if (output && typeof output === "object") {
    if ("value" in output && typeof (output as { value?: unknown }).value === "string") {
      return (output as { value: string }).value;
    }
    if ("content" in output && typeof (output as { content?: unknown }).content === "string") {
      return (output as { content: string }).content;
    }
  }
  return "";
}

/** 107/004: a stable string identity for one tool call's arguments — the
 *  `hashArgs` of the plan's pseudo code. Object keys are sorted at every depth,
 *  so `{a:1,b:2}` and `{b:2,a:1}` produce the same string and share one TTL
 *  window. No arguments, or an empty argument object, is the identity `"-"`.
 *
 *  There is deliberately no digest: the value is only ever a `Map` key inside a
 *  single sweep, `crypto.subtle.digest()` is async and secure-context-only
 *  (MDN, checked 2026-09-04), and a raw canonical string cannot collide.
 */
export function hashArgs(args: Record<string, unknown> | undefined): string {
  if (!args || Object.keys(args).length === 0) return "-";
  return stableStringify(args);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

/** 107/004: what replaces an expired result's content. It names the tool and the
 *  age, so the model can see a result existed there and call the tool again. */
export function redactionNote(toolName: string, age: number): string {
  return `[expired ${toolName} result — ${age} user turn${age === 1 ? "" : "s"} old. Call ${toolName} again if you need it.]`;
}

/** P0 Classify part helper. */
export function classifyParts(msg: ModelMessage): PartKind[] {
  const content = msg.content;
  const role = msg.role;

  if (typeof content === "string") {
    if (role === "user") {
      return [content.startsWith("[ui_action:") ? "ui_action" : "user_prose"];
    } else if (role === "assistant") {
      return [content.includes("```ui") ? "assistant_ui_block" : "assistant_prose"];
    }
    return ["user_prose"];
  }

  if (Array.isArray(content)) {
    return content.map((part) => {
      if (part.type === "text") {
        const text = part.text || "";
        if (role === "user") {
          return text.startsWith("[ui_action:") ? "ui_action" : "user_prose";
        } else if (role === "assistant") {
          return text.includes("```ui") ? "assistant_ui_block" : "assistant_prose";
        }
        return "user_prose";
      } else if (part.type === "tool-call") {
        return "tool_call";
      } else if (part.type === "thinking" || part.type === "redacted_thinking") {
        return "assistant_prose";
      } else if (part.type === "image") {
        return "user_prose";
      } else if (part.type === "tool-result") {
        const toolName = part.toolName;
        if (toolName === "snapshot_page") {
          return "tool_result_snapshot";
        } else if (toolName === "query_state") {
          return "tool_result_query";
        } else if (
          toolName === "click" ||
          toolName === "fill" ||
          toolName === "select_option"
        ) {
          return "tool_result_action";
        } else if (toolName === "wait_for") {
          return "tool_result_wait";
        }
        return "tool_result_action";
      }
      if (role === "user") return "user_prose";
      if (role === "assistant") return "assistant_prose";
      return "user_prose";
    });
  }

  return ["user_prose"];
}

export function extractMeta(msg: ModelMessage, turnId: string, stepNo: number, userTurn: number): JournalEntry["meta"] {
  const kinds = classifyParts(msg);
  const chars = JSON.stringify(msg).length;
  
  let toolName: string | undefined;
  let generation: number | undefined;

  if (msg.role === "tool") {
    if (Array.isArray(msg.content) && msg.content.length > 0) {
      const first = msg.content[0];
      if (first.type === "tool-result") {
        toolName = first.toolName;
        if (toolName === "snapshot_page") {
          const val = getOutputText(first.output);
          const match = val.match(/generation:\s*(\d+)/i);
          if (match) {
            generation = parseInt(match[1], 10);
          }
        }
      }
    }
  } else if (msg.role === "assistant") {
    if (Array.isArray(msg.content)) {
      const firstCall = msg.content.find((part) => part.type === "tool-call");
      if (firstCall && firstCall.type === "tool-call") {
        toolName = firstCall.toolName;
      }
    }
  }

  return {
    turnId,
    stepNo,
    userTurn,
    kinds,
    chars,
    toolName,
    generation,
    createdAt: Date.now(),
  };
}

export function cloneJournal(journal: JournalEntry[]): JournalEntry[] {
  return journal.map((entry) => {
    let clonedContent: ContentPart[] | string = entry.msg.content;
    if (Array.isArray(entry.msg.content)) {
      clonedContent = entry.msg.content.map((part) => {
        const clonedPart = { ...part };
        if (clonedPart.type === "tool-result" && clonedPart.output && typeof clonedPart.output === "object") {
          clonedPart.output = { ...clonedPart.output };
        }
        return clonedPart;
      });
    }

    return {
      msg: {
        role: entry.msg.role,
        content: clonedContent,
        ...(entry.msg.providerOptions ? { providerOptions: { ...entry.msg.providerOptions } } : {}),
      } as ModelMessage,
      meta: { ...entry.meta, kinds: [...entry.meta.kinds] },
    };
  });
}

/** The candidates that are not already in `known` — by object reference first,
 *  and by serialized value only for a candidate that failed the reference
 *  check. `known` grows as matches are found, so a duplicate candidate inside
 *  one call is dropped too.
 *
 *  Serializing is a fallback, not the main path: `commitTurn()` normally hands
 *  over the very messages `recordStep()` already journaled, and a turn can hold
 *  ten tool calls whose results run to kilobytes each. */
export function unjournaled(
  known: Set<ModelMessage>,
  candidates: readonly ModelMessage[],
): ModelMessage[] {
  const out: ModelMessage[] = [];
  let knownJson: Set<string> | null = null;
  for (const msg of candidates) {
    if (known.has(msg)) continue;
    if (!knownJson) knownJson = new Set(Array.from(known, (m) => JSON.stringify(m)));
    const serialized = JSON.stringify(msg);
    if (knownJson.has(serialized)) continue;
    out.push(msg);
    known.add(msg);
    knownJson.add(serialized);
  }
  return out;
}
