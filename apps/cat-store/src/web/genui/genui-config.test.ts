import { describe, it, expect } from "vitest";
import { GENUI_APPROVED_COLOUR_TOKENS, MATERIAL_GENUI_COMPONENTS } from "./genui-config";


describe("GENUI_APPROVED_COLOUR_TOKENS", () => {
  it("does not name the legacy, retired --wa-primary-color", () => {
    expect(GENUI_APPROVED_COLOUR_TOKENS).not.toContain("--wa-primary-color");
  });
});

describe("MATERIAL_GENUI_COMPONENTS", () => {
  it("every entry is a valid custom element name", () => {
    // A custom element name must be lowercase and contain a hyphen. The list
    // is read by registeredElementsRule, which matches tags with exactly that
    // shape (genui-rules.ts:169), so an entry outside it could never be
    // matched and would silently do nothing.
    for (const tag of MATERIAL_GENUI_COMPONENTS) {
      expect(tag).toMatch(/^[a-z][a-z0-9]*-[a-z0-9-]*$/);
    }
  });

  it("still names the nine Material tags genui-material-bundle.ts registers", () => {
    for (const tag of ["md-filled-button", "md-outlined-button", "md-icon-button",
      "md-outlined-text-field", "md-checkbox", "md-linear-progress",
      "md-menu", "md-menu-item", "md-icon"]) {
      expect(MATERIAL_GENUI_COMPONENTS).toContain(tag);
    }
  });

  it("names the chart block the chart bundle registers", () => {
    expect(MATERIAL_GENUI_COMPONENTS).toContain("agent-chart-block");
  });
});
