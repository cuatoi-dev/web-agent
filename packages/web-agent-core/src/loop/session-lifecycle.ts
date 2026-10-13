import type { AuditEntry, JournalEntry, TurnFlushRecord } from "./types.js";
export type { TurnFlushRecord } from "./types.js";

export function buildFlushRecord(
  journalDelta: JournalEntry[],
  audit: AuditEntry[]
): TurnFlushRecord {
  return { _kind: "turn_flush", journalDelta, audit };
}

export function reconstructState(records: unknown[]): {
  journal: JournalEntry[];
  audit: AuditEntry[];
} {
  const flushRecords = records.filter(
    (r): r is TurnFlushRecord => (r as { _kind?: unknown })?._kind === "turn_flush"
  );
  const journal: JournalEntry[] = flushRecords.flatMap(r => r.journalDelta);
  const last = flushRecords[flushRecords.length - 1];
  return {
    journal,
    audit: last?.audit ?? [],
  };
}
