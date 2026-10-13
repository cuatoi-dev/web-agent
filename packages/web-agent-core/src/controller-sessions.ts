// Session lifecycle and persistence: opening, creating, switching and deleting
// a session, flushing a turn to the store, the auto-title, and the compaction
// rows a rehydrated journal implies. Moved out of `controller.ts` unchanged —
// each former closure variable is now read from the `SessionRuntime` passed in.
import type { SessionStore } from "./loop/session-store.js";
import { buildFlushRecord, reconstructState } from "./loop/session-lifecycle.js";
import { runBareTurn } from "./loop/agent.js";
import { ContextManager, type JournalEntry } from "./loop/context-manager.js";
import type { CompactionObserver, TurnFlushRecord } from "./loop/types.js";
import { runHooks } from "./hooks/run-hooks.js";
import type { TodoItem } from "./todo.js";
import type { CompactionRow } from "./controller.types.js";
import type { SessionRuntime } from "./controller-runtime.types.js";
import { abort, notifyListeners } from "./controller-state.js";


export function persistTodos(st: SessionRuntime, items: TodoItem[]) {
  const sess = st.sessions.find((s) => s.id === st.activeSessionId);
  if (sess) {
    sess.todos = items;
  }
  if (!st.sessionStore || !st.activeSessionId) return;
  st.sessionStore.saveMeta(st.activeSessionId, { todos: items })
    .catch((err) => console.error("[todo] saveMeta failed:", err));
}

/** 105/004 fix — rebuilds the fallback rows a rehydrated journal should show.
 *  Persisted state carries tombstones but never the live `stats` a
 *  `CompactionRow` holds during a run, so every tombstone becomes a "done"
 *  row with no stats: the single-line fallback the render path already has
 *  for exactly this case (`compaction?.status === "done" && !stats`). Without
 *  this, a reloaded or switched-to session has tombstones in its journal but
 *  an empty `compactionRows`, so no compaction row renders at all. */
export function compactionRowsFromJournal(
  st: SessionRuntime,
  journal: JournalEntry[],
): CompactionRow[] {
  const rows: CompactionRow[] = [];
  for (const entry of journal) {
    if (entry.meta.tombstone) {
      rows.push({
        id: `compaction-${++st.compactionRowSeq}`,
        afterTurnId: entry.meta.turnId,
        status: "done",
      });
    }
  }
  return rows;
}

/** The compaction row this session shows while `runCompaction` works. */
export function createCompactionObserver(st: SessionRuntime): CompactionObserver {
  return {
    onStart() {
      st.compactionAbort = new AbortController();
      st.compacting = true;
      const j = st.cm.journal;
      st.activeCompactionRowId = `compaction-${++st.compactionRowSeq}`;
      st.compactionRows.push({
        id: st.activeCompactionRowId,
        afterTurnId: j.length ? j[j.length - 1].meta.turnId : "",
        status: "running",
      });
      notifyListeners(st);
      return st.compactionAbort.signal;
    },
    onSettle(outcome, _error, stats) {
      const row = st.compactionRows.find((r) => r.id === st.activeCompactionRowId);
      if (row) {
        row.status = outcome === "compacted" ? "done" : outcome;
        if (stats) row.stats = stats;
      }
      st.activeCompactionRowId = undefined;
      st.compactionAbort = undefined;
      st.compacting = false;
      notifyListeners(st);
    },
  };
}

export async function refreshSessions(st: SessionRuntime) {
  if (st.sessionStore) {
    st.sessions = await st.sessionStore.loadAllMetadata();
  } else {
    st.sessions = [
      {
        id: st.activeSessionId || "default-session",
        title: "Default Session",
        titleManual: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messageCount: st.cm.journal.length,
      },
    ];
  }
}

/** How many records one `readRange` call asks for. */
const SESSION_PAGE_SIZE = 200;

/** Every record of a session, oldest-first, read back one page at a time.
 *  Pages arrive newest-block-first, so each is PREPENDED: `reconstructState`
 *  takes `audit` from the LAST record it sees, so a page in the wrong place
 *  silently loses the audit. */
async function loadAllRecords(
  store: SessionStore,
  id: string,
): Promise<TurnFlushRecord[]> {
  const all: TurnFlushRecord[] = [];
  let cursor: number | undefined;
  for (;;) {
    const page = await store.readRange(id, { before: cursor, limit: SESSION_PAGE_SIZE });
    all.unshift(...(page.records as TurnFlushRecord[]));
    if (page.cursor === undefined) break;
    cursor = page.cursor;
  }
  return all;
}

