import { describe, it, expect } from "vitest";
import { financeDemoSkill } from "./finance-demo-skill";

describe("financeDemoSkill", () => {
  it("has a non-empty description and definition", () => {
    expect(financeDemoSkill.description.length).toBeGreaterThan(0);
    expect(financeDemoSkill.description).toContain("/finance");
    expect(financeDemoSkill.definition.length).toBeGreaterThan(0);
    expect(financeDemoSkill.definition).toContain("candlestick");
  });
});