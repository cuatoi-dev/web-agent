import { describe, it, expect, vi } from "vitest";
import {
  brandDefaultKey,
  listModels,
  resolveDefault,
  modelForAgent,
  setEnabled,
  setDefault,
  setBrandKey,
  saveCustomProvider,
  deleteModels,
  readModelStore,
  writeModelStore,
  EMPTY_MODEL_STORE,
} from "./model-store";
import type { AgentBrand, CustomProvider, ModelStore } from "./types";

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
    expect(entries[0].provider.keySource).toBe("none");

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
    expect(entries[0].provider.keySource).toBe("user");
    expect(entries[1].provider.apiKey).toBe("k");
    expect(entries[2].provider.apiKey).toBe("");
    expect(entries[2].provider.keySource).toBe("none");
  });

  it("listModels uses the first brand apiKey in the group when no user key", () => {
    const brandWithKeys: AgentBrand = {
      ...FIXTURE_BRAND,
      models: [
        { ...FIXTURE_BRAND.models[0] },
        { ...FIXTURE_BRAND.models[1], apiKey: " kb " },
        { ...FIXTURE_BRAND.models[2], apiKey: "kc" },
      ],
    };
    const entries = listModels(brandWithKeys, EMPTY_MODEL_STORE);
    expect(entries[0].provider.apiKey).toBe("kb");
    expect(entries[0].provider.keySource).toBe("brand");
    expect(entries[2].provider.apiKey).toBe("kc");
    expect(entries[2].provider.keySource).toBe("brand");
  });

  it("the first key in model.yml order wins", () => {
    const brandWithTwoKeys: AgentBrand = {
      ...FIXTURE_BRAND,
      models: [
        { ...FIXTURE_BRAND.models[0], apiKey: "ka" },
        { ...FIXTURE_BRAND.models[1], apiKey: "kb" },
        { ...FIXTURE_BRAND.models[2] },
      ],
    };
    const entries = listModels(brandWithTwoKeys, EMPTY_MODEL_STORE);
    expect(entries[0].provider.apiKey).toBe("ka");
    expect(entries[1].provider.apiKey).toBe("ka");
  });

  it("a user key wins over the brand key; a blank user key falls back", () => {
    const brandWithKey: AgentBrand = {
      ...FIXTURE_BRAND,
      models: [
        { ...FIXTURE_BRAND.models[0], apiKey: "kb-default" },
        { ...FIXTURE_BRAND.models[1] },
        { ...FIXTURE_BRAND.models[2] },
      ],
    };
    const idA = "brand:anthropic:https://a.test/api/anthropic";
    const storeUser: ModelStore = {
      ...EMPTY_MODEL_STORE,
      brandKeys: { [idA]: "ku" },
    };
    const entriesUser = listModels(brandWithKey, storeUser);
    expect(entriesUser[0].provider.apiKey).toBe("ku");
    expect(entriesUser[0].provider.keySource).toBe("user");

    const storeBlank: ModelStore = {
      ...EMPTY_MODEL_STORE,
      brandKeys: { [idA]: "   " },
    };
    const entriesBlank = listModels(brandWithKey, storeBlank);
    expect(entriesBlank[0].provider.apiKey).toBe("kb-default");
    expect(entriesBlank[0].provider.keySource).toBe("brand");
  });

  it("brandDefaultKey returns trimmed first key or empty string", () => {
    expect(brandDefaultKey([])).toBe("");
    expect(brandDefaultKey([{ apiKey: "" } as any])).toBe("");
    expect(brandDefaultKey([{ apiKey: "   " } as any])).toBe("");
    expect(brandDefaultKey([{} as any, { apiKey: " found " } as any])).toBe("found");
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
    expect(entries[3].provider.keySource).toBeUndefined();
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

const CUSTOM: CustomProvider = {
  id: "p1",
  name: "Local",
  wireFormat: "openai",
  endpoint: "http://localhost:8000/v1",
  apiKey: "",
  headers: [],
  models: [
    { model: "m1", label: "M1", vision: true },
    { model: "m2", label: "M2", vision: false },
  ],
};

describe("saveCustomProvider", () => {
  it("appends a new provider with all its models enabled", () => {
    const next = saveCustomProvider(FIXTURE_BRAND, EMPTY_MODEL_STORE, CUSTOM);
    expect(next.providers).toEqual([CUSTOM]);
    const custom = listModels(FIXTURE_BRAND, next).filter((e) => e.kind === "custom");
    expect(custom.map((e) => e.enabled)).toEqual([true, true]);
  });

  it("updates in place, keeps surviving disabled refs, drops stale ones and moves the default", () => {
    const other: CustomProvider = { ...CUSTOM, id: "p2", models: [{ model: "z", label: "Z", vision: false }] };
    const store: ModelStore = {
      ...EMPTY_MODEL_STORE,
      providers: [CUSTOM, other],
      disabled: ["p1/m1", "p1/m2", "brand:a"],
      defaultModel: "p1/m2",
    };
    // m1 stays (still disabled), m2 is removed, m3 is new.
    const edited: CustomProvider = {
      ...CUSTOM,
      models: [
        { model: "m1", label: "M1", vision: true },
        { model: "m3", label: "M3", vision: false },
      ],
    };
    const next = saveCustomProvider(FIXTURE_BRAND, store, edited);
    expect(next.providers.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(next.providers[0]).toEqual(edited);
    expect(next.disabled).toEqual(["p1/m1", "brand:a"]);
    // old default p1/m2 no longer exists: the first enabled model takes over.
    expect(next.defaultModel).toBe("brand:b");
  });
});

describe("deleteModels", () => {
  const store: ModelStore = { ...EMPTY_MODEL_STORE, providers: [CUSTOM], defaultModel: "p1/m1" };

  it("removes models, empties the provider, prunes disabled and moves the default", () => {
    const withOff: ModelStore = { ...store, disabled: ["p1/m2"] };
    const r = deleteModels(FIXTURE_BRAND, withOff, new Set(["p1/m1", "p1/m2"]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.store.providers).toEqual([]);
    expect(r.store.disabled).toEqual([]);
    expect(r.store.defaultModel).toBe("brand:a");
  });

  it("keeps a provider that still has models", () => {
    const r = deleteModels(FIXTURE_BRAND, store, new Set(["p1/m2"]));
    expect(r.ok && r.store.providers[0].models.map((m) => m.model)).toEqual(["m1"]);
  });

  it("ignores brand refs", () => {
    const r = deleteModels(FIXTURE_BRAND, store, new Set(["brand:a"]));
    expect(r).toEqual({ ok: true, store });
  });

  it("refuses to leave no enabled model", () => {
    const onlyCustom: ModelStore = {
      ...store,
      disabled: ["brand:a", "brand:b", "brand:c"],
    };
    const r = deleteModels(FIXTURE_BRAND, onlyCustom, new Set(["p1/m1", "p1/m2"]));
    expect(r).toEqual({ ok: false, hint: "At least one model must stay on." });
  });
});
