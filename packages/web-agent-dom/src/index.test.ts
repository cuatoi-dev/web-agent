import { describe, it, expect } from "vitest";
import { domSkills, multiStepUiSkill } from "./index.js";

describe("DOM Package Entrypoint", () => {
  it("the skill still teaches the snapshot cycle", () => {
    const [skill] = domSkills();
    expect(skill.definition).toContain("snapshot_page");
    expect(skill.definition).toContain("wait_for");
    expect(skill.definition).toContain("Stale ref recovery");
  });

  it("multiStepUiSkill is exported directly", () => {
    expect(domSkills()[0]).toBe(multiStepUiSkill);
  });
});
