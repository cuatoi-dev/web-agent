import { describe, expect, it } from "vitest";
import { EMPTY_BRAND } from "./brand";
import { defaultSettings, resolveModels } from "./brand-models";
import { DEFAULT_THEME } from "./constants";
import { PRESET_ENTRIES } from "./presets";
import type { PresetEntry } from "./types";

const TWO: PresetEntry[] = [
  {
    id: "two-a",
    label: "Two A",
    endpoint: "https://two-a.example/api/anthropic",
    wireFormat: "anthropic",
    model: "model-a",
    streaming: true,
  },
  {
    id: "two-b",
    label: "Two B",
    endpoint: "https://two-b.example/api/openai/v1",
    wireFormat: "openai",
    model: "model-b",
    streaming: false,
  },
];

describe("brand-models", () => {
  it("a brand with models returns them", () => {
    expect(resolveModels({ ...EMPTY_BRAND, models: TWO })).toBe(TWO);
  });

  it("an empty model list falls back to the compiled presets", () => {
    expect(resolveModels(EMPTY_BRAND)).toEqual(PRESET_ENTRIES);
  });

  it("a brand whose models key is not an array falls back", () => {
    expect(resolveModels({ ...EMPTY_BRAND, models: "x" as never })).toEqual(PRESET_ENTRIES);
  });

  it("the defaults are the FIRST entry", () => {
    expect(defaultSettings({ ...EMPTY_BRAND, models: TWO })).toEqual({
      endpoint: TWO[0].endpoint,
      wireFormat: TWO[0].wireFormat,
      model: TWO[0].model,
      streaming: TWO[0].streaming,
      apiKey: "",
      theme: DEFAULT_THEME,
    });
  });

  it("the defaults never carry a key", () => {
    expect(defaultSettings({ ...EMPTY_BRAND, models: TWO }).apiKey).toBe("");
    expect(defaultSettings(EMPTY_BRAND).apiKey).toBe("");
  });

  it("an empty brand defaults to the first compiled preset", () => {
    const s = defaultSettings(EMPTY_BRAND);
    expect(s.endpoint).toBe(PRESET_ENTRIES[0].endpoint);
    expect(s.wireFormat).toBe(PRESET_ENTRIES[0].wireFormat);
    expect(s.model).toBe(PRESET_ENTRIES[0].model);
    expect(s.streaming).toBe(PRESET_ENTRIES[0].streaming);
  });
});
