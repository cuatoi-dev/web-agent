import { describe, it, expect } from "vitest";
import { pageAgentSkill, tabManagementSkill, tabSkills } from "./tab-skill";

describe("tab-skill", () => {
  it("tabSkills() returns an array containing tabManagementSkill and pageAgentSkill", () => {
    expect(tabSkills()).toEqual([tabManagementSkill, pageAgentSkill]);
  });

  it("has a non-empty description and definition", () => {
    expect(typeof tabManagementSkill.description).toBe("string");
    expect(tabManagementSkill.description.length).toBeGreaterThan(0);
    expect(typeof tabManagementSkill.definition).toBe("string");
    expect(tabManagementSkill.definition.length).toBeGreaterThan(0);
  });

  it("guides reading tabs before acting, navigate_tab limits, and close_tab confirmation", () => {
    const def = tabManagementSkill.definition;
    expect(def).toContain("read_tabs");
    expect(def).toContain("navigate_tab");
    expect(def).toContain("chrome://");
    expect(def).toContain("close_tab");
    expect(def).toContain("confirmation");
  });
});

describe("pageAgentSkill", () => {
  it("has name page_agent and non-empty description/definition", () => {
    expect(typeof pageAgentSkill.description).toBe("string");
    expect(pageAgentSkill.description.length).toBeGreaterThan(0);
    expect(typeof pageAgentSkill.definition).toBe("string");
    expect(pageAgentSkill.definition.length).toBeGreaterThan(0);
  });

  it("specifies the 5-step loop and the 30s/120s wait discipline", () => {
    const def = pageAgentSkill.definition;
    expect(def).toContain("toggle_page_agent");
    expect(def).toContain("send_to_page_agent");
    expect(def).toContain("read_page_agent");
    expect(def).toContain("wait: 30");
    expect(def).toContain("wait: 120");
    expect(def).toContain("5-step");
  });

  it("tells the model that /compact, /new and /clear travel over send_to_page_agent (113/002)", () => {
    const def = pageAgentSkill.definition;
    expect(def).toContain("/compact");
    expect(def).toContain("/new");
    expect(def).toContain("/clear");
    expect(def).toContain("send_to_page_agent");
  });
});
