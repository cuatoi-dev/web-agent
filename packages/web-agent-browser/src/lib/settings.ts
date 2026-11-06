import { DEFAULT_THEME } from "./constants";
import { brandForThisContext } from "./brand-source";
import { getTheme } from "./theme";
import { LAST_AGENT_KEY } from "./agent-store";
import type { AgentSettings, AgentSettingsInput } from "./types";

export type { AgentSettings, AgentSettingsInput } from "./types";

const ENABLED_KEY = "enabledOrigins";
export const SETTINGS_KEY = "agentSettings";

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 104/003 — extracts boolean entries from `memoryEnabled`, ignoring anything else. */
export function parseMemoryEnabled(raw: unknown): Record<string, boolean> {
  if (!isPlainRecord(raw)) return {};
  const out: Record<string, boolean> = {};
  for (const [key, val] of Object.entries(raw)) {
    if (typeof val === "boolean") out[key] = val;
  }
  return out;
}

/** The stored theme when it names a known theme, else the default, plus the
 *  per-agent memory switches (default `{}`).
 *  136/005 — the model fields moved to the model store (model-store.ts); a
 *  stored old object's endpoint, wireFormat, model and apiKey are ignored. */
export async function getSettings(): Promise<AgentSettings> {
  const [brand, got] = await Promise.all([
    brandForThisContext(),
    chrome.storage.local.get(SETTINGS_KEY),
  ]);
  const stored: unknown = got[SETTINGS_KEY];
  const s = isPlainRecord(stored) ? stored : {};
  return {
    theme: typeof s.theme === "string"
      && (s.theme === "auto"
        || getTheme(s.theme) !== undefined
        || (Array.isArray(brand.themes) && brand.themes.some((t) => t.id === s.theme)))
      ? s.theme
      : DEFAULT_THEME,
    memoryEnabled: parseMemoryEnabled(s.memoryEnabled),
  };
}

export async function setSettings(settings: AgentSettingsInput): Promise<void> {
  let memoryEnabled = settings.memoryEnabled;
  if (memoryEnabled === undefined) {
    const got = await chrome.storage.local.get(SETTINGS_KEY);
    const stored = isPlainRecord(got[SETTINGS_KEY]) ? got[SETTINGS_KEY] : {};
    memoryEnabled = parseMemoryEnabled(stored.memoryEnabled);
  }
  await chrome.storage.local.set({
    [SETTINGS_KEY]: { theme: settings.theme, memoryEnabled },
  });
}

/** 104/003 — writes `memoryEnabled[agentId]` under `"agentSettings"` while
 *  keeping the stored theme and other agents' switches intact. */
export async function setMemoryEnabled(agentId: string, on: boolean): Promise<void> {
  const got = await chrome.storage.local.get(SETTINGS_KEY);
  const stored = isPlainRecord(got[SETTINGS_KEY]) ? got[SETTINGS_KEY] : {};
  const memoryEnabled = {
    ...parseMemoryEnabled(stored.memoryEnabled),
    [agentId]: on,
  };
  await chrome.storage.local.set({
    [SETTINGS_KEY]: { ...stored, memoryEnabled },
  });
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
