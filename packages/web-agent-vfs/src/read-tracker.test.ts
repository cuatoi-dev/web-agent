import { describe, expect, it } from "vitest";
import { createReadTracker } from "./read-tracker.js";

describe("createReadTracker", () => {
  it("markRead/wasRead round trip", () => {
    const tracker = createReadTracker();
    expect(tracker.wasRead("s1", "/a.md")).toBe(false);
    tracker.markRead("s1", "/a.md", 100);
    expect(tracker.wasRead("s1", "/a.md")).toBe(true);
  });

  it("two different session ids are independent buckets", () => {
    const tracker = createReadTracker();
    tracker.markRead("s1", "/a.md", 100);
    expect(tracker.wasRead("s2", "/a.md")).toBe(false);
  });

  it("undefined and empty string are the same bucket", () => {
    const tracker = createReadTracker();
    tracker.markRead(undefined, "/a.md", 100);
    expect(tracker.wasRead("", "/a.md")).toBe(true);
    tracker.markRead("", "/b.md", 100);
    expect(tracker.wasRead(undefined, "/b.md")).toBe(true);
  });

  it("forget clears one path only", () => {
    const tracker = createReadTracker();
    tracker.markRead("s1", "/a.md", 100);
    tracker.markRead("s1", "/b.md", 100);
    tracker.forget("s1", "/a.md");
    expect(tracker.wasRead("s1", "/a.md")).toBe(false);
    expect(tracker.wasRead("s1", "/b.md")).toBe(true);
  });

  it("moveRead moves a marked path, and is a no-op for an unmarked one", () => {
    const tracker = createReadTracker();
    tracker.markRead("s1", "/a.md", 100);
    tracker.moveRead("s1", "/a.md", "/b.md");
    expect(tracker.wasRead("s1", "/a.md")).toBe(false);
    expect(tracker.wasRead("s1", "/b.md")).toBe(true);

    tracker.moveRead("s1", "/never-read.md", "/c.md");
    expect(tracker.wasRead("s1", "/c.md")).toBe(false);
  });

  it("keeps the supplied modification time, including zero, and a new read replaces it", () => {
    const tracker = createReadTracker();
    expect(tracker.readMtime("s1", "/a.md")).toBeUndefined();
    tracker.markRead("s1", "/a.md", 0);
    expect(tracker.readMtime("s1", "/a.md")).toBe(0);
    expect(tracker.wasRead("s1", "/a.md")).toBe(true);
    tracker.markRead("s1", "/a.md", 250);
    expect(tracker.readMtime("s1", "/a.md")).toBe(250);
    expect(tracker.readMtime("s2", "/a.md")).toBeUndefined();
  });

  it("moveRead keeps the modification time", () => {
    const tracker = createReadTracker();
    tracker.markRead("s1", "/a.md", 77);
    tracker.moveRead("s1", "/a.md", "/b.md");
    expect(tracker.readMtime("s1", "/b.md")).toBe(77);
    expect(tracker.readMtime("s1", "/a.md")).toBeUndefined();
  });

  it("forgetUnder clears the prefix and its children in every chat, and nothing else", () => {
    const tracker = createReadTracker();
    for (const sid of ["s1", "s2"]) {
      tracker.markRead(sid, "/share/reports/a.csv", 1);
      tracker.markRead(sid, "/share/reports/sub/b.csv", 1);
      tracker.markRead(sid, "/share/reports-old/c.csv", 1);
      tracker.markRead(sid, "/home/agent/d.md", 1);
    }
    tracker.forgetUnder("/share/reports");
    for (const sid of ["s1", "s2"]) {
      expect(tracker.wasRead(sid, "/share/reports/a.csv")).toBe(false);
      expect(tracker.wasRead(sid, "/share/reports/sub/b.csv")).toBe(false);
      expect(tracker.wasRead(sid, "/share/reports-old/c.csv")).toBe(true);
      expect(tracker.wasRead(sid, "/home/agent/d.md")).toBe(true);
    }
  });
});
