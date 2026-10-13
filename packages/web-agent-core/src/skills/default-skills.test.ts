import { describe, it, expect } from "vitest";
import { coreSkills } from "./default-skills.js";
import { validateDataQuery } from "../datasource/types.js";


describe("coreSkills()", () => {
  it("no longer ships a DOM skill", () => {
    const names = coreSkills().map((s) => s.name);
    expect(names).not.toContain("multi_step_ui");
  });

  it("no core skill instructs a tool core does not ship", () => {
    const joined = coreSkills().map((s) => s.definition).join("\n");
    expect(joined).not.toMatch(/\bsnapshot_page\b/);
    expect(joined).not.toMatch(/\bwait_for\b/);
    for (const skill of coreSkills()) {
      expect(skill.name).not.toBe("multi_step_ui");
    }
  });

  it("the surviving skills are intact", () => {
    const names = coreSkills().map((s) => s.name);
    expect(names).toContain("query_data_advanced");
    expect(names).toContain("present_to_user");
    for (const skill of coreSkills()) {
      expect(skill.description.length).toBeGreaterThan(0);
      expect(skill.definition.length).toBeGreaterThan(0);
    }
  });

  it("query_data_advanced documents free-text search, get_field_details, and sample_field_values", () => {
    const skill = coreSkills().find((s) => s.name === "query_data_advanced")!;
    expect(skill.definition).toContain("## Free-text search");
    expect(skill.definition).toContain("$contains");
    expect(skill.definition).toContain("get_field_details");
    expect(skill.definition).toContain("sample_field_values");
  });

  it("query_data_advanced routes unsupported fields through get_field_details", () => {
    const skill = coreSkills().find((s) => s.name === "query_data_advanced")!;
    expect(skill.definition).toContain('get_field_details({ source: "<name>", filter: "<field>" })');
    expect(skill.definition).toContain("unsupportedFields");
  });

  it("query_data_advanced carries the Column projection guidance", () => {
    const skill = coreSkills().find((s) => s.name === "query_data_advanced")!;
    expect(skill.definition).toContain("## Column projection");
    expect(skill.definition).toContain("get_field_details");
  });

  it("query_data_advanced tells the model where an aggregate sort goes", () => {
    const skill = coreSkills().find((s) => s.name === "query_data_advanced")!;
    // The sort named in the Aggregation section is the one inside the block,
    // on a result-column alias.
    expect(skill.definition).toMatch(/the one INSIDE the aggregate block/);
    expect(skill.definition).toContain("<field>_<granularity>");
    expect(skill.definition).toContain("<op>_<field>");
    // A top-level sort/select next to an aggregate is rejected.
    expect(skill.definition).toMatch(/A top-level `sort` or `select` next to an\s+aggregate is rejected/);
  });

  it("query_data_advanced example parses successfully against DataQuerySchema", async () => {
    const skill = coreSkills().find((s) => s.name === "query_data_advanced")!;
    const jsonMatch = skill.definition.match(/```json\n([\s\S]*?)\n```/);
    expect(jsonMatch).not.toBeNull();
    const parsedJson: unknown = JSON.parse(jsonMatch![1]);
    const res = await validateDataQuery(parsedJson);
    expect(res.ok, res.ok ? "" : res.message).toBe(true);
  });
});
