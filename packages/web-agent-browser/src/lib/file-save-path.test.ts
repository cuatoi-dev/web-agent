import { describe, expect, it } from "vitest";
import { localFileStamp } from "./file-save-path";

describe("localFileStamp", () => {
  it("pads every field to its fixed width", () => {
    // Local constructors throughout: the stamp must follow the local clock,
    // not UTC, so a Date built from components is what has to be readable.
    expect(localFileStamp(new Date(2026, 0, 2, 3, 4, 5))).toBe("2026-01-02-030405");
    expect(localFileStamp(new Date(2026, 11, 31, 23, 59, 59))).toBe("2026-12-31-235959");
  });

  it("rolls the date at midnight", () => {
    const lastSecond = new Date(2026, 0, 1, 23, 59, 59);
    expect(localFileStamp(lastSecond)).toBe("2026-01-01-235959");
    expect(localFileStamp(new Date(lastSecond.getTime() + 1000))).toBe("2026-01-02-000000");
  });

  it("follows the given date, not the clock", () => {
    const two = localFileStamp(new Date(2026, 8, 9, 10, 11, 12));
    expect(two).toBe("2026-09-09-101112");
    expect(localFileStamp()).toMatch(/^\d{4}-\d{2}-\d{2}-\d{6}$/);
  });
});