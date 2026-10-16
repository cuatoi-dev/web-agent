import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createTabStateActions,
  watchActiveTab,
  type EventSource,
} from "./tab-state-sync";
import { toggleView, type TabState } from "./panel-toggle";
import { mountPageAgentIcon, paintPageAgentIcon } from "./page-agent-icon";

function createFakeEventSource<F>(): {
  source: EventSource<F>;
  listeners: Set<F>;
} {
  const listeners = new Set<F>();
  return {
    source: {
      addListener: (l: F) => {
        listeners.add(l);
      },
      removeListener: (l: F) => {
        listeners.delete(l);
      },
    },
    listeners,
  };
}

function createFakeTabEventSources() {
  const onActivated = createFakeEventSource<(info: { tabId: number; windowId: number }) => void>();
  const onUpdated = createFakeEventSource<(
    tabId: number,
    changeInfo: { status?: string; url?: string },
    tab: { active?: boolean; windowId?: number },
  ) => void>();
  const onFocusChanged = createFakeEventSource<(windowId: number) => void>();

  return {
    events: {
      onActivated: onActivated.source,
      onUpdated: onUpdated.source,
      onFocusChanged: onFocusChanged.source,
    },
    sources: {
      onActivated,
      onUpdated,
      onFocusChanged,
    },
  };
}

