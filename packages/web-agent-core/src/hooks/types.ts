import type { UserPromptMerged, UserPromptPayload } from "./user-prompt.types.js";
export type {
  HookEntry,
  HookHandler,
  UserPromptMerged,
  UserPromptPayload,
  UserPromptResult,
} from "./user-prompt.types.js";
import type {
  AgentHooks,
  PostToolPayload,
  PreCompactPayload,
  PostCompactPayload,
  PreToolPayload,
  SessionStartPayload,
  ToolOutcome,
  TurnEndPayload,
} from "../tool-hooks.types.js";
// Declared in `../tool-hooks.types.ts`: they form a type-level recursion with
// `ToolContext`, so they cannot live here without an import cycle.
export type {
  AgentHooks,
  PostToolPayload,
  PostToolResult,
  PreCompactPayload,
  PreCompactResult,
  PostCompactPayload,
  PreToolPayload,
  PreToolResult,
  SessionStartPayload,
  TurnEndPayload,
} from "../tool-hooks.types.js";

/** Merged result. `input` is the composed input the tool will actually receive. */
export interface PreToolDecision {
  decision: "allow" | "deny" | "ask";
  reason?: string;
  input: Record<string, unknown>;
}

export type HookEvent = keyof AgentHooks;

export interface HookPayloads {
  onPreTool: PreToolPayload;
  onPostTool: PostToolPayload;
  onUserPrompt: UserPromptPayload;
  onTurnEnd: TurnEndPayload;
  onPreCompact: PreCompactPayload;
  onPostCompact: PostCompactPayload;
  onSessionStart: SessionStartPayload;
}

export interface HookResults {
  onPreTool: PreToolDecision;
  onPostTool: ToolOutcome;
  onUserPrompt: UserPromptMerged;
  onTurnEnd: void;
  onPreCompact: { veto: boolean };
  onPostCompact: void;
  onSessionStart: void;
}
