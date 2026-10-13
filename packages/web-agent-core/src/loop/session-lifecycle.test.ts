import { describe, it, expect, vi, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { clear } from "idb-keyval";
import { buildFlushRecord, reconstructState, type TurnFlushRecord } from "./session-lifecycle.js";
import { ContextManager } from "./context-manager.js";
import type { JournalEntry } from "./context-manager.js";
import type { ModelMessage } from "../types.js";
import {
  IdbSessionStore,
  type SessionStore,
  type SessionMeta,
  type SessionRecordRange,
  type SessionRecordPage,
} from "./session-store.js";

// ---------------------------------------------------------------------------
// reconstructState
// ---------------------------------------------------------------------------

describe("reconstructState", () => {
  it("empty records → empty journal, empty audit", () => {
    expect(reconstructState([])).toEqual({ journal: [], audit: [] });
  });

  it("null/undefined entries in array are filtered", () => {
    const entry: JournalEntry = { msg: { role: "user", content: "hi" }, meta: { turnId: "t1", stepNo: 0, kinds: [], chars: 2, createdAt: 0 } };
    const record: TurnFlushRecord = { _kind: "turn_flush", journalDelta: [entry], audit: [] };
    const result = reconstructState([null, undefined, record]);
    expect(result.journal).toHaveLength(1);
    expect(result.audit).toEqual([]);
  });

  it("single TurnFlushRecord — journal delta and state recovered", () => {
    const entry: JournalEntry = { msg: { role: "user", content: "hello" }, meta: { turnId: "t1", stepNo: 0, kinds: [], chars: 5, createdAt: 1 } };
    const ae = { ts: 1, name: "click", input: {}, outcomeSummary: "ok" };
    const record: TurnFlushRecord = { _kind: "turn_flush", journalDelta: [entry], audit: [ae] };
    const result = reconstructState([record]);
    expect(result.journal).toEqual([entry]);
    expect(result.audit).toEqual([ae]);
  });

  it("multiple records — journal is concatenation in order, audit from last", () => {
    const e1: JournalEntry = { msg: { role: "user", content: "a" }, meta: { turnId: "t1", stepNo: 0, kinds: [], chars: 1, createdAt: 1 } };
    const e2: JournalEntry = { msg: { role: "user", content: "b" }, meta: { turnId: "t1", stepNo: 1, kinds: [], chars: 1, createdAt: 2 } };
    const e3: JournalEntry = { msg: { role: "user", content: "c" }, meta: { turnId: "t2", stepNo: 0, kinds: [], chars: 1, createdAt: 3 } };
    const ae1 = { ts: 1, name: "click", input: {}, outcomeSummary: "ok" };
    const ae2 = { ts: 2, name: "type", input: {}, outcomeSummary: "done" };
    const r1: TurnFlushRecord = { _kind: "turn_flush", journalDelta: [e1, e2], audit: [ae1] };
    const r2: TurnFlushRecord = { _kind: "turn_flush", journalDelta: [e3], audit: [ae1, ae2] };
    const result = reconstructState([r1, r2]);
    expect(result.journal).toEqual([e1, e2, e3]);
    expect(result.audit).toEqual([ae1, ae2]);
  });

  it("unknown _kind records are ignored", () => {
    const entry: JournalEntry = { msg: { role: "user", content: "x" }, meta: { turnId: "t1", stepNo: 0, kinds: [], chars: 1, createdAt: 1 } };
    const good: TurnFlushRecord = { _kind: "turn_flush", journalDelta: [entry], audit: [] };
    const bad = { _kind: "something_else", data: "ignored" };
    const result = reconstructState([bad, good]);
    expect(result.journal).toHaveLength(1);
  });

  it("ignores a legacy record that still carries a memo field", () => {
    const entry: JournalEntry = { msg: { role: "user", content: "x" }, meta: { turnId: "t1", stepNo: 0, kinds: [], chars: 1, createdAt: 1 } };
    const legacyRecord = {
      _kind: "turn_flush",
      journalDelta: [entry],
      memo: { version: 1, coveredThroughTurnId: "t1", text: "old" },
      audit: [],
    };
    const result = reconstructState([legacyRecord]);
    expect(result.journal).toEqual([entry]);
    expect(result.audit).toEqual([]);
    expect("memo" in result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildFlushRecord
// ---------------------------------------------------------------------------

describe("buildFlushRecord", () => {
  it("round-trip: buildFlushRecord → reconstructState", () => {
    const e1: JournalEntry = { msg: { role: "user", content: "hi" }, meta: { turnId: "t1", stepNo: 0, kinds: [], chars: 2, createdAt: 1 } };
    const e2: JournalEntry = { msg: { role: "user", content: "there" }, meta: { turnId: "t2", stepNo: 0, kinds: [], chars: 5, createdAt: 2 } };
    const ae = { ts: 1, name: "see", input: {}, outcomeSummary: "visible" };

    const r1 = buildFlushRecord([e1], []);
    const r2 = buildFlushRecord([e2], [ae]);

    const result = reconstructState([r1, r2]);
    expect(result.journal).toEqual([e1, e2]);
    expect(result.audit).toEqual([ae]);
  });
});

// ---------------------------------------------------------------------------
// Flush-once-per-turn (mock SessionStore)
// ---------------------------------------------------------------------------

/** In-memory SessionStore for testing */
class MockSessionStore implements SessionStore {
  private _index: SessionMeta[] = [];
  private _records: Map<string, unknown[]> = new Map();

  appendRecords = vi.fn((sessionId: string, records: unknown[]) => {
    const existing = this._records.get(sessionId) ?? [];
    this._records.set(sessionId, [...existing, ...records]);
    return Promise.resolve();
  });

  truncateAfter = vi.fn((sessionId: string, seq: number) => {
    this._records.set(sessionId, (this._records.get(sessionId) ?? []).slice(0, seq));
    return Promise.resolve();
  });

  saveMeta = vi.fn((sessionId: string, meta: Partial<SessionMeta>) => {
    const idx = this._index.findIndex(m => m.id === sessionId);
    if (idx !== -1) this._index[idx] = { ...this._index[idx], ...meta };
    return Promise.resolve();
  });

  createSession(meta: SessionMeta): Promise<void> {
    this._index.push(meta);
    return Promise.resolve();
  }

  loadAllMetadata(): Promise<SessionMeta[]> {
    return Promise.resolve([...this._index].sort((a, b) => b.updatedAt - a.updatedAt));
  }

  readRange(sessionId: string, range: SessionRecordRange): Promise<SessionRecordPage> {
    const all = this._records.get(sessionId) ?? [];
    const end = range.before ?? all.length;          // exclusive-of-nothing: seq N is index N-1
    const start = Math.max(0, end - range.limit);
    return Promise.resolve({
      records: all.slice(start, end),
      cursor: start >= 1 ? start : undefined,
    });
  }

  deleteByIds(ids: string[]): Promise<void> {
    this._index = this._index.filter(m => !ids.includes(m.id));
    ids.forEach(id => this._records.delete(id));
    return Promise.resolve();
  }
}

/** Creates the flush/hook wiring used by the panel, for testing in isolation. */
function wireFlushHooks(
  cm: ContextManager,
  store: SessionStore,
  state: { sessionId: string | null; flushedLength: number }
): void {
  const origCommitTurn = cm.commitTurn.bind(cm);
  cm.commitTurn = (messages?: ModelMessage[]) => {
    origCommitTurn(messages);
    if (!store || !state.sessionId) return;
    const newEntries = cm.journal.slice(state.flushedLength);
    state.flushedLength = cm.journal.length;
    const record = buildFlushRecord(newEntries, cm.audit);
    store.appendRecords(state.sessionId, [record]).catch(() => {});
    store.saveMeta(state.sessionId, { updatedAt: Date.now(), messageCount: cm.journal.length }).catch(() => {});
  };
}

describe("flush-once-per-turn (via mock SessionStore)", () => {
  let store: MockSessionStore;
  let cm: ContextManager;
  let state: { sessionId: string | null; flushedLength: number };

  beforeEach(() => {
    store = new MockSessionStore();
    cm = new ContextManager();
    state = { sessionId: "test-session-id", flushedLength: 0 };
    wireFlushHooks(cm, store, state);
  });

  function doTurn(userText: string, assistantText: string) {
    cm.appendUser({ role: "user", content: userText });
    cm.recordStep([{ role: "assistant", content: assistantText }]);
    cm.commitTurn([{ role: "assistant", content: assistantText }]);
  }

  it("appendRecords called once per commitTurn, NOT on recordStep", () => {
    doTurn("q1", "a1");
    doTurn("q2", "a2");
    doTurn("q3", "a3");
    expect(store.appendRecords).toHaveBeenCalledTimes(3);
  });

  it("saveMeta called once per turn with correct messageCount", () => {
    doTurn("q1", "a1");
    doTurn("q2", "a2");
    expect(store.saveMeta).toHaveBeenCalledTimes(2);
    const lastCall = store.saveMeta.mock.calls[1][1];
    expect(lastCall.messageCount).toBe(cm.journal.length);
  });

  it("journalDelta contains only new entries since last flush", () => {
    doTurn("first", "reply1");
    const firstRecord = store.appendRecords.mock.calls[0][1][0] as TurnFlushRecord;
    expect(firstRecord.journalDelta.length).toBeGreaterThan(0);
    const firstLen = firstRecord.journalDelta.length;

    doTurn("second", "reply2");
    const secondRecord = store.appendRecords.mock.calls[1][1][0] as TurnFlushRecord;
    // Delta should only contain new entries
    expect(secondRecord.journalDelta.length).toBeGreaterThan(0);
    // Total journal = sum of deltas
    expect(firstLen + secondRecord.journalDelta.length).toBe(cm.journal.length);
  });

  it("flush is no-op when sessionId is null", () => {
    state.sessionId = null;
    doTurn("q1", "a1");
    expect(store.appendRecords).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// openOrCreateActiveSession logic (via standalone helper)
// ---------------------------------------------------------------------------

/** Mirrors the controller's openOrCreateActiveSession logic for isolated testing. */
async function openOrCreate(
  store: SessionStore,
  cm: ContextManager,
  flushFn: (cm: ContextManager) => void,
  syncFn: () => void
): Promise<{ sessionId: string; flushedLength: number }> {
  const allSessions = await store.loadAllMetadata();
  let sessionId: string;
  let loadedJournalLength = 0;

  if (allSessions.length === 0) {
    sessionId = crypto.randomUUID();
    const now = Date.now();
    await store.createSession({ id: sessionId, title: "", titleManual: false, createdAt: now, updatedAt: now, messageCount: 0 });
  } else {
    sessionId = allSessions[0].id;
    const records: unknown[] = [];
    let cursor: number | undefined;
    for (;;) {
      const page = await store.readRange(sessionId, { before: cursor, limit: 200 });
      records.unshift(...page.records);
      if (page.cursor === undefined) break;
      cursor = page.cursor;
    }
    const { journal, audit } = reconstructState(records);
    cm.rehydrateState(journal, audit);
    loadedJournalLength = journal.length;
  }

  if (cm.journal.length > loadedJournalLength) {
    flushFn(cm);
  }

  syncFn();
  return { sessionId, flushedLength: loadedJournalLength };
}

describe("_openOrCreateActiveSession logic", () => {
  let store: IdbSessionStore;

  beforeEach(async () => {
    await clear();
    store = new IdbSessionStore();
  });

  it("empty index → creates fresh session, index has 1 entry", async () => {
    const cm = new ContextManager();
    const syncFn = vi.fn();
    const result = await openOrCreate(store, cm, () => {}, syncFn);

    const sessions = await store.loadAllMetadata();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].messageCount).toBe(0);
    expect(sessions[0].title).toBe("");
    expect(sessions[0].id).toBe(result.sessionId);
    expect(syncFn).toHaveBeenCalled();
  });

  it("non-empty index → resumes most-recently-updated session", async () => {
    // Seed two sessions; second is more recently updated
    const older = { id: "sess-old", title: "old", titleManual: false, createdAt: 1000, updatedAt: 1000, messageCount: 0 };
    const newer = { id: "sess-new", title: "new", titleManual: false, createdAt: 2000, updatedAt: 2000, messageCount: 1 };
    await store.createSession(older);
    await store.createSession(newer);

    // Seed a TurnFlushRecord for the newer session
    const entry: JournalEntry = { msg: { role: "user", content: "hi" }, meta: { turnId: "t1", stepNo: 0, kinds: [], chars: 2, createdAt: 2000 } };
    const record: TurnFlushRecord = { _kind: "turn_flush", journalDelta: [entry], audit: [] };
    await store.appendRecords("sess-new", [record]);

    const cm = new ContextManager();
    const result = await openOrCreate(store, cm, () => {}, () => {});

    // Should resume the most recently updated session
    expect(result.sessionId).toBe("sess-new");
    // CM should be rehydrated with the session's journal
    expect(cm.journal).toHaveLength(1);
    expect(result.flushedLength).toBe(1);
  });

  it("backlog flush: entries committed before init resolves are flushed on init", async () => {
    const cm = new ContextManager();
    const flushedRecords: TurnFlushRecord[] = [];
    const state = { sessionId: null as string | null, flushedLength: 0 };

    const flushFn = (cmArg: ContextManager) => {
      const newEntries = cmArg.journal.slice(state.flushedLength);
      state.flushedLength = cmArg.journal.length;
      flushedRecords.push(buildFlushRecord(newEntries, cmArg.audit));
    };

    // Simulate: user turns committed before session init resolves
    cm.appendUser({ role: "user", content: "early message" });
    cm.commitTurn();
    // journal now has entries but state.sessionId is still null

    // Now init resolves (cm.journal.length > 0 > loadedJournalLength=0)
    const result = await openOrCreate(store, cm, flushFn, () => {});
    state.sessionId = result.sessionId;

    // The backlog flush should have been triggered
    expect(flushedRecords).toHaveLength(1);
    expect(flushedRecords[0].journalDelta.length).toBeGreaterThan(0);
  });

  it("a session read back one page at a time reconstructs the same journal and audit as one full read", async () => {
    const id = "paged-session";
    await store.createSession({ id, title: "", titleManual: false, createdAt: 0, updatedAt: 0, messageCount: 0 });
    for (let i = 1; i <= 25; i++) {
      const entry: JournalEntry = { msg: { role: "user", content: `m${i}` }, meta: { turnId: `t${i}`, stepNo: 0, kinds: [], chars: 1, createdAt: i } };
      const record: TurnFlushRecord = { _kind: "turn_flush", journalDelta: [entry], audit: [{ ts: i, name: "step", input: {}, outcomeSummary: `audit${i}` }] };
      await store.appendRecords(id, [record]);
    }

    const paged: unknown[] = [];
    let cursor: number | undefined;
    for (;;) {
      const page = await store.readRange(id, { before: cursor, limit: 7 });
      paged.unshift(...page.records);
      if (page.cursor === undefined) break;
      cursor = page.cursor;
    }
    const full = await store.readRange(id, { before: undefined, limit: 1000 });

    const fromPaged = reconstructState(paged);
    const fromFull = reconstructState(full.records);
    expect(fromPaged).toEqual(fromFull);
    expect(fromPaged.audit).toEqual([{ ts: 25, name: "step", input: {}, outcomeSummary: "audit25" }]);
  });
});