export async function openOrCreateActiveSession(st: SessionRuntime) {
  // Snapshot sessionStore once: this function `await`s across several ticks,
  // and a concurrent updateConfig({ persist: false }) reassigns
  // `st.sessionStore` to undefined mid-flight (buildConfig() runs
  // synchronously). Reading `st.sessionStore` again after an await
  // would then throw "Cannot read properties of undefined (reading
  // 'createSession')" instead of completing the in-flight init.
  const store = st.sessionStore;
  if (!store) {
    st.activeSessionId = "default-session";
    st.todoStore.reset([]);
    st.flushedJournalLength = 0;
    st.flushedSeq = 0;
    await refreshSessions(st);
    await runHooks(st.agentConfig.hooks, "onSessionStart", { sessionId: st.activeSessionId });
    notifyListeners(st);
    return;
  }

  try {
    const allSessions = await store.loadAllMetadata();
    let sessId = "";
    let loadedJournalLength = 0;
    if (allSessions.length === 0) {
      sessId = crypto.randomUUID();
      const now = Date.now();
      await store.createSession({
        id: sessId,
        title: "",
        titleManual: false,
        createdAt: now,
        updatedAt: now,
        messageCount: 0,
      });
      st.flushedSeq = 0;
    } else {
      sessId = allSessions[0].id;
      st.todoStore.reset(allSessions[0].todos ?? []);
      const records = await loadAllRecords(store, sessId);
      const { journal, audit } = reconstructState(records);
      st.cm.rehydrateState(journal, audit);
      st.compactionRows = compactionRowsFromJournal(st, journal);
      loadedJournalLength = journal.length;
      st.flushedSeq = allSessions[0].lastSeq ?? 0;
    }

    st.activeSessionId = sessId;
    st.flushedJournalLength = loadedJournalLength;
    await refreshSessions(st);
  } catch (err) {
    console.error("[session] init failed:", err);
  }
  await runHooks(st.agentConfig.hooks, "onSessionStart", { sessionId: st.activeSessionId });
  notifyListeners(st);
}

export function flushTurn(st: SessionRuntime) {
  if (!st.sessionStore || !st.activeSessionId) return;
  const newEntries = st.cm.journal.slice(st.flushedJournalLength);
  // 001 — the real size of the record about to be written, so a resume can
  // rewind exactly this record. A turn that also compacts flushes twice, so
  // this is NOT the size of the turn.
  st.lastRecordEntryCount = newEntries.length;
  st.flushedJournalLength = st.cm.journal.length;
  const record = buildFlushRecord(newEntries, st.cm.audit);
  st.flushedSeq += 1;
  st.sessionStore
    .appendRecords(st.activeSessionId, [record])
    .catch((err) => console.error("[session] appendRecords failed:", err));
  st.sessionStore
    .saveMeta(st.activeSessionId, {
      updatedAt: Date.now(),
      messageCount: st.cm.journal.length,
    })
    .catch((err) => console.error("[session] saveMeta failed:", err));
}

export async function createSession(st: SessionRuntime): Promise<void> {
  const previous = st.sessionTransition;
  let release!: () => void;
  const transition = new Promise<void>((resolve) => { release = resolve; });
  st.sessionTransition = transition;
  try {
    if (previous) await previous;
    if (st.running) abort(st);

    const sessionId = crypto.randomUUID();
    if (st.sessionStore) {
      const now = Date.now();
      await st.sessionStore.createSession({
        id: sessionId,
        title: "",
        titleManual: false,
        createdAt: now,
        updatedAt: now,
        messageCount: 0,
      });
    }

    st.toolBlocks.clear();
    st.toolBlocksVersion++;
    st.turnCache.clear();
    st.cachedStateMessages = null;
    st.cachedStateKey = "";
    st.cachedContextWindow = null;
    st.cachedContextWindowUsage = null;
    st.compactionRows = [];
    st.activeCompactionRowId = undefined;
    st.queuedMessages = [];
    st.flushedJournalLength = 0;
    st.flushedSeq = 0;
    st.cm = new ContextManager(st.agentConfig.context);
    st.initAgent({ preserveJournal: true });
    st.sessionEpoch++;
    st.activeSessionId = sessionId;
    st.scheduler.clearAll();
    st.todoStore.reset([]);
    await refreshSessions(st);
    notifyListeners(st);
  } finally {
    release();
    if (st.sessionTransition === transition) st.sessionTransition = undefined;
  }
}

