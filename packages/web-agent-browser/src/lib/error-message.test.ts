import { describe, it, expect } from "vitest";
import { errorMessage } from "./error-message";

describe("errorMessage", () => {
  it("reads the message off an Error", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });

  it("falls back to String() for an Error with an empty message", () => {
    const err = new Error("");
    expect(errorMessage(err)).toBe(String(err));
  });

  it("reads a message field off a plain object", () => {
    expect(errorMessage({ message: "plain object" })).toBe("plain object");
  });

  it("falls back to String() when the message field is not a string", () => {
    // Object's default stringification — the same fallback a plain object
    // with no useful message field gets.
    expect(errorMessage({ message: 42 })).toBe("[object Object]");
  });

  it("returns a thrown string unchanged", () => {
    expect(errorMessage("a thrown string")).toBe("a thrown string");
  });

  it("stringifies undefined and null", () => {
    expect(errorMessage(undefined)).toBe("undefined");
    expect(errorMessage(null)).toBe("null");
  });

  it("keeps a DOMException's message, so the relay-fetch abort path keeps its text", () => {
    const err = new DOMException("aborted", "AbortError");
    expect(errorMessage(err)).toBe("aborted");
  });
});
