import { describe, expect, it } from "vitest";
import { base64ByteLength } from "./files-screen.js";

describe("base64ByteLength", () => {
  it("returns 0 for empty or whitespace-only input", () => {
    expect(base64ByteLength("")).toBe(0);
    expect(base64ByteLength("   \n  ")).toBe(0);
  });

  it("calculates exact decoded byte length with no padding", () => {
    // "YWJj" decodes to "abc" (3 bytes)
    expect(base64ByteLength("YWJj")).toBe(3);
  });

  it("calculates exact decoded byte length with 1 padding character", () => {
    // "YWI=" decodes to "ab" (2 bytes)
    expect(base64ByteLength("YWI=")).toBe(2);
  });

  it("calculates exact decoded byte length with 2 padding characters", () => {
    // "YQ==" decodes to "a" (1 byte)
    expect(base64ByteLength("YQ==")).toBe(1);
  });

  it("correctly calculates byte size for 83,779 byte fixture (rainbow.png)", () => {
    // In base64, 83779 bytes encode to 111708 characters ending with "=="
    const dummyB64 = "A".repeat(111706) + "==";
    const bytes = base64ByteLength(dummyB64);
    expect(bytes).toBe(83779);
    expect((bytes / 1024).toFixed(1)).toBe("81.8");
  });
});
