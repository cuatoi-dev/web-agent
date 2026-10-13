import { describe, it, expect } from "vitest";
import {
  defaultBaseURLFor,
  resolveModelLabel,
  DEFAULT_CONFIG,
} from "./config.js";

describe("defaultBaseURLFor", () => {
  it("returns /api/openai/v1 for openai", () => {
    expect(defaultBaseURLFor("openai")).toBe("/api/openai/v1");
  });

  it("returns /api/anthropic for anthropic", () => {
    expect(defaultBaseURLFor("anthropic")).toBe("/api/anthropic");
  });

  it("returns /api/gemini for gemini", () => {
    expect(defaultBaseURLFor("gemini")).toBe("/api/gemini");
  });
});

describe("resolveModelLabel", () => {
  it("returns the label when found", () => {
    expect(resolveModelLabel([{ id: "m", label: "Leo" }], "m")).toBe("Leo");
  });

  it("falls back to raw id for unknown id", () => {
    expect(resolveModelLabel([{ id: "m", label: "Leo" }], "s")).toBe("s");
  });

  it("falls back to raw id when models is undefined", () => {
    expect(resolveModelLabel(undefined, "m")).toBe("m");
  });

  it("falls back to raw id when entry has no label", () => {
    expect(resolveModelLabel([{ id: "m" }], "m")).toBe("m");
  });
});

describe("no model defaults", () => {
  it("ships no model default", () => {
    expect("model" in DEFAULT_CONFIG).toBe(false);
  });
});
