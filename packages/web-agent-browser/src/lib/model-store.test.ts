import { describe, it, expect, vi } from "vitest";
import {
  listModels,
  resolveDefault,
  modelForAgent,
  setEnabled,
  setDefault,
  setBrandKey,
  readModelStore,
  writeModelStore,
  EMPTY_MODEL_STORE,
} from "./model-store";
import type { AgentBrand, ModelStore } from "./types";

const FIXTURE_BRAND: AgentBrand = {
  name: "Test",
  themes: [],
  options: {},
  models: [
    {
      id: "a",
      label: "Model A",
      endpoint: "https://a.test/api/anthropic",
      wireFormat: "anthropic",
      model: "claude-a",
      vision: true,
      provider: "Acme",
    },
    {
      id: "b",
      label: "Model B",
      endpoint: "https://a.test/api/anthropic",
      wireFormat: "anthropic",
      model: "claude-b",
    },
    {
      id: "c",
      label: "Model C",
      endpoint: "https://c.test/v1/",
      wireFormat: "openai",
      model: "gpt-c",
    },
  ],
  agents: [],
  skills: [],
  tools: {},
  defaultAgent: "a",
};

const EMPTY_BRAND: AgentBrand = {
  name: "Empty",
  themes: [],
  options: {},
  models: [],
  agents: [],
  skills: [],
  tools: {},
  defaultAgent: "",
};

