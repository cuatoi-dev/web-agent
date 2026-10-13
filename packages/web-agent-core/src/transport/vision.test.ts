import { describe, it, expect } from "vitest";
import { modelSupportsVision, imageReachesModel } from "./vision.js";

describe("modelSupportsVision", () => {
  it("anthropic: claude-3-5-sonnet → true", () => {
    expect(modelSupportsVision("anthropic", "claude-3-5-sonnet")).toBe(true);
  });

  it("anthropic: sonnet (router alias) → true", () => {
    expect(modelSupportsVision("anthropic", "sonnet")).toBe(true);
  });

  it("openai: sonnet (router alias) → true", () => {
    expect(modelSupportsVision("openai", "sonnet")).toBe(true);
  });

  it("anthropic: text-only-model → false", () => {
    expect(modelSupportsVision("anthropic", "text-only-model")).toBe(false);
  });

  it("openai: gpt-4o-mini → true", () => {
    expect(modelSupportsVision("openai", "gpt-4o-mini")).toBe(true);
  });

  it("openai: gpt-5.5 → false", () => {
    expect(modelSupportsVision("openai", "gpt-5.5")).toBe(false);
  });

  it("gemini: gemini-flash-lite-latest → true", () => {
    expect(modelSupportsVision("gemini", "gemini-flash-lite-latest")).toBe(true);
  });

  it("gemini: sonnet → false", () => {
    expect(modelSupportsVision("gemini", "sonnet")).toBe(false);
  });

  it("unknown endpoint type → false", () => {
    expect(modelSupportsVision("fallback-chain", "claude-3-5-sonnet")).toBe(false);
  });

  it("anthropic and openai agree on every marker", () => {
    const markers = [
      "claude-3", "gemma-4", "gemma4", "gpt-4o", "gpt-4-turbo", "vision", "sonnet",
    ];
    for (const m of markers) {
      expect(modelSupportsVision("anthropic", m)).toBe(modelSupportsVision("openai", m));
    }
  });
});

describe("imageReachesModel", () => {
  it("explicit yes wins over unsupported model", () => {
    expect(imageReachesModel(true, false)).toBe(true);
  });

  it("explicit no blocks even a supported model", () => {
    expect(imageReachesModel(false, true)).toBe(false);
  });

  it("undefined imageInput + unsupported model → false", () => {
    expect(imageReachesModel(undefined, false)).toBe(false);
  });

  it("undefined imageInput + supported model → true", () => {
    expect(imageReachesModel(undefined, true)).toBe(true);
  });

  it("both undefined → true", () => {
    expect(imageReachesModel(undefined, undefined)).toBe(true);
  });
});