export async function switchSession(st: SessionRuntime, id: string): Promise<void> {
  if (st.activeSessionId === id) return;
  if (st.running) abort(st);

  if (st.sessionStore) {
    const metas = await st.sessionStore.loadAllMetadata();
    const records = await loadAllRecords(st.sessionStore, id);
    const { journal, audit } = reconstructState(records);
    st.toolBlocks.clear();
    st.toolBlocksVersion++;
    st.turnCache.clear();
    st.cachedStateMessages = null;
    st.cachedStateKey = "";
    st.cachedContextWindow = null;
    st.cachedContextWindowUsage = null;
    st.activeCompactionRowId = undefined;
    st.queuedMessages = [];
    st.flushedJournalLength = journal.length;
    st.flushedSeq = metas.find((m) => m.id === id)?.lastSeq ?? 0;
    st.cm.rehydrateState(journal, audit);
    st.compactionRows = compactionRowsFromJournal(st, journal);
    st.activeSessionId = id;
  } else {
    st.turnCache.clear();
    st.cachedStateMessages = null;
    st.cachedStateKey = "";
    st.queuedMessages = [];
    st.flushedSeq = 0;
    st.cm = new ContextManager(st.agentConfig.context);
    st.initAgent({ preserveJournal: true });
    st.sessionEpoch++;
    st.activeSessionId = id;
  }
  st.scheduler.clearAll();
  await refreshSessions(st);
  const switchedMeta = st.sessions.find((s) => s.id === id);
  st.todoStore.reset(switchedMeta?.todos ?? []);
  notifyListeners(st);
}

export async function deleteSession(st: SessionRuntime, id: string): Promise<void> {
  if (st.sessionStore) {
    await st.sessionStore.deleteByIds([id]);
  }
  if (st.activeSessionId === id) {
    await createSession(st);
  } else {
    await refreshSessions(st);
    notifyListeners(st);
  }
}

export async function clearAllSessions(st: SessionRuntime): Promise<void> {
  if (st.running) abort(st);
  if (st.sessionStore) {
    const all = await st.sessionStore.loadAllMetadata();
    if (all.length) await st.sessionStore.deleteByIds(all.map((m) => m.id));
  }
  await createSession(st);
}

export async function setTitle(st: SessionRuntime, id: string, t: string): Promise<void> {
  if (st.sessionStore) {
    await st.sessionStore.saveMeta(id, { title: t, titleManual: true });
  }
  await refreshSessions(st);
  notifyListeners(st);
}

export async function autoTitle(st: SessionRuntime): Promise<void> {
  if (!st.sessionStore || !st.activeSessionId) return;
  const targetSessionId = st.activeSessionId;
  const transcript = buildTitleTranscript(st.cm.journal);
  if (!transcript.trim()) return;

  const prompt =
    "Summarize the following conversation as a short UI title of 3-6 words. " +
    "Reply with ONLY the title text, no quotes, no punctuation at the end.\n\n" +
    transcript;

  try {
    const raw = await runBareTurn(prompt, st.agentConfig, { fetch: st.agentConfig.fetch });
    const title = (raw || "").trim().replace(/^["']|["']$/g, "").slice(0, 80);
    if (!title) return;
    await st.sessionStore.saveMeta(targetSessionId, { title, titleManual: false });
    await refreshSessions(st);
    notifyListeners(st);
  } catch (err) {
    console.error("[autotitle] generation failed:", err);
  }
}

export function buildTitleTranscript(journal: JournalEntry[]): string {
  const lines: string[] = [];
  for (const entry of journal) {
    const role = entry.msg?.role;
    if (role !== "user" && role !== "assistant") continue;
    let text: string;
    if (role === "user" && entry.meta?.userDisplayText) {
      text = entry.meta.userDisplayText;
    } else {
      text = typeof entry.msg.content === "string"
        ? entry.msg.content
        : Array.isArray(entry.msg.content)
          ? entry.msg.content.map((p) => (p as { text?: string })?.text ?? "").join(" ")
          : "";
      if (!text.trim() && entry.meta?.userDisplayText) {
        text = entry.meta.userDisplayText;
      }
    }
    if (text.trim()) lines.push(`${role}: ${text.trim()}`);
  }
  return lines.join("\n").slice(0, 1500);
}
