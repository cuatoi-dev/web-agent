import { describe, it, expect } from "vitest";
import { searchDocsTool } from "./search-docs-tool";

describe("searchDocsTool renderer", () => {
  it("interpolates the query as sanitizable HTML", () => {
    expect(searchDocsTool.renderer!({ query: "lit3 registry" }, "…")).toBe(
      "Searched the docs for <b>lit3 registry</b> 📚",
    );
  });

  it("no query → generic", () => {
    expect(searchDocsTool.renderer!({}, "…")).toBe("Searched the docs 📚");
  });
});
