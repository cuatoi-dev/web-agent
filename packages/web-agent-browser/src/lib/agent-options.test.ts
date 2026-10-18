import { describe, expect, it } from "vitest";
import { skillNames, toolGroups, uniqueGroups } from "./agent-options";
import { SIDE_PANEL_DROPPED_TOOL_NAMES } from "./sidepanel-tool-filter";
import type { AgentBrand } from "./types";

const base = {
  agents: [],
  defaultAgent: "",
  prompts: {},
  tools: {},
  skills: {},
  options: {},
  models: [],
  skillDefs: [],
  hosts: [],
} as unknown as AgentBrand;

describe("agent-options", () => {
  it("O1 tool groups keep their headings in order and list no name twice", () => {
    const groups = toolGroups(base);
    expect(groups.map((g) => g.heading)).toEqual(["Tabs", "Page", "Page agent", "Core"]);
    const names = groups.flatMap((g) => g.names);
    expect(new Set(names).size).toBe(names.length);
  });

  it("O2 create_skill is in Core", () => {
    expect(toolGroups(base).find((g) => g.heading === "Core")!.names).toContain("create_skill");
  });

  it("O3 data off", () => {
    const brand = { ...base, tools: { data: { enabled: false } } } as AgentBrand;
    const groups = toolGroups(brand);
    const core = groups.find((g) => g.heading === "Core")!.names;
    for (const name of ["list_data_sources", "get_field_details", "sample_field_values", "query_data"]) {
      expect(core).not.toContain(name);
    }
    const defaultGroups = toolGroups(base);
    expect(groups.find((g) => g.heading === "Tabs")).toEqual(defaultGroups.find((g) => g.heading === "Tabs"));
    expect(groups.find((g) => g.heading === "Page")).toEqual(defaultGroups.find((g) => g.heading === "Page"));
    expect(groups.find((g) => g.heading === "Page agent")).toEqual(defaultGroups.find((g) => g.heading === "Page agent"));
  });

  it("O4 the side panel drops the CSP-blocked tools, and the scheduler and todo flags still drop theirs", () => {
    const baseCoreLen = toolGroups(base).find((g) => g.heading === "Core")!.names.length;

    const allNames = toolGroups(base).flatMap((g) => g.names);
    for (const dropped of SIDE_PANEL_DROPPED_TOOL_NAMES) {
      expect(allNames).not.toContain(dropped);
    }
    expect(allNames).toContain("query_data");

    const schedOff = { ...base, tools: { scheduler: { enabled: false } } } as AgentBrand;
    const schedCore = toolGroups(schedOff).find((g) => g.heading === "Core")!.names;
    for (const n of ["set_schedule", "list_schedules", "cancel_schedule"]) {
      expect(schedCore).not.toContain(n);
    }
    expect(schedCore.length).toBe(baseCoreLen - 3);

    const todoOff = { ...base, tools: { todo: { enabled: false } } } as AgentBrand;
    const todoCore = toolGroups(todoOff).find((g) => g.heading === "Core")!.names;
    for (const n of ["todo_write", "todo_read"]) {
      expect(todoCore).not.toContain(n);
    }
    expect(todoCore.length).toBe(baseCoreLen - 2);
  });

  it("O5 uniqueGroups", () => {
    expect(
      uniqueGroups([
        { heading: "A", names: ["x", "y", "x"] },
        { heading: "B", names: ["y", "z"] },
        { heading: "C", names: ["x"] },
      ]),
    ).toEqual([
      { heading: "A", names: ["x", "y"] },
      { heading: "B", names: ["z"] },
    ]);
  });

  it("O6 skill names", () => {
    expect(skillNames(base)).toEqual([
      { heading: null, names: ["tab_management", "page_agent", "website_edit", "test_plan", "test_report", "explore_app"] },
    ]);
  });

  it("O7 skill group off and brand skill", () => {
    const brand = {
      ...base,
      skills: { testing: { enabled: false } },
      skillDefs: [{ name: "acme_skill", description: "d", definition: "x" }],
    } as unknown as AgentBrand;
    expect(skillNames(brand)).toEqual([
      { heading: null, names: ["tab_management", "page_agent", "website_edit", "acme_skill"] },
    ]);
  });
});
