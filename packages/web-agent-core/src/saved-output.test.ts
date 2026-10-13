import { describe, it, expect } from "vitest";
import { SAVED_OUTPUT_TAG, parseSavedOutput } from "./saved-output.js";

describe("parseSavedOutput", () => {
  const saved = `<${SAVED_OUTPUT_TAG} path="/tmp/tool-results/call_7.txt" chars="48210">\nOutput too large…`;
  const unsaved = `<${SAVED_OUTPUT_TAG} chars="48210" saved="false">\nOutput too large…`;
  const noPath = `<${SAVED_OUTPUT_TAG} chars="13000">\nOutput too large…`;

  it("reads a saved header with a path", () => {
    expect(parseSavedOutput(saved)).toEqual({
      path: "/tmp/tool-results/call_7.txt",
      chars: 48210,
      saved: true,
    });
  });

  it("reads an unsaved header as no path and saved false", () => {
    expect(parseSavedOutput(unsaved)).toEqual({ path: undefined, chars: 48210, saved: false });
  });

  it("reads a saved header without a path", () => {
    expect(parseSavedOutput(noPath)).toEqual({ path: undefined, chars: 13000, saved: true });
  });

  it("returns null when the marker is not at the start", () => {
    expect(parseSavedOutput("prefix " + saved)).toBeNull();
  });

  it("returns null for reordered attributes", () => {
    expect(parseSavedOutput(`<${SAVED_OUTPUT_TAG} chars="10" path="/a.txt">`)).toBeNull();
  });

  it("returns null for a malformed char count", () => {
    expect(parseSavedOutput(`<${SAVED_OUTPUT_TAG} chars="4,821">`)).toBeNull();
    expect(parseSavedOutput(`<${SAVED_OUTPUT_TAG} chars="abc">`)).toBeNull();
  });

  it("returns null for plain text", () => {
    expect(parseSavedOutput("just a normal tool result")).toBeNull();
  });
});
