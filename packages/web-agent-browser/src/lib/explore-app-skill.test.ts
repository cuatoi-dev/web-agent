import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { exploreAppSkill } from "./explore-app-skill";
import { testPlanSkill } from "./test-plan-skill";

const BROWSER_ROOT = path.resolve(__dirname, "../..");

describe("exploreAppSkill", () => {
  it("is a reference skill named explore_app with a searchable description", () => {
    expect(exploreAppSkill.name).toBe("explore_app");
    expect(exploreAppSkill.command).toBe(false);
    expect(exploreAppSkill.description).toContain("locator");
    expect(exploreAppSkill.description).toContain("TC-");
  });

  it("defines the five app AGENTS.md headings and the seven-column page locator table", () => {
    for (const heading of ["## Site map", "## Environments", "## Login", "## Test data", "## Known defects"]) {
      expect(exploreAppSkill.definition).toContain(heading);
    }
    expect(exploreAppSkill.definition).toContain("| Element | Role + name | id | data-testid | name | CSS | XPath |");
    expect(exploreAppSkill.definition).toContain("page_generate_locator");
    expect(exploreAppSkill.definition).toContain("complete from the document");
  });

  it("requires user approval before writing TC-<nn>-<slug>.md files and defines nextTc numbering", () => {
    expect(exploreAppSkill.definition).toContain("wait for the user's OK");
    expect(exploreAppSkill.definition).toContain("Never write any `TC-*.md` file");
    expect(exploreAppSkill.definition).toContain("nextTc(suiteDir)");
    expect(exploreAppSkill.definition).toContain("never reused");
    expect(exploreAppSkill.definition).toContain("Scenario:");
    expect(exploreAppSkill.definition).toContain("Given ");
    expect(exploreAppSkill.definition).toContain("When ");
    expect(exploreAppSkill.definition).toContain("Then ");
  });
});

describe("testPlanSkill manual-testing and maintenance rules", () => {
  it("delegates missing site maps or empty suites to explore_app and checks Then with page_verify", () => {
    expect(testPlanSkill.definition).toContain("explore_app");
    expect(testPlanSkill.definition).toContain("## Site map");
    expect(testPlanSkill.definition).toContain("page_verify");
    expect(testPlanSkill.definition).toContain("resolves to no element is stale");
  });

  it("documents PASS, FAIL, updated: locator, updated: steps, Known defects, and the final chat summary", () => {
    expect(testPlanSkill.definition).toContain("Last result: PASS");
    expect(testPlanSkill.definition).toContain("Last result: FAIL");
    expect(testPlanSkill.definition).toContain("updated: locator");
    expect(testPlanSkill.definition).toContain("updated: steps");
    expect(testPlanSkill.definition).toContain("## Known defects");
    expect(testPlanSkill.definition).toContain("Download them from Files.");
    expect(testPlanSkill.definition).toContain("The run folder is gone after a browser restart; ask me to keep it.");
  });
});

describe("tesagent prompt and starter AGENTS.md", () => {
  it("tesagent.yml frames Tesagent as a manual tester that does not write automation scripts", () => {
    const yml = fs.readFileSync(path.join(BROWSER_ROOT, "brand/agents/tesagent.yml"), "utf8");
    expect(yml).toContain("You are Tesagent, a manual tester.");
    expect(yml).toContain("You do not write automation scripts.");
    expect(yml).toContain("page_verify");
    expect(yml).toContain("<password>");
  });

  it("tesagent.home/AGENTS.md includes Workspace, Where files go, Before you test, Safe writing, When you finish, and Apps", () => {
    const starter = fs.readFileSync(path.join(BROWSER_ROOT, "brand/agents/tesagent.home/AGENTS.md"), "utf8");
    expect(starter.startsWith("# Tesagent workspace\n")).toBe(true);
    for (const section of [
      "## Workspace",
      "## Where files go",
      "## Before you test",
      "## Safe writing",
      "## When you finish",
      "## Apps",
    ]) {
      expect(starter).toContain(section);
    }
    expect(starter).toContain("secrets.md");
    expect(starter).toContain("turn this recording into a test case");
    expect(starter).toContain("keep this run");
  });
});
