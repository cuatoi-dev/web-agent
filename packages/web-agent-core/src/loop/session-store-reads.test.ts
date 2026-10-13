import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UseStore } from "idb-keyval";
import { clear } from "idb-keyval";
import { IdbSessionStore } from "./session-store.js";
import type { SessionMeta } from "./types.js";

// vi.mock's factory is hoisted above every import, so the recorder it closes
// over must be created with vi.hoisted (vitest 1.6.1).
const { reads } = vi.hoisted(() => ({ reads: [] as string[] }));

vi.mock("idb-keyval", async (importOriginal) => {
  const actual = await importOriginal<typeof import("idb-keyval")>();
  return {
    ...actual,
    get: (key: IDBValidKey, store?: UseStore) => {
      // Every key this store ever passes is a string (recKey / INDEX_KEY) —
      // IDBValidKey is wider than what actually flows through here.
      reads.push(key as string);
      return actual.get(key, store);
    },
    getMany: (keys: IDBValidKey[], store?: UseStore) => {
      for (const k of keys) reads.push(k as string);
      return actual.getMany(keys, store);
    },
  };
});

function makeMeta(overrides?: Partial<SessionMeta>): SessionMeta {
  const now = Date.now();
  return {
    id: "test-session-1",
    title: "Test Session",
    titleManual: false,
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
    ...overrides,
  };
}

function rec(n: number) {
  return { _kind: "turn_flush", journalDelta: [{ n }], audit: [] };
}

async function seed(store: IdbSessionStore, id: string, count: number) {
  await store.createSession(makeMeta({ id }));
  for (let i = 1; i <= count; i++) await store.appendRecords(id, [rec(i)]);
}

describe("IdbSessionStore — record-read cost", () => {
  let store: IdbSessionStore;

  beforeEach(async () => {
    await clear();
    store = new IdbSessionStore();
    reads.length = 0;
  });

  it("appendRecords reads no record key", async () => {
    await seed(store, "s", 3);
    reads.length = 0;
    await store.appendRecords("s", [rec(4)]);
    // The index key IS read and that is fine — criterion 3 is about record reads.
    expect(reads.some(k => k.startsWith("session-rec-"))).toBe(false);
  });

  it("appendRecords cost does not grow with session length", async () => {
    await seed(store, "short", 3);
    reads.length = 0;
    await store.appendRecords("short", [rec(4)]);
    const shortReadCount = reads.length;

    await seed(store, "long", 200);
    reads.length = 0;
    await store.appendRecords("long", [rec(201)]);
    const longReadCount = reads.length;

    expect(longReadCount).toBe(shortReadCount);
  });

  it("readRange reads one window per page, not one key per record", async () => {
    await seed(store, "s", 50);
    reads.length = 0;
    await store.readRange("s", { limit: 10 });
    const recordReads = reads.filter(k => k.startsWith("session-rec-"));
    expect(recordReads).toHaveLength(10);
    expect(recordReads).toEqual([
      "session-rec-s-000050",
      "session-rec-s-000049",
      "session-rec-s-000048",
      "session-rec-s-000047",
      "session-rec-s-000046",
      "session-rec-s-000045",
      "session-rec-s-000044",
      "session-rec-s-000043",
      "session-rec-s-000042",
      "session-rec-s-000041",
    ]);
  });
});
