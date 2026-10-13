import { beforeEach, describe, expect, it, vi } from "vitest";

describe("hash router", () => {
  beforeEach(() => {
    // `history.replaceState` updates the URL without firing `hashchange`
    // (jsdom schedules that asynchronously via setTimeout(0) when the
    // `location.hash` setter is used instead), so each test starts clean
    // with no pending event to leak into the next test.
    window.history.replaceState(null, "", "#");
  });

  it("currentPath() parses location.hash", async () => {
    window.history.replaceState(null, "", "#/store");
    const router = await import("./router");
    expect(router.currentPath()).toBe("/store");
  });

  it("currentPath() defaults empty or # to /", async () => {
    window.history.replaceState(null, "", "#");
    const router = await import("./router");
    expect(router.currentPath()).toBe("/");
  });

  it("navigate updates location.hash and notifies listeners exactly once when hash changes", async () => {
    const router = await import("./router");
    const seen: string[] = [];
    const unsub = router.registerOnNavigate((path) => seen.push(path));
    router.navigate("/cart");
    expect(window.location.hash).toBe("#/cart");
    // jsdom dispatches `hashchange` asynchronously (queued via setTimeout(0)),
    // so wait one macrotask for the router's own listener to run it.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen).toEqual(["/cart"]);
    unsub();
  });

  it("navigate notifies listeners exactly once when hash is already matching", async () => {
    window.history.replaceState(null, "", "#/cart");
    const router = await import("./router");
    const seen: string[] = [];
    const unsub = router.registerOnNavigate((path) => seen.push(path));
    router.navigate("/cart");
    expect(seen).toEqual(["/cart"]);
    unsub();
  });

  it("hashchange event notifies listeners exactly once (Back/Forward navigation)", async () => {
    const router = await import("./router");
    const seen: string[] = [];
    const unsub = router.registerOnNavigate((path) => seen.push(path));
    // Simulate a Back/Forward navigation: the URL changes and the browser
    // fires `hashchange` once. `replaceState` changes the URL without
    // scheduling jsdom's own async event, so only the dispatch below fires.
    window.history.replaceState(null, "", "#/orders");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(seen).toEqual(["/orders"]);
    unsub();
  });

  it("toRelative normalizes routes and hashes", async () => {
    const router = await import("./router");
    expect(router.toRelative("/store")).toBe("/store");
    expect(router.toRelative("#/orders")).toBe("/orders");
    expect(router.toRelative("cart")).toBe("/cart");
  });

  it("registerOnNavigate unsubscribe works", async () => {
    const router = await import("./router");
    const spy = vi.fn();
    const unsubscribe = router.registerOnNavigate(spy);
    unsubscribe();
    router.navigate("/store");
    expect(spy).not.toHaveBeenCalled();
  });
});
