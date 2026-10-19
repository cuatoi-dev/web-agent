import { describe, expect, it } from "vitest";
import { EMPTY_BRAND } from "./brand";
import { resolveModels } from "./brand-models";
import { PRESET_ENTRIES } from "./presets";
import type { PresetEntry } from "./types";

const TWO: PresetEntry[] = [
  {
    id: "two-a",
    label: "Two A",
    endpoint: "https://two-a.example/api/anthropic",
    wireFormat: "anthropic",
    model: "model-a",
  },
  {
    id: "two-b",
    label: "Two B",
    endpoint: "https://two-b.example/api/openai/v1",
    wireFormat: "openai",
    model: "model-b",
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


});
