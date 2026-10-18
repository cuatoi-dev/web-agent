import { describe, it, expect } from "vitest";
import { testReportSkill } from "./test-report-skill";
import { testPlanSkill } from "./test-plan-skill";

describe("testReportSkill", () => {
  it("name, command, description", () => {
    expect(testReportSkill.name).toBe("test_report");
    expect(testReportSkill.command).toBe(false);
    expect(typeof testReportSkill.description).toBe("string");
    expect(testReportSkill.description.length).toBeGreaterThan(0);
    expect(testReportSkill.description.toLowerCase()).toContain("report");
  });

  it("names the tool and both files", () => {
    expect(testReportSkill.definition).toContain("bundle_html");
    expect(testReportSkill.definition).toContain("report.src.html");
    expect(testReportSkill.definition).toContain("report.html");
  });

  it("names the six columns", () => {
    const cols = ["TC", "Test case", "Expected result", "Real result", "Status", "Screenshot"];
    for (const col of cols) {
      expect(testReportSkill.definition).toContain(col);
    }
  });

  it("states the status rule with PASS, FAIL and greyscale", () => {
    expect(testReportSkill.definition).toContain("PASS");
    expect(testReportSkill.definition).toContain("FAIL");
    expect(testReportSkill.definition).toContain("greyscale");
  });

  it("contains the starter table markup and absolute file-system path requirement", () => {
    expect(testReportSkill.definition).toContain("border-collapse");
    expect(testReportSkill.definition).toContain('width="480"');
    expect(testReportSkill.definition).toMatch(/absolute\s+file-system path/);
  });

  it("states a user's format wins", () => {
    expect(testReportSkill.definition).toContain("sample HTML file");
  });

  it("states every row needs a result capture and requires a list format in answer", () => {
    expect(testReportSkill.definition).toContain("Every row needs a result capture");
    expect(testReportSkill.definition).toContain("no result capture");
    expect(testReportSkill.definition).toContain("Answer with a list, one item per case");
  });

  it("testPlanSkill names the temporary-attribute rule and page_generate_locator", () => {
    expect(testPlanSkill.definition).toContain("page_generate_locator");
    expect(testPlanSkill.definition).toContain("temporary");
    expect(testPlanSkill.definition).toContain("aria-label");
  });
});
