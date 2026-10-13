import { describe, it, expect } from "vitest";
import { buildPointedElementsBlock } from "./pointed-elements.js";

describe("buildPointedElementsBlock", () => {
  it("formats a single 1-line item", () => {
    const result = buildPointedElementsBlock([{ ref: 3, text: '[3] button "Add"' }]);
    expect(result).toBe('# Pointed elements (the user clicked these)\n1. [3] button "Add"');
  });

  it("numbers items and indents multi-line continuation lines by 3 spaces", () => {
    const result = buildPointedElementsBlock([
      { ref: 3, text: '[3] button "Add"\n  text "$1"' },
      { ref: 5, text: '[5] link "X"' },
    ]);
    const lines = result.split("\n");
    expect(lines[0]).toBe("# Pointed elements (the user clicked these)");
    expect(lines[1]).toBe('1. [3] button "Add"');
    expect(lines[2]).toBe('     text "$1"');
    expect(lines[3]).toBe('2. [5] link "X"');
  });

  it("returns just the header for an empty array", () => {
    const result = buildPointedElementsBlock([]);
    expect(result).toBe("# Pointed elements (the user clicked these)\n");
  });
});
