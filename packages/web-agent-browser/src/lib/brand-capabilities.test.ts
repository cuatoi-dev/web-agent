import { describe, expect, it } from "vitest";
import type { SkillDef, ToolContext } from "@cuatoi/web-agent-core";
import {
  agentAllows,
  brandToolConfig,
  effectiveSettings,
  mergeBrandSkills,
  resolveAgent,
} from "./brand-capabilities";
import { EMPTY_BRAND } from "./brand";
import type { AgentBrand, AgentSettings, BrandAgent, PresetEntry } from "./types";

const a: SkillDef = { name: "a", description: "A", definition: "body a" };
const b: SkillDef = { name: "b", description: "B", definition: "body b" };

describe("mergeBrandSkills", () => {
  it("M1: built-in groups are kept in order when the brand declares no flags", () => {
    const result = mergeBrandSkills({ core: [a], dom: [b] }, EMPTY_BRAND);
    expect(result.map((s) => s.name)).toEqual(["a", "b"]);
  });

  it("M2: brand skills are appended last", () => {
    const c: SkillDef = { name: "c", description: "C", definition: "body c" };
    const brand: AgentBrand = { ...EMPTY_BRAND, skillDefs: [c] };
    const result = mergeBrandSkills({ core: [a], dom: [b] }, brand);
    expect(result.map((s) => s.name)).toEqual(["a", "b", "c"]);
  });

  it("M3: a brand skill named the same as a built-in replaces it, in its position", () => {
    const brandedA: SkillDef = { name: "a", description: "Branded A", definition: "branded body" };
    const brand: AgentBrand = { ...EMPTY_BRAND, skillDefs: [brandedA] };
    const result = mergeBrandSkills({ core: [a], dom: [b] }, brand);
    expect(result).toHaveLength(2);
    expect(result.map((s) => s.name)).toEqual(["a", "b"]);
    expect(result[0].definition).toBe("branded body");
  });

  it("M4: skills: { core: { enabled: false } } drops that group; skillDefs still add", () => {
    const c: SkillDef = { name: "c", description: "C", definition: "body c" };
    const off: AgentBrand = { ...EMPTY_BRAND, skills: { core: { enabled: false } } };
    expect(mergeBrandSkills({ core: [a], dom: [b] }, off).map((s) => s.name)).toEqual(["b"]);

    const offWithSkill: AgentBrand = { ...off, skillDefs: [c] };
    expect(mergeBrandSkills({ core: [a], dom: [b] }, offWithSkill).map((s) => s.name)).toEqual(["b", "c"]);
  });

  it("M5: a flag for a group this agent does not have changes nothing", () => {
    const brand: AgentBrand = { ...EMPTY_BRAND, skills: { tab: { enabled: false } } };
    expect(mergeBrandSkills({ core: [a] }, brand).map((s) => s.name)).toEqual(["a"]);
  });

  it("M6: an explicit true keeps the group", () => {
    const brand: AgentBrand = { ...EMPTY_BRAND, skills: { core: { enabled: true } } };
    expect(mergeBrandSkills({ core: [a], dom: [b] }, brand).map((s) => s.name)).toEqual(["a", "b"]);
  });

  it("M7: every group off and no skillDefs returns empty, not core's default list", () => {
    const brand: AgentBrand = {
      ...EMPTY_BRAND,
      skills: { core: { enabled: false }, dom: { enabled: false } },
    };
    expect(mergeBrandSkills({ core: [a], dom: [b] }, brand)).toEqual([]);
  });

  it("M8: skills: { playwright: { enabled: false } } drops only the playwright group", () => {
    const c: SkillDef = { name: "c", description: "C", definition: "body c" };
    const groups = { tab: [a], websiteEdit: [b], playwright: [c] };
    expect(mergeBrandSkills(groups, EMPTY_BRAND).map((s) => s.name)).toEqual(["a", "b", "c"]);

    const off: AgentBrand = { ...EMPTY_BRAND, skills: { playwright: { enabled: false } } };
    expect(mergeBrandSkills(groups, off).map((s) => s.name)).toEqual(["a", "b"]);
  });
});

