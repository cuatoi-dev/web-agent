import { describe, it, expect, vi } from "vitest";
import { pageDescribeValue, pageRunFetch, PAGE_DESCRIBE_SOURCE, PAGE_FETCH_SOURCE } from "./cdp-page-source";
import { describeValue } from "../core/run-eval";
import { runPageFetch } from "../core/run-fetch";

function fakeFetch(response: { status?: number; statusText?: string; contentType?: string; body?: string }) {
  return vi.fn(() =>
    Promise.resolve({
      status: response.status ?? 200,
      statusText: response.statusText ?? "OK",
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "content-type" ? (response.contentType ?? "application/json") : null,
      },
      text: () => Promise.resolve(response.body ?? "{}"),
    } as unknown as Response),
  );
}

describe("pageDescribeValue matches describeValue", () => {
  it("agrees on every value kind", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    const values: unknown[] = [
      undefined,
      null,
      "text",
      42,
      true,
      10n,
      Symbol("s"),
      function named() {},
      () => {},
      [1, 2, 3],
      { a: 1 },
      new Map([["a", 1]]),
      new Set([1]),
      new TypeError("boom"),
      Object.create(null),
      circular,
    ];

    for (const value of values) {
      expect(pageDescribeValue.call(value)).toEqual(describeValue(value));
    }
  });

  it("agrees on a DOM node", () => {
    const p = document.createElement("p");
    p.id = "x";
    p.textContent = "hello";

    const fromPage = pageDescribeValue.call(p);
    const fromBubble = describeValue(p);
    expect(fromPage).toEqual(fromBubble);
    expect(fromPage.kind).toBe("HTMLParagraphElement");
  });
});

describe("pageRunFetch matches runPageFetch", () => {
  it("agrees on a 200 response", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = fakeFetch({ contentType: "application/json", body: '{"ok":true}' });
    try {
      const viaPage = await pageRunFetch({ url: "/api/items" });
      const viaBubble = await runPageFetch(
        { url: "/api/items" },
        { fetch: fakeFetch({ contentType: "application/json", body: '{"ok":true}' }) },
      );
      expect(viaPage).toEqual(viaBubble);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("agrees on a cross-origin URL", async () => {
    const viaPage = await pageRunFetch({ url: "https://other.test/x" });
    const viaBubble = await runPageFetch({ url: "https://other.test/x" });
    expect(viaPage).toEqual(viaBubble);
    expect(viaPage).toEqual(
      expect.objectContaining({ kind: "cross-origin", requested: "https://other.test" }),
    );
  });

  it("agrees on an invalid URL", async () => {
    const viaPage = await pageRunFetch({ url: "http://" });
    const viaBubble = await runPageFetch({ url: "http://" });
    expect(viaPage.kind).toBe("invalid-url");
    expect(viaBubble.kind).toBe("invalid-url");
    expect(viaPage).toEqual(viaBubble);
  });

  it("agrees when fetch rejects", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(() => Promise.reject(new Error("network down")));
    try {
      const viaPage = await pageRunFetch({ url: "/api/items" });
      const viaBubble = await runPageFetch(
        { url: "/api/items" },
        { fetch: vi.fn(() => Promise.reject(new Error("network down"))) },
      );
      expect(viaPage).toEqual(viaBubble);
      expect(viaPage).toEqual(expect.objectContaining({ kind: "throw", name: "Error", message: "network down" }));
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("the source strings", () => {
  it("PAGE_DESCRIBE_SOURCE is a function expression that runs", () => {
    // 'use strict' matches how the source is actually authored (an ES module
    // export, always strict): without it, `Function`'s own sloppy mode boxes
    // a primitive `this` passed to `.call()`, which the real caller never does
    // (callFunctionOn only binds `this` to an object's objectId).
    const fn = new Function("'use strict'; return (" + PAGE_DESCRIBE_SOURCE + ")")() as (
      this: unknown,
    ) => { kind: string; text: string };
    expect(fn.call("hi")).toEqual({ kind: "string", text: "hi" });
  });

  it("PAGE_FETCH_SOURCE is a function expression that runs", async () => {
    const fn = new Function("return (" + PAGE_FETCH_SOURCE + ")")() as (
      args: Record<string, unknown>,
    ) => Promise<Record<string, unknown>>;
    const original = globalThis.fetch;
    globalThis.fetch = fakeFetch({ contentType: "text/plain", body: "hi" });
    try {
      const result = await fn({ url: "/x" });
      expect(result.kind).toBe("response");
      expect(result.body).toBe("hi");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("neither source reads a module-level name", async () => {
    // new Function's body runs in the GLOBAL scope, with no access to this
    // module's local functions (describeValue, errorMessage, thrownName, …).
    // If either source called one of those as a free variable, invoking it
    // here would throw (or reject with) a ReferenceError instead of running.
    const describeFn = new Function("return (" + PAGE_DESCRIBE_SOURCE + ")")() as (this: unknown) => unknown;
    expect(() => describeFn.call({ a: 1 })).not.toThrow();

    const fetchFn = new Function("return (" + PAGE_FETCH_SOURCE + ")")() as (
      args: Record<string, unknown>,
    ) => Promise<Record<string, unknown>>;
    await expect(fetchFn({ url: "" })).resolves.toEqual(expect.objectContaining({ kind: "invalid-url" }));
  });
});
