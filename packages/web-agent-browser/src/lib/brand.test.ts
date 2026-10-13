import { createRequire } from "module";
import { describe, expect, it } from "vitest";
import { EMPTY_BRAND, applyAgentBrand } from "./brand";
import type { AgentBrand, BrandableElement } from "./types";

const require = createRequire(import.meta.url);
const { emptyBrand } = require("../../tool/compile-brand.cjs") as {
  emptyBrand: () => Record<string, unknown>;
};

describe("brand", () => {
  it("EMPTY_BRAND carries every key a compiled brand carries", () => {
    expect(Object.keys(EMPTY_BRAND).sort()).toEqual(Object.keys(emptyBrand()).sort());
    expect(EMPTY_BRAND.prompts).toEqual({});
  });

  const brand: AgentBrand = {
    ...EMPTY_BRAND,
    prompts: { inPage: "P" },
  };

  it("inPage prompt is applied to appContext", () => {
    const el: BrandableElement = { appContext: { appName: "A", appDescription: "B" } };
    applyAgentBrand(el, brand, "inPage");
    expect(el.appContext).toEqual({ appName: "A", appDescription: "B", appInstructions: "P" });
  });

  it("an empty brand leaves appInstructions undefined", () => {
    const el: BrandableElement = { appContext: { appName: "A", appDescription: "B" } };
    applyAgentBrand(el, EMPTY_BRAND, "inPage");
    expect(el.appContext?.appInstructions).toBeUndefined();
  });

  it("appName and appDescription survive", () => {
    const el: BrandableElement = { appContext: { appName: "A", appDescription: "B" } };
    applyAgentBrand(el, brand, "inPage");
    expect(el.appContext?.appName).toBe("A");
    expect(el.appContext?.appDescription).toBe("B");
  });

  it("an element with no appContext still gets the prompt", () => {
    const el: BrandableElement = {};
    applyAgentBrand(el, brand, "inPage");
    expect(el.appContext).toEqual({ appInstructions: "P" });
  });
});