describe("tab-state-sync", () => {
  let button: HTMLButtonElement;
  let lastApplied: TabState | null;

  beforeEach(() => {
    button = document.createElement("button");
    mountPageAgentIcon(button);
    lastApplied = null;
  });

  const makeApply = () => (state: TabState | null) => {
    lastApplied = state;
    paintPageAgentIcon(button, toggleView(state));
  };

  describe("watcher and actions integration", () => {
    let disposeWatcher: (() => void) | undefined;

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      if (disposeWatcher) {
        disposeWatcher();
        disposeWatcher = undefined;
      }
      vi.restoreAllMocks();
      vi.useRealTimers();
    });

    it("1. Activation changes the painted tab", async () => {
      let currentTabId = 11;
      const query = vi.fn().mockImplementation((info: { active: true; currentWindow: true }) => {
        expect(info).toEqual({ active: true, currentWindow: true });
        return Promise.resolve([{ id: currentTabId }]);
      });
      const send = vi.fn().mockImplementation((tabId: number, msg: { type: string }) => {
        if (msg.type === "wa-state") {
          return Promise.resolve({
            origin: tabId === 11 ? "https://a.example.com" : "https://b.example.com",
            mounted: false,
            foreign: false,
          });
        }
        return Promise.resolve({});
      });

      const actions = createTabStateActions({ query, send, apply: makeApply() });
      const fakes = createFakeTabEventSources();
      disposeWatcher = watchActiveTab({
        events: fakes.events,
        getPanelWindowId: () => Promise.resolve(7),
        refresh: actions.refresh,
      });
      await Promise.resolve();

      await actions.refresh();
      expect(button.title).toContain("https://a.example.com");
      expect(button.getAttribute("aria-label")).toContain("https://a.example.com");

      // Change active tab to 22
      currentTabId = 22;
      const queryCountBefore = query.mock.calls.length;

      // Fire onActivated for tab 22
      for (const l of fakes.sources.onActivated.listeners) {
        l({ tabId: 22, windowId: 7 });
      }

      await vi.advanceTimersByTimeAsync(99);
      expect(query.mock.calls.length).toBe(queryCountBefore);

      await vi.advanceTimersByTimeAsync(1);
      expect(query).toHaveBeenLastCalledWith({ active: true, currentWindow: true });
      expect(send).toHaveBeenCalledWith(22, { type: "wa-state" });
      expect(button.title).toContain("https://b.example.com");
      expect(button.title).not.toContain("https://a.example.com");
      expect(button.getAttribute("aria-label")).toContain("https://b.example.com");
      expect(button.getAttribute("aria-label")).not.toContain("https://a.example.com");
    });

    it("2. Complete recovers from null", async () => {
      let currentTabs: { id?: number }[] = [];
      const query = vi.fn().mockImplementation(() => Promise.resolve(currentTabs));
      const send = vi.fn().mockImplementation(() => Promise.resolve({
        origin: "https://b.example.com",
        mounted: false,
        foreign: false,
      }));

      const actions = createTabStateActions({ query, send, apply: makeApply() });
      const fakes = createFakeTabEventSources();
      disposeWatcher = watchActiveTab({
        events: fakes.events,
        getPanelWindowId: () => Promise.resolve(7),
        refresh: actions.refresh,
      });
      await Promise.resolve();

      // Initial query returns no tab -> disabled
      await actions.refresh();
      expect(button.disabled).toBe(true);
      expect(lastApplied).toBeNull();

      // Return id 22 and nonforeign, unmounted state
      currentTabs = [{ id: 22 }];

      for (const l of fakes.sources.onUpdated.listeners) {
        l(22, { status: "complete" }, { active: true, windowId: 7 });
      }

      await vi.advanceTimersByTimeAsync(100);
      expect(button.disabled).toBe(false);
      expect(button.getAttribute("aria-pressed")).toBe("false");
      expect(toggleView(lastApplied).disabled).toBe(false);
    });

    it("3. Update filtering: negative and positive cases", async () => {
      const refresh = vi.fn().mockResolvedValue(undefined);
      const fakes = createFakeTabEventSources();

      disposeWatcher = watchActiveTab({
        events: fakes.events,
        getPanelWindowId: () => Promise.resolve(7),
        refresh,
      });
      await Promise.resolve();

      const emit = (changeInfo: { status?: string; url?: string }, tab: { active?: boolean; windowId?: number }) => {
        for (const l of fakes.sources.onUpdated.listeners) {
          l(22, changeInfo, tab);
        }
      };

      // Negative cases:
      // inactive false
      emit({ status: "complete" }, { active: false, windowId: 7 });
      await vi.advanceTimersByTimeAsync(100);
      expect(refresh).not.toHaveBeenCalled();

      // missing active
      emit({ status: "complete" }, { windowId: 7 });
      await vi.advanceTimersByTimeAsync(100);
      expect(refresh).not.toHaveBeenCalled();

      // other window id
      emit({ status: "complete" }, { active: true, windowId: 8 });
      await vi.advanceTimersByTimeAsync(100);
      expect(refresh).not.toHaveBeenCalled();

      // missing window id after panel id is known
      emit({ status: "complete" }, { active: true });
      await vi.advanceTimersByTimeAsync(100);
      expect(refresh).not.toHaveBeenCalled();

      // empty change info
      emit({}, { active: true, windowId: 7 });
      await vi.advanceTimersByTimeAsync(100);
      expect(refresh).not.toHaveBeenCalled();

      // status: "loading" without a URL
      emit({ status: "loading" }, { active: true, windowId: 7 });
      await vi.advanceTimersByTimeAsync(100);
      expect(refresh).not.toHaveBeenCalled();

      // Positive cases:
      // 1. complete
      emit({ status: "complete" }, { active: true, windowId: 7 });
      await vi.advanceTimersByTimeAsync(100);
      expect(refresh).toHaveBeenCalledTimes(1);

      // 2. URL-only
      emit({ url: "https://example.com/2" }, { active: true, windowId: 7 });
      await vi.advanceTimersByTimeAsync(100);
      expect(refresh).toHaveBeenCalledTimes(2);

      // 3. URL plus loading
      emit({ status: "loading", url: "https://example.com/3" }, { active: true, windowId: 7 });
      await vi.advanceTimersByTimeAsync(100);
      expect(refresh).toHaveBeenCalledTimes(3);
    });

    it("4. Window lookup fallback", async () => {
      // 4a. While lookup is pending
      const refresh = vi.fn().mockResolvedValue(undefined);
      const fakes = createFakeTabEventSources();
      let resolveLookup!: (id: number | undefined) => void;
      const pendingLookup = new Promise<number | undefined>((res) => {
        resolveLookup = res;
      });

      const d1 = watchActiveTab({
        events: fakes.events,
        getPanelWindowId: () => pendingLookup,
        refresh,
      });

      // Update in another window while lookup is pending still schedules
      for (const l of fakes.sources.onUpdated.listeners) {
        l(10, { status: "complete" }, { active: true, windowId: 8 });
      }
      await vi.advanceTimersByTimeAsync(100);
      expect(refresh).toHaveBeenCalledTimes(1);

      // Once lookup resolves to 7, updates from window 8 do not schedule
      resolveLookup(7);
      await Promise.resolve();

      for (const l of fakes.sources.onUpdated.listeners) {
        l(10, { status: "complete" }, { active: true, windowId: 8 });
      }
      await vi.advanceTimersByTimeAsync(100);
      expect(refresh).toHaveBeenCalledTimes(1);
      d1();

      // 4b. With undefined result
      const refresh2 = vi.fn().mockResolvedValue(undefined);
      const fakes2 = createFakeTabEventSources();
      const d2 = watchActiveTab({
        events: fakes2.events,
        getPanelWindowId: () => Promise.resolve(undefined),
        refresh: refresh2,
      });
      await Promise.resolve();

      for (const l of fakes2.sources.onUpdated.listeners) {
        l(10, { status: "complete" }, { active: true, windowId: 8 });
      }
      await vi.advanceTimersByTimeAsync(100);
      expect(refresh2).toHaveBeenCalledTimes(1);
      d2();

      // 4c. With rejected lookup
      const refresh3 = vi.fn().mockResolvedValue(undefined);
      const fakes3 = createFakeTabEventSources();
      const d3 = watchActiveTab({
        events: fakes3.events,
        getPanelWindowId: () => Promise.reject(new Error("Window not found")),
        refresh: refresh3,
      });
      await Promise.resolve();

      for (const l of fakes3.sources.onUpdated.listeners) {
        l(10, { status: "complete" }, { active: true, windowId: 8 });
      }
      await vi.advanceTimersByTimeAsync(100);
      expect(refresh3).toHaveBeenCalledTimes(1);
      d3();
    });

    it("5. Focus and activation are unconditional", async () => {
      const query = vi.fn().mockResolvedValue([{ id: 11 }]);
      const send = vi.fn().mockResolvedValue({
        origin: "https://panel-tab.example.com",
        mounted: false,
        foreign: false,
      });
      const actions = createTabStateActions({ query, send, apply: makeApply() });
      const fakes = createFakeTabEventSources();

      disposeWatcher = watchActiveTab({
        events: fakes.events,
        getPanelWindowId: () => Promise.resolve(7),
        refresh: actions.refresh,
      });
      await Promise.resolve();

      // Activation from window 8 schedules
      for (const l of fakes.sources.onActivated.listeners) {
        l({ tabId: 99, windowId: 8 });
      }
      await vi.advanceTimersByTimeAsync(100);
      expect(query).toHaveBeenCalledWith({ active: true, currentWindow: true });
      expect(button.title).toContain("https://panel-tab.example.com");

      // Focus ids 7, 8, -1 each schedule in isolated cases
      for (const focusWinId of [7, 8, -1]) {
        query.mockClear();
        for (const l of fakes.sources.onFocusChanged.listeners) {
          l(focusWinId);
        }
        await vi.advanceTimersByTimeAsync(100);
        expect(query).toHaveBeenCalledTimes(1);
        expect(query).toHaveBeenCalledWith({ active: true, currentWindow: true });
      }
    });

    it("6. Trailing debounce: five mixed events coalesce, custom debounceMs works", async () => {
      const refresh = vi.fn().mockResolvedValue(undefined);
      const fakes = createFakeTabEventSources();

      disposeWatcher = watchActiveTab({
        events: fakes.events,
        getPanelWindowId: () => Promise.resolve(7),
        refresh,
      });
      await Promise.resolve();

      // Emit five events at 0, 20, 40, 60, 80 ms
      const fireActivated = () => {
        for (const l of fakes.sources.onActivated.listeners) l({ tabId: 1, windowId: 7 });
      };
      const fireFocus = () => {
        for (const l of fakes.sources.onFocusChanged.listeners) l(7);
      };
      const fireUpdated = () => {
        for (const l of fakes.sources.onUpdated.listeners) {
          l(1, { status: "complete" }, { active: true, windowId: 7 });
        }
      };

      // t = 0
      fireActivated();
      // t = 20
      await vi.advanceTimersByTimeAsync(20);
      fireFocus();
      // t = 40
      await vi.advanceTimersByTimeAsync(20);
      fireUpdated();
      // t = 60
      await vi.advanceTimersByTimeAsync(20);
      fireActivated();
      // t = 80
      await vi.advanceTimersByTimeAsync(20);
      fireFocus();

      // At t = 179 ms (which is 99 ms after 80 ms): no refresh yet
      await vi.advanceTimersByTimeAsync(99);
      expect(refresh).not.toHaveBeenCalled();

      // At t = 180 ms (100 ms after 80 ms): exactly 1 refresh
      await vi.advanceTimersByTimeAsync(1);
      expect(refresh).toHaveBeenCalledTimes(1);

      // A subsequent event after that causes a second refresh
      await vi.advanceTimersByTimeAsync(50);
      fireActivated();
      await vi.advanceTimersByTimeAsync(100);
      expect(refresh).toHaveBeenCalledTimes(2);

      // Custom debounceMs: 25
      const refreshCustom = vi.fn().mockResolvedValue(undefined);
      const fakesCustom = createFakeTabEventSources();
      const dCustom = watchActiveTab({
        events: fakesCustom.events,
        getPanelWindowId: () => Promise.resolve(7),
        refresh: refreshCustom,
        debounceMs: 25,
      });
      for (const l of fakesCustom.sources.onActivated.listeners) l({ tabId: 1, windowId: 7 });
      await vi.advanceTimersByTimeAsync(24);
      expect(refreshCustom).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(refreshCustom).toHaveBeenCalledTimes(1);
      dCustom();
    });

    it("7. Disposal removes all listeners, cancels timer, prevents late scheduling, is idempotent", async () => {
      const refresh = vi.fn().mockResolvedValue(undefined);
      const fakes = createFakeTabEventSources();

      const d = watchActiveTab({
        events: fakes.events,
        getPanelWindowId: () => Promise.resolve(7),
        refresh,
      });

      // Capture function identities
      expect(fakes.sources.onActivated.listeners.size).toBe(1);
      expect(fakes.sources.onUpdated.listeners.size).toBe(1);
      expect(fakes.sources.onFocusChanged.listeners.size).toBe(1);
      const [actListener] = Array.from(fakes.sources.onActivated.listeners);
      const [updListener] = Array.from(fakes.sources.onUpdated.listeners);
      const [focListener] = Array.from(fakes.sources.onFocusChanged.listeners);

      // Schedule a refresh
      actListener({ tabId: 1, windowId: 7 });

      // Dispose before deadline
      d();

      // All listener sets are empty
      expect(fakes.sources.onActivated.listeners.size).toBe(0);
      expect(fakes.sources.onUpdated.listeners.size).toBe(0);
      expect(fakes.sources.onFocusChanged.listeners.size).toBe(0);

      // Advancing time yields zero refreshes
      await vi.advanceTimersByTimeAsync(200);
      expect(refresh).not.toHaveBeenCalled();

      // Invoke previously captured callbacks after disposal: cannot schedule
      actListener({ tabId: 1, windowId: 7 });
      updListener(1, { status: "complete" }, { active: true, windowId: 7 });
      focListener(7);
      await vi.advanceTimersByTimeAsync(200);
      expect(refresh).not.toHaveBeenCalled();

      // Dispose twice without exception
      expect(() => d()).not.toThrow();
    });
  });

  describe("actions: click and refresh sequencing", () => {
    it("8. Click re-resolves and orders messages, targets fresh id, updates dot", async () => {
      let currentTabId = 11;
      const messages: { tabId: number; type: string }[] = [];
      const query = vi.fn().mockImplementation(() => Promise.resolve([{ id: currentTabId }]));
      const send = vi.fn().mockImplementation((tabId: number, msg: { type: string }) => {
        messages.push({ tabId, type: msg.type });
        if (msg.type === "wa-state") {
          return Promise.resolve({
            origin: tabId === 11 ? "https://a.example.com" : "https://b.example.com",
            mounted: false,
            foreign: false,
          });
        }
        if (msg.type === "wa-toggle") {
          return Promise.resolve({
            origin: "https://b.example.com",
            mounted: true,
            foreign: false,
          });
        }
        return Promise.resolve({});
      });

      const actions = createTabStateActions({ query, send, apply: makeApply() });

      // Paint A via refresh
      await actions.refresh();
      expect(button.title).toContain("https://a.example.com");

      // Change query to B
      currentTabId = 22;
      messages.length = 0;

      await actions.toggleCurrent();
      expect(messages).toEqual([
        { tabId: 22, type: "wa-state" },
        { tabId: 22, type: "wa-toggle" },
      ]);
      expect(button.getAttribute("aria-pressed")).toBe("true");
      expect(button.disabled).toBe(false);
      expect(button.title).toContain("https://b.example.com");
      const dot = button.querySelector<HTMLElement>(".dot");
      expect(dot?.hidden).toBe(false);

      // Exercise stored null state with a valid fresh B result
      lastApplied = null;
      paintPageAgentIcon(button, toggleView(null));
      expect(button.disabled).toBe(true);

      await actions.toggleCurrent();
      expect(button.disabled).toBe(false);
      expect(button.title).toContain("https://b.example.com");
    });

    it("9. Click resolves null or handles toggle errors", async () => {
      let currentTabs: { id?: number }[] = [{ id: 11 }];
      const send = vi.fn().mockImplementation((_tabId: number, msg: { type: string }) => {
        if (msg.type === "wa-state") {
          return Promise.resolve({ origin: "https://a.example.com", mounted: false, foreign: false });
        }
        return Promise.resolve({});
      });
      const query = vi.fn().mockImplementation(() => Promise.resolve(currentTabs));
      const actions = createTabStateActions({ query, send, apply: makeApply() });

      // Begin with A painted
      await actions.refresh();
      expect(button.disabled).toBe(false);

      // Return no tab -> await toggleCurrent -> disabled, no toggle sent
      currentTabs = [];
      send.mockClear();
      await actions.toggleCurrent();
      expect(button.disabled).toBe(true);
      expect(lastApplied).toBeNull();
      expect(send).not.toHaveBeenCalled();

      // Repeat with rejected state-message send: resolver returns null
      currentTabs = [{ id: 22 }];
      send.mockRejectedValueOnce(new Error("State message failed"));
      await actions.toggleCurrent();
      expect(button.disabled).toBe(true);
      expect(lastApplied).toBeNull();

      // Rejected toggle-message send retains fresh B state per real toggleTab contract
      send.mockImplementation((_tabId: number, msg: { type: string }) => {
        if (msg.type === "wa-state") {
          return Promise.resolve({ origin: "https://b.example.com", mounted: false, foreign: false });
        }
        if (msg.type === "wa-toggle") {
          return Promise.reject(new Error("Toggle message failed"));
        }
        return Promise.resolve({});
      });
      await actions.toggleCurrent();
      expect(button.disabled).toBe(false);
      expect(lastApplied?.origin).toBe("https://b.example.com");
      expect(button.title).toContain("https://b.example.com");
    });

    it("10. Newest refresh wins and sequences are independent across factory instances", async () => {
      type Deferred<T> = {
        promise: Promise<T>;
        resolve: (val: T) => void;
      };
      const makeDeferred = <T>(): Deferred<T> => {
        let resolve!: (val: T) => void;
        const promise = new Promise<T>((res) => {
          resolve = res;
        });
        return { promise, resolve };
      };

      const deferredA = makeDeferred<unknown>();
      const deferredB = makeDeferred<unknown>();

      let targetDeferred = deferredA;
      let targetTabId = 11;
      const query = vi.fn().mockImplementation(() => Promise.resolve([{ id: targetTabId }]));
      const send = vi.fn().mockImplementation(() => targetDeferred.promise);

      const actions = createTabStateActions({ query, send, apply: makeApply() });

      // Start refresh A
      targetTabId = 11;
      targetDeferred = deferredA;
      const promiseA = actions.refresh();

      // Start refresh B
      targetTabId = 22;
      targetDeferred = deferredB;
      const promiseB = actions.refresh();

      // Resolve B first, then A
      deferredB.resolve({
        origin: "https://b.example.com",
        mounted: false,
        foreign: false,
      });
      await promiseB;
      expect(button.title).toContain("https://b.example.com");

      deferredA.resolve({
        origin: "https://a.example.com",
        mounted: false,
        foreign: false,
      });
      await promiseA;

      // Assert only B is applied and its icon remains painted after both promises settle
      expect(button.title).toContain("https://b.example.com");
      expect(button.title).not.toContain("https://a.example.com");
      expect(lastApplied?.origin).toBe("https://b.example.com");

      // Repeat with B resolving null: late A cannot re-enable button
      const defA2 = makeDeferred<unknown>();
      const defB2 = makeDeferred<unknown>();
      targetDeferred = defA2;
      const pA2 = actions.refresh();

      targetDeferred = defB2;
      const pB2 = actions.refresh();

      // B resolves null (e.g. no origin)
      defB2.resolve(undefined);
      await pB2;
      expect(button.disabled).toBe(true);

      // A resolves valid
      defA2.resolve({
        origin: "https://a.example.com",
        mounted: false,
        foreign: false,
      });
      await pA2;
      // Late A dropped, button stays disabled
      expect(button.disabled).toBe(true);

      // Test independent factory instances so a sequence in one cannot suppress the other
      const applyInst1 = vi.fn();
      const applyInst2 = vi.fn();
      const inst1 = createTabStateActions({
        query: vi.fn().mockResolvedValue([{ id: 1 }]),
        send: vi.fn().mockResolvedValue({ origin: "https://inst1.com", mounted: false, foreign: false }),
        apply: applyInst1,
      });
      const inst2 = createTabStateActions({
        query: vi.fn().mockResolvedValue([{ id: 2 }]),
        send: vi.fn().mockResolvedValue({ origin: "https://inst2.com", mounted: false, foreign: false }),
        apply: applyInst2,
      });

      await inst1.refresh();
      await inst2.refresh();
      expect(applyInst1).toHaveBeenCalledWith(
        expect.objectContaining({ origin: "https://inst1.com" }),
      );
      expect(applyInst2).toHaveBeenCalledWith(
        expect.objectContaining({ origin: "https://inst2.com" }),
      );
    });

    it("11. Pending refresh cannot overwrite newer toggleCurrent result", async () => {
      type Deferred<T> = {
        promise: Promise<T>;
        resolve: (val: T) => void;
      };
      const makeDeferred = <T>(): Deferred<T> => {
        let resolve!: (val: T) => void;
        const promise = new Promise<T>((res) => {
          resolve = res;
        });
        return { promise, resolve };
      };

      const pendingRefreshDeferred = makeDeferred<unknown>();
      const query = vi.fn().mockResolvedValue([{ id: 11 }]);
      let stateCallCount = 0;
      const send = vi.fn().mockImplementation((_tabId: number, msg: { type: string }) => {
        if (msg.type === "wa-state") {
          stateCallCount++;
          if (stateCallCount === 1) {
            return pendingRefreshDeferred.promise;
          }
          return Promise.resolve({ origin: "https://example.com", mounted: false, foreign: false });
        }
        if (msg.type === "wa-toggle") {
          return Promise.resolve({ origin: "https://example.com", mounted: true, foreign: false });
        }
        return Promise.resolve({});
      });

      const actions = createTabStateActions({ query, send, apply: makeApply() });

      // Start a refresh whose send stays pending
      const refreshPromise = actions.refresh();

      // Run toggleCurrent() to completion (state "on")
      await actions.toggleCurrent();
      expect(lastApplied?.mounted).toBe(true);
      expect(button.getAttribute("aria-pressed")).toBe("true");

      // Resolve the pending refresh with "off"
      pendingRefreshDeferred.resolve({
        origin: "https://example.com",
        mounted: false,
        foreign: false,
      });
      await refreshPromise;

      // Assert that the painted icon is still "on"
      expect(lastApplied?.mounted).toBe(true);
      expect(button.getAttribute("aria-pressed")).toBe("true");
    });
  });
});
