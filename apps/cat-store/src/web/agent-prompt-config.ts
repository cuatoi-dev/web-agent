import { getTheme } from "@cuatoi/web-agent-lit/themes";
import { getStoredTheme } from "./theme";
import type { CustomPromptConfig, PresetOption } from "./types";

export type { CustomPromptConfig, PresetOption } from "./types";

export const PROMPT_PRESETS: Record<"role" | "tone" | "length" | "language", PresetOption[]> = {
  role: [
    {
      label: "Sales assistant",
      sample: "You are a proactive sales assistant who helps customers find the right products and highlights active discounts and promotions.",
    },
    {
      label: "Nutrition adviser",
      sample: "You are a feline nutrition specialist who advises on dietary requirements, ingredients, and healthy feeding portions.",
    },
    {
      label: "Support agent",
      sample: "You are an empathetic customer support agent who answers questions clearly and helps resolve order issues.",
    },
    {
      label: "Concise operator",
      sample: "You are a direct, concise operator who executes commands and answers with minimum words.",
    },
  ],
  tone: [
    {
      label: "Precise",
      sample: "Adopt a factual, precise tone without fluff or pleasantries.",
    },
    {
      label: "Warm",
      sample: "Answer in a warm, friendly voice and use the customer's name when you know it.",
    },
    {
      label: "Playful",
      sample: "Use a cheerful, playful tone with occasional cat-related humor.",
    },
    {
      label: "Formal",
      sample: "Maintain a professional, formal tone suitable for business communication.",
    },
  ],
  length: [
    {
      label: "One line",
      sample: "Keep all responses to a single concise line.",
    },
    {
      label: "Short paragraph",
      sample: "Limit answers to a single short paragraph of two to three sentences.",
    },
    {
      label: "Detailed with bullets",
      sample: "Provide detailed answers structured with bullet points and clear sections.",
    },
  ],
  language: [
    {
      label: "English",
      sample: "Always reply in English regardless of the input language.",
    },
    {
      label: "Vietnamese",
      sample: "Always reply in Vietnamese (Tiếng Việt) regardless of the input language.",
    },
    {
      label: "Match the user",
      sample: "Reply in the same language that the user writes in.",
    },
  ],
};

export const BASE_APP_INSTRUCTIONS =
  "Before every add_to_cart call, first run load_skill(\"promotions-assistant\") " +
  "so you know the active promotions and can proactively suggest reaching promo " +
  "thresholds (Buy-3-Get-1-Free on Food items p01–p04; Buy-5-Get-2-Free on Toy " +
  "items p05–p08). After loading the skill, check the current cart quantity for " +
  "the product being added; if the user is 1–2 units below a threshold, nudge them. " +
  "Whenever the user asks what theme is active or in use, always call get_theme to check " +
  "the current storefront theme, and report whatever get_theme returns — never attempt to " +
  "re-set or overwrite it with a theme from earlier messages, because the user can change " +
  "themes at any time using the header menu.";

export function activeThemeInstruction(): string {
  const themeId = getStoredTheme();
  const themeLabel = getTheme(themeId)?.label ?? themeId;
  return `The page's active theme is ${themeLabel} (${themeId}). The user can change it at any time from the header theme menu; this line always shows the current theme.`;
}

export function buildCatStoreAppInstructions(custom?: CustomPromptConfig | null): string {
  const themeSentence = activeThemeInstruction();
  const baseWithTheme = `${BASE_APP_INSTRUCTIONS}\n\n${themeSentence}`;
  return composeAppInstructions(baseWithTheme, custom);
}

export function composeAppInstructions(base: string, custom?: CustomPromptConfig | null): string {
  if (!custom) return base;
  const parts: string[] = [];
  if (custom.role?.trim()) parts.push(custom.role.trim());
  if (custom.tone?.trim()) parts.push(custom.tone.trim());
  if (custom.length?.trim()) parts.push(custom.length.trim());
  if (custom.language?.trim()) parts.push(custom.language.trim());
  if (custom.extra?.trim()) parts.push(custom.extra.trim());
  if (parts.length === 0) return base;
  return `${base}\n\n${parts.join("\n\n")}`;
}

export const CUSTOM_PROMPT_STORAGE_KEY = "cat-store:custom-prompt-config";

export function loadCustomPromptConfig(): CustomPromptConfig {
  try {
    const raw = localStorage.getItem(CUSTOM_PROMPT_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    // Ignore storage parse failures
  }
  return {};
}

export function saveCustomPromptConfig(config: CustomPromptConfig): void {
  try {
    localStorage.setItem(CUSTOM_PROMPT_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Ignore storage write failures
  }
}

export function clearCustomPromptConfig(): void {
  try {
    localStorage.removeItem(CUSTOM_PROMPT_STORAGE_KEY);
  } catch {
    // Ignore storage clear failures
  }
}
