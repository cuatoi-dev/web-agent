---
title: Session backend interface (SessionStore)
---

# Session backend interface (SessionStore)

The `SessionStore` interface is the persistence seam between the agent UI and
whatever storage backend the host provides. The default implementation uses
IndexedDB via `idb-keyval`.

---

## SessionStore interface

From `packages/web-agent-core/src/loop/types.ts:38-46` (re-exported by `src/loop/session-store.ts`):

```ts
interface SessionStore {
  createSession(meta: SessionMeta): Promise<void>;
  appendRecords(sessionId: string, records: unknown[]): Promise<void>;
  readRange(sessionId: string, range: SessionRecordRange): Promise<SessionRecordPage>;
  truncateAfter(sessionId: string, seq: number): Promise<void>;
  saveMeta(sessionId: string, meta: Partial<SessionMeta>): Promise<void>;
  loadAllMetadata(): Promise<SessionMeta[]>;
  deleteByIds(ids: string[]): Promise<void>;
}

interface SessionRecordRange {
  before?: number;   // highest sequence to read, inclusive
  limit: number;     // how many records to return
}

interface SessionRecordPage {
  records: unknown[];  // oldest-first
  cursor?: number;     // highest sequence still unread
}
```

| Method | When called |
|--------|-------------|
| `createSession` | When a new session is created |
| `appendRecords` | After each turn — writes the turn's records, one key each |
| `readRange` | When a session is opened or selected — read back one page at a time |
| `truncateAfter` | After `retryLast()` rewinds a turn — deletes the records above the last good turn. A failed turn is RESUMED, so its last record is dropped and rewritten with the resumed steps; an empty completed turn is discarded and re-sent |
| `saveMeta` | When the session title, `updatedAt`, `messageCount` or `todos` changes |
| `loadAllMetadata` | When the history panel opens |
| `deleteByIds` | When sessions are deleted from the history panel |

---

## SessionMeta shape

```ts
interface SessionMeta {
  id: string;
  title: string;
  titleManual: boolean;   // true when explicitly renamed by user
  createdAt: number;      // Unix ms
  updatedAt: number;      // Unix ms
  messageCount: number;
  todos?: TodoItem[];     // the session's todo list
  lastSeq?: number;  // highest record sequence written
}
```

From `packages/web-agent-core/src/loop/types.ts:7-18`. Core writes `todos` with
`saveMeta()` every time the todo list changes, and reads it back when a session
opens. See [Todo tracking](./todo.md#persistence).

---

## Default implementation: IdbSessionStore

`IdbSessionStore` from `packages/web-agent-core/src/loop/session-store.ts`
uses `idb-keyval` for IndexedDB access.

### Storage layout

| Key | Content |
|-----|---------|
| `"web-agent-sessions"` | `SessionMeta[]` array — the full session list |
| `"session-rec-{id}-{seq}"` | one record of session `{id}`; `{seq}` is the sequence, zero-padded to 6 |

### Namespace isolation

```ts
new IdbSessionStore()              // uses the default idb-keyval store (shared origin key-space)
new IdbSessionStore("my-app")      // creates "web-agent-my-app" IndexedDB database, "sessions" store
```

When a namespace is provided, `` createStore(`web-agent-${namespace}`, "sessions") ``
creates a **separate IndexedDB database** for that namespace. Hosts on the same
origin (e.g. docs-site and cat-store both on `localhost`) must use different
namespaces to avoid sharing session data.

---

## Per-host namespacing via AgentConfig

Set `AgentConfig.persist` to `true` and `AgentConfig.sessionNamespace?: string`,
and core creates the store for you:

```ts
panel.config = {
  // ...
  persist: true,
  sessionNamespace: "cat-store",  // creates IdbSessionStore("cat-store")
};
```

When `persist` is `true` and `sessionStore` is not set, core instantiates
`new IdbSessionStore(sessionNamespace)`. `sessionNamespace` is ignored when
`sessionStore` is explicitly provided. When `persist` is `false` (the default),
core creates no store.

---

## Custom backend

To use server-side persistence, encryption, or multi-device sync, implement
the seven-method `SessionStore` interface, pass it as `AgentConfig.sessionStore`,
and set `persist: true`. With `persist` off, core ignores `sessionStore`:

```ts
class MyServerStore implements SessionStore {
  async createSession(meta) { await api.post("/sessions", meta); }
  async appendRecords(id, records) { await api.post(`/sessions/${id}/records`, records); }
  async readRange(id, range) { return api.get(`/sessions/${id}/records`, range); }
  async truncateAfter(id, seq) { await api.delete(`/sessions/${id}/records`, { after: seq }); }
  async saveMeta(id, meta) { await api.patch(`/sessions/${id}`, meta); }
  async loadAllMetadata() { return api.get("/sessions"); }
  async deleteByIds(ids) { await api.delete("/sessions", { ids }); }
}

panel.config = { ...panel.config, persist: true, sessionStore: new MyServerStore() };
```

---

## Cross-links

- [Session handling](./session-handling.md) — UI session lifecycle