describe("model-store", () => {
  it("listModels returns brand entries grouped by provider with default provider name and vision", () => {
    const entries = listModels(FIXTURE_BRAND, EMPTY_MODEL_STORE);
    expect(entries.map((e) => e.ref)).toEqual(["brand:a", "brand:b", "brand:c"]);

    // A and B share one provider object
    expect(entries[0].provider).toBe(entries[1].provider);
    expect(entries[0].provider.id).toBe("brand:anthropic:https://a.test/api/anthropic");
    expect(entries[0].provider.name).toBe("Acme");
    expect(entries[0].provider.apiKey).toBe("");

    // C provider name strips trailing slash
    expect(entries[2].provider.name).toBe("c.test/v1");

    // Vision
    expect(entries[0].vision).toBe(true);
    expect(entries[1].vision).toBe(false);
    expect(entries[2].vision).toBe(false);

    // All enabled
    expect(entries.every((e) => e.enabled)).toBe(true);
  });

  it("listModels populates brand provider apiKey from store brandKeys", () => {
    const store: ModelStore = {
      ...EMPTY_MODEL_STORE,
      brandKeys: {
        "brand:anthropic:https://a.test/api/anthropic": "k",
      },
    };
    const entries = listModels(FIXTURE_BRAND, store);
    expect(entries[0].provider.apiKey).toBe("k");
    expect(entries[1].provider.apiKey).toBe("k");
    expect(entries[2].provider.apiKey).toBe("");
  });

  it("listModels includes custom providers and models", () => {
    const store: ModelStore = {
      ...EMPTY_MODEL_STORE,
      providers: [
        {
          id: "p1",
          name: "Mine",
          wireFormat: "openai",
          endpoint: "https://m.test/v1",
          apiKey: "x",
          headers: [{ name: "X-Team", value: "web" }],
          models: [
            { model: "m-a", label: "MA", vision: true },
            { model: "m-b", label: "MB", vision: false },
          ],
        },
      ],
    };
    const entries = listModels(FIXTURE_BRAND, store);
    expect(entries).toHaveLength(5);
    expect(entries[3].ref).toBe("p1/m-a");
    expect(entries[3].kind).toBe("custom");
    expect(entries[3].provider.headers).toEqual([{ name: "X-Team", value: "web" }]);
    expect(entries[4].ref).toBe("p1/m-b");
    expect(entries[4].kind).toBe("custom");
  });

  it("listModels with EMPTY_BRAND returns the 3 PRESET_ENTRIES refs with vision: true and provider Gateway", () => {
    const entries = listModels(EMPTY_BRAND, EMPTY_MODEL_STORE);
    expect(entries.map((e) => e.ref)).toEqual(["brand:anthropic-sonnet", "brand:openai-sonnet", "brand:gemini-flash"]);
    expect(entries.every((e) => e.vision)).toBe(true);
    expect(entries.every((e) => e.provider.name === "Gateway")).toBe(true);
  });

  it("resolveDefault handles stored default, disabled, null default, and all-disabled", () => {
    const entries = listModels(FIXTURE_BRAND, EMPTY_MODEL_STORE);

    // Stored default enabled
    const s1: ModelStore = { ...EMPTY_MODEL_STORE, defaultModel: "brand:b" };
    expect(resolveDefault(entries, s1)?.ref).toBe("brand:b");

    // Stored default disabled
    const s2: ModelStore = { ...EMPTY_MODEL_STORE, defaultModel: "brand:a", disabled: ["brand:a"] };
    const e2 = listModels(FIXTURE_BRAND, s2);
    expect(resolveDefault(e2, s2)?.ref).toBe("brand:b");

    // Null default
    const s3: ModelStore = { ...EMPTY_MODEL_STORE, defaultModel: null };
    expect(resolveDefault(entries, s3)?.ref).toBe("brand:a");

    // Everything disabled
    const s4: ModelStore = { ...EMPTY_MODEL_STORE, disabled: ["brand:a", "brand:b", "brand:c"] };
    const e4 = listModels(FIXTURE_BRAND, s4);
    expect(resolveDefault(e4, s4)).toBeNull();
  });

  it("setEnabled toggles models and manages defaultModel", () => {
    const entries = listModels(FIXTURE_BRAND, EMPTY_MODEL_STORE);

    // Turning off default brand:a
    const r1 = setEnabled(entries, EMPTY_MODEL_STORE, "brand:a", false);
    expect(r1.ok).toBe(true);
    if (r1.ok) {
      expect(r1.store.disabled).toContain("brand:a");
      expect(r1.store.defaultModel).toBe("brand:b");
    }

    // Turning off non-default brand:c
    const storeWithDefault: ModelStore = { ...EMPTY_MODEL_STORE, defaultModel: "brand:a" };
    const r2 = setEnabled(entries, storeWithDefault, "brand:c", false);
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      expect(r2.store.defaultModel).toBe("brand:a");
      expect(r2.store.disabled).toEqual(["brand:c"]);
    }

    // Turning off the last enabled model fails
    const storeTwoDisabled: ModelStore = { ...EMPTY_MODEL_STORE, disabled: ["brand:b", "brand:c"] };
    const eTwo = listModels(FIXTURE_BRAND, storeTwoDisabled);
    const r3 = setEnabled(eTwo, storeTwoDisabled, "brand:a", false);
    expect(r3).toEqual({ ok: false, hint: "At least one model must stay on." });

    // Turning on removes from disabled
    const storeDisabled: ModelStore = { ...EMPTY_MODEL_STORE, disabled: ["brand:a"] };
    const eDis = listModels(FIXTURE_BRAND, storeDisabled);
    const r4 = setEnabled(eDis, storeDisabled, "brand:a", true);
    expect(r4.ok).toBe(true);
    if (r4.ok) {
      expect(r4.store.disabled).toEqual([]);
    }

    // Off twice keeps ref listed once
    const r5 = setEnabled(entries, storeDisabled, "brand:a", false);
    expect(r5.ok).toBe(true);
    if (r5.ok) {
      expect(r5.store.disabled).toEqual(["brand:a"]);
    }
  });

  it("setDefault sets enabled ref and ignores disabled or unknown ref", () => {
    const storeDisabled: ModelStore = { ...EMPTY_MODEL_STORE, disabled: ["brand:c"] };
    const entries = listModels(FIXTURE_BRAND, storeDisabled);

    // Enabled ref
    const s1 = setDefault(entries, storeDisabled, "brand:b");
    expect(s1.defaultModel).toBe("brand:b");

    // Disabled ref
    const s2 = setDefault(entries, storeDisabled, "brand:c");
    expect(s2).toBe(storeDisabled);

    // Unknown ref
    const s3 = setDefault(entries, storeDisabled, "brand:unknown");
    expect(s3).toBe(storeDisabled);
  });

  it("modelForAgent handles undefined, enabled, disabled, and unknown refs", () => {
    const storeDisabled: ModelStore = { ...EMPTY_MODEL_STORE, disabled: ["brand:c"], defaultModel: "brand:a" };
    const entries = listModels(FIXTURE_BRAND, storeDisabled);

    // undefined -> default, fellBack false
    const m1 = modelForAgent(entries, storeDisabled, undefined);
    expect(m1.entry.ref).toBe("brand:a");
    expect(m1.fellBack).toBe(false);

    // enabled ref -> that entry, false
    const m2 = modelForAgent(entries, storeDisabled, "brand:b");
    expect(m2.entry.ref).toBe("brand:b");
    expect(m2.fellBack).toBe(false);

    // disabled ref -> default, true
    const m3 = modelForAgent(entries, storeDisabled, "brand:c");
    expect(m3.entry.ref).toBe("brand:a");
    expect(m3.fellBack).toBe(true);

    // unknown ref -> default, true
    const m4 = modelForAgent(entries, storeDisabled, "brand:unknown");
    expect(m4.entry.ref).toBe("brand:a");
    expect(m4.fellBack).toBe(true);
  });

  it("setBrandKey stores trimmed key or empty string", () => {
    const s1 = setBrandKey(EMPTY_MODEL_STORE, "prov1", "  k  ");
    expect(s1.brandKeys["prov1"]).toBe("k");

    const s2 = setBrandKey(s1, "prov1", "");
    expect(s2.brandKeys["prov1"]).toBe("");
  });

  it("readModelStore and writeModelStore validate storage shapes", async () => {
    const getFn = vi.fn();
    const setFn = vi.fn();
    const fakeStorage = { get: getFn, set: setFn } as any;

    // Nothing stored
    getFn.mockResolvedValueOnce({});
    const r1 = await readModelStore(fakeStorage);
    expect(r1).toEqual(EMPTY_MODEL_STORE);

    // Garbage stored
    getFn.mockResolvedValueOnce({ modelStore: "garbage" });
    const r2 = await readModelStore(fakeStorage);
    expect(r2).toEqual(EMPTY_MODEL_STORE);

    // Partial and invalid types cleaned
    getFn.mockResolvedValueOnce({
      modelStore: {
        disabled: ["a", 3],
        brandKeys: { x: "k", y: 5 },
        defaultModel: "",
        providers: [{ id: "p", models: [] }, { nope: 1 }],
      },
    });
    const r3 = await readModelStore(fakeStorage);
    expect(r3.disabled).toEqual(["a"]);
    expect(r3.brandKeys).toEqual({ x: "k" });
    expect(r3.defaultModel).toBeNull();
    expect(r3.providers).toHaveLength(1);

    // Write
    await writeModelStore(EMPTY_MODEL_STORE, fakeStorage);
    expect(setFn).toHaveBeenCalledWith({ modelStore: EMPTY_MODEL_STORE });
  });
});
