import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { clear, createStore, del, getMany, keys, set } from "idb-keyval";
import { IdbSessionStore } from "./session-store.js";
import type { SessionMeta } from "./session-store.js";

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

describe("IdbSessionStore", () => {
  let store: IdbSessionStore;

  beforeEach(async () => {
    await clear();
    store = new IdbSessionStore();
  });

  describe("createSession", () => {
    it("basic round-trip", async () => {
      const meta = makeMeta();
      await store.createSession(meta);
      const all = await store.loadAllMetadata();
      expect(all).toHaveLength(1);
      expect(all[0].id).toBe(meta.id);
      expect(all[0].title).toBe("Test Session");
    });

    it("idempotent — same id does not duplicate", async () => {
      const meta = makeMeta();
      await store.createSession(meta);
      await store.createSession(meta);
      const all = await store.loadAllMetadata();
      expect(all).toHaveLength(1);
    });
  });

  describe("appendRecords", () => {
    it("one call writes one key per record", async () => {
      const meta = makeMeta({ id: "s" });
      await store.createSession(meta);
      await store.appendRecords(meta.id, [rec(1), rec(2)]);
      const recordKeys = (await keys()).map(String).filter(k => k.startsWith("session-rec-"));
      expect(recordKeys).toHaveLength(2);
      expect(recordKeys).toEqual(["session-rec-s-000001", "session-rec-s-000002"]);
    });

    it("sequence continues across calls", async () => {
      const meta = makeMeta({ id: "s" });
      await store.createSession(meta);
      await store.appendRecords(meta.id, [rec(1), rec(2)]);
      await store.appendRecords(meta.id, [rec(3), rec(4), rec(5)]);
      const recordKeys = (await keys()).map(String).filter(k => k.startsWith("session-rec-"));
      expect(recordKeys).toHaveLength(5);
      const all = await store.loadAllMetadata();
      expect(all[0].lastSeq).toBe(5);
    });

    it("an empty array writes nothing and does not move lastSeq", async () => {
      const meta = makeMeta({ id: "s" });
      await store.createSession(meta);
      await store.appendRecords(meta.id, []);
      const recordKeys = (await keys()).map(String).filter(k => k.startsWith("session-rec-"));
      expect(recordKeys).toHaveLength(0);
      const all = await store.loadAllMetadata();
      expect(all[0].lastSeq).toBeUndefined();
    });

    it("no session-msgs key is ever written", async () => {
      await seed(store, "s", 3);
      const allKeys = (await keys()).map(String);
      expect(allKeys.some(k => k.startsWith("session-msgs-"))).toBe(false);
    });

    it("each key holds exactly one record", async () => {
      await seed(store, "s", 3);
      const recordKeys = (await keys()).map(String).filter(k => k.startsWith("session-rec-")).sort();
      const values = await getMany(recordKeys);
      expect(values).toHaveLength(3);
      for (const v of values) {
        expect((v as { _kind: string })._kind).toBe("turn_flush");
        expect((v as { journalDelta: unknown[] }).journalDelta).toHaveLength(1);
      }
    });
  });

  describe("readRange", () => {
    it("newest page comes back oldest-first with a cursor", async () => {
      await seed(store, "s", 50);
      const page = await store.readRange("s", { limit: 10 });
      expect(page.records).toHaveLength(10);
      expect((page.records[0] as { journalDelta: { n: number }[] }).journalDelta[0].n).toBe(41);
      expect((page.records[9] as { journalDelta: { n: number }[] }).journalDelta[0].n).toBe(50);
      expect(page.cursor).toBe(40);
    });

    it("the cursor continues without repeat or gap", async () => {
      await seed(store, "s", 50);
      const page1 = await store.readRange("s", { limit: 10 });
      const page2 = await store.readRange("s", { before: page1.cursor, limit: 10 });
      const ns2 = page2.records.map(r => (r as { journalDelta: { n: number }[] }).journalDelta[0].n);
      expect(ns2).toEqual([31, 32, 33, 34, 35, 36, 37, 38, 39, 40]);
      expect(page2.cursor).toBe(30);
      const ns1 = page1.records.map(r => (r as { journalDelta: { n: number }[] }).journalDelta[0].n);
      expect(ns1.filter(n => ns2.includes(n))).toHaveLength(0);
    });

    it("paging the whole session equals the records that were appended", async () => {
      await seed(store, "s", 50);
      const all: unknown[] = [];
      let cursor: number | undefined;
      for (;;) {
        const page = await store.readRange("s", { before: cursor, limit: 7 });
        all.unshift(...page.records);
        if (page.cursor === undefined) break;
        cursor = page.cursor;
      }
      expect(all).toEqual(Array.from({ length: 50 }, (_, i) => rec(i + 1)));
    });

    it("past the start returns nothing and no cursor", async () => {
      await seed(store, "s", 5);
      const page = await store.readRange("s", { before: 0, limit: 10 });
      expect(page).toEqual({ records: [], cursor: undefined });
    });

    it("a limit larger than the session returns everything, no cursor", async () => {
      await seed(store, "s", 3);
      const page = await store.readRange("s", { limit: 10 });
      expect(page.records).toHaveLength(3);
      expect(page.cursor).toBeUndefined();
    });

    it("a gap is skipped, not treated as the end", async () => {
      await seed(store, "s", 30);
      await del("session-rec-s-000025");
      const page = await store.readRange("s", { before: 30, limit: 10 });
      expect(page.records).toHaveLength(10);
      const ns = page.records.map(r => (r as { journalDelta: { n: number }[] }).journalDelta[0].n);
      expect(ns).not.toContain(25);
      expect(ns).toContain(24);
    });

    it("unknown session id returns nothing", async () => {
      const page = await store.readRange("ghost", { limit: 10 });
      expect(page).toEqual({ records: [], cursor: undefined });
    });
  });

  describe("truncateAfter", () => {
    it("removes only the records above seq", async () => {
      await seed(store, "s", 5);
      const before = await store.readRange("s", { before: 3, limit: 3 });
      await store.truncateAfter("s", 3);
      const after = await store.readRange("s", { before: 3, limit: 3 });
      expect(after.records).toEqual(before.records);
      const recordKeys = (await keys()).map(String);
      expect(recordKeys).not.toContain("session-rec-s-000004");
      expect(recordKeys).not.toContain("session-rec-s-000005");
    });

    it("moves lastSeq down", async () => {
      await seed(store, "s", 5);
      await store.truncateAfter("s", 3);
      const all = await store.loadAllMetadata();
      expect(all[0].lastSeq).toBe(3);
    });

    it("truncating at the high-water mark changes nothing", async () => {
      await seed(store, "s", 5);
      await store.truncateAfter("s", 5);
      const recordKeys = (await keys()).map(String).filter(k => k.startsWith("session-rec-"));
      expect(recordKeys).toHaveLength(5);
      const all = await store.loadAllMetadata();
      expect(all[0].lastSeq).toBe(5);
    });

    it("the next append reuses the freed sequence", async () => {
      await seed(store, "s", 5);
      await store.truncateAfter("s", 4);
      await store.appendRecords("s", [rec(99)]);
      const all = await store.loadAllMetadata();
      expect(all[0].lastSeq).toBe(5);
      const page = await store.readRange("s", { limit: 1 });
      expect((page.records[0] as { journalDelta: { n: number }[] }).journalDelta[0].n).toBe(99);
    });
  });

  describe("saveMeta", () => {
    it("partial update merges fields", async () => {
      const meta = makeMeta();
      await store.createSession(meta);
      await store.saveMeta(meta.id, { title: "New Title", titleManual: true });
      const all = await store.loadAllMetadata();
      expect(all).toHaveLength(1);
      expect(all[0].title).toBe("New Title");
      expect(all[0].titleManual).toBe(true);
      // Other fields unchanged
      expect(all[0].createdAt).toBe(meta.createdAt);
      expect(all[0].messageCount).toBe(0);
    });

    it("unknown session id is silent no-op", async () => {
      await store.saveMeta("nonexistent", { title: "x" });
      const all = await store.loadAllMetadata();
      expect(all).toHaveLength(0);
    });
  });

  describe("loadAllMetadata", () => {
    it("ordered by updatedAt descending", async () => {
      const older = makeMeta({ id: "session-a", updatedAt: 100, createdAt: 100 });
      const newer = makeMeta({ id: "session-b", updatedAt: 200, createdAt: 100 });
      // Create older first, then newer
      await store.createSession(older);
      await store.createSession(newer);
      const all = await store.loadAllMetadata();
      expect(all).toHaveLength(2);
      expect(all[0].id).toBe("session-b"); // newer first
      expect(all[1].id).toBe("session-a");
    });
  });

  describe("deleteByIds", () => {
    it("removes index entry and messages for a single id", async () => {
      const meta = makeMeta();
      await store.createSession(meta);
      await store.appendRecords(meta.id, [rec(1)]);
      await store.deleteByIds([meta.id]);
      const all = await store.loadAllMetadata();
      expect(all).toHaveLength(0);
      const page = await store.readRange(meta.id, { limit: 10 });
      expect(page.records).toEqual([]);
    });

    it("batch deletes multiple ids", async () => {
      const a = makeMeta({ id: "a" });
      const b = makeMeta({ id: "b" });
      await store.createSession(a);
      await store.createSession(b);
      await store.deleteByIds(["a", "b"]);
      const all = await store.loadAllMetadata();
      expect(all).toHaveLength(0);
    });

    it("unknown ids are silent", async () => {
      await store.deleteByIds(["ghost"]);
      // No throw
    });

    it("removes every record key of the deleted session", async () => {
      await seed(store, "a", 5);
      await store.deleteByIds(["a"]);
      const allKeys = (await keys()).map(String);
      expect(allKeys.some(k => k.includes("a-0000"))).toBe(false);
      expect(await store.loadAllMetadata()).toEqual([]);
    });

    it("leaves another session's records alone", async () => {
      await seed(store, "a", 5);
      await seed(store, "b", 3);
      await store.deleteByIds(["a"]);
      const page = await store.readRange("b", { limit: 10 });
      expect(page.records).toHaveLength(3);
    });
  });

  describe("write ordering", () => {
    it("an unawaited append and saveMeta both survive", async () => {
      const meta = makeMeta({ id: "s" });
      await store.createSession(meta);
      const p1 = store.appendRecords("s", [rec(1)]);
      const p2 = store.saveMeta("s", { updatedAt: 12345 });
      await Promise.all([p1, p2]);
      const all = await store.loadAllMetadata();
      expect(all[0].lastSeq).toBe(1);
      expect(all[0].updatedAt).toBe(12345);
    });
  });

  describe("old layout", () => {
    it("a session in the old layout is not listed", async () => {
      await set("web-agent-session-index", [makeMeta({ id: "legacy" })]);
      await set("session-msgs-legacy", [rec(1)]);
      const all = await store.loadAllMetadata();
      expect(all).toEqual([]);
    });
  });
});

describe("namespace isolation", () => {
  let storeA: IdbSessionStore;
  let storeB: IdbSessionStore;
  let storeA2: IdbSessionStore;

  beforeEach(async () => {
    await Promise.all([
      clear(createStore("web-agent-ns-a", "sessions")),
      clear(createStore("web-agent-ns-b", "sessions")),
    ]);
    storeA  = new IdbSessionStore("ns-a");
    storeB  = new IdbSessionStore("ns-b");
    storeA2 = new IdbSessionStore("ns-a");
  });

  it("session created in ns-a is NOT visible in ns-b", async () => {
    const meta = makeMeta({ id: "cross-host-session" });
    await storeA.createSession(meta);

    const fromB = await storeB.loadAllMetadata();
    expect(fromB).toHaveLength(0);
  });

  it("two instances with the same namespace share sessions", async () => {
    const meta = makeMeta({ id: "shared-session" });
    await storeA.createSession(meta);

    const fromA2 = await storeA2.loadAllMetadata();
    expect(fromA2).toHaveLength(1);
    expect(fromA2[0].id).toBe("shared-session");
  });
});
