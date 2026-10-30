import type { ModelMessage, ToolImage } from "../types.js";
import { DEFAULT_CONTEXT_CONFIG } from "../config.js";
import type { ContextConfig } from "../config.types.js";
import type { AuditEntry, JournalEntry, ToolTtlPolicy } from "./types.js";
export type { AuditEntry, JournalEntry, PartKind, ToolTtlPolicy } from "./types.js";
import { isDev, extractMeta, cloneJournal, unjournaled } from "./context-helpers.js";
export { classifyParts } from "./context-helpers.js";
import {
  assembleContext,
  currentUserTurn,
  lastTombstoneIndex,
  startOfNthTurnBefore,
} from "./context-assembly.js";
import { redactExpiredResultsInJournal } from "./context-redact.js";
import { validateContextInvariants } from "./context-validate.js";

export class ContextManager {
  #journal: JournalEntry[] = [];
  #audit: AuditEntry[] = [];
  #cfg: ContextConfig;
  #currentTurnId: string = "";
  #stepNo: number = 0;
  #completedTurns = new Set<string>();
  #turnAudits = new Map<string, AuditEntry[]>();
  #needsCompaction: boolean = false;
  #mode: "assert" | "warn";
  #lastKnownInputTokens: number | null = null;
  #lastKnownJournalLength: number = 0;
  #version: number = 0;
  #cachedUsage: { tokens: number; max: number; percent: number } | null = null;
  #cachedUsageVersion: number = -1;

  constructor(cfg: ContextConfig = DEFAULT_CONTEXT_CONFIG) {
    this.#cfg = cfg;
    this.#mode = cfg.mode || (isDev ? "assert" : "warn");
  }

  get version(): number {
    return this.#version;
  }

  recordUsage(usage: { inputTokens?: number; cacheReadTokens?: number; cacheCreationTokens?: number } | number): void {
    const total = typeof usage === "number"
      ? usage
      : (usage.inputTokens ?? 0) + (usage.cacheReadTokens ?? 0) + (usage.cacheCreationTokens ?? 0);
    this.#lastKnownInputTokens = total;
    this.#lastKnownJournalLength = this.#journal.length;
    this.#version++;
  }

  get config(): ContextConfig {
    return this.#cfg;
  }

  get mode(): "assert" | "warn" {
    return this.#mode;
  }

  set mode(val: "assert" | "warn") {
    this.#mode = val;
  }

  get journal(): JournalEntry[] {
    return this.#journal;
  }

  get audit(): AuditEntry[] {
    return this.#audit;
  }

  // 074: the id of the turn currently in flight (appended via appendUser,
  // not yet commitTurn'd). undefined when no turn is open.
  get activeTurnId(): string | undefined {
    if (this.#currentTurnId && !this.#completedTurns.has(this.#currentTurnId)) {
      return this.#currentTurnId;
    }
    return undefined;
  }

  getTurnAudits(turnId: string): readonly AuditEntry[] | undefined {
    return this.#turnAudits.get(turnId);
  }

