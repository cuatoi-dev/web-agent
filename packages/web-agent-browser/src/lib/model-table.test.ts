// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderModelTable, modelCountText, providerSubText, deleteButtonText } from "./model-table";
import { listModels, EMPTY_MODEL_STORE } from "./model-store";
import type { AgentBrand, CustomProvider, ModelStore, ResolvedProvider } from "./types";

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
  defaultAgent: "",
};

describe("model-table", () => {
  it("renders the table structure, headers, provider rows and model rows", () => {
    const table = document.createElement("table");
    const entries = listModels(FIXTURE_BRAND, EMPTY_MODEL_STORE);
    const handlers = {
      lockModel: false,
      onToggle: vi.fn(),
      onDefault: vi.fn(),
      onKey: vi.fn(),
    };

    renderModelTable(table, entries, EMPTY_MODEL_STORE, handlers);

    const ths = table.querySelectorAll("thead th");
    expect(ths.length).toBe(7);

    const provRows = table.querySelectorAll("tr.prov");
    expect(provRows.length).toBe(2);

    const modelRows = table.querySelectorAll("tr.model-row");
    expect(modelRows.length).toBe(3);

    // First provider row assertions
    const firstProv = provRows[0];
    const provLabel = firstProv.querySelector(".prov-label");
    expect(provLabel?.textContent).toBe("Acme");

    const pillBrand = firstProv.querySelector(".pill.brand");
    expect(pillBrand?.textContent).toBe("From brand");

    const provSub = firstProv.querySelector(".prov-sub");
    expect(provSub?.textContent).toBe("https://a.test/api/anthropic · shared Token");

    const countCell = firstProv.querySelector(".count");
    expect(countCell?.textContent).toBe("2 / 2");

    const checkbox = firstProv.querySelector("input[type=checkbox]") as HTMLInputElement;
    expect(checkbox.disabled).toBe(true);
    expect(checkbox.title).toBe("Brand models cannot be deleted");

    const keyBtn = firstProv.querySelector(".key-btn") as HTMLButtonElement;
    expect(keyBtn).not.toBeNull();
    expect(keyBtn.querySelector("svg")).not.toBeNull();
    expect(keyBtn.textContent).toContain("Key");

    const editBtns = Array.from(firstProv.querySelectorAll("button")).filter(
      (b) => b.textContent?.includes("Edit"),
    );
    expect(editBtns.length).toBe(0);

    // Vision pills
    const rowA = table.querySelector('tr.model-row[data-ref="brand:a"]') as HTMLTableRowElement;
    const rowB = table.querySelector('tr.model-row[data-ref="brand:b"]') as HTMLTableRowElement;
    expect(rowA.querySelector(".pill.vision")?.textContent).toBe("Vision");
    expect(rowB.textContent).toContain("—");

    // All SVGs aria-hidden
    const svgs = table.querySelectorAll("svg");
    expect(svgs.length).toBeGreaterThan(0);
    for (const svg of svgs) {
      expect(svg.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("shows key hint when brandKeys has a stored key", () => {
    const table = document.createElement("table");
    const provId = "brand:anthropic:https://a.test/api/anthropic";
    const store: ModelStore = {
      ...EMPTY_MODEL_STORE,
      brandKeys: { [provId]: "abcd1234" },
    };
    const entries = listModels(FIXTURE_BRAND, store);
    const handlers = {
      lockModel: false,
      onToggle: vi.fn(),
      onDefault: vi.fn(),
      onKey: vi.fn(),
    };

    renderModelTable(table, entries, store, handlers);
    const firstProv = table.querySelector("tr.prov");
    const provSub = firstProv?.querySelector(".prov-sub");
    expect(provSub?.textContent).toMatch(/key ••••1234$/);
  });

  it("handles default radio and disabled model switches properly", () => {
    const table = document.createElement("table");
    const store: ModelStore = {
      ...EMPTY_MODEL_STORE,
      disabled: ["brand:b"],
      defaultModel: "brand:a",
    };
    const entries = listModels(FIXTURE_BRAND, store);
    const handlers = {
      lockModel: false,
      onToggle: vi.fn(),
      onDefault: vi.fn(),
      onKey: vi.fn(),
    };

    renderModelTable(table, entries, store, handlers);

    const checkedRadios = table.querySelectorAll("input.model-default:checked");
    expect(checkedRadios.length).toBe(1);

    const rowB = table.querySelector('tr.model-row[data-ref="brand:b"]') as HTMLTableRowElement;
    const radioB = rowB.querySelector("input.model-default") as HTMLInputElement;
    const switchB = rowB.querySelector("input.model-enabled") as HTMLInputElement;

    expect(radioB.disabled).toBe(true);
    expect(switchB.checked).toBe(false);
  });

  it("fires onToggle, onDefault and onKey handlers upon interaction", () => {
    const table = document.createElement("table");
    const entries = listModels(FIXTURE_BRAND, EMPTY_MODEL_STORE);
    const handlers = {
      lockModel: false,
      onToggle: vi.fn(),
      onDefault: vi.fn(),
      onKey: vi.fn(),
    };

    renderModelTable(table, entries, EMPTY_MODEL_STORE, handlers);

    const rowA = table.querySelector('tr.model-row[data-ref="brand:a"]') as HTMLTableRowElement;
    const switchA = rowA.querySelector("input.model-enabled") as HTMLInputElement;
    switchA.checked = false;
    switchA.dispatchEvent(new Event("change"));
    expect(handlers.onToggle).toHaveBeenCalledWith("brand:a", false);

    const rowC = table.querySelector('tr.model-row[data-ref="brand:c"]') as HTMLTableRowElement;
    const radioC = rowC.querySelector("input.model-default") as HTMLInputElement;
    radioC.checked = true;
    radioC.dispatchEvent(new Event("change"));
    expect(handlers.onDefault).toHaveBeenCalledWith("brand:c");

    const keyBtn = table.querySelector(".key-btn") as HTMLButtonElement;
    keyBtn.click();
    expect(handlers.onKey).toHaveBeenCalledWith(
      expect.objectContaining({ id: "brand:anthropic:https://a.test/api/anthropic" }),
    );
  });

  it("renders 6 table headings and no checkboxes when lockModel is true", () => {
    const table = document.createElement("table");
    const entries = listModels(FIXTURE_BRAND, EMPTY_MODEL_STORE);
    const handlers = {
      lockModel: true,
      onToggle: vi.fn(),
      onDefault: vi.fn(),
      onKey: vi.fn(),
    };

    renderModelTable(table, entries, EMPTY_MODEL_STORE, handlers);
    const ths = table.querySelectorAll("thead th");
    expect(ths.length).toBe(6);

    const checkboxes = table.querySelectorAll("input[type=checkbox]:not([role=switch])");
    expect(checkboxes.length).toBe(0);
  });

  it("computes modelCountText correctly with disabled models", () => {
    const store: ModelStore = {
      ...EMPTY_MODEL_STORE,
      disabled: ["brand:b"],
    };
    const entries = listModels(FIXTURE_BRAND, store);
    expect(modelCountText(entries)).toBe("2 of 3 models enabled");
  });
});

const CUSTOM: CustomProvider = {
  id: "p1",
  name: "Local",
  wireFormat: "openai",
  endpoint: "http://localhost:8000/v1",
  apiKey: "sk-test-9876",
  headers: [{ name: "X-Team", value: "web" }],
  models: [
    { model: "m1", label: "M1", vision: true },
    { model: "m2", label: "M2", vision: false },
  ],
};

function paintCustom(h: Partial<Parameters<typeof renderModelTable>[3]> = {}) {
  const table = document.createElement("table");
  const store: ModelStore = { ...EMPTY_MODEL_STORE, providers: [CUSTOM] };
  const handlers = {
    lockModel: false,
    onToggle: vi.fn(),
    onDefault: vi.fn(),
    onKey: vi.fn(),
    onEdit: vi.fn(),
    onSelectionChange: vi.fn(),
    ...h,
  };
  renderModelTable(table, listModels(FIXTURE_BRAND, store), store, handlers);
  return { table, handlers };
}

describe("providerSubText", () => {
  const base: ResolvedProvider = {
    id: "p",
    kind: "custom",
    name: "P",
    endpoint: "http://x/v1",
    wireFormat: "openai",
    apiKey: "",
    headers: [],
  };
  it("shows the endpoint alone for a bare custom provider", () => {
    expect(providerSubText(base)).toBe("http://x/v1");
  });
  it("adds the key tail and the header count", () => {
    expect(providerSubText({ ...base, apiKey: "sk-test-9876", headers: [{ name: "A", value: "1" }] })).toBe(
      "http://x/v1 · key ••••9876 · 1 custom header",
    );
    expect(
      providerSubText({
        ...base,
        headers: [
          { name: "A", value: "1" },
          { name: "B", value: "2" },
        ],
      }),
    ).toBe("http://x/v1 · 2 custom headers");
  });
  it("keeps the shared Token wording for brand providers", () => {
    expect(providerSubText({ ...base, kind: "brand" })).toBe("http://x/v1 · shared Token");
  });
});

describe("deleteButtonText", () => {
  it("names the count only when something is ticked", () => {
    expect(deleteButtonText(0)).toBe("Delete selected");
    expect(deleteButtonText(3)).toBe("Delete selected (3)");
  });
});

describe("custom rows", () => {
  it("renders an enabled provider checkbox, an Edit button and model checkboxes", () => {
    const { table, handlers } = paintCustom();
    const prov = table.querySelector<HTMLInputElement>('tr[data-provider-id="p1"] .prov-select');
    expect(prov?.disabled).toBe(false);
    expect(table.querySelectorAll(".model-select").length).toBe(2);
    table.querySelector<HTMLButtonElement>(".edit-btn")?.click();
    expect(handlers.onEdit).toHaveBeenCalledWith("p1");
  });

  it("syncs provider and model ticks both ways", () => {
    const { table, handlers } = paintCustom();
    const prov = table.querySelector<HTMLInputElement>(".prov-select:not(:disabled)")!;
    prov.checked = true;
    prov.dispatchEvent(new Event("change"));
    const boxes = [...table.querySelectorAll<HTMLInputElement>(".model-select")];
    expect(boxes.every((b) => b.checked)).toBe(true);
    expect(table.querySelectorAll("tr.sel-row").length).toBe(2);
    expect(handlers.onSelectionChange).toHaveBeenLastCalledWith(new Set(["p1/m1", "p1/m2"]));

    boxes[0].checked = false;
    boxes[0].dispatchEvent(new Event("change"));
    expect(prov.checked).toBe(false);
    expect(handlers.onSelectionChange).toHaveBeenLastCalledWith(new Set(["p1/m2"]));
  });

  it("shows no custom provider, checkbox or Edit under lockModel", () => {
    const { table } = paintCustom({ lockModel: true });
    expect(table.querySelector('tr[data-provider-id="p1"]')).toBeNull();
    expect(table.querySelector(".edit-btn")).toBeNull();
    expect(table.querySelectorAll("input[type=checkbox]:not([role=switch])").length).toBe(0);
  });
});
