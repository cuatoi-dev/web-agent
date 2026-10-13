import type { BridgeMessage } from "./types";

export type { BridgeMessage } from "./types";

/** True when `value` is a plain object. The narrowing every guard below starts
 *  from; `typeof null === "object"` is why the null test is there. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * The message a `message` event carries, or null when the event is not one of
 * ours. Replaces the `event.source !== window || !event.data ||
 * typeof event.data.type !== "string"` test both files repeated before this
 * helper existed, keeping the same three conditions in the same order.
 */
export function readBridgeMessage(event: MessageEvent): BridgeMessage | null {
  if (event.source !== window) return null;
  const data: unknown = event.data;
  if (!isRecord(data) || typeof data.type !== "string") return null;
  return data as BridgeMessage;
}
