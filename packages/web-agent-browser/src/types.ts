// The shapes the extension entry points in this directory share. This file
// imports nothing from a sibling module, so a sibling can import its shapes
// back from here without closing a cycle.

// --- bridge.ts -------------------------------------------------------------

/** What the MAIN world reports back about the bubble. */
export interface TabAgentState {
  origin: string;
  mounted: boolean;
  foreign: boolean;
}

/** What the MAIN world reports back about a toggle: the state that resulted,
 *  plus the direction that was asked for. A toggle that asked for ON and
 *  came back not mounted is a refusal, not a turn-off. */
export interface TabAgentToggleResult extends TabAgentState {
  requested: "on" | "off";
}

/** What the MAIN world reports back about a send. `delivered` says the message
 *  reached the in-page panel's session — not that the page agent has answered.
 *  It is false when there was no bubble to send to, or when the bubble's own
 *  `send()` failed before the message reached that session.
 *
 *  001/113 — `ranCommand` says whether the panel resolved the text as a slash
 *  command and handled it. `command` carries the name, without the leading
 *  slash, when it did. A `/new` that arrived as ordinary text has
 *  `delivered: true` and `ranCommand: false`. */
export interface TabAgentSendResult extends TabAgentState {
  delivered: boolean;
  ranCommand: boolean;
  command?: string;
}

/** One message in the bubble's conversation, as reported by the MAIN world. */
export interface TabAgentConversationMessage {
  role: string;
  text: string;
}

/** What the MAIN world reports back about a read: the bubble's conversation
 *  and whether it is still running. */
export interface TabAgentReadResult extends TabAgentState {
  messages: TabAgentConversationMessage[];
  running: boolean;
}
