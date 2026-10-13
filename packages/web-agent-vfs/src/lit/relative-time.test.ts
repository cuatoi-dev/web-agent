import { describe, it, expect } from "vitest";
import { relativeTime } from "./files-screen.js";

describe("relativeTime", () => {
  const now = 1_000_000_000;

  it("returns 'just now' for differences under 60 seconds", () => {
    expect(relativeTime(now, now)).toBe("just now");
    expect(relativeTime(now - 10_000, now)).toBe("just now");
    expect(relativeTime(now - 59_000, now)).toBe("just now");
  });

  it("returns '<n> min ago' for differences between 60 seconds and 1 hour", () => {
    expect(relativeTime(now - 60_000, now)).toBe("1 min ago");
    expect(relativeTime(now - 120_000, now)).toBe("2 min ago");
    expect(relativeTime(now - 59 * 60_000, now)).toBe("59 min ago");
  });

  it("returns '<n> h ago' for differences between 1 hour and 24 hours", () => {
    expect(relativeTime(now - 60 * 60_000, now)).toBe("1 h ago");
    expect(relativeTime(now - 2 * 3600_000, now)).toBe("2 h ago");
    expect(relativeTime(now - 23 * 3600_000, now)).toBe("23 h ago");
  });

  it("returns '<n> d ago' for differences >= 24 hours", () => {
    expect(relativeTime(now - 24 * 3600_000, now)).toBe("1 d ago");
    expect(relativeTime(now - 48 * 3600_000, now)).toBe("2 d ago");
    expect(relativeTime(now - 10 * 86400_000, now)).toBe("10 d ago");
  });
});
