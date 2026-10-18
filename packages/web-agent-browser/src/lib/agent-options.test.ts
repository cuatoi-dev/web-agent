import { describe, expect, it } from "vitest";
import { skillNames, toolGroups, uniqueGroups } from "./agent-options";
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
  it("O1 default tool groups", () => {
    expect(toolGroups(base)).toEqual([
      { heading: "Tabs", names: ["read_tabs", "open_tab", "navigate_tab", "refresh_tab", "close_tab"] },
      {
        heading: "Page",
        names: [
          "page_eval",
          "page_fetch",
          "page_console",
          "page_snapshot",
          "page_click",
          "page_fill_form",
          "page_select_option",
          "page_verify",
          "page_generate_locator",
          "page_network",
          "page_dialog",
          "page_upload_file",
          "start_debugging",
          "stop_debugging",
          "page_hover",
          "page_press_key",
          "page_emulate",
          "start_recording",
          "stop_recording",
          "page_screenshot",
        ],
      },
      { heading: "Page agent", names: ["send_to_page_agent", "toggle_page_agent", "read_page_agent"] },
      {
        heading: "Core",
        names: [
          "wait",
          "get_time",
          "list_data_sources",
          "get_field_details",
          "sample_field_values",
          "query_data",
          "show_generative_ui",
          "search_skills",
          "load_skill",
          "create_skill",
          "compact_conversation",
          "set_schedule",
          "list_schedules",
          "cancel_schedule",
          "todo_write",
          "todo_read",
        ],
      },
    ]);
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

  it("O4 genui, scheduler, todo off", () => {
    const baseCoreLen = toolGroups(base).find((g) => g.heading === "Core")!.names.length;

    const genuiOff = { ...base, tools: { genui: { enabled: false } } } as AgentBrand;
    const genuiCore = toolGroups(genuiOff).find((g) => g.heading === "Core")!.names;
    expect(genuiCore).not.toContain("show_generative_ui");
    expect(genuiCore.length).toBe(baseCoreLen - 1);

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
      { heading: null, names: ["tab_management", "page_agent", "website_edit", "test_plan", "test_report"] },
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
