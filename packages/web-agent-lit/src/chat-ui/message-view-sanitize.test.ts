import { afterEach, describe, expect, it, vi } from "vitest";
import { marked } from "marked";
import { sanitize } from "./message-view-sanitize.js";

/** Every panel render re-reads each text part, and a turn re-renders the thread
 *  many times, so the same markdown must not be parsed and sanitized again. */
describe("sanitize", () => {
  afterEach(() => vi.restoreAllMocks());

  it("parses an identical string once and returns the same HTML", () => {
    const parse = vi.spyOn(marked, "parse");
    const source = "**cache probe** <script>bad()</script>";

    const first = sanitize(source);
    const afterFirst = parse.mock.calls.length;
    expect(afterFirst).toBe(1);
    expect(first).not.toContain("<script");

    const second = sanitize(source);
    expect(parse.mock.calls.length).toBe(afterFirst);
    expect(second).toBe(first);
  });

  it("still parses a different string independently", () => {
    const parse = vi.spyOn(marked, "parse");
    expect(sanitize("**one**")).toContain("<strong>one</strong>");
    expect(sanitize("**two**")).toContain("<strong>two</strong>");
    expect(parse.mock.calls.length).toBe(2);
  });
});
