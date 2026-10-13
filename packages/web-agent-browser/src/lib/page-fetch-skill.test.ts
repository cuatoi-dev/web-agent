import { describe, it, expect } from "vitest";
import { pageFetchSkill } from "./page-fetch-skill";

describe("pageFetchSkill", () => {
  it("has valid name, description, and definition", () => {
    expect(pageFetchSkill.description).toBeTruthy();
    expect(typeof pageFetchSkill.definition).toBe("string");
    expect(pageFetchSkill.definition.length).toBeGreaterThan(50);
  });

  it("outlines same-origin rules, cookies, and HTTP API preference", () => {
    const def = pageFetchSkill.definition;
    expect(def).toContain("Same-origin only");
    expect(def).toContain("Session cookies");
    expect(def).toContain("page_fetch");
    expect(def).toContain("Inspect status and errors");
  });

  it("tells the agent when to run code in the page and what constrains it", () => {
    const def = pageFetchSkill.definition;
    expect(def).toContain("When to use page_eval");
    expect(def).toContain("async function body");
    expect(def).toContain("Content Security Policy");
    expect(pageFetchSkill.description).toContain("page_eval");
  });
});
