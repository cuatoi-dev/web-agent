import { describe, it, expect, beforeEach } from "vitest";
import {
  PROMPT_PRESETS,
  BASE_APP_INSTRUCTIONS,
  composeAppInstructions,
  loadCustomPromptConfig,
  saveCustomPromptConfig,
  clearCustomPromptConfig,
  CUSTOM_PROMPT_STORAGE_KEY,
} from "./agent-prompt-config";

describe("agent-prompt-config", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defines non-empty actionable sample sentences for all presets", () => {
    const categories = ["role", "tone", "length", "language"] as const;
    for (const cat of categories) {
      const presets = PROMPT_PRESETS[cat];
      expect(presets.length).toBeGreaterThan(0);
      for (const p of presets) {
        expect(p.label.trim().length).toBeGreaterThan(0);
        expect(p.sample.trim().length).toBeGreaterThan(15);
      }
    }
  });

  it("composes instructions returning base exactly when custom config is empty or whitespace", () => {
    expect(composeAppInstructions(BASE_APP_INSTRUCTIONS, null)).toBe(BASE_APP_INSTRUCTIONS);
    expect(composeAppInstructions(BASE_APP_INSTRUCTIONS, undefined)).toBe(BASE_APP_INSTRUCTIONS);
    expect(composeAppInstructions(BASE_APP_INSTRUCTIONS, {})).toBe(BASE_APP_INSTRUCTIONS);
    expect(
      composeAppInstructions(BASE_APP_INSTRUCTIONS, {
        role: "   ",
        tone: "",
        length: "\n",
        language: "  ",
        extra: "   \t  ",
      }),
    ).toBe(BASE_APP_INSTRUCTIONS);
  });

  it("appends non-empty trimmed custom fields separated by double newlines", () => {
    const single = composeAppInstructions(BASE_APP_INSTRUCTIONS, {
      role: "  You are a cat expert.  ",
    });
    expect(single).toBe(`${BASE_APP_INSTRUCTIONS}\n\nYou are a cat expert.`);

    const multi = composeAppInstructions(BASE_APP_INSTRUCTIONS, {
      role: "Role text",
      tone: "Tone text",
      extra: "Extra text",
    });
    expect(multi).toBe(`${BASE_APP_INSTRUCTIONS}\n\nRole text\n\nTone text\n\nExtra text`);

    const allFive = composeAppInstructions(BASE_APP_INSTRUCTIONS, {
      role: "Role text",
      tone: "Tone text",
      length: "Length text",
      language: "Language text",
      extra: "Extra text",
    });
    expect(allFive).toBe(
      `${BASE_APP_INSTRUCTIONS}\n\nRole text\n\nTone text\n\nLength text\n\nLanguage text\n\nExtra text`,
    );
  });

  it("base instructions no longer carry the orders schema block or slash command instructions", () => {
    expect(BASE_APP_INSTRUCTIONS).not.toMatch(/createdAt/);
    expect(BASE_APP_INSTRUCTIONS).not.toMatch(/aggregate\.sort/);
    expect(BASE_APP_INSTRUCTIONS).not.toMatch(/intervalMs/);
    expect(BASE_APP_INSTRUCTIONS).toContain("promotions-assistant");
    expect(BASE_APP_INSTRUCTIONS).not.toContain("/demo");
    expect(BASE_APP_INSTRUCTIONS).not.toContain("/finance");
  });

  it("handles localStorage load, save, and clear gracefully", () => {
    expect(loadCustomPromptConfig()).toEqual({});

    const sampleConfig = {
      role: "Sales assistant",
      tone: "Warm",
    };
    saveCustomPromptConfig(sampleConfig);
    expect(localStorage.getItem(CUSTOM_PROMPT_STORAGE_KEY)).toBe(JSON.stringify(sampleConfig));
    expect(loadCustomPromptConfig()).toEqual(sampleConfig);

    clearCustomPromptConfig();
    expect(localStorage.getItem(CUSTOM_PROMPT_STORAGE_KEY)).toBeNull();
    expect(loadCustomPromptConfig()).toEqual({});

    // Bad JSON in localStorage should degrade to empty object without throwing
    localStorage.setItem(CUSTOM_PROMPT_STORAGE_KEY, "invalid-json{");
    expect(loadCustomPromptConfig()).toEqual({});
  });
});
