// Inputs `buildSessionMessages()` needs. Each field was a closure variable of
// `createAgentSession` before the split.
import type { AuditEntry, JournalEntry } from "./loop/context-manager.js";
import type { RenderableBlock } from "./ui-blocks/types.js";
import type { CachedTurnMessages, CompactionRow } from "./controller.types.js";

export interface BuildMessagesParams {
  journal: JournalEntry[];
  audit: AuditEntry[];
  inProgressTurnId: string | undefined;
  compactionRows: CompactionRow[];
  turnCache: Map<string, CachedTurnMessages>;
  toolBlocks: Map<string, RenderableBlock>;
  toolBlocksVersion: number;
  running: boolean;
  streamingText: string;
}
