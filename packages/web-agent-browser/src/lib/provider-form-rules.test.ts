import { describe, it, expect } from "vitest";
import {
  applyModelsDiff,
  buildCustomProvider,
  compareModels,
  deleteDialogMessage,
  deleteDialogTitle,
  DUPLICATE_MODELS_ERROR,
  EMPTY_MODELS_ERROR,
  ENDPOINT_ERROR,
  joinNames,
  parseModelsResponse,
  validateProviderDraft,
} from "./provider-form-rules";
import { listModels, EMPTY_MODEL_STORE } from "./model-store";
import type { AgentBrand, ProviderFormDraft } from "./types";

const draft = (over: Partial<ProviderFormDraft> = {}): ProviderFormDraft => ({
  name: "",
  wireFormat: "openai",
  endpoint: "http://localhost:8000/v1",
  apiKey: "",
  headers: [],
  models: [{ model: "m1", label: "", vision: false }],
  ...over,
});

describe("validateProviderDraft", () => {
  it("accepts a valid draft", () => {
    expect(validateProviderDraft(draft())).toEqual({});
  });
  it("rejects a non-http endpoint", () => {
    expect(validateProviderDraft(draft({ endpoint: "ftp://x" })).endpoint).toBe(ENDPOINT_ERROR);
    expect(validateProviderDraft(draft({ endpoint: "" })).endpoint).toBe(ENDPOINT_ERROR);
  });
  it("rejects no model row", () => {
    const blank = [{ model: "  ", label: "", vision: false }];
    expect(validateProviderDraft(draft({ models: blank })).models).toBe(EMPTY_MODELS_ERROR);
  });
  it("rejects a duplicate trimmed id", () => {
    const rows = [
      { model: "m1", label: "", vision: false },
      { model: " m1 ", label: "", vision: true },
    ];
    expect(validateProviderDraft(draft({ models: rows })).models).toBe(DUPLICATE_MODELS_ERROR);
  });
});

describe("buildCustomProvider", () => {
  it("defaults name and labels, trims, and drops nameless headers", () => {
    const p = buildCustomProvider(
      draft({
        apiKey: " k ",
        headers: [
          { name: " X-Team ", value: " web " },
          { name: "  ", value: "ignored" },
        ],
        models: [
          { model: " a ", label: "", vision: true },
          { model: "", label: "x", vision: false },
          { model: "b", label: "Beta", vision: false },
        ],
      }),
      () => "new-id",
    );
    expect(p.id).toBe("new-id");
    expect(p.name).toBe("localhost:8000");
    expect(p.apiKey).toBe("k");
    expect(p.headers).toEqual([{ name: "X-Team", value: "web" }]);
    expect(p.models).toEqual([
      { model: "a", label: "a", vision: true },
      { model: "b", label: "Beta", vision: false },
    ]);
  });
  it("keeps the id when editing", () => {
    expect(buildCustomProvider(draft({ id: "keep" }), () => "other").id).toBe("keep");
  });
});

describe("parseModelsResponse", () => {
  it("returns unique trimmed ids in endpoint order", () => {
    expect(parseModelsResponse({ data: [{ id: "a" }, { id: " b " }, { id: "a" }, { id: "" }, { x: 1 }] })).toEqual([
      "a",
      "b",
    ]);
  });
  it("returns null when there is no data array", () => {
    expect(parseModelsResponse({})).toBeNull();
    expect(parseModelsResponse({ data: "x" })).toBeNull();
    expect(parseModelsResponse(null)).toBeNull();
    expect(parseModelsResponse([])).toBeNull();
  });
});

describe("compareModels and applyModelsDiff", () => {
  const rows = [
    { model: "b", label: "Beta", vision: true },
    { model: "x", label: "X", vision: false },
  ];
  it("lists add, remove and keep", () => {
    expect(compareModels(rows, ["a", "b", "c"])).toEqual({
      returnedCount: 3,
      add: ["a", "c"],
      remove: ["x"],
      keep: ["b"],
    });
  });
  it("keeps kept rows unchanged and adds new rows with vision off", () => {
    const diff = compareModels(rows, ["a", "b", "c"]);
    expect(applyModelsDiff(rows, diff)).toEqual([
      { model: "b", label: "Beta", vision: true },
      { model: "a", label: "a", vision: false },
      { model: "c", label: "c", vision: false },
    ]);
  });
});

describe("delete copy", () => {
  const brand: AgentBrand = {
    name: "T",
    themes: [],
    options: {},
    models: [],
    agents: [],
    skills: [],
    tools: {},
    defaultAgent: "",
  };
  const store = {
    ...EMPTY_MODEL_STORE,
    providers: [
      {
        id: "p1",
        name: "Local",
        wireFormat: "openai" as const,
        endpoint: "http://x",
        apiKey: "",
        headers: [],
        models: [
          { model: "a", label: "A", vision: false },
          { model: "b", label: "B", vision: false },
        ],
      },
    ],
  };
  const entries = listModels(brand, store);

  it("pluralises the title", () => {
    expect(deleteDialogTitle(1)).toBe("Delete 1 model?");
    expect(deleteDialogTitle(3)).toBe("Delete 3 models?");
  });
  it("names the models, and the provider when it empties", () => {
    expect(deleteDialogMessage(entries, store, new Set(["p1/a"]))).toBe(
      "This removes A. You cannot undo this.",
    );
    expect(deleteDialogMessage(entries, store, new Set(["p1/a", "p1/b"]))).toBe(
      "This removes A and B (and the Local provider with them). You cannot undo this.",
    );
  });
  it("joins names", () => {
    expect(joinNames(["a", "b", "c"])).toBe("a, b, and c");
  });
});
