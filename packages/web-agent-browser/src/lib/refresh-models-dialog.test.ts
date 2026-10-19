// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { runRefreshFromModels } from "./refresh-models-dialog";

const rows = [
  { model: "b", label: "Beta", vision: true },
  { model: "x", label: "X", vision: false },
];
const input = { endpoint: "http://localhost:8000/v1/", apiKey: "k", headers: [], rows };

const reply = (body: unknown, init: ResponseInit = {}) =>
  vi.fn().mockResolvedValue(new Response(JSON.stringify(body), init));

/** Waits one macrotask so the dialog the flow opened is in the DOM. */
const tick = () => new Promise((r) => setTimeout(r, 0));

function text(): string {
  return document.querySelector("dialog")?.textContent ?? "";
}

describe("runRefreshFromModels", () => {
  it("asks permission for the endpoint origin and reports a refusal", async () => {
    const requestPermission = vi.fn().mockResolvedValue(false);
    const fetchImpl = vi.fn();
    const p = runRefreshFromModels(input, { requestPermission, fetchImpl });
    await tick();
    expect(requestPermission).toHaveBeenCalledWith("http://localhost/*");
    expect(text()).toContain("Permission to reach this endpoint was not granted.");
    expect(text()).toContain("Nothing was changed.");
    document.querySelector<HTMLButtonElement>(".close-btn")!.click();
    expect(await p).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports an HTTP error", async () => {
    const fetchImpl = reply({}, { status: 401, statusText: "Unauthorized" });
    const p = runRefreshFromModels(input, { requestPermission: () => Promise.resolve(true), fetchImpl });
    await tick();
    expect(text()).toContain("The endpoint answered 401 Unauthorized. Check the API key and headers, then try again.");
    expect(text()).toContain("Nothing was changed.");
    document.querySelector<HTMLButtonElement>(".close-btn")!.click();
    expect(await p).toBeNull();
  });

  it("sends GET <endpoint>/models with the key header", async () => {
    const fetchImpl = reply({});
    const p = runRefreshFromModels(input, { requestPermission: () => Promise.resolve(true), fetchImpl });
    await tick();
    expect(fetchImpl).toHaveBeenCalledWith("http://localhost:8000/v1/models", {
      method: "GET",
      headers: { Authorization: "Bearer k" },
    });
    document.querySelector<HTMLButtonElement>(".close-btn")!.click();
    await p;
  });

  it("reports a body without a model list", async () => {
    const p = runRefreshFromModels(input, { requestPermission: () => Promise.resolve(true), fetchImpl: reply({}) });
    await tick();
    expect(text()).toContain("The endpoint did not return a model list.");
    expect(text()).toContain("Nothing was changed.");
    document.querySelector<HTMLButtonElement>(".close-btn")!.click();
    expect(await p).toBeNull();
  });

  it("reports an unreachable endpoint", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("boom"));
    const p = runRefreshFromModels(input, { requestPermission: () => Promise.resolve(true), fetchImpl });
    await tick();
    expect(text()).toContain("The endpoint could not be reached.");
    document.querySelector<HTMLButtonElement>(".close-btn")!.click();
    expect(await p).toBeNull();
  });

  it("lists Add, Remove and Keep; Cancel returns null and Apply returns the diff", async () => {
    const body = { data: [{ id: "a" }, { id: "b" }, { id: "c" }] };
    const deps = { requestPermission: () => Promise.resolve(true), fetchImpl: reply(body) };

    const cancelled = runRefreshFromModels(input, deps);
    await tick();
    expect(text()).toContain("The endpoint returned 3 models.");
    expect(text()).toContain("Add 2");
    expect(text()).toContain("Remove 1");
    expect(text()).toContain("not returned by the endpoint");
    expect(text()).toContain("Keep 1");
    expect([...document.querySelectorAll(".diff-add li")].map((li) => li.textContent)).toEqual(["a", "c"]);
    expect([...document.querySelectorAll(".diff-remove li")].map((li) => li.textContent)).toEqual(["x"]);
    expect([...document.querySelectorAll(".diff-keep li")].map((li) => li.textContent)).toEqual(["b"]);
    document.querySelector<HTMLButtonElement>(".cancel-btn")!.click();
    expect(await cancelled).toBeNull();

    const applied = runRefreshFromModels(input, { ...deps, fetchImpl: reply(body) });
    await tick();
    document.querySelector<HTMLButtonElement>(".apply-btn")!.click();
    expect(await applied).toEqual({ returnedCount: 3, add: ["a", "c"], remove: ["x"], keep: ["b"] });
  });
});
