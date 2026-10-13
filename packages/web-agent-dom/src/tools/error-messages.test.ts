import { describe, it, expect } from "vitest";
import {
  staleRef,
  detachedRef,
  disabledRef,
  unknownTool,
  schemaViolation,
  waitTimeout,
  invalidJsonPath,
  selectOptionMissing,
  navigationBlocked,
  elementNotVisible,
  screenshotMayNotContainElement,
  emptyScreenshot,
  invisibleTargetNote,
} from "./error-messages.js";

describe("error-messages", () => {
  it("staleRef", () => {
    expect(staleRef("12", 3, 7)).toBe(
      "Ref 12 is stale (generation 3, current 7). Take a new snapshot.",
    );
  });

  it("detachedRef", () => {
    expect(detachedRef("5")).toBe(
      "Ref 5 no longer exists in the DOM. Take a new snapshot.",
    );
  });

  it("disabledRef", () => {
    expect(disabledRef("7", "Submit Order")).toBe(
      'Ref 7 ("Submit Order") is disabled. Inspect the form for unmet requirements.',
    );
  });

  it("unknownTool", () => {
    expect(unknownTool("foo", ["click", "fill"])).toBe(
      'Unknown tool "foo". Available: click, fill.',
    );
  });

  it("schemaViolation", () => {
    expect(schemaViolation("click", "ref is required")).toBe(
      "Invalid input for click: ref is required.",
    );
  });

  it("waitTimeout", () => {
    expect(waitTimeout(5000, 'text "Order confirmed"')).toBe(
      'Timed out after 5000ms waiting for text "Order confirmed". Condition not met.',
    );
  });

  it("invalidJsonPath", () => {
    expect(invalidJsonPath("path must start with $")).toBe(
      "Invalid JSONPath: path must start with $. Paths must start with $.",
    );
  });

  it("selectOptionMissing — few options", () => {
    expect(selectOptionMissing("BUY", ["SELL", "HOLD"])).toBe(
      'No option "BUY". Available: SELL, HOLD.',
    );
  });

  it("selectOptionMissing — many options, truncated", () => {
    const opts = Array.from({ length: 25 }, (_, i) => `opt${i}`);
    const msg = selectOptionMissing("missing", opts);
    expect(msg).toContain('No option "missing"');
    expect(msg).toContain("…+5 more");
  });

  it("navigationBlocked", () => {
    expect(navigationBlocked()).toBe("Only same-origin paths are allowed.");
  });

  it("elementNotVisible names the ref and element name and contains is not visible", () => {
    const msg = elementNotVisible("12", "Buy now");
    expect(msg).toContain("Ref 12");
    expect(msg).toContain('"Buy now"');
    expect(msg).toContain("is not visible");
    expect(msg).toMatch(/see without a scope|new snapshot/);
  });

  it("elementNotVisible omits the quoted label when the element has no name", () => {
    expect(elementNotVisible("12", "")).not.toContain('""');
  });

  it("screenshotMayNotContainElement names the ref and includes warning phrasing", () => {
    const msg = screenshotMayNotContainElement("12", "Buy now");
    expect(msg).toContain("ref 12");
    expect(msg).toContain('"Buy now"');
    expect(msg).toContain("may not contain the element");
  });

  it("emptyScreenshot says no image was sent and what to do next", () => {
    const msg = emptyScreenshot();
    expect(msg).toContain("no image was sent");
    expect(msg).toMatch(/see without a scope|snapshot/);
  });

  it("invisibleTargetNote with name", () => {
    expect(invisibleTargetNote("1", "Submit")).toBe('Note: ref 1 ("Submit") is not visible on screen.');
  });

  it("invisibleTargetNote without name", () => {
    expect(invisibleTargetNote("2", "")).toBe("Note: ref 2 is not visible on screen.");
  });
});
