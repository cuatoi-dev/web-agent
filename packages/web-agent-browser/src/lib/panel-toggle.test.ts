import { describe, it, expect, vi } from "vitest";
import { resolveTabState, toggleTab, toggleView, type TabState } from "./panel-toggle";

describe("panel-toggle", () => {
  describe("resolveTabState", () => {
    it("returns null when query resolves to an empty array without calling send", async () => {
      const query = vi.fn().mockResolvedValue([]);
      const send = vi.fn();
      const res = await resolveTabState(query, send);
      expect(res).toBeNull();
      expect(send).not.toHaveBeenCalled();
    });

    it("returns null when the single tab has no id", async () => {
      const query = vi.fn().mockResolvedValue([{}]);
      const send = vi.fn();
      const res = await resolveTabState(query, send);
      expect(res).toBeNull();
      expect(send).not.toHaveBeenCalled();
    });

    it("returns null and does not propagate rejection when send rejects", async () => {
      const query = vi.fn().mockResolvedValue([{ id: 42 }]);
      const send = vi.fn().mockRejectedValue(new Error("Could not establish connection"));
      const res = await resolveTabState(query, send);
      expect(res).toBeNull();
    });

    it("returns null when send resolves with undefined or non-string origin", async () => {
      const query = vi.fn().mockResolvedValue([{ id: 42 }]);
      const send1 = vi.fn().mockResolvedValue(undefined);
      expect(await resolveTabState(query, send1)).toBeNull();

      const send2 = vi.fn().mockResolvedValue({ origin: 123, mounted: true });
      expect(await resolveTabState(query, send2)).toBeNull();
    });

    it("maps a good reply and calls send with correct arguments", async () => {
      const query = vi.fn().mockResolvedValue([{ id: 7 }]);
      const send = vi.fn().mockResolvedValue({
        origin: "https://example.com",
        mounted: true,
        foreign: false,
      });
      const res = await resolveTabState(query, send);
      expect(res).toEqual({
        tabId: 7,
        origin: "https://example.com",
        mounted: true,
        foreign: false,
      });
      expect(send).toHaveBeenCalledWith(7, { type: "wa-state" });
    });

    it("coerces truthy/falsy mounted and foreign values to booleans", async () => {
      const query = vi.fn().mockResolvedValue([{ id: 10 }]);
      const send = vi.fn().mockResolvedValue({
        origin: "https://example.com",
        mounted: 1,
        foreign: 0,
      });
      const res = await resolveTabState(query, send);
      expect(res).toEqual({
        tabId: 10,
        origin: "https://example.com",
        mounted: true,
        foreign: false,
      });
    });
  });

  describe("toggleTab", () => {
    it("sends wa-toggle message to tabId and returns reported state", async () => {
      const initial: TabState = {
        tabId: 12,
        origin: "https://example.com",
        mounted: false,
        foreign: false,
      };
      const send = vi.fn().mockResolvedValue({
        origin: "https://example.com",
        mounted: true,
        foreign: false,
      });
      const res = await toggleTab(send, initial);
      expect(send).toHaveBeenCalledWith(12, { type: "wa-toggle" });
      expect(res).toEqual({
        tabId: 12,
        origin: "https://example.com",
        mounted: true,
        foreign: false,
      });
    });

    it("returns unchanged input state when send rejects", async () => {
      const initial: TabState = {
        tabId: 12,
        origin: "https://example.com",
        mounted: false,
        foreign: false,
      };
      const send = vi.fn().mockRejectedValue(new Error("Tab closed"));
      const res = await toggleTab(send, initial);
      expect(res).toEqual(initial);
    });
  });

  describe("toggleView", () => {
    it("returns disabled view with prompt to open a website when state is null", () => {
      const view = toggleView(null);
      expect(view.disabled).toBe(true);
      expect(view.pressed).toBe(false);
      expect(view.status).toContain("Open a website in a tab to use this control");
    });

    it("returns enabled pressed view when mounted is true", () => {
      const view = toggleView({
        tabId: 1,
        origin: "https://cat-store.example",
        mounted: true,
        foreign: false,
      });
      expect(view.disabled).toBe(false);
      expect(view.pressed).toBe(true);
      expect(view.label).toBe("Turn off the agent in this tab");
      expect(view.status).toContain("https://cat-store.example");
    });

    it("returns disabled unpressed view when foreign is true and not mounted", () => {
      const view = toggleView({
        tabId: 1,
        origin: "https://native-agent.example",
        mounted: false,
        foreign: true,
      });
      expect(view.disabled).toBe(true);
      expect(view.pressed).toBe(false);
      expect(view.label).toBe("Turn on the agent in this tab");
      expect(view.status).toContain("already has its own agent");
    });

    it("returns enabled unpressed view when mounted is false and foreign is false", () => {
      const view = toggleView({
        tabId: 1,
        origin: "https://plain.example",
        mounted: false,
        foreign: false,
      });
      expect(view.disabled).toBe(false);
      expect(view.pressed).toBe(false);
      expect(view.label).toBe("Turn on the agent in this tab");
      expect(view.status).toContain("https://plain.example");
    });

    it("mounted true wins over foreign true so a mounted bubble can always be turned off", () => {
      const view = toggleView({
        tabId: 1,
        origin: "https://both.example",
        mounted: true,
        foreign: true,
      });
      expect(view.disabled).toBe(false);
      expect(view.pressed).toBe(true);
      expect(view.label).toBe("Turn off the agent in this tab");
    });

    it("ensures state is legible without colour by having differing label strings between mounted and unmounted", () => {
      const on = toggleView({ tabId: 1, origin: "https://a.com", mounted: true, foreign: false });
      const off = toggleView({ tabId: 1, origin: "https://a.com", mounted: false, foreign: false });
      expect(on.label).not.toBe(off.label);
    });
  });
});
