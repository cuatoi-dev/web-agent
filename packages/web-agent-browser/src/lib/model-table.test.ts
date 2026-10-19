// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderModelTable, modelCountText } from "./model-table";
import { listModels, EMPTY_MODEL_STORE } from "./model-store";
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
