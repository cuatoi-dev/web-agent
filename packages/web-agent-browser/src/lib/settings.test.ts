import { describe, it, expect, beforeEach, vi } from "vitest";
import { DEFAULT_TOKEN } from "./constants";
import { getEnabledOrigins, getLastAgentId, getSettings, getToken, isOriginEnabled, setLastAgentId, setOriginEnabled, setSettings, setToken } from "./settings";
import { resolveAgent } from "./brand-capabilities";
import { EMPTY_BRAND } from "./brand";
import { defaultSettings } from "./brand-models";
import type { AgentBrand, BrandAgent } from "./types";

const BRAND_MODELS: AgentBrand = {
  ...EMPTY_BRAND,
  models: [
    { id: "brand-a", label: "Brand A", endpoint: "https://a.test/api/anthropic", wireFormat: "anthropic", model: "a-model" },
    { id: "brand-b", label: "Brand B", endpoint: "https://b.test/api/openai/v1", wireFormat: "openai", model: "b-model" },
  ],
};

describe("settings", () => {
  let store: Record<string, unknown> = {};
  let brand: AgentBrand = EMPTY_BRAND;

  beforeEach(() => {
    store = {};
    brand = EMPTY_BRAND;
    // `chrome` is declared globally by @types/chrome as the real, much richer
    // namespace type; the fake below implements only what settings.ts calls —
    // `get(key: string): Promise<Record<string, unknown>>` and
    // `set(items: Record<string, unknown>): Promise<void>`, per this module's
    // own real signature (settings.ts).
    //
    // settings.ts reaches the brand through brand-source.ts, which in a
    // window context (jsdom is one) asks the worker by message. The fake
    // answers that message; `brand` is swapped per test.
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: { sendMessage: vi.fn(() => Promise.resolve(brand)) },
      storage: {
        local: {
          get: vi.fn((key: string) => Promise.resolve({ [key]: store[key] })),
          set: vi.fn((items: Record<string, unknown>) => {
            Object.assign(store, items);
            return Promise.resolve();
          }),
        },
      },
    };
  });

  it("returns empty array when enabledOrigins is missing or not an array", async () => {
    expect(await getEnabledOrigins()).toEqual([]);
    store["enabledOrigins"] = "not-an-array";
    expect(await getEnabledOrigins()).toEqual([]);
  });

  it("enables origin and does not duplicate entries on repeated calls", async () => {
    await setOriginEnabled("https://example.com", true);
    expect(await isOriginEnabled("https://example.com")).toBe(true);

    await setOriginEnabled("https://example.com", true);
    expect(await getEnabledOrigins()).toEqual(["https://example.com"]);
  });

  it("disables one origin and keeps others", async () => {
    await setOriginEnabled("https://a.com", true);
    await setOriginEnabled("https://b.com", true);
    await setOriginEnabled("https://a.com", false);

    expect(await isOriginEnabled("https://a.com")).toBe(false);
    expect(await isOriginEnabled("https://b.com")).toBe(true);
    expect(await getEnabledOrigins()).toEqual(["https://b.com"]);
  });

  it("returns default token when stored token is missing or empty", async () => {
    expect(await getToken()).toBe(DEFAULT_TOKEN);
    store["token"] = "";
    expect(await getToken()).toBe(DEFAULT_TOKEN);
  });

  it("saves and retrieves a custom token", async () => {
    await setToken("custom-secret-token");
    expect(await getToken()).toBe("custom-secret-token");
  });

  it("returns every default when nothing is stored", async () => {
    expect(await getSettings()).toEqual(defaultSettings(EMPTY_BRAND));
  });

  it("round-trips a saved settings object", async () => {
    const settings = { endpoint: "https://x/v1", wireFormat: "gemini" as const, model: "m", apiKey: "k", theme: "auto" as const };
    await setSettings(settings);
    expect(await getSettings()).toEqual(settings);
  });

  it("falls back per field when the stored object is partial", async () => {
    // Store directly via the mock to simulate a partial object
    await chrome.storage.local.set({ agentSettings: { model: "only-model" } });
    const result = await getSettings();
    expect(result.model).toBe("only-model");
    expect(result.endpoint).toBe(defaultSettings(EMPTY_BRAND).endpoint);
    expect(result.wireFormat).toBe(defaultSettings(EMPTY_BRAND).wireFormat);
    expect(result.apiKey).toBe(defaultSettings(EMPTY_BRAND).apiKey);
    expect(result.theme).toBe(defaultSettings(EMPTY_BRAND).theme);
  });

  it("rejects an unknown theme", async () => {
    await chrome.storage.local.set({ agentSettings: { theme: "solarized" } });
    const result = await getSettings();
    expect(result.theme).toBe(defaultSettings(EMPTY_BRAND).theme);
  });

  it("a stored preference dark or light loads as auto", async () => {
    await chrome.storage.local.set({ agentSettings: { theme: "dark" } });
    expect((await getSettings()).theme).toBe("auto");
    await chrome.storage.local.set({ agentSettings: { theme: "light" } });
    expect((await getSettings()).theme).toBe("auto");
  });

  it("a stored built-in theme id loads as that theme id", async () => {
    await chrome.storage.local.set({ agentSettings: { theme: "wa2-light" } });
    expect((await getSettings()).theme).toBe("wa2-light");
  });

  it("a stored brand theme id loads as that theme id", async () => {
    brand = {
      ...EMPTY_BRAND,
      themes: [{ id: "acme-dense", label: "Acme Dense", scheme: "dark", base: "wa2-dark", css: "brand-themes/acme-dense.css" }],
    };
    await chrome.storage.local.set({ agentSettings: { theme: "acme-dense" } });
    expect((await getSettings()).theme).toBe("acme-dense");
  });

  it("ignores a non-object stored under the settings key", async () => {
    await chrome.storage.local.set({ agentSettings: "garbage" });
    expect(await getSettings()).toEqual(defaultSettings(EMPTY_BRAND));
  });

  it("with nothing stored, the brand's first entry is used", async () => {
    brand = BRAND_MODELS;
    expect(await getSettings()).toEqual(defaultSettings(BRAND_MODELS));
    expect((await getSettings()).endpoint).toBe(BRAND_MODELS.models[0].endpoint);
  });

  it("a stored field still wins over the brand", async () => {
    brand = BRAND_MODELS;
    await chrome.storage.local.set({ agentSettings: { model: "stored-model" } });
    const result = await getSettings();
    expect(result.model).toBe("stored-model");
    expect(result.endpoint).toBe(BRAND_MODELS.models[0].endpoint);
  });

  it("a brand that fails to answer degrades to the compiled presets", async () => {
    // `sendMessage` is typed `unknown` here rather than `ReturnType<typeof vi.fn>`:
    // vitest's `Mock` is invariant in BOTH its parameters, so a rejecting stub
    // (`Mock<[], Promise<never>>`) will not assign to `Mock<any[], unknown>`.
    (globalThis as unknown as { chrome: { runtime: { sendMessage: unknown }; storage: unknown } }).chrome.runtime.sendMessage = vi.fn(() => Promise.reject(new Error("refused")));
    const result = await getSettings();
    expect(result).toEqual(defaultSettings(EMPTY_BRAND));
  });

  it("changing the brand changes the defaults", async () => {
    // First call with EMPTY_BRAND (default)
    const first = await getSettings();
    // Now switch to BRAND_MODELS
    brand = BRAND_MODELS;
    const second = await getSettings();
    // They must differ, and each must equal its own brand's defaults
    expect(first.endpoint).toBe(defaultSettings(EMPTY_BRAND).endpoint);
    expect(second.endpoint).toBe(defaultSettings(BRAND_MODELS).endpoint);
    expect(first.endpoint).not.toBe(second.endpoint);
  });

  it("getLastAgentId is undefined when nothing, an empty string or a non-string is stored (120/002)", async () => {
    expect(await getLastAgentId()).toBeUndefined();
    store["sidePanelAgent"] = "";
    expect(await getLastAgentId()).toBeUndefined();
    store["sidePanelAgent"] = 42;
    expect(await getLastAgentId()).toBeUndefined();
  });

  it("setLastAgentId writes sidePanelAgent and getLastAgentId reads it back (120/002)", async () => {
    await setLastAgentId("tesagent");
    expect(store["sidePanelAgent"]).toBe("tesagent");
    expect(await getLastAgentId()).toBe("tesagent");
  });

  it("a stored id that names no agent resolves to the default agent (120/002)", async () => {
    const chromagent: BrandAgent = { id: "chromagent", displayName: "Chromagent", description: "D", instructions: "I", tools: "*", skills: "*" };
    const tesagent: BrandAgent = { id: "tesagent", displayName: "tesagent", description: "D", instructions: "I", tools: "*", skills: "*" };
    const withAgents: AgentBrand = { ...EMPTY_BRAND, agents: [chromagent, tesagent], defaultAgent: "chromagent" };
    store["sidePanelAgent"] = "removed_agent";
    expect(resolveAgent(withAgents, await getLastAgentId())).toBe(chromagent);
    store["sidePanelAgent"] = "tesagent";
    expect(resolveAgent(withAgents, await getLastAgentId())).toBe(tesagent);
  });
});
