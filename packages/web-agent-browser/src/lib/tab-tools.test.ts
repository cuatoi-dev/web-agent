import { describe, it, expect, vi } from "vitest";
import type { ToolContext } from "@cuatoi/web-agent-core";
import { createTabTools, tabTools, type TabsApi } from "./tab-tools";

/** The minimum ToolContext the tools under test read. `app` and `signal` are
 *  the interface's only required fields (web-agent-core tool-hooks.types.ts);
 *  none of these tools touches the optional ones. */
function toolCtx(): ToolContext {
  return { app: {}, signal: new AbortController().signal };
}

/** A fake `chrome.tabs.onUpdated` that a test can fire manually via `.fire(...)`. */
function fakeOnUpdated() {
  const listeners: Array<(tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => void> = [];
  return {
    addListener: vi.fn((cb: (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => void) => listeners.push(cb)),
    removeListener: vi.fn((cb: (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => void) => {
      const i = listeners.indexOf(cb);
      if (i >= 0) listeners.splice(i, 1);
    }),
    fire: (tabId: number, changeInfo: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab = {} as chrome.tabs.Tab) => {
      for (const cb of [...listeners]) cb(tabId, changeInfo, tab);
    },
  };
}

function fakeTabsApi(overrides: Partial<TabsApi> = {}): TabsApi {
  return {
    query: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    update: vi.fn(),
    reload: vi.fn(),
    remove: vi.fn(),
    get: vi.fn(),
    onUpdated: fakeOnUpdated(),
    ...overrides,
  };
}

function getTool(tools: ReturnType<typeof createTabTools>, name: string) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} not found`);
  return tool;
}

describe("tab-tools", () => {
  describe("read_tabs", () => {
    it("lists tabs with id, windowId, title, url and active state across windows", async () => {
      const tabsApi = fakeTabsApi({
        query: vi.fn().mockResolvedValue([
          { id: 1, windowId: 10, title: "First", url: "https://a.example", active: true },
          { id: 2, windowId: 20, title: "Second", url: "https://b.example", active: false },
        ]),
      });
      const tools = createTabTools({ tabsApi });
      const result = await getTool(tools, "read_tabs").execute({}, toolCtx());
      expect(tabsApi.query).toHaveBeenCalledWith({ windowType: "normal" });
      expect(result.content).toContain("Found 2 open tab(s)");
      expect(result.content).toContain("#1 [window 10 (active)]");
      expect(result.content).toContain('"First" <https://a.example>');
      expect(result.content).toContain("#2 [window 20]");
      expect(result.content).toContain('"Second" <https://b.example>');
      expect(result.isError).toBeUndefined();
    });

    it("reports no open tabs when the query resolves empty", async () => {
      const tabsApi = fakeTabsApi({ query: vi.fn().mockResolvedValue([]) });
      const tools = createTabTools({ tabsApi });
      const result = await getTool(tools, "read_tabs").execute({}, toolCtx());
      expect(result.content).toBe("No open tabs found.");
    });

    it("returns an error result when the query rejects", async () => {
      const tabsApi = fakeTabsApi({ query: vi.fn().mockRejectedValue(new Error("boom")) });
      const tools = createTabTools({ tabsApi });
      const result = await getTool(tools, "read_tabs").execute({}, toolCtx());
      expect(result.isError).toBe(true);
      expect(result.content).toContain("Failed to read tabs");
      expect(result.content).toContain("boom");
    });
  });

  describe("open_tab", () => {
    it("opens a tab with the given url and active flag, returning the new tab id", async () => {
      const tabsApi = fakeTabsApi({
        create: vi.fn().mockResolvedValue({ id: 5, url: "https://c.example" }),
      });
      const tools = createTabTools({ tabsApi });
      const result = await getTool(tools, "open_tab").execute(
        { url: "https://c.example", active: false },
        toolCtx(),
      );
      expect(tabsApi.create).toHaveBeenCalledWith({ url: "https://c.example", active: false });
      expect(result.content).toContain("#5");
      expect(result.content).toContain("https://c.example");
    });

    it("defaults active to true when not specified", async () => {
      const tabsApi = fakeTabsApi({
        create: vi.fn().mockResolvedValue({ id: 6, url: "https://d.example" }),
      });
      const tools = createTabTools({ tabsApi });
      await getTool(tools, "open_tab").execute({ url: "https://d.example" }, toolCtx());
      expect(tabsApi.create).toHaveBeenCalledWith({ url: "https://d.example", active: true });
    });

    it("returns an error result when create rejects", async () => {
      const tabsApi = fakeTabsApi({ create: vi.fn().mockRejectedValue(new Error("blocked")) });
      const tools = createTabTools({ tabsApi });
      const result = await getTool(tools, "open_tab").execute({ url: "https://e.example" }, toolCtx());
      expect(result.isError).toBe(true);
      expect(result.content).toContain("Failed to open tab");
      expect(result.content).toContain("blocked");
    });
  });

  describe("navigate_tab", () => {
    it("updates the tab url and reports the resulting url once navigation completes", async () => {
      const onUpdated = fakeOnUpdated();
      const tabsApi = fakeTabsApi({
        onUpdated,
        update: vi.fn().mockImplementation((id: number, props: chrome.tabs.UpdateProperties) => {
          // Chrome fires onUpdated asynchronously, after update() has already
          // resolved. A macrotask guarantees it lands after the tool has had
          // a chance to register its listener.
          setTimeout(() => onUpdated.fire(id, { status: "complete" }, { id, url: props.url } as chrome.tabs.Tab), 0);
          return Promise.resolve({ url: props.url } as chrome.tabs.Tab);
        }),
        get: vi.fn().mockResolvedValue({ id: 3, url: "https://f.example" }),
      });
      const tools = createTabTools({ tabsApi });
      const result = await getTool(tools, "navigate_tab").execute(
        { tabId: 3, url: "https://f.example" },
        toolCtx(),
      );
      expect(tabsApi.update).toHaveBeenCalledWith(3, { url: "https://f.example" });
      expect(result.content).toContain("#3");
      expect(result.content).toContain("https://f.example");
    });

    it("waits for the tab to reach status complete before resolving", async () => {
      const onUpdated = fakeOnUpdated();
      const tabsApi = fakeTabsApi({
        onUpdated,
        update: vi.fn().mockResolvedValue({ url: "https://g.example" }),
        get: vi.fn().mockResolvedValue({ id: 3, url: "https://g.example" }),
      });
      const tools = createTabTools({ tabsApi, navigateCompleteTimeoutMs: 5000 });

      let settled = false;
      const pending = getTool(tools, "navigate_tab")
        .execute({ tabId: 3, url: "https://g.example" }, toolCtx())
        .then((r) => {
          settled = true;
          return r;
        });

      // Flush pending microtasks (update() resolving, listener registration)
      // without letting the 5s timeout race ahead.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      expect(settled).toBe(false);
      expect(onUpdated.addListener).toHaveBeenCalled();

      onUpdated.fire(3, { status: "complete" }, { id: 3, url: "https://g.example" } as chrome.tabs.Tab);
      const result = await pending;
      expect(settled).toBe(true);
      expect(result.content).toContain("#3");
      expect(onUpdated.removeListener).toHaveBeenCalled();
    });

    it("re-fetches the tab after navigation completes, so a stale update() response does not leak into the result", async () => {
      const onUpdated = fakeOnUpdated();
      const tabsApi = fakeTabsApi({
        onUpdated,
        // Simulates the real race: chrome.tabs.update() resolves once
        // navigation STARTS, so its own returned tab can still carry the
        // pre-navigation URL.
        update: vi.fn().mockImplementation((id: number) => {
          setTimeout(() => onUpdated.fire(id, { status: "complete" }, { id, url: "https://new.example" } as chrome.tabs.Tab), 0);
          return Promise.resolve({ url: "https://old.example" });
        }),
        get: vi.fn().mockResolvedValue({ id: 3, url: "https://new.example" }),
      });
      const tools = createTabTools({ tabsApi });
      const result = await getTool(tools, "navigate_tab").execute(
        { tabId: 3, url: "https://new.example" },
        toolCtx(),
      );
      expect(result.content).toContain("https://new.example");
      expect(result.content).not.toContain("https://old.example");
    });

    it("falls back to the requested navigation after a bounded timeout when no complete event arrives", async () => {
      const tabsApi = fakeTabsApi({
        update: vi.fn().mockResolvedValue({ url: "https://h.example" }),
        get: vi.fn().mockResolvedValue({ id: 3, url: "https://h.example" }),
      });
      const tools = createTabTools({ tabsApi, navigateCompleteTimeoutMs: 20 });
      const result = await getTool(tools, "navigate_tab").execute(
        { tabId: 3, url: "https://h.example" },
        toolCtx(),
      );
      expect(result.content).toContain("https://h.example");
      expect(tabsApi.onUpdated.removeListener).toHaveBeenCalled();
    });

    it("returns the browser's own error text for a blocked chrome:// navigation", async () => {
      const tabsApi = fakeTabsApi({
        update: vi.fn().mockRejectedValue(new Error("Cannot navigate to a chrome:// url")),
      });
      const tools = createTabTools({ tabsApi });
      const result = await getTool(tools, "navigate_tab").execute(
        { tabId: 3, url: "chrome://extensions" },
        toolCtx(),
      );
      expect(result.isError).toBe(true);
      expect(result.content).toContain("Cannot navigate to a chrome:// url");
    });

    it("returns a clear error naming the id for an unknown tab", async () => {
      const tabsApi = fakeTabsApi({
        update: vi.fn().mockRejectedValue(new Error("No tab with id: 999")),
      });
      const tools = createTabTools({ tabsApi });
      const result = await getTool(tools, "navigate_tab").execute(
        { tabId: 999, url: "https://g.example" },
        toolCtx(),
      );
      expect(result.isError).toBe(true);
      expect(result.content).toContain("#999");
      expect(result.content).toContain("No tab with id: 999");
    });
  });

  describe("refresh_tab", () => {
    it("reloads the tab, passing bypassCache through", async () => {
      const tabsApi = fakeTabsApi({ reload: vi.fn().mockResolvedValue(undefined) });
      const tools = createTabTools({ tabsApi });
      const result = await getTool(tools, "refresh_tab").execute(
        { tabId: 4, bypassCache: true },
        toolCtx(),
      );
      expect(tabsApi.reload).toHaveBeenCalledWith(4, { bypassCache: true });
      expect(result.content).toContain("#4");
      expect(result.content).toContain("bypassing cache");
    });

    it("defaults bypassCache to false", async () => {
      const tabsApi = fakeTabsApi({ reload: vi.fn().mockResolvedValue(undefined) });
      const tools = createTabTools({ tabsApi });
      await getTool(tools, "refresh_tab").execute({ tabId: 4 }, toolCtx());
      expect(tabsApi.reload).toHaveBeenCalledWith(4, { bypassCache: false });
    });

    it("returns a clear error naming the id when reload rejects", async () => {
      const tabsApi = fakeTabsApi({
        reload: vi.fn().mockRejectedValue(new Error("No tab with id: 4")),
      });
      const tools = createTabTools({ tabsApi });
      const result = await getTool(tools, "refresh_tab").execute({ tabId: 4 }, toolCtx());
      expect(result.isError).toBe(true);
      expect(result.content).toContain("#4");
      expect(result.content).toContain("No tab with id: 4");
    });
  });

  describe("close_tab", () => {
    it("returns an error and does not call confirmInteraction when the tab does not exist", async () => {
      const confirmInteraction = vi.fn();
      const tabsApi = fakeTabsApi({ get: vi.fn().mockRejectedValue(new Error("No tab with id: 8")) });
      const tools = createTabTools({ tabsApi, confirmInteraction });
      const result = await getTool(tools, "close_tab").execute({ tabId: 8 }, toolCtx());
      expect(confirmInteraction).not.toHaveBeenCalled();
      expect(tabsApi.remove).not.toHaveBeenCalled();
      expect(result.isError).toBe(true);
      expect(result.content).toContain("#8");
      expect(result.content).toContain("not found");
    });

    it("calls confirmInteraction naming the tab before removing it", async () => {
      const confirmInteraction = vi.fn().mockResolvedValue(true);
      const tabsApi = fakeTabsApi({
        get: vi.fn().mockResolvedValue({ id: 9, title: "My Tab", url: "https://h.example" }),
        remove: vi.fn().mockResolvedValue(undefined),
      });
      const tools = createTabTools({ tabsApi, confirmInteraction });
      const result = await getTool(tools, "close_tab").execute({ tabId: 9 }, toolCtx());

      expect(confirmInteraction).toHaveBeenCalledWith(
        expect.objectContaining({ action: "close tab", name: "My Tab" }),
      );
      expect(tabsApi.remove).toHaveBeenCalledWith(9);
      expect(result.content).toContain("Closed tab #9");
      expect(result.content).toContain("My Tab");
      expect(result.isError).toBeUndefined();
    });

    it("does not call remove and returns a decline message when confirmInteraction resolves false", async () => {
      const confirmInteraction = vi.fn().mockResolvedValue(false);
      const tabsApi = fakeTabsApi({
        get: vi.fn().mockResolvedValue({ id: 9, title: "My Tab", url: "https://h.example" }),
        remove: vi.fn(),
      });
      const tools = createTabTools({ tabsApi, confirmInteraction });
      const result = await getTool(tools, "close_tab").execute({ tabId: 9 }, toolCtx());

      expect(tabsApi.remove).not.toHaveBeenCalled();
      expect(result.isError).toBe(true);
      expect(result.content).toContain("declined");
      expect(result.content).toContain("My Tab");
    });

    it("proceeds straight to remove when confirmInteraction is not wired", async () => {
      const tabsApi = fakeTabsApi({
        get: vi.fn().mockResolvedValue({ id: 9, title: "My Tab", url: "https://h.example" }),
        remove: vi.fn().mockResolvedValue(undefined),
      });
      const tools = createTabTools({ tabsApi });
      const result = await getTool(tools, "close_tab").execute({ tabId: 9 }, toolCtx());

      expect(tabsApi.remove).toHaveBeenCalledWith(9);
      expect(result.content).toContain("Closed tab #9");
    });

    it("returns an error when remove rejects after confirmation", async () => {
      const confirmInteraction = vi.fn().mockResolvedValue(true);
      const tabsApi = fakeTabsApi({
        get: vi.fn().mockResolvedValue({ id: 9, title: "My Tab", url: "https://h.example" }),
        remove: vi.fn().mockRejectedValue(new Error("gone")),
      });
      const tools = createTabTools({ tabsApi, confirmInteraction });
      const result = await getTool(tools, "close_tab").execute({ tabId: 9 }, toolCtx());
      expect(result.isError).toBe(true);
      expect(result.content).toContain("Failed to remove tab #9");
    });
  });

  describe("tabTools", () => {
    it("returns a ToolProvider named tab-tools, not required, resolving 5 tools", async () => {
      const providers = tabTools();
      expect(providers).toHaveLength(1);
      expect(providers[0].name).toBe("tab-tools");
      expect(providers[0].required).toBe(false);
      const loaded = await providers[0].load();
      expect(loaded).toHaveLength(5);
      expect(loaded.map((t) => t.name).sort()).toEqual(
        ["close_tab", "navigate_tab", "open_tab", "read_tabs", "refresh_tab"],
      );
    });
  });
});
