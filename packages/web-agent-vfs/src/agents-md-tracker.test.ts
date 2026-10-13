import { describe, expect, it } from "vitest";
import { createAgentsMdTracker } from "./agents-md-tracker.js";

describe("AgentsMdTracker", () => {
  it("tracks seen mtimes per session and path", () => {
    const tracker = createAgentsMdTracker();
    expect(tracker.seen("s1", "/a")).toBeUndefined();
    tracker.record("s1", "/a", 10);
    expect(tracker.seen("s1", "/a")).toBe(10);
    expect(tracker.seen("s2", "/a")).toBeUndefined();
    expect(tracker.seen("s1", "/b")).toBeUndefined();
    tracker.record(undefined, "/a", 20);
    expect(tracker.seen(undefined, "/a")).toBe(20);
    expect(tracker.seen("s1", "/a")).toBe(10);
  });
});
