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
  selectRequiredForWideSource,
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

  it("selectRequiredForWideSource — names the source, count, limit and example", () => {
    const msg = selectRequiredForWideSource("es-orders", 300, 40, ["a", "b", "c"]);
    expect(msg).toContain('Source "es-orders" has 300 columns');
    expect(msg).toContain("40-column limit");
    expect(msg).toContain('"select": ["a", "b"]');
    expect(msg).not.toContain('"c"');
  });

  it("selectRequiredForWideSource — names both discovery tools", () => {
    const msg = selectRequiredForWideSource("es-orders", 300, 40, ["a", "b"]);
    expect(msg).toContain('get_field_details({ source: "es-orders"');
    expect(msg).toContain('sample_field_values({ source: "es-orders"');
  });

  it("selectRequiredForWideSource — states aggregates do not need select", () => {
    const msg = selectRequiredForWideSource("es-orders", 300, 40, ["a", "b"]);
    expect(msg).toContain("An aggregate query does not need \"select\".");
  });

  it("selectRequiredForWideSource — one example field is still well-formed", () => {
    const msg = selectRequiredForWideSource("es-orders", 300, 40, ["a"]);
    expect(msg).toContain('"select": ["a"]');
  });
});
