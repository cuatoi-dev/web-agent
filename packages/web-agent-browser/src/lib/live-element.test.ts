import { describe, it, expect } from "vitest";
import { inPage } from "./live-element";

describe("inPage", () => {
  it("returns the element while it is in the document", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    expect(inPage(el)).toBe(el);
    el.remove();
  });

  it("returns null once the element has been removed", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    el.remove();
    expect(inPage(el)).toBeNull();
  });

  it("returns null for an element that was never appended", () => {
    expect(inPage(document.createElement("div"))).toBeNull();
  });

  it("returns null for null", () => {
    expect(inPage(null)).toBeNull();
  });
});
