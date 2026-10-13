import { describe, expect, it } from "vitest";
import { schedulerSkills } from "./scheduler-skills.js";

describe("schedulerSkills", () => {
  it("returns exactly three skills with command: true", () => {
    const skills = schedulerSkills();
    expect(skills.length).toBeGreaterThan(0);
    for (const skill of skills) {
      expect(skill.command).toBe(true);
      expect(skill.disableModelInvocation).toBe(true);
      expect(skill.description.length).toBeGreaterThan(0);
      expect(skill.definition.length).toBeGreaterThan(0);
    }
  });

  it("scheduler prompt definitions contain expected tool calls", () => {
    const skills = schedulerSkills();
    const byName = Object.fromEntries(skills.map((s) => [s.name, s]));
    expect(byName["schedule"].definition).toContain("set_schedule");
    expect(byName["schedule-list"].definition).toContain("list_schedules");
    expect(byName["schedule-cancel"].definition).toContain("cancel_schedule");
  });
});