describe("brandToolConfig", () => {
  it("T1: an empty brand adds nothing", () => {
    expect(brandToolConfig(EMPTY_BRAND)).toEqual({});
  });

  it("T2: tools: { todo: { enabled: false } } sets todo only; tools stays absent", () => {
    const brand: AgentBrand = { ...EMPTY_BRAND, tools: { todo: { enabled: false } } };
    const cfg = brandToolConfig(brand);
    expect(cfg).toEqual({ todo: { enabled: false } });
    expect(cfg.tools).toBeUndefined();
  });

  it("T3: tools: { scheduler: { enabled: true } } sets scheduler", () => {
    const brand: AgentBrand = { ...EMPTY_BRAND, tools: { scheduler: { enabled: true } } };
    expect(brandToolConfig(brand)).toEqual({ scheduler: { enabled: true } });
  });

  it("T4: tools: { genui: { enabled: false } } drops show_generative_ui, keeps query_data", () => {
    const brand: AgentBrand = { ...EMPTY_BRAND, tools: { genui: { enabled: false } } };
    const cfg = brandToolConfig(brand);
    expect(typeof cfg.tools).toBe("function");
    const names = cfg.tools?.({} as ToolContext).map((t) => t.name) ?? [];
    expect(names).not.toContain("show_generative_ui");
    expect(names).toContain("query_data");
  });

  it("T5: tools: { data: { enabled: false } } drops the four data tools, keeps genui", () => {
    const brand: AgentBrand = { ...EMPTY_BRAND, tools: { data: { enabled: false } } };
    const cfg = brandToolConfig(brand);
    const names = cfg.tools?.({} as ToolContext).map((t) => t.name) ?? [];
    expect(names).not.toContain("list_data_sources");
    expect(names).not.toContain("get_field_details");
    expect(names).not.toContain("sample_field_values");
    expect(names).not.toContain("query_data");
    expect(names).toContain("show_generative_ui");
  });

  it("T6: both data and genui off drops both groups; get_time still present", () => {
    const brand: AgentBrand = {
      ...EMPTY_BRAND,
      tools: { data: { enabled: false }, genui: { enabled: false } },
    };
    const cfg = brandToolConfig(brand);
    const names = cfg.tools?.({} as ToolContext).map((t) => t.name) ?? [];
    expect(names).not.toContain("list_data_sources");
    expect(names).not.toContain("show_generative_ui");
    expect(names).toContain("get_time");
  });

  it("T7: an explicit true for genui changes nothing; tools stays absent", () => {
    const brand: AgentBrand = { ...EMPTY_BRAND, tools: { genui: { enabled: true } } };
    expect(brandToolConfig(brand).tools).toBeUndefined();
  });
});

describe("agentAllows", () => {
  it("returns true for wildcard *", () => {
    expect(agentAllows("*", undefined, "read_tabs")).toBe(true);
    expect(agentAllows("*", undefined, "anything")).toBe(true);
  });

  it("respects inclusion list", () => {
    expect(agentAllows(["read_tabs", "page_eval"], undefined, "read_tabs")).toBe(true);
    expect(agentAllows(["read_tabs", "page_eval"], undefined, "close_tab")).toBe(false);
  });

  it("respects excludeTools/excludeSkills, even against a wildcard or the inclusion list itself", () => {
    expect(agentAllows("*", ["close_tab"], "close_tab")).toBe(false);
    expect(agentAllows("*", ["close_tab"], "read_tabs")).toBe(true);
    expect(agentAllows(["close_tab"], ["close_tab"], "close_tab")).toBe(false);
  });
});

describe("resolveAgent", () => {
  const chromagent: BrandAgent = {
    id: "chromagent",
    displayName: "Chromagent",
    description: "D",
    instructions: "I",
    tools: "*",
    skills: "*",
  };
  const tesagent: BrandAgent = {
    id: "tesagent",
    displayName: "tesagent",
    description: "D",
    instructions: "I",
    tools: "*",
    skills: "*",
  };
  const brand: AgentBrand = { ...EMPTY_BRAND, agents: [chromagent, tesagent], defaultAgent: "chromagent" };

  it("returns defaultAgent when lastId is unset", () => {
    expect(resolveAgent(brand, undefined)).toBe(chromagent);
  });

  it("returns agent matching lastId when present", () => {
    expect(resolveAgent(brand, "tesagent")).toBe(tesagent);
  });

  it("falls back to defaultAgent when lastId matches no agent", () => {
    expect(resolveAgent(brand, "missing")).toBe(chromagent);
  });

  it("returns undefined when the brand has no agents", () => {
    expect(resolveAgent(EMPTY_BRAND, undefined)).toBeUndefined();
  });
});

describe("effectiveSettings", () => {
  const settings: AgentSettings = {
    endpoint: "https://options.test",
    wireFormat: "openai",
    model: "options-model",
    streaming: true,
    apiKey: "k",
    theme: "auto",
  };
  const textOnlyEntry: PresetEntry = {
    id: "test-text-only",
    label: "Text-only",
    endpoint: "http://localhost:28780/api/anthropic",
    wireFormat: "anthropic",
    model: "text-only-model",
    streaming: false,
  };
  const brand: AgentBrand = { ...EMPTY_BRAND, models: [textOnlyEntry] };
  const agentWithModel: BrandAgent = {
    id: "chromagent",
    displayName: "Chromagent",
    description: "D",
    instructions: "I",
    tools: "*",
    skills: "*",
    model: "test-text-only",
  };
  const agentNoModel: BrandAgent = {
    id: "chromagent",
    displayName: "Chromagent",
    description: "D",
    instructions: "I",
    tools: "*",
    skills: "*",
  };

  it("overrides model and endpoint when agent.model is set", () => {
    expect(effectiveSettings(settings, brand, agentWithModel)).toEqual({
      ...settings,
      endpoint: "http://localhost:28780/api/anthropic",
      wireFormat: "anthropic",
      model: "text-only-model",
      streaming: false,
    });
  });

  it("returns unmodified settings when agent.model is unset", () => {
    expect(effectiveSettings(settings, brand, agentNoModel)).toBe(settings);
  });

  it("returns unmodified settings when agent.model names no entry in brand.models", () => {
    const agent: BrandAgent = { ...agentNoModel, model: "not-a-real-id" };
    expect(effectiveSettings(settings, brand, agent)).toBe(settings);
  });
});
