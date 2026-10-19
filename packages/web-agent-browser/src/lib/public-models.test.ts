import { describe, it, expect } from "vitest";
import { toPublicModels, pageBrand } from "./public-models";
import { EMPTY_BRAND } from "./brand";
import { providerIconSvg } from "./provider-builtins";
import type { ModelEntry } from "./model-store.types";
import type { AgentBrand } from "./types";

describe("public-models", () => {
  it("toPublicModels filters disabled models and scrubs secrets and headers", () => {
    const entries: ModelEntry[] = [
      {
        ref: "brand:a",
        kind: "brand",
        label: "Model A",
        model: "claude-a",
        vision: true,
        enabled: true,
        provider: {
          id: "prov-a",
          kind: "brand",
          name: "Gateway",
          endpoint: "https://a.test/api/anthropic",
          wireFormat: "anthropic",
          apiKey: "secret",
          headers: [{ name: "X-Team", value: "web" }],
        },
      },
      {
        ref: "brand:b",
        kind: "brand",
        label: "Model B",
        model: "claude-b",
        vision: false,
        enabled: false,
        provider: {
          id: "prov-b",
          kind: "brand",
          name: "Gateway",
          endpoint: "https://b.test/api/anthropic",
          wireFormat: "anthropic",
          apiKey: "",
          headers: [],
        },
      },
    ];

    const result = toPublicModels(entries);
    expect(result).toHaveLength(1);

    const keys = Object.keys(result[0]).sort();
    expect(keys).toEqual(["endpoint", "icon", "label", "model", "ref", "vision", "wireFormat"]);

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("X-Team");

    expect(result[0].icon).toBe(providerIconSvg(undefined));
  });
  it("gives a built-in provider its own logo", () => {
    const entries: ModelEntry[] = [
      {
        ref: "p1/claude-sonnet-5-5",
        kind: "custom",
        label: "Sonnet",
        model: "claude-sonnet-5-5",
        vision: true,
        enabled: true,
        provider: {
          id: "p1",
          kind: "custom",
          name: "Anthropic",
          endpoint: "https://api.anthropic.com",
          wireFormat: "anthropic",
          apiKey: "secret",
          headers: [],
          builtIn: "anthropic",
        },
      },
    ];
    const [model] = toPublicModels(entries);
    expect(model.icon).toBe(providerIconSvg("anthropic"));
    expect(model.icon).not.toBe(providerIconSvg(undefined));
    expect(model.icon).not.toContain("secret");
  });
});

describe("pageBrand", () => {
  it("strips apiKey from brand models without mutating the input", () => {
    const b: AgentBrand = {
      ...EMPTY_BRAND,
      models: [
        {
          id: "m1",
          label: "M1",
          endpoint: "https://e1.test",
          wireFormat: "anthropic",
          model: "claude",
          vision: true,
          provider: "P1",
          apiKey: "secret",
        },
        {
          id: "m2",
          label: "M2",
          endpoint: "https://e2.test",
          wireFormat: "openai",
          model: "gpt",
          vision: false,
          provider: "P2",
        },
      ],
    };

    const cleaned = pageBrand(b);

    expect(JSON.stringify(cleaned).includes("apiKey")).toBe(false);
    expect(JSON.stringify(cleaned).includes("secret")).toBe(false);

    expect(cleaned.models[0]).toEqual({
      id: "m1",
      label: "M1",
      endpoint: "https://e1.test",
      wireFormat: "anthropic",
      model: "claude",
      vision: true,
      provider: "P1",
    });
    expect(cleaned.models[1]).toEqual({
      id: "m2",
      label: "M2",
      endpoint: "https://e2.test",
      wireFormat: "openai",
      model: "gpt",
      vision: false,
      provider: "P2",
    });

    expect(b.models[0].apiKey).toBe("secret");
    expect(cleaned.agents).toBe(b.agents);
  });
});
