import { describe, it, expect } from "vitest";
import { buildAuthHeaders } from "./auth-headers";
import type { AgentSettings } from "./settings";

const base = {
  endpoint: "https://example.com/v1",
  model: "test",
  streaming: true,
  apiKey: "",
  theme: "auto" as const,
};

describe("buildAuthHeaders", () => {
  it("sends the shared token when the key is empty", () => {
    const settings: AgentSettings = { ...base, wireFormat: "openai", apiKey: "" };
    expect(buildAuthHeaders(settings, "shared-tok")).toEqual({ "X-Web-Agent-Token": "shared-tok" });
  });

  it("treats a whitespace-only key as empty", () => {
    const settings: AgentSettings = { ...base, wireFormat: "openai", apiKey: "   " };
    expect(buildAuthHeaders(settings, "shared-tok")).toEqual({ "X-Web-Agent-Token": "shared-tok" });
  });

  it("sends an openai key as a bearer token and drops the shared token", () => {
    const settings: AgentSettings = { ...base, wireFormat: "openai", apiKey: "sk-1" };
    const result = buildAuthHeaders(settings, "shared-tok");
    expect(result).toEqual({ Authorization: "Bearer sk-1" });
    expect(result).not.toHaveProperty("X-Web-Agent-Token");
  });

  it("sends an anthropic key in X-Api-Key", () => {
    const settings: AgentSettings = { ...base, wireFormat: "anthropic", apiKey: "ant-1" };
    const result = buildAuthHeaders(settings, "shared-tok");
    expect(result).toEqual({ "X-Api-Key": "ant-1" });
    expect(result).not.toHaveProperty("Authorization");
  });

  it("sends a gemini key in x-goog-api-key", () => {
    const settings: AgentSettings = { ...base, wireFormat: "gemini", apiKey: "g-1" };
    const result = buildAuthHeaders(settings, "shared-tok");
    expect(result).toEqual({ "x-goog-api-key": "g-1" });
    expect(result).not.toHaveProperty("Authorization");
  });
});
