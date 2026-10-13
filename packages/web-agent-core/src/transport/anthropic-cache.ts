// Prompt-cache helpers for the Anthropic provider. Split out of
// anthropic-provider.ts; the code is unchanged apart from being exported so
// the provider can import it.
import type { MessageParam, CacheControlEphemeral } from "./wire.types.js";

// ---------------------------------------------------------------------------
// normalizeMessageContent: convert every message's bare-string content into a
// single-block text array, so a message's serialized shape never depends on
// whether it happens to be the message the rolling cache breakpoint currently
// lands on. Anthropic treats a bare string and an equivalent one-block text
// array as the same input, but they are DIFFERENT BYTES — and Anthropic's
// cache match is a byte-for-byte positional prefix. Without this, the message
// that carried the breakpoint on the request where it was last (block array,
// `applyRollingCacheBreakpoint` below converted it) reverts to a bare string
// the moment a later request's breakpoint moves past it (e.g. compaction's
// appended turn) — task 001's Stage-B review caught this: the cached prefix
// stopped matching at exactly that message, so most of the history was still
// billed at full price despite `tools`/`system` matching exactly. Mutates
// `messages` in place; called at the start of `applyRollingCacheBreakpoint` so
// the turn and the compaction path (which share `buildParams` in
// anthropic-provider.ts) see identical shapes whichever message ends up last.
// ---------------------------------------------------------------------------
export function normalizeMessageContent(messages: MessageParam[]): void {
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      if (msg.content.length === 0) continue; // nothing to normalize
      msg.content = [{ type: "text", text: msg.content }];
    }
  }
}

// ---------------------------------------------------------------------------
// applyRollingCacheBreakpoint: tag the LAST content block of the LAST message
// with cache_control ephemeral, so within a turn the tool-loop steps re-read
// the (append-only) prior history from Anthropic's prompt cache. Exactly one
// message-level breakpoint is ever added. Mutates `messages` in place.
// Requires every message already normalized to block-array form (see
// normalizeMessageContent above) so adding/removing this annotation is a
// pure annotation change, never a content-shape change.
// ---------------------------------------------------------------------------
export function applyRollingCacheBreakpoint(messages: MessageParam[]): void {
  if (messages.length === 0) return;
  normalizeMessageContent(messages);
  const last = messages[messages.length - 1];
  const cc = { type: "ephemeral" } as const;

  const blocks = last.content;
  if (!Array.isArray(blocks) || blocks.length === 0) return;
  const lastBlock = blocks[blocks.length - 1];
  // All Anthropic block-param types accept optional cache_control; cast to set
  // it uniformly (text / tool_result / image / tool_use).
  (lastBlock as { cache_control?: CacheControlEphemeral }).cache_control = cc;
}