  /**
   * 107/002: record a compaction by APPENDING a tombstone. Nothing already in
   * the journal is rewritten or removed, so replay and rollback keep working.
   *
   * The entry carries no text of its own — its `msg` is an empty user message,
   * so the UI transcript renders nothing for it and `assembleContext` builds
   * the summary message itself. It shares the current turn id, so it rolls
   * back with that turn: "an ordinary journal entry — it persists, replays and
   * rolls back with everything else".
   */
  appendTombstone(summary: string): void {
    const msg: ModelMessage = { role: "user", content: "" };
    this.#journal.push({
      msg,
      meta: {
        turnId: this.#currentTurnId,
        stepNo: this.#stepNo,
        kinds: ["summary_stub"],
        chars: JSON.stringify(msg).length,
        createdAt: Date.now(),
        tombstone: { summary },
      },
    });
    // The real-usage baseline (#lastKnownInputTokens, tracked from the
    // provider's actual reported usage) predates the tombstone and has no idea
    // it exists — #getCurrentTokenCount's fast path would keep adding deltas
    // on top of a token count computed before compaction happened, so
    // getUsage() (and onPostCompact's tokensBefore/tokensAfter) would report
    // the exact same number whether or not compaction ran. Reset it so the
    // next getUsage() falls back to an honest estimateTokens() over the
    // rebuilt context.
    this.#lastKnownInputTokens = null;
    this.#lastKnownJournalLength = 0;
    this.#version++;
  }

  /**
   * Count of journal entries that the last tombstone summarised away — entries
   * strictly before the two kept turns preceding the tombstone, tombstones
   * excluded. Returns 0 when no tombstone exists.
   */
  messagesSummarisedByLastTombstone(): number {
    const t = lastTombstoneIndex(this.#journal);
    if (t === -1) return 0;
    const keptStart = startOfNthTurnBefore(this.#journal, t, 2);
    let count = 0;
    for (let i = 0; i < keptStart; i++) {
      if (!this.#journal[i].meta.tombstone) {
        count++;
      }
    }
    return count;
  }

  /**
   * Count of tool-call parts among the entries the last tombstone summarised
   * away — the same dropped range as `messagesSummarisedByLastTombstone()`,
   * counted by `tool_call` entries in `meta.kinds` (one per content part, so
   * a single message with 2 tool calls counts as 2). Returns 0 when no
   * tombstone exists.
   */
  toolCallsRedactedByLastTombstone(): number {
    const t = lastTombstoneIndex(this.#journal);
    if (t === -1) return 0;
    const keptStart = startOfNthTurnBefore(this.#journal, t, 2);
    let count = 0;
    for (let i = 0; i < keptStart; i++) {
      const entry = this.#journal[i];
      if (entry.meta.tombstone) continue;
      count += entry.meta.kinds.filter((k) => k === "tool_call").length;
    }
    return count;
  }

  rehydrateState(journal: JournalEntry[], audit: AuditEntry[]): void {
    this.#journal = journal;
    this.#audit = audit;
    this.#version++;

    this.#completedTurns.clear();
    this.#turnAudits.clear();

    const turnIdsInJournal = new Set<string>();
    for (const entry of journal) {
      turnIdsInJournal.add(entry.meta.turnId);
    }

    for (const tid of turnIdsInJournal) {
      this.#completedTurns.add(tid);
    }

    if (journal.length > 0) {
      this.#currentTurnId = journal[journal.length - 1].meta.turnId;
      const steps = journal
        .filter((e) => e.meta.turnId === this.#currentTurnId)
        .map((e) => e.meta.stepNo);
      this.#stepNo = steps.length > 0 ? Math.max(...steps) : 0;
    }

    let auditIdx = 0;
    for (const entry of journal) {
      if (entry.msg.role === "tool" && Array.isArray(entry.msg.content)) {
        for (const part of entry.msg.content) {
          if (part.type === "tool-result") {
            const toolName = part.toolName;
            let foundAudit: AuditEntry | null = null;
            let foundIdx = -1;
            for (let k = auditIdx; k < audit.length; k++) {
              if (audit[k].name === toolName) {
                foundAudit = audit[k];
                foundIdx = k;
                auditIdx = k + 1;
                break;
              }
            }
            if (foundAudit) {
              const hasError = (part as { isError?: boolean }).isError === true;
              if (foundAudit.failed === undefined) {
                foundAudit = { ...foundAudit, failed: hasError };
                if (foundIdx >= 0) {
                  this.#audit[foundIdx] = foundAudit;
                }
              }
              const tid = entry.meta.turnId;
              if (!this.#turnAudits.has(tid)) {
                this.#turnAudits.set(tid, []);
              }
              this.#turnAudits.get(tid)!.push(foundAudit);
            }
          }
        }
      }
    }
  }

  clearNeedsCompaction(): void {
    this.#needsCompaction = false;
  }

  reset(): void {
    this.#journal = [];
    this.#audit = [];
    this.#currentTurnId = "";
    this.#stepNo = 0;
    this.#completedTurns.clear();
    this.#turnAudits.clear();
    this.#needsCompaction = false;
    this.#lastKnownInputTokens = null;
    this.#lastKnownJournalLength = 0;
    this.#version++;
  }

  /**
   * Discards the entire last turn (user message + any partial assistant/tool steps
   * and audits) so that the manager rehydrates identically to "that turn never happened".
   * Returns the removed journal entries to allow the caller to recover user input.
   * Shared primitive for 043 rollback and 044 retry.
   */
  truncateLastTurn(): JournalEntry[] {
    if (this.#journal.length === 0) {
      return [];
    }

    let targetTurnId = this.#currentTurnId;
    const hasTarget = targetTurnId !== "" && this.#journal.some(e => e.meta.turnId === targetTurnId);
    if (!hasTarget) {
      targetTurnId = this.#journal[this.#journal.length - 1].meta.turnId;
    }

    const targetIndex = this.#journal.findIndex(e => e.meta.turnId === targetTurnId);
    if (targetIndex === -1) {
      return [];
    }

    const removed = this.#journal.slice(targetIndex);
    this.#journal = this.#journal.slice(0, targetIndex);

    const auds = this.#turnAudits.get(targetTurnId);
    if (auds) {
      const audsSet = new Set(auds);
      this.#audit = this.#audit.filter(a => !audsSet.has(a));
      this.#turnAudits.delete(targetTurnId);
    }

    this.#completedTurns.delete(targetTurnId);

    if (this.#journal.length === 0) {
      this.#currentTurnId = "";
      this.#stepNo = 0;
    } else {
      this.#currentTurnId = this.#journal[this.#journal.length - 1].meta.turnId;
      const steps = this.#journal
        .filter((e) => e.meta.turnId === this.#currentTurnId)
        .map((e) => e.meta.stepNo);
      this.#stepNo = steps.length > 0 ? Math.max(...steps) : 0;
    }

    this.#lastKnownInputTokens = null;
    this.#lastKnownJournalLength = 0;
    this.#version++;

    // 107/002: a tombstone is an ordinary journal entry and shares the turn id
    // of the turn it followed, so rolling that turn back also drops its
    // tombstone — the context grows back to what it was. That is deliberate.

    return removed;
  }

  getCompletedTurnsInOrder(): string[] {
    const list: string[] = [];
    for (const entry of this.#journal) {
      const tid = entry.meta.turnId;
      if (this.#completedTurns.has(tid) && !list.includes(tid)) {
        list.push(tid);
      }
    }
    return list;
  }

  #eligibleTurnsToCompact(): string[] {
    const allCompleted = this.getCompletedTurnsInOrder();
    const verbatim = allCompleted.slice(-this.#cfg.kTurnsVerbatim);

    let eligible = allCompleted.filter(tid => !verbatim.includes(tid));
    // Everything at or before the last tombstone is already summarised.
    const t = lastTombstoneIndex(this.#journal);
    if (t !== -1) {
      const covered = new Set(this.#journal.slice(0, t + 1).map(e => e.meta.turnId));
      eligible = eligible.filter(tid => !covered.has(tid));
    }
    return eligible;
  }

  /** Cheap check (no serialization) for whether manual compaction would do anything. */
  hasCompactableTurns(): boolean {
    return this.#eligibleTurnsToCompact().length > 0;
  }

  turnsToCompact(): { turnIds: string[]; serialized: string } {
    const eligible = this.#eligibleTurnsToCompact();

    if (eligible.length === 0) {
      return { turnIds: [], serialized: "" };
    }

    return {
      turnIds: eligible,
      serialized: "",
    };
  }

  get needsCompaction(): boolean {
    return this.#needsCompaction;
  }

  appendUser(
    msg: ModelMessage,
    userDisplayText?: string,
    promptMeta?: Record<string, unknown>,
  ): void {
    this.#currentTurnId = `turn-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    this.#stepNo = 0;
    const meta = extractMeta(msg, this.#currentTurnId, this.#stepNo, currentUserTurn(this.#journal));
    if (userDisplayText !== undefined) {
      meta.userDisplayText = userDisplayText;
    }
    if (promptMeta !== undefined) {
      meta.promptMeta = promptMeta;
    }
    this.#journal.push({ msg, meta });
    this.#version++;
  }

  recordStep(
    messages: ModelMessage[], audit?: AuditEntry[], imagesByCallId?: Record<string, ToolImage[]>,
  ): void {
    this.#stepNo++;
    for (const msg of messages) {
      const meta = extractMeta(msg, this.#currentTurnId, this.#stepNo, currentUserTurn(this.#journal) - 1);
      // 003: a tool message keeps the images its own calls returned. Saved here,
      // on the journal entry, so a flush writes them once (the audit list is
      // re-saved whole in every flush — loop/session-lifecycle.ts).
      if (msg.role === "tool" && imagesByCallId && Array.isArray(msg.content)) {
        const own: Record<string, ToolImage[]> = {};
        for (const part of msg.content) {
          if (part.type === "tool-result" && imagesByCallId[part.toolCallId]) {
            own[part.toolCallId] = imagesByCallId[part.toolCallId];
          }
        }
        if (Object.keys(own).length > 0) meta.toolImages = own;
      }
      this.#journal.push({ msg, meta });
    }
    this.#version++;

    if (audit) {
      for (const ae of audit) {
        this.#audit.push(ae);
        if (!this.#turnAudits.has(this.#currentTurnId)) {
          this.#turnAudits.set(this.#currentTurnId, []);
        }
        this.#turnAudits.get(this.#currentTurnId)!.push(ae);
      }
    }
  }

  commitTurn(messages?: ModelMessage[]): void {
    if (messages && messages.length > 0) {
      const current = this.#currentTurnId;
      const known = new Set(
        this.#journal.filter((j) => j.meta.turnId === current).map((j) => j.msg),
      );
      for (const msg of unjournaled(known, messages)) {
        this.#journal.push({
          msg,
          meta: extractMeta(msg, current, this.#stepNo, currentUserTurn(this.#journal) - 1),
        });
      }
    }
    this.#completedTurns.add(this.#currentTurnId);
    this.#version++;
  }

  estimateTokens(messages: ModelMessage[]): number {
    const chars = JSON.stringify(messages).length;
    return Math.ceil(chars / this.#cfg.charsPerToken) * this.#cfg.jsonOverhead;
  }
  get #softThreshold(): number {
    return Math.round(this.#cfg.contextLength * this.#cfg.autoCompactPercent);
  }

  #getCurrentTokenCount(lastGoodMsgs: ModelMessage[]): number {
    if (this.#lastKnownInputTokens !== null) {
      const deltaEntries = this.#journal.slice(this.#lastKnownJournalLength);
      if (deltaEntries.length === 0) {
        return this.#lastKnownInputTokens;
      }
      const deltaMsgs = deltaEntries.map((e) => e.msg);
      const deltaTokens = this.estimateTokens(deltaMsgs);
      return this.#lastKnownInputTokens + deltaTokens;
    }
    return this.estimateTokens(lastGoodMsgs);
  }

  getUsage(): { tokens: number; max: number; percent: number } {
    if (this.#journal.length === 0) {
      if (this.#cachedUsage && this.#cachedUsageVersion === this.#version && this.#cachedUsage.tokens === 0) {
        return this.#cachedUsage;
      }
      this.#cachedUsage = { tokens: 0, max: this.#cfg.contextLength, percent: 0 };
      this.#cachedUsageVersion = this.#version;
      return this.#cachedUsage;
    }
    if (this.#cachedUsage && this.#cachedUsageVersion === this.#version) {
      return this.#cachedUsage;
    }
    const tokens = this.#getCurrentTokenCount(assembleContext(this.#journal));
    const max = this.#cfg.contextLength;
    const rawPercent = max > 0 ? tokens / max : 0;
    const percent = Math.min(Math.max(rawPercent, 0), 1);
    this.#cachedUsage = { tokens, max, percent };
    this.#cachedUsageVersion = this.#version;
    return this.#cachedUsage;
  }

  /**
   * 107/004: expire tool results whose declared lifetime has run out, in place
   * in the journal. Returns how many results it redacted.
   *
   * The sweep itself is `redactExpiredResultsInJournal` in
   * `./context-redact.js`, which carries the full explanation.
   */
  redactExpiredResults(defs: readonly ToolTtlPolicy[]): number {
    const redacted = redactExpiredResultsInJournal(this.#journal, defs);

    if (redacted > 0) {
      // Same reason appendTombstone resets these: the real-usage baseline was
      // reported by the provider BEFORE this sweep, so #getCurrentTokenCount's
      // fast path would keep adding deltas on top of a count that still
      // includes every byte just removed, and getUsage() would never show the
      // drop. Bumping #version also invalidates the getUsage() cache.
      this.#lastKnownInputTokens = null;
      this.#lastKnownJournalLength = 0;
      this.#version++;
    }

    return redacted;
  }

  compose(): ModelMessage[] {
    this.#needsCompaction = false;
    if (this.#journal.length === 0) return [];

    const lastGood = assembleContext(cloneJournal(this.#journal));

    // P1 used to run this inside its own try/catch and silently drop its
    // redaction when it threw. Redaction is now persisted, so there is nothing
    // to revert — warn and carry on, which is what "warn" mode already did.
    try {
      this.validateWorkingContext(lastGood);
    } catch (e) {
      console.warn(String(e));
    }

    // The 75% soft check is all that remains of P4. It sets the flag; it never
    // drops or rewrites anything.
    if (this.#getCurrentTokenCount(lastGood) > this.#softThreshold) {
      this.#needsCompaction = true;
    }

    return lastGood;
  }

  validateWorkingContext(msgs: ModelMessage[]): void {
    validateContextInvariants(msgs, this.#mode);
  }
}
