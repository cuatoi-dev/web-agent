import { describe, it, expect } from "vitest";
import { GATEWAY_BASE } from "./constants";
import { PRESET_ENTRIES } from "./presets";

describe("PRESET_ENTRIES", () => {
  it("every preset id is unique", () => {
    const ids = PRESET_ENTRIES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every preset endpoint is an absolute URL on the gateway", () => {
    const gatewayOrigin = new URL(GATEWAY_BASE).origin;
    for (const entry of PRESET_ENTRIES) {
      expect(new URL(entry.endpoint).origin).toBe(gatewayOrigin);
    }
  });

  it("every preset carries a wire format the bubble accepts", () => {
    const valid: readonly string[] = ["openai", "anthropic", "gemini"];
    for (const entry of PRESET_ENTRIES) {
      expect(valid).toContain(entry.wireFormat);
    }
  });

  it("every openai preset path ends in /v1 and no gemini preset does", () => {
    for (const entry of PRESET_ENTRIES) {
      if (entry.wireFormat === "openai") {
        expect(entry.endpoint.endsWith("/v1")).toBe(true);
      }
      if (entry.wireFormat === "gemini") {
        expect(entry.endpoint.endsWith("/v1")).toBe(false);
      }
    }
  });

  it("every preset label is ASCII", () => {
    for (const entry of PRESET_ENTRIES) {
      expect(/^[\x20-\x7E]+$/.test(entry.label)).toBe(true);
    }
  });
});
