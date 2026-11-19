// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderModelTable, modelCountText, providerSubText, deleteButtonText, visibleEntries } from "./model-table";
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
      testResults: new Map(),
      onToggle: vi.fn(),
      onDefault: vi.fn(),
      onKey: vi.fn(),
    };

    renderModelTable(table, entries, EMPTY_MODEL_STORE, handlers);

    const ths = table.querySelectorAll("thead th");
    expect(ths.length).toBe(7);
    expect([...ths].map((th) => th.textContent)).toEqual([
      "",
      "Provider / model",
      "Format",
      "Capabilities",
      "Enabled",
      "Default",
      "",
    ]);

    const provRows = table.querySelectorAll("tr.prov");
    expect(provRows.length).toBe(2);

    const modelRows = table.querySelectorAll("tr.model-row");
    expect(modelRows.length).toBe(3);

    // First provider row assertions
    const firstProv = provRows[0];
    const provLabel = firstProv.querySelector(".prov-label");
    expect(provLabel?.textContent).toBe("Acme");

    const pillBrand = firstProv.querySelector(".pill.brand");
    expect(pillBrand?.textContent).toBe("Provided");

    const provSub = firstProv.querySelector(".prov-sub");
    expect(provSub?.textContent).toBe("https://a.test/api/anthropic · no key");

    const countCell = firstProv.querySelector(".count");
    expect(countCell?.textContent).toBe("2 / 2");

    const checkbox = firstProv.querySelector("input[type=checkbox]") as HTMLInputElement;
    expect(checkbox.disabled).toBe(true);
    expect(checkbox.title).toBe("Brand models cannot be deleted");

    const keyBtn = firstProv.querySelector(".key-btn") as HTMLButtonElement;
    expect(keyBtn).not.toBeNull();
    expect(keyBtn.querySelector("svg")).not.toBeNull();
    expect(keyBtn.textContent).toBe("");
    expect(keyBtn.title).toBe(keyBtn.getAttribute("aria-label"));

    expect(firstProv.querySelector(".edit-btn")).toBeNull();

    // Model label and id badge, plus Capabilities icons
    const rowA = table.querySelector('tr.model-row[data-ref="brand:a"]') as HTMLTableRowElement;
    const rowB = table.querySelector('tr.model-row[data-ref="brand:b"]') as HTMLTableRowElement;
    expect(rowA.querySelector("td.model")?.childNodes.length).toBe(2);
    expect(rowA.querySelector(".model-label")?.textContent).toBe("Model A");
    expect(rowA.querySelector(".mid")?.textContent).toBe("claude-a");
    expect(rowB.querySelector(".model-label")?.textContent).toBe("Model B");
    expect(rowB.querySelector(".mid")?.textContent).toBe("claude-b");

    const capA = rowA.querySelector("td:nth-child(4) > span.cap") as HTMLElement;
    const capB = rowB.querySelector("td:nth-child(4) > span.cap") as HTMLElement;
    expect(capA).not.toBeNull();
    expect(capA.classList.contains("off")).toBe(false);
    expect(capA.getAttribute("role")).toBe("img");
    expect(capA.getAttribute("aria-label")).toBe("Vision");
    expect(capA.title).toBe("Vision");
    expect(capA.querySelector("svg path")?.getAttribute("d") ?? "").not.toBe("");

    expect(capB).not.toBeNull();
    expect(capB.classList.contains("off")).toBe(true);
    expect(capB.getAttribute("role")).toBe("img");
    expect(capB.getAttribute("aria-label")).toBe("No vision");
    expect(capB.title).toBe("No vision");
    expect(capB.querySelector("svg path")?.getAttribute("d") ?? "").not.toBe("");
    expect(capA.querySelector("svg")?.outerHTML).not.toBe(capB.querySelector("svg")?.outerHTML);

    expect(table.querySelector(".pill.vision")).toBeNull();
    expect(rowB.textContent).not.toContain("—");
    for (const prov of provRows) {
      expect(prov.querySelectorAll("td")[3].textContent).toBe("");
      expect(prov.querySelectorAll("td")[3].children.length).toBe(0);
    }

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
      testResults: new Map(),
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
      testResults: new Map(),
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
      testResults: new Map(),
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
      testResults: new Map(),
      onToggle: vi.fn(),
      onDefault: vi.fn(),
      onKey: vi.fn(),
    };

    renderModelTable(table, entries, EMPTY_MODEL_STORE, handlers);
    const ths = table.querySelectorAll("thead th");
    expect(ths.length).toBe(6);
    expect([...ths].map((th) => th.textContent)).toEqual([
      "Provider / model",
      "Format",
      "Capabilities",
      "Enabled",
      "Default",
      "",
    ]);

    const checkboxes = table.querySelectorAll("input[type=checkbox]:not([role=switch])");
    expect(checkboxes.length).toBe(0);
  });

  it("computes modelCountText correctly with disabled models", () => {
    const store: ModelStore = {
      ...EMPTY_MODEL_STORE,
      disabled: ["brand:b"],
    };
    const entries = listModels(FIXTURE_BRAND, store);
    expect(modelCountText(entries)).toBe("Enabled 2/3");
  });

  it("reports the enabled numerator over the entry count", () => {
    const all = listModels(FIXTURE_BRAND, EMPTY_MODEL_STORE);
    expect(modelCountText(all)).toBe("Enabled 3/3");
    expect(modelCountText([])).toBe("Enabled 0/0");

    const none: ModelStore = {
      ...EMPTY_MODEL_STORE,
      disabled: ["brand:a", "brand:b", "brand:c"],
    };
    expect(modelCountText(listModels(FIXTURE_BRAND, none))).toBe("Enabled 0/3");
  });

  it("moves only the numerator when one copied entry is turned off", () => {
    const entries = listModels(FIXTURE_BRAND, EMPTY_MODEL_STORE);
    const copy = entries.map((e) => ({ ...e }));
    const index = copy.findIndex((e) => e.ref === "brand:b");
    copy[index].enabled = false;

    expect(modelCountText(copy)).toBe("Enabled 2/3");
    expect(modelCountText(entries)).toBe("Enabled 3/3");
  });

  it("visibleEntries returns all entries when unlocked and only brand entries when locked", () => {
    const oneBrand: AgentBrand = {
      ...FIXTURE_BRAND,
      models: [FIXTURE_BRAND.models[0]],
    };
    const fourCustomStore: ModelStore = {
      ...EMPTY_MODEL_STORE,
      providers: [
        {
          id: "p1",
          name: "Local",
          wireFormat: "openai",
          endpoint: "http://localhost:10040/v1",
          apiKey: "",
          headers: [],
          models: [
            { model: "m1", label: "M1", vision: false },
            { model: "m2", label: "M2", vision: false },
            { model: "m3", label: "M3", vision: false },
            { model: "m4", label: "M4", vision: false },
          ],
        },
      ],
    };
    const entries = listModels(oneBrand, fourCustomStore);
    expect(entries).toHaveLength(5);

    expect(visibleEntries(entries, false).map((e) => e.ref)).toEqual([
      "brand:a",
      "p1/m1",
      "p1/m2",
      "p1/m3",
      "p1/m4",
    ]);
    expect(visibleEntries(entries).map((e) => e.ref)).toEqual([
      "brand:a",
      "p1/m1",
      "p1/m2",
      "p1/m3",
      "p1/m4",
    ]);
    expect(modelCountText(visibleEntries(entries, false))).toBe("Enabled 5/5");

    const lockedVisible = visibleEntries(entries, true);
    expect(lockedVisible.map((e) => e.ref)).toEqual(["brand:a"]);
    expect(modelCountText(lockedVisible)).toBe("Enabled 1/1");

    const disabledBrandEntries = listModels(oneBrand, {
      ...fourCustomStore,
      disabled: ["brand:a"],
    });
    expect(modelCountText(visibleEntries(disabledBrandEntries, true))).toBe("Enabled 0/1");
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
    testResults: new Map(),
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
  it("brand provider shows provided key, user key or no key", () => {
    expect(providerSubText({ ...base, kind: "brand", apiKey: "bk", keySource: "brand" })).toBe(
      "http://x/v1 · provided key",
    );
    expect(providerSubText({ ...base, kind: "brand", apiKey: "sk-user-1234", keySource: "user" })).toBe(
      "http://x/v1 · key ••••1234",
    );
    expect(providerSubText({ ...base, kind: "brand", apiKey: "", keySource: "none" })).toBe(
      "http://x/v1 · no key",
    );
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
  it("draws the built-in provider logo and keeps the server icon for a custom one", () => {
    const table = document.createElement("table");
    const providers: CustomProvider[] = [
      {
        id: "p-anthropic",
        name: "My Anthropic",
        builtIn: "anthropic",
        wireFormat: "anthropic",
        endpoint: "https://api.anthropic.com",
        apiKey: "",
        headers: [],
        models: [{ model: "claude-sonnet-5-5", label: "Sonnet", vision: true }],
      },
      {
        id: "p-local",
        name: "Local",
        wireFormat: "openai",
        endpoint: "http://localhost:8000/v1",
        apiKey: "",
        headers: [],
        models: [{ model: "m1", label: "M1", vision: false }],
      },
    ];
    const store: ModelStore = { providers, brandKeys: {}, disabled: [], defaultModel: null };
    renderModelTable(table, listModels({ ...FIXTURE_BRAND, models: [] }, store), store, {
      lockModel: false,
      testResults: new Map(),
      onToggle: vi.fn(),
      onDefault: vi.fn(),
      onKey: vi.fn(),
    });

    const firstIcon = table.querySelector('tr[data-provider-id="p-anthropic"] .prov-name svg.logo')?.outerHTML ?? "";
    const secondIcon = table.querySelector('tr[data-provider-id="p-local"] .prov-name svg.logo')?.outerHTML ?? "";
    expect(firstIcon).not.toBe(secondIcon);
    expect(firstIcon).toContain("<path");
    expect(secondIcon).toContain("<path");
    expect(firstIcon).not.toContain("<title>");
  });
});

const okBody = (text: string) => ({
  id: "x",
  object: "chat.completion",
  created: 0,
  model: "m1",
  choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
});
const okResponse = (text = "OK") => new Response(JSON.stringify(okBody(text)), { status: 200 });

function stubNetwork(fetchImpl: ReturnType<typeof vi.fn>) {
  const request = vi.fn().mockResolvedValue(true);
  vi.stubGlobal("fetch", fetchImpl);
  vi.stubGlobal("chrome", { permissions: { request } });
  return request;
}

function handlersWith(over: Partial<Parameters<typeof renderModelTable>[3]> = {}) {
  return {
    lockModel: false,
    testResults: new Map(),
    onToggle: vi.fn(),
    onDefault: vi.fn(),
    onKey: vi.fn(),
    onEdit: vi.fn(),
    ...over,
  };
}

function paint(table: HTMLTableElement, brand: AgentBrand, store: ModelStore, h: ReturnType<typeof handlersWith>) {
  renderModelTable(table, listModels(brand, store), store, h);
}

const CUSTOM_STORE: ModelStore = { ...EMPTY_MODEL_STORE, providers: [CUSTOM] };
const NO_BRAND: AgentBrand = { ...FIXTURE_BRAND, models: [] };
const tickTable = () => new Promise<void>((r) => setTimeout(r, 0));
const testBtn = (table: HTMLElement, ref: string) =>
  table.querySelector<HTMLButtonElement>(`tr.model-row[data-ref="${ref}"] .test-model-btn`)!;
const resultOf = (table: HTMLElement, ref: string) =>
  table.querySelector<HTMLElement>(`tr.model-row[data-ref="${ref}"] .table-model-result`)!;

describe("Models tab Test button", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("U1: every model row has a Test icon button; Key and Edit are icon-only", () => {
    const table = document.createElement("table");
    const store: ModelStore = { ...CUSTOM_STORE, disabled: ["brand:b"] };
    const h = handlersWith();
    paint(table, FIXTURE_BRAND, store, h);

    const rows = table.querySelectorAll("tr.model-row");
    expect(rows.length).toBe(5);
    for (const row of rows) {
      const btns = row.querySelectorAll<HTMLButtonElement>(".test-model-btn");
      expect(btns.length).toBe(1);
      const b = btns[0];
      expect(b.querySelector("svg path")).not.toBeNull();
      expect(b.textContent).toBe("");
      expect(b.getAttribute("aria-label")).toBe("Test key and model");
      expect(b.title).toBe("Test key and model");
      expect(b.type).toBe("button");
      expect(b.disabled).toBe(false);
      const r = row.querySelector<HTMLElement>(".table-model-result")!;
      expect(r.hidden).toBe(true);
      expect(r.textContent).toBe("");
    }
    expect(table.querySelectorAll("tr.prov .test-model-btn").length).toBe(0);

    const edit = table.querySelector<HTMLButtonElement>(".edit-btn")!;
    expect(edit.querySelector("svg path")).not.toBeNull();
    expect(edit.textContent).toBe("");
    expect(edit.getAttribute("aria-label")).toBe("Edit Local");
    expect(edit.title).toBe("Edit Local");
    edit.click();
    expect(h.onEdit).toHaveBeenCalledWith("p1");

    const key = table.querySelector<HTMLButtonElement>(".key-btn")!;
    expect(key.querySelector("svg path")).not.toBeNull();
    expect(key.textContent).toBe("");
    expect(key.getAttribute("aria-label")).toMatch(/^Key for /);
    expect(key.title).toBe(key.getAttribute("aria-label"));
    key.click();
    expect(h.onKey).toHaveBeenCalledTimes(1);
  });

  it("U2: a click tests with the saved provider's key, headers and model", async () => {
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(okResponse()));
    const request = stubNetwork(fetchImpl);
    const table = document.createElement("table");
    const h = handlersWith();
    paint(table, NO_BRAND, CUSTOM_STORE, h);

    testBtn(table, "p1/m1").click();
    await vi.waitFor(() => expect(resultOf(table, "p1/m1").textContent).toMatch(/^✓ OK · /));

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({ origins: ["http://localhost/*"] });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toBe("http://localhost:8000/v1/chat/completions");
    const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer sk-test-9876");
    expect(headers.get("x-team")).toBe("web");
    expect((JSON.parse(init.body as string) as { model: string }).model).toBe("m1");
    expect(resultOf(table, "p1/m1").hidden).toBe(false);
    expect(resultOf(table, "p1/m1").classList.contains("ok")).toBe(true);
    expect(h.testResults.get("p1/m1")?.text).toMatch(/^✓ OK · /);
    expect(resultOf(table, "p1/m2").textContent).toBe("");
  });

  it("U3: a brand row sends the Key-button key, else the brand default key", async () => {
    const brand: AgentBrand = {
      ...FIXTURE_BRAND,
      models: [{ ...FIXTURE_BRAND.models[0], apiKey: "brand-default" }],
    };
    const keys: string[] = [];
    const fetchImpl = vi.fn().mockImplementation((_u: string, init: RequestInit) => {
      keys.push(String(new Headers(init.headers).get("x-api-key") ?? new Headers(init.headers).get("authorization")));
      return Promise.resolve(new Response(JSON.stringify({
        id: "m", type: "message", role: "assistant", model: "claude-a",
        content: [{ type: "text", text: "OK" }], stop_reason: "end_turn", stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      }), { status: 200 }));
    });
    stubNetwork(fetchImpl);

    const table = document.createElement("table");
    paint(table, brand, EMPTY_MODEL_STORE, handlersWith());
    testBtn(table, "brand:a").click();
    await vi.waitFor(() => expect(keys.length).toBe(1));
    expect(keys[0]).toContain("brand-default");

    const providerId = listModels(brand, EMPTY_MODEL_STORE)[0].provider.id;
    const withUser: ModelStore = { ...EMPTY_MODEL_STORE, brandKeys: { [providerId]: "user-key" } };
    const table2 = document.createElement("table");
    paint(table2, brand, withUser, handlersWith());
    testBtn(table2, "brand:a").click();
    await vi.waitFor(() => expect(keys.length).toBe(2));
    expect(keys[1]).toContain("user-key");
    expect(keys[1]).not.toContain("brand-default");
  });

  it("U3b: a brand row with no key is still testable", () => {
    const table = document.createElement("table");
    paint(table, FIXTURE_BRAND, EMPTY_MODEL_STORE, handlersWith());
    const entry = listModels(FIXTURE_BRAND, EMPTY_MODEL_STORE)[0];
    expect(entry.provider.keySource).toBe("none");
    expect(testBtn(table, "brand:a").disabled).toBe(false);
  });

  it("U4: a result is repainted from the shared map, success and failure", async () => {
    const fetchImpl = vi
      .fn()
      .mockImplementationOnce(() => Promise.resolve(okResponse()))
      .mockImplementationOnce(() => Promise.resolve(new Response("no", { status: 401, statusText: "Unauthorized" })));
    stubNetwork(fetchImpl);
    const table = document.createElement("table");
    const h = handlersWith();
    paint(table, NO_BRAND, CUSTOM_STORE, h);

    testBtn(table, "p1/m1").click();
    await vi.waitFor(() => expect(h.testResults.has("p1/m1")).toBe(true));
    testBtn(table, "p1/m2").click();
    await vi.waitFor(() => expect(h.testResults.has("p1/m2")).toBe(true));

    const again = document.createElement("table");
    paint(again, NO_BRAND, CUSTOM_STORE, h);
    expect(resultOf(again, "p1/m1").textContent).toBe(resultOf(table, "p1/m1").textContent);
    expect(resultOf(again, "p1/m1").classList.contains("ok")).toBe(true);
    expect(resultOf(again, "p1/m2").textContent).toBe("✗ 401 Unauthorized. Check the API key.");
    expect(resultOf(again, "p1/m2").classList.contains("fail")).toBe(true);

    const fresh = document.createElement("table");
    paint(fresh, NO_BRAND, CUSTOM_STORE, handlersWith());
    expect(resultOf(fresh, "p1/m1").textContent).toBe("");
  });

  it("U5: a pending test survives a repaint and its result shows at the next one", async () => {
    let resolveFetch!: (r: Response) => void;
    const fetchImpl = vi.fn(() => new Promise<Response>((r) => { resolveFetch = r; }));
    stubNetwork(fetchImpl);
    const table = document.createElement("table");
    const h = handlersWith();
    paint(table, NO_BRAND, CUSTOM_STORE, h);

    const b = testBtn(table, "p1/m1");
    b.click();
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    expect(b.disabled).toBe(true);
    expect(b.getAttribute("aria-busy")).toBe("true");
    expect(b.querySelector(".test-spinner")).not.toBeNull();
    expect(table.textContent).not.toContain("Testing…");
    expect(testBtn(table, "p1/m2").disabled).toBe(false);

    const replacement = document.createElement("table");
    paint(replacement, NO_BRAND, CUSTOM_STORE, h);
    expect(testBtn(replacement, "p1/m1").disabled).toBe(false);
    expect(resultOf(replacement, "p1/m1").textContent).toBe("");

    resolveFetch(okResponse());
    await vi.waitFor(() => expect(h.testResults.has("p1/m1")).toBe(true));
    await tickTable();
    expect(resultOf(replacement, "p1/m1").textContent).toBe("");

    const third = document.createElement("table");
    paint(third, NO_BRAND, CUSTOM_STORE, h);
    expect(resultOf(third, "p1/m1").textContent).toMatch(/^✓ OK · /);
  });

  it("U6: under lockModel brand rows keep Test and Key, and lose Edit and the boxes", () => {
    const table = document.createElement("table");
    const h = handlersWith({ lockModel: true });
    paint(table, FIXTURE_BRAND, CUSTOM_STORE, h);

    expect(table.querySelectorAll("tr.model-row").length).toBe(3);
    expect(table.querySelectorAll("tr.model-row .test-model-btn").length).toBe(3);
    expect(table.querySelectorAll(".key-btn").length).toBeGreaterThan(0);
    expect(table.querySelector(".edit-btn")).toBeNull();
    expect(table.querySelector('tr[data-provider-id="p1"]')).toBeNull();
    expect(table.querySelectorAll("input[type=checkbox]:not([role=switch])").length).toBe(0);
    expect(table.querySelectorAll("input.model-default").length).toBe(3);
  });
});
