import { describe, it, expect } from "vitest";
import { toPublicModels } from "./public-models";
import { ICON_SVGS } from "@cuatoi/web-agent-lit/ui/icon-svgs";
import type { ModelEntry } from "./model-store.types";

describe("public-models", () => {
  it("toPublicModels filters disabled models and scrubs secrets and headers", () => {
    const entries: ModelEntry[] = [
      {
        ref: "brand:a",
        kind: "brand",
        id: "a",
        label: "Model A",
        model: "claude-a",
        wireFormat: "anthropic",
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
        id: "b",
        label: "Model B",
        model: "claude-b",
        wireFormat: "anthropic",
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

    expect(result[0].icon).toBe(ICON_SVGS.dns);
  });
});
