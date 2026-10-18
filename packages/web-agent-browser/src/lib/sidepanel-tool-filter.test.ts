import { describe, expect, it } from "vitest";
import type { ToolContext } from "@cuatoi/web-agent-core";
import { EMPTY_BRAND } from "./brand";
import { SIDE_PANEL_DROPPED_TOOL_NAMES, sidePanelTools } from "./sidepanel-tool-filter";
import type { AgentBrand } from "./types";

/** Only the seams are read, and none are needed for the names asserted here. */
const CTX = {} as ToolContext;

const namesOfSidePanel = (brand: AgentBrand): string[] =>
  sidePanelTools(brand, CTX).map((tool) => tool.name);

describe("sidePanelTools", () => {
  it("never offers show_generative_ui", () => {
    expect(namesOfSidePanel(EMPTY_BRAND)).not.toContain("show_generative_ui");
  });

  it("drops every name in SIDE_PANEL_DROPPED_TOOL_NAMES and keeps core's other tools", () => {
    const names = namesOfSidePanel(EMPTY_BRAND);
    for (const dropped of SIDE_PANEL_DROPPED_TOOL_NAMES) {
      expect(names, `${dropped} must never reach the side panel`).not.toContain(dropped);
    }
    expect(names).toContain("query_data");
    expect(names).toContain("get_time");
    expect(names).toContain("wait");
  });

  it("still removes the data tools when the brand switches that group off", () => {
    const off: AgentBrand = { ...EMPTY_BRAND, tools: { data: { enabled: false } } };
    const names = namesOfSidePanel(off);
    for (const dataTool of ["list_data_sources", "get_field_details", "sample_field_values", "query_data"]) {
      expect(names).not.toContain(dataTool);
    }
    expect(names).toContain("get_time");
    expect(names).not.toContain("show_generative_ui");
  });
});
