import { get, set, setMany, getMany, delMany, createStore } from "idb-keyval";
import type { UseStore } from "idb-keyval";
import type {
  SessionMeta,
  SessionStore,
  SessionRecordRange,
  SessionRecordPage,
} from "./types.js";
export type {
  SessionMeta,
  SessionStore,
  SessionRecordRange,
  SessionRecordPage,
} from "./types.js";

// Renamed from "web-agent-session-index" so a profile holding sessions in the
// old one-value-per-session layout is simply not read. Those sessions are
// dropped, not migrated (see the plan's Decisions and criterion 13).
const INDEX_KEY = "web-agent-sessions";

/** The key one record lives under. The sequence is zero-padded to 6 so the raw
 *  key order in IndexedDB matches the numeric order. */
function recKey(sessionId: string, seq: number): string {
  return `session-rec-${sessionId}-${String(seq).padStart(6, "0")}`;
}

// ---------------------------------------------------------------------------
// Default IndexedDB-backed implementation
// ---------------------------------------------------------------------------

export class IdbSessionStore implements SessionStore {
  private readonly _store: UseStore | undefined;
  /** Tail of the write chain. Every method that reads the index, changes it and
   *  writes it back runs through `_enqueue`, so two such calls issued in the
   *  same tick cannot both read the pre-change index and clobber each other.
   *  The controller fires `appendRecords` and `saveMeta` back to back without
   *  awaiting either (controller-sessions.ts flushTurn), and `appendRecords` writes
   *  `lastSeq` into the very index entry `saveMeta` then rewrites — unserialised,
   *  `lastSeq` is lost on most turns and `readRange` reads the wrong high-water
   *  mark. */
  private _writes: Promise<unknown> = Promise.resolve();

  constructor(namespace?: string) {
    this._store = namespace
      ? createStore(`web-agent-${namespace}`, "sessions")
      : undefined;
  }

  /** Runs `op` after every write already queued, whether those succeeded or not. */
  private _enqueue<T>(op: () => Promise<T>): Promise<T> {
    const next = this._writes.then(op, op);
    this._writes = next.catch(() => undefined);
    return next;
  }

  /** The whole session index, or an empty array when there is none yet. */
  private async _index(): Promise<SessionMeta[]> {
    return (await get(INDEX_KEY, this._store)) ?? [];
  }

  async createSession(meta: SessionMeta): Promise<void> {
    return this._enqueue(async () => {
      const index = await this._index();
      if (!index.find(m => m.id === meta.id)) {
        index.push(meta);
        await set(INDEX_KEY, index, this._store);
      }
    });
  }

  async appendRecords(sessionId: string, records: unknown[]): Promise<void> {
    if (!records.length) return;
    return this._enqueue(async () => {
      const index = await this._index();
      const idx = index.findIndex(m => m.id === sessionId);
      const base = idx !== -1 ? (index[idx].lastSeq ?? 0) : 0;
      // One transaction for every record, and NOT ONE read of an existing
      // record key — that is what makes turn 900 cost the same as turn 1.
      await setMany(
        records.map((r, i): [IDBValidKey, unknown] => [recKey(sessionId, base + i + 1), r]),
        this._store,
      );
      if (idx !== -1) {
        index[idx] = { ...index[idx], lastSeq: base + records.length };
        await set(INDEX_KEY, index, this._store);
      }
    });
  }

  async readRange(
    sessionId: string,
    range: SessionRecordRange,
  ): Promise<SessionRecordPage> {
    const { limit } = range;
    const index = await this._index();
    const meta = index.find(m => m.id === sessionId);
    let cursor = range.before ?? (meta?.lastSeq ?? 0);
    const newestFirst: unknown[] = [];
    while (cursor >= 1 && newestFirst.length < limit) {
      // Read the window in ONE transaction instead of `limit` round trips.
      // getMany returns results positionally and `undefined` for a missing key
      // (idb-keyval 6.2.2, dist/index.js:74), so a gap is skipped and the walk
      // keeps going — one lost record must never hide the records before it.
      const from = Math.max(1, cursor - (limit - newestFirst.length) + 1);
      const window: IDBValidKey[] = [];
      for (let s = cursor; s >= from; s--) window.push(recKey(sessionId, s));
      const values = await getMany(window, this._store);
      for (const v of values) if (v !== undefined) newestFirst.push(v);
      // `from` is at most `cursor`, so the cursor strictly decreases on every
      // pass and the loop always terminates.
      cursor = from - 1;
    }
    return {
      records: newestFirst.reverse(),
      cursor: cursor >= 1 ? cursor : undefined,
    };
  }

  async truncateAfter(sessionId: string, seq: number): Promise<void> {
    return this._enqueue(async () => {
      const index = await this._index();
      const idx = index.findIndex(m => m.id === sessionId);
      const last = idx !== -1 ? (index[idx].lastSeq ?? 0) : 0;
      if (last > seq) {
        const doomed: IDBValidKey[] = [];
        for (let s = seq + 1; s <= last; s++) doomed.push(recKey(sessionId, s));
        await delMany(doomed, this._store);
      }
      if (idx !== -1) {
        index[idx] = { ...index[idx], lastSeq: seq };
        await set(INDEX_KEY, index, this._store);
      }
    });
  }

  async saveMeta(sessionId: string, meta: Partial<SessionMeta>): Promise<void> {
    return this._enqueue(async () => {
      const index = await this._index();
      const idx = index.findIndex(m => m.id === sessionId);
      if (idx !== -1) {
        index[idx] = { ...index[idx], ...meta };
        await set(INDEX_KEY, index, this._store);
      }
    });
  }

  async loadAllMetadata(): Promise<SessionMeta[]> {
    const index = await this._index();
    return [...index].sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async deleteByIds(ids: string[]): Promise<void> {
    return this._enqueue(async () => {
      const index = await this._index();
      const doomed: IDBValidKey[] = [];
      for (const id of ids) {
        const last = index.find(m => m.id === id)?.lastSeq ?? 0;
        for (let s = 1; s <= last; s++) doomed.push(recKey(id, s));
      }
      await set(INDEX_KEY, index.filter(m => !ids.includes(m.id)), this._store);
      if (doomed.length) await delMany(doomed, this._store);
    });
  }
}
