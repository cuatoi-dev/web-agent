import { describe, it, expect, afterEach, vi } from "vitest";
import { requestBrand } from "./brand-request";
import { EMPTY_BRAND } from "./brand";

describe("requestBrand", () => {
  afterEach(() => {
    delete (globalThis as unknown as { chrome?: unknown }).chrome;
    vi.restoreAllMocks();
  });

  // `chrome` is declared globally by @types/chrome as the real, much richer
  // namespace type; the fake below implements only what this module calls —
  // `runtime.sendMessage(message): Promise<unknown>` — per @types/chrome's own
  // signature (index.d.ts:8260). This mocks the external boundary (the
  // extension messaging API); EMPTY_BRAND and the narrowing run for real.
  function stubSendMessage(impl: () => Promise<unknown>): void {
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: { sendMessage: vi.fn(impl) },
    };
  }

  it("a valid brand comes back unchanged", async () => {
    const brand = { prompts: { inPage: "x" }, tools: {}, skills: {}, options: {}, models: [], skillDefs: [], hosts: [] };
    stubSendMessage(() => Promise.resolve(brand));
    expect(await requestBrand()).toEqual(brand);
  });

  it("the message sent is brand:get", async () => {
    const sendMessage = vi.fn(() => Promise.resolve(EMPTY_BRAND));
    (globalThis as unknown as { chrome: unknown }).chrome = { runtime: { sendMessage } };
    await requestBrand();
    expect(sendMessage).toHaveBeenCalledWith({ type: "brand:get" });
  });

  it("an undefined answer degrades to the empty brand", async () => {
    stubSendMessage(() => Promise.resolve(undefined));
    expect(await requestBrand()).toEqual(EMPTY_BRAND);
  });

  it("a non-object answer degrades to the empty brand", async () => {
    stubSendMessage(() => Promise.resolve("nope"));
    expect(await requestBrand()).toEqual(EMPTY_BRAND);
  });

  it("a rejected send degrades to the empty brand and warns once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stubSendMessage(() => Promise.reject(new Error("no worker")));
    expect(await requestBrand()).toEqual(EMPTY_BRAND);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("no worker");
  });
});
