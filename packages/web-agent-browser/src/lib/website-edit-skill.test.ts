import { describe, it, expect } from "vitest";
import { websiteEditSkill } from "./website-edit-skill";
import { mergeBrandSkills } from "./brand-capabilities";
import { EMPTY_BRAND } from "./brand";
import { tabManagementSkill } from "./tab-skill";
import type { AgentBrand } from "./types";

describe("websiteEditSkill", () => {
  it("U2: description is a non-empty string", () => {
    expect(typeof websiteEditSkill.description).toBe("string");
    expect(websiteEditSkill.description.length).toBeGreaterThan(0);
  });

  it("U3: definition is a string longer than 200 characters", () => {
    expect(typeof websiteEditSkill.definition).toBe("string");
    expect(websiteEditSkill.definition.length).toBeGreaterThan(200);
  });

  it("U4: description contains 'shadow', which search_skills matches on", () => {
    expect(websiteEditSkill.description.toLowerCase()).toContain("shadow");
  });

  it("U5: the definition names all three shadow-DOM routes", () => {
    expect(websiteEditSkill.definition).toContain("var()");
    expect(websiteEditSkill.definition).toContain("::part(");
    expect(websiteEditSkill.definition).toContain("adoptedStyleSheets");
  });

  it("U6: the definition states page CSS does not cross a shadow boundary", () => {
    expect(websiteEditSkill.definition).toContain("does not cross a shadow boundary");
  });

  it("U7: the definition contains the deepRoots/deepQuery helpers and the append rule", () => {
    expect(websiteEditSkill.definition).toContain("deepRoots");
    expect(websiteEditSkill.definition).toContain("deepQuery");
    expect(websiteEditSkill.definition).toContain("[...r.adoptedStyleSheets, sheet]");
    expect(websiteEditSkill.definition).toContain("Append; never replace");
  });

  it("U8: the definition states the four-step loop with the screenshot required", () => {
    expect(websiteEditSkill.definition).toContain("page_screenshot");
    expect(websiteEditSkill.definition).toContain("page_console");
    expect(websiteEditSkill.definition).toContain("A returned value is not evidence");
    expect(websiteEditSkill.definition).toContain("1. **Survey**");
    expect(websiteEditSkill.definition).toContain("2. **Edit**");
    expect(websiteEditSkill.definition).toContain("3. **Look**");
    expect(websiteEditSkill.definition).toContain("4. **Fix**");
  });

  it("U9: the definition states the fallback when page_screenshot is absent", () => {
    expect(websiteEditSkill.definition).toContain("not in your tool list");
    expect(websiteEditSkill.definition).toContain('page_console({level:"error"})');
  });

  it("U10: the defect table contains at least the six P6 rows", () => {
    const symptoms = [
      "Content is missing below a point",
      "Image boxes are blank",
      "An image is blurry",
      "A box collapses to about 18 pixels wide",
      "A pale frame sits around an element on a dark page",
      "The layout reverts after the user interacts",
      "The page looks unchanged after a dark restyle",
      "A figure shrinks back to a thumbnail",
      "Real content disappeared along with the furniture",
    ];
    for (const symptom of symptoms) {
      expect(websiteEditSkill.definition).toContain(symptom);
    }
  });

  it("U11: group merging keeps both tab and websiteEdit skills", () => {
    const names = mergeBrandSkills(
      { tab: [tabManagementSkill], websiteEdit: [websiteEditSkill] },
      EMPTY_BRAND,
    ).map((s) => s.name);
    expect(names).toEqual(["tab_management", "website_edit"]);
  });

  it("U12: a brand switch drops websiteEdit but keeps tab", () => {
    const off: AgentBrand = { ...EMPTY_BRAND, skills: { websiteEdit: { enabled: false } } };
    const names = mergeBrandSkills(
      { tab: [tabManagementSkill], websiteEdit: [websiteEditSkill] },
      off,
    ).map((s) => s.name);
    expect(names).toEqual(["tab_management"]);
  });

  it("U13: the definition contains no colour literal", () => {
    expect(websiteEditSkill.definition).not.toMatch(
      /#(?:[0-9a-fA-F]{3,4}){1,2}\b|\b(?:rgba?|hsla?)\s*\(/,
    );
  });
});
