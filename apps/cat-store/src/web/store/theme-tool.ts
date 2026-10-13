import { z } from "zod";
import type { CustomToolDef } from "@cuatoi/web-agent-lit";
import { defaultTheme, getTheme, listThemes } from "@cuatoi/web-agent-lit/themes";
import { getStoredTheme, setStoredTheme } from "../theme";

/** Every registered theme id, in registration order. */
function themeIds(): string {
  return listThemes().map((t) => t.id).join(", ");
}

/** "dark" and "light" pick the default theme of that scheme; anything else is a theme id. */
function resolveThemeId(requested: string): string {
  return requested === "dark" || requested === "light" ? defaultTheme(requested) : requested;
}

export const setThemeTool: CustomToolDef = {
  name: "set_theme",
  // A getter, so a theme registered after this module loads is still listed.
  get description() {
    return (
      `Switch the Cat Store theme when the user explicitly asks to change or switch it. Accepts "dark", "light" (the default theme of that scheme) ` +
      `or a theme id: ${themeIds()}. ` +
      "Applies immediately and persists across reloads — the same state the header theme menu sets. " +
      "Never call this tool when the user is simply asking what theme is currently active or in use."
    );
  },
  inputSchema: z.object({
    theme: z.string().describe('A theme id, or "dark" / "light" for the default theme of that scheme.'),
  }).strict(),
  promptSnippet:
    'Use set_theme({theme: "dark" | "light" | <theme id>}) ONLY when the user explicitly asks to change or switch themes. Never call set_theme when answering inquiries about the current theme.',
  execute: (input: Record<string, unknown>) => {
    const requested = (input as { theme?: unknown }).theme;
    const t = typeof requested === "string" ? getTheme(resolveThemeId(requested)) : undefined;
    if (!t) {
      return Promise.resolve({
        content: `Unknown theme ${String(requested)}. Available: ${themeIds()}.`,
        isError: true,
      });
    }
    setStoredTheme(t.id);
    return Promise.resolve({ content: `Theme set to ${t.label} (${t.id}).` });
  },
};

export const getThemeTool: CustomToolDef = {
  name: "get_theme",
  description:
    "Read the Cat Store's current theme. Returns its label and id. " +
    "Always call this tool whenever asked what theme is active or in use. " +
    "Report whatever theme this tool returns — do not call set_theme, because the user may change themes at any time via the header menu.",
  inputSchema: z.object({}).strict(),
  promptSnippet:
    "Always call get_theme() when asked about the active or current storefront theme, and report its result directly without calling set_theme or attempting to re-apply any older theme.",
  execute: () => {
    const id = getStoredTheme();
    const label = getTheme(id)?.label ?? id;
    return Promise.resolve({ content: `Current theme: ${label} (${id}).` });
  },
};
