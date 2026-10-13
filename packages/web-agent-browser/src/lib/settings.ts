import { DEFAULT_TOKEN } from "./constants";
import { brandForThisContext } from "./brand-source";
import { defaultSettings } from "./brand-models";
import { getTheme } from "./theme";
import { LAST_AGENT_KEY } from "./agent-store";
import type { AgentSettings } from "./types";

export type { AgentSettings } from "./types";

const ENABLED_KEY = "enabledOrigins";
const TOKEN_KEY = "token";
const SETTINGS_KEY = "agentSettings";

/** Stored values win, field by field, over the brand's defaults. A profile
 *  saved before this task has no settings key at all and still works.
 *
 *  116/002 — the base is the FIRST entry of the brand's model list, not a
 *  build-time constant, so a white-label install answers from its own endpoint
 *  on a fresh profile. */
export async function getSettings(): Promise<AgentSettings> {
  const [brand, got] = await Promise.all([
    brandForThisContext(),
    chrome.storage.local.get(SETTINGS_KEY),
  ]);
  const base = defaultSettings(brand);
  const stored: unknown = got[SETTINGS_KEY];
  if (!stored || typeof stored !== "object") return { ...base };
  const s = stored as Partial<AgentSettings>;
  return {
    endpoint: typeof s.endpoint === "string" && s.endpoint ? s.endpoint : base.endpoint,
    wireFormat: s.wireFormat === "openai" || s.wireFormat === "anthropic" || s.wireFormat === "gemini"
      ? s.wireFormat
      : base.wireFormat,
    model: typeof s.model === "string" && s.model ? s.model : base.model,
    streaming: typeof s.streaming === "boolean" ? s.streaming : base.streaming,
    apiKey: typeof s.apiKey === "string" ? s.apiKey : base.apiKey,
    theme: typeof s.theme === "string"
      && (s.theme === "auto"
        || getTheme(s.theme) !== undefined
        || (Array.isArray(brand.themes) && brand.themes.some((t) => t.id === s.theme)))
      ? s.theme
      : base.theme,
  };
}

export async function setSettings(settings: AgentSettings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

export async function getEnabledOrigins(): Promise<string[]> {
  const got = await chrome.storage.local.get(ENABLED_KEY);
  return Array.isArray(got[ENABLED_KEY]) ? (got[ENABLED_KEY] as string[]) : [];
}

export async function isOriginEnabled(origin: string): Promise<boolean> {
  return (await getEnabledOrigins()).includes(origin);
}

export async function setOriginEnabled(origin: string, on: boolean): Promise<void> {
  const current = new Set(await getEnabledOrigins());
  if (on) current.add(origin); else current.delete(origin);
  await chrome.storage.local.set({ [ENABLED_KEY]: [...current] });
}

/** The stored token wins; the build-time default is the fallback, so the
 *  extension works on install with no manual step. */
export async function getToken(): Promise<string> {
  const got = await chrome.storage.local.get(TOKEN_KEY);
  const stored: unknown = got[TOKEN_KEY];
  return typeof stored === "string" && stored.length > 0 ? stored : DEFAULT_TOKEN;
}

export async function setToken(token: string): Promise<void> {
  await chrome.storage.local.set({ [TOKEN_KEY]: token });
}

/** 120/002 — the id of the side panel agent shown last. Anything that is not a
 *  non-empty string reads as unset. */
export async function getLastAgentId(): Promise<string | undefined> {
  const got = await chrome.storage.local.get(LAST_AGENT_KEY);
  const stored: unknown = got[LAST_AGENT_KEY];
  return typeof stored === "string" && stored.length > 0 ? stored : undefined;
}

export async function setLastAgentId(id: string): Promise<void> {
  await chrome.storage.local.set({ [LAST_AGENT_KEY]: id });
}
