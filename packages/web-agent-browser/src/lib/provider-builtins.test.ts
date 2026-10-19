import { describe, it, expect } from "vitest";
import {
  BUILT_IN,
  builtInById,
  builtInInitialModels,
  endpointForFormat,
  providerIconSvg,
} from "./provider-builtins";

describe("provider-builtins", () => {
  it("gives every built-in provider one currentColor path and no title", () => {
    for (const provider of BUILT_IN) {
      const svg = providerIconSvg(provider.id);
      expect(svg).not.toBe(providerIconSvg(undefined));
      expect(svg.startsWith("<svg")).toBe(true);
      expect(svg).toContain('fill="currentColor"');
      expect(svg.match(/<path/g)?.length).toBe(1);
      expect(svg).not.toContain("<title>");
      expect(svg).not.toContain("style=");
    }
  });

  it("falls back to the generic server icon for an absent or unknown id", () => {
    expect(providerIconSvg(undefined)).toBe(providerIconSvg("not-a-provider"));
    expect(providerIconSvg("not-a-provider")).toContain("<path");
  });

  it("answers the endpoint of every format it offers and nothing else", () => {
    for (const provider of BUILT_IN) {
      expect(provider.formats.length).toBeGreaterThan(0);
      for (const format of provider.formats) {
        expect(endpointForFormat(provider, format.wireFormat)).toBe(format.endpoint);
      }
    }
    const openai = builtInById("openai");
    expect(openai).toBeDefined();
    expect(endpointForFormat(openai!, "gemini")).toBeUndefined();
    expect(endpointForFormat(openai!, "anthropic")).toBeUndefined();
  });

  it("has unique ids and a first format that is a real format", () => {
    const ids = BUILT_IN.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const provider of BUILT_IN) {
      expect(["openai", "anthropic", "gemini"]).toContain(provider.formats[0].wireFormat);
    }
  });

  it("returns a copy of the known model list, never the constant", () => {
    const anthropic = builtInById("anthropic");
    expect(anthropic).toBeDefined();
    const rows = builtInInitialModels(anthropic!);
    expect(rows.length).toBeGreaterThan(0);
    rows[0].label = "changed";
    expect(anthropic!.models[0].label).not.toBe("changed");
  });

  it("carries unique model ids with a label and a vision flag", () => {
    for (const provider of BUILT_IN) {
      const ids = provider.models.map((m) => m.model);
      expect(new Set(ids).size).toBe(ids.length);
      for (const model of provider.models) {
        expect(model.label.trim()).not.toBe("");
        expect(typeof model.vision).toBe("boolean");
      }
    }
  });
});
