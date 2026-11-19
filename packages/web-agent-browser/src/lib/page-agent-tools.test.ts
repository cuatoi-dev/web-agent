import { describe, it, expect, vi } from "vitest";
import type { ToolContext } from "@cuatoi/web-agent-core";
import {
  createPageAgentTools,
  pageAgentTools,
  type PageAgentApi,
} from "./page-agent-tools";
import { MOUNT_PROBE_INTERVAL_MS, MOUNT_READY_TIMEOUT_MS } from "./constants";

/** The minimum ToolContext the tools under test read. `app` and `signal` are
 *  the interface's only required fields (web-agent-core tool-hooks.types.ts);
 *  none of these tools touches the optional ones. */
function toolCtx(): ToolContext {
  return { app: {}, signal: new AbortController().signal };
}

function fakePageAgentApi(overrides: Partial<PageAgentApi> = {}): PageAgentApi {
  return {
    query: vi.fn().mockResolvedValue([]),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function getTool(tools: ReturnType<typeof createPageAgentTools>, name: string) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} not found`);
  return tool;
}

/** One fake that answers each message type differently, so a test can
 *  script "the send says not mounted, the probe says mounted". */
function replyByType(replies: Record<string, unknown>) {
  const counts: Record<string, number> = {};
  return vi.fn((_tabId: number, message: { type: string }): Promise<unknown> => {
    const scripted = replies[message.type];
    if (Array.isArray(scripted)) {
      const i = counts[message.type] ?? 0;
      counts[message.type] = i + 1;
      return Promise.resolve(scripted[Math.min(i, scripted.length - 1)]);
    }
    return Promise.resolve(scripted);
  });
}

describe("page-agent-tools", () => {
  describe("send_to_page_agent", () => {
    it("resolves the active tab when no tabId is given", async () => {
      const api = fakePageAgentApi({
        query: vi.fn().mockResolvedValue([{ id: 7, active: true, currentWindow: true }]),
        sendMessage: vi.fn().mockResolvedValue({
          origin: "https://x.example",
          mounted: true,
          delivered: true,
        }),
      });
      const tools = createPageAgentTools({ pageAgentApi: api });
      const result = await getTool(tools, "send_to_page_agent").execute({ text: "hello" }, toolCtx());
      expect(api.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
      expect(api.sendMessage).toHaveBeenCalledWith(7, { type: "wa-send", text: "hello" });
      expect(result.content).toContain("https://x.example");
      expect(result.isError).toBeFalsy();
    });

    it("uses the given tabId and never queries", async () => {
      const api = fakePageAgentApi({
        sendMessage: vi.fn().mockResolvedValue({
          origin: "https://x.example",
          mounted: true,
          delivered: true,
        }),
      });
      const tools = createPageAgentTools({ pageAgentApi: api });
      await getTool(tools, "send_to_page_agent").execute({ text: "hello", tabId: 42 }, toolCtx());
      expect(api.query).not.toHaveBeenCalled();
      expect(api.sendMessage).toHaveBeenCalledWith(42, { type: "wa-send", text: "hello" });
    });

    it("returns an error naming the toggle tool when the reply says not mounted", async () => {
      const api = fakePageAgentApi({
        sendMessage: vi.fn().mockResolvedValue({
          origin: "https://x.example",
          mounted: false,
          foreign: false,
        }),
      });
      const tools = createPageAgentTools({ pageAgentApi: api, sleep: async () => {} });
      const result = await getTool(tools, "send_to_page_agent").execute({ text: "hello", tabId: 10 }, toolCtx());
      expect(result.isError).toBe(true);
      expect(result.content).toContain("toggle_page_agent");
      expect(result.content).toContain("https://x.example");
    });

    it("the not-mounted error does not enable anything", async () => {
      const api = fakePageAgentApi({
        sendMessage: vi.fn().mockResolvedValue({
          origin: "https://x.example",
          mounted: false,
          foreign: false,
        }),
      });
      const tools = createPageAgentTools({ pageAgentApi: api, sleep: async () => {} });
      await getTool(tools, "send_to_page_agent").execute({ text: "hello", tabId: 10 }, toolCtx());
      // The send now probes before it refuses, so the count is no longer
      // the guard. What must stay true is that nothing it sends can mount,
      // unmount or toggle: the first message is the send, and every message
      // after it is the read-only state probe.
      const sent = (api.sendMessage as ReturnType<typeof vi.fn>).mock.calls;
      expect(sent[0]).toEqual([10, { type: "wa-send", text: "hello" }]);
      for (const [, message] of sent.slice(1)) {
        expect(message).toEqual({ type: "wa-state" });
      }
      expect(sent.some(([, m]) => (m as { type: string }).type === "wa-toggle")).toBe(false);
    });

    it("reports the foreign-agent case distinctly", async () => {
      const api = fakePageAgentApi({
        sendMessage: vi.fn().mockResolvedValue({
          origin: "https://x.example",
          mounted: false,
          foreign: true,
        }),
      });
      const tools = createPageAgentTools({ pageAgentApi: api });
      const result = await getTool(tools, "send_to_page_agent").execute({ text: "hello", tabId: 10 }, toolCtx());
      expect(result.isError).toBe(true);
      expect(result.content).toContain("already has its own agent");
    });

    it("returns 'cannot reach' when sendMessage rejects", async () => {
      const api = fakePageAgentApi({
        sendMessage: vi.fn().mockRejectedValue(new Error("No tab")),
      });
      const tools = createPageAgentTools({ pageAgentApi: api });
      const result = await getTool(tools, "send_to_page_agent").execute({ text: "hello", tabId: 10 }, toolCtx());
      expect(result.isError).toBe(true);
      expect(result.content).toContain("Cannot reach tab #10");
    });

    it("returns 'cannot reach' when the reply has no origin", async () => {
      const apiUndef = fakePageAgentApi({
        sendMessage: vi.fn().mockResolvedValue(undefined),
      });
      const toolsUndef = createPageAgentTools({ pageAgentApi: apiUndef });
      const resUndef = await getTool(toolsUndef, "send_to_page_agent").execute({ text: "hello", tabId: 10 }, toolCtx());
      expect(resUndef.isError).toBe(true);
      expect(resUndef.content).toContain("Cannot reach tab #10");

      const apiEmpty = fakePageAgentApi({
        sendMessage: vi.fn().mockResolvedValue({}),
      });
      const toolsEmpty = createPageAgentTools({ pageAgentApi: apiEmpty });
      const resEmpty = await getTool(toolsEmpty, "send_to_page_agent").execute({ text: "hello", tabId: 10 }, toolCtx());
      expect(resEmpty.isError).toBe(true);
      expect(resEmpty.content).toContain("Cannot reach tab #10");
    });

    it("reports ordinary delivery when ranCommand is absent/false", async () => {
      const api = fakePageAgentApi({
        sendMessage: vi.fn().mockResolvedValue({
          origin: "https://x.example",
          mounted: true,
          delivered: true,
          ranCommand: false,
        }),
      });
      const tools = createPageAgentTools({ pageAgentApi: api });
      const result = await getTool(tools, "send_to_page_agent").execute({ text: "hello custom text", tabId: 10 }, toolCtx());
      expect(result.isError).toBeFalsy();
      expect(result.content).toContain("https://x.example");
      expect(result.content).toContain('"hello custom text"');
    });

    it("reports a refused delivery", async () => {
      const api = fakePageAgentApi({
        sendMessage: vi.fn().mockResolvedValue({
          origin: "https://x.example",
          mounted: true,
          delivered: false,
          ranCommand: false,
        }),
      });
      const tools = createPageAgentTools({ pageAgentApi: api });
      const result = await getTool(tools, "send_to_page_agent").execute({ text: "hello", tabId: 10 }, toolCtx());
      expect(result.isError).toBe(true);
      expect(result.content).toContain("did not accept");
    });

    it("errors when there is no tab at all", async () => {
      const api = fakePageAgentApi({
        query: vi.fn().mockResolvedValue([]),
      });
      const tools = createPageAgentTools({ pageAgentApi: api });
      const result = await getTool(tools, "send_to_page_agent").execute({ text: "hello" }, toolCtx());
      expect(result.isError).toBe(true);
      expect(result.content).toContain("read_tabs");
      expect(api.sendMessage).not.toHaveBeenCalled();
    });

    it("reports 'Ran /new' when ranCommand is true and command is 'new'", async () => {
      const api = fakePageAgentApi({
        sendMessage: vi.fn().mockResolvedValue({
          origin: "https://x.example",
          mounted: true,
          delivered: true,
          ranCommand: true,
          command: "new",
        }),
      });
      const tools = createPageAgentTools({ pageAgentApi: api });
      const result = await getTool(tools, "send_to_page_agent").execute({ text: "/new", tabId: 10 }, toolCtx());
      expect(result.isError).toBeFalsy();
      expect(result.content).toContain("Ran /new");
    });

    it("reports slash as ordinary text when delivered but ranCommand is false", async () => {
      const api = fakePageAgentApi({
        sendMessage: vi.fn().mockResolvedValue({
          origin: "https://x.example",
          mounted: true,
          delivered: true,
          ranCommand: false,
        }),
      });
      const tools = createPageAgentTools({ pageAgentApi: api });
      const result = await getTool(tools, "send_to_page_agent").execute({ text: "/unknowncmd", tabId: 10 }, toolCtx());
      expect(result.isError).toBeFalsy();
      expect(result.content).toContain("ordinary text");
      expect(result.content).toContain("unknowncmd");
    });

    it("passes /compact through as text; tool sends no special messages", async () => {
      const api = fakePageAgentApi({
        sendMessage: vi.fn().mockResolvedValue({
          origin: "https://x.example",
          mounted: true,
          delivered: true,
          ranCommand: true,
          command: "compact",
        }),
      });
      const tools = createPageAgentTools({ pageAgentApi: api });
      const result = await getTool(tools, "send_to_page_agent").execute(
        { text: "/compact", tabId: 42 },
        toolCtx(),
      );

      expect(api.sendMessage).toHaveBeenCalledWith(42, { type: "wa-send", text: "/compact" });
      expect(result.isError).toBeFalsy();
      expect(result.content).toContain("Ran /compact");
    });

    it("a send that lands while the mount is still settling is delivered", async () => {
      const api = fakePageAgentApi({
        sendMessage: replyByType({
          "wa-send": [
            { origin: "https://x.example", mounted: false, foreign: false },
            { origin: "https://x.example", mounted: true, delivered: true },
          ],
          "wa-state": { origin: "https://x.example", mounted: true },
        }),
      });
      const tools = createPageAgentTools({ pageAgentApi: api, sleep: async () => {} });
      const result = await getTool(tools, "send_to_page_agent").execute({ text: "hello", tabId: 5 }, toolCtx());
      expect(result.isError).toBeFalsy();
      expect(result.content).toContain("Sent to the web agent in tab #5");
      expect(result.content).toContain('"hello"');
      const types = (api.sendMessage as ReturnType<typeof vi.fn>).mock.calls.map(([, m]) => (m as { type: string }).type);
      expect(types).toEqual(["wa-send", "wa-state", "wa-send"]);
    });

    it("the probe only reads; it never toggles", async () => {
      const api = fakePageAgentApi({
        sendMessage: replyByType({
          "wa-send": [
            { origin: "https://x.example", mounted: false, foreign: false },
            { origin: "https://x.example", mounted: true, delivered: true },
          ],
          "wa-state": { origin: "https://x.example", mounted: true },
        }),
      });
      const tools = createPageAgentTools({ pageAgentApi: api, sleep: async () => {} });
      await getTool(tools, "send_to_page_agent").execute({ text: "hello", tabId: 5 }, toolCtx());
      const types = (api.sendMessage as ReturnType<typeof vi.fn>).mock.calls.map(([, m]) => (m as { type: string }).type);
      expect(types.every((t) => t === "wa-send" || t === "wa-state")).toBe(true);
      expect(types).not.toContain("wa-toggle");
    });

    it("a tab that never mounts still gets the unchanged refusal", async () => {
      const sleep = vi.fn(async () => {});
      const api = fakePageAgentApi({
        sendMessage: replyByType({
          "wa-send": { origin: "https://x.example", mounted: false, foreign: false },
          "wa-state": { origin: "https://x.example", mounted: false },
        }),
      });
      const tools = createPageAgentTools({ pageAgentApi: api, sleep });
      const result = await getTool(tools, "send_to_page_agent").execute({ text: "hello", tabId: 10 }, toolCtx());
      expect(result.isError).toBe(true);
      expect(result.content.startsWith("The web agent is not on in tab #")).toBe(true);
      const calls = (api.sendMessage as ReturnType<typeof vi.fn>).mock.calls;
      const stateCalls = calls.filter(([, m]) => (m as { type: string }).type === "wa-state");
      const sendCalls = calls.filter(([, m]) => (m as { type: string }).type === "wa-send");
      expect(stateCalls.length).toBe(Math.ceil(MOUNT_READY_TIMEOUT_MS / MOUNT_PROBE_INTERVAL_MS));
      expect(sendCalls.length).toBe(1);
      for (const args of sleep.mock.calls) {
        expect(args[0]).toBe(MOUNT_PROBE_INTERVAL_MS);
      }
    });

    it("a probe that rejects gives up at once", async () => {
      const sleep = vi.fn(async () => {});
      const api = fakePageAgentApi({
        sendMessage: vi.fn((_tabId: number, message: { type: string }) => {
          if (message.type === "wa-send") return Promise.resolve({ origin: "https://x.example", mounted: false, foreign: false });
          return Promise.reject(new Error("no receiver"));
        }),
      });
      const tools = createPageAgentTools({ pageAgentApi: api, sleep });
      const result = await getTool(tools, "send_to_page_agent").execute({ text: "hello", tabId: 10 }, toolCtx());
      expect(result.isError).toBe(true);
      expect(result.content.startsWith("The web agent is not on in tab #")).toBe(true);
      const calls = (api.sendMessage as ReturnType<typeof vi.fn>).mock.calls;
      const stateCalls = calls.filter(([, m]) => (m as { type: string }).type === "wa-state");
      expect(stateCalls.length).toBe(1);
      expect(sleep).not.toHaveBeenCalled();
    });

    it("a foreign page is refused without any probe", async () => {
      const api = fakePageAgentApi({
        sendMessage: vi.fn().mockResolvedValue({ origin: "https://x.example", mounted: false, foreign: true }),
      });
      const tools = createPageAgentTools({ pageAgentApi: api, sleep: async () => {} });
      const result = await getTool(tools, "send_to_page_agent").execute({ text: "hello", tabId: 10 }, toolCtx());
      expect(result.content).toContain("already has its own agent");
      expect(api.sendMessage).toHaveBeenCalledTimes(1);
      expect(api.sendMessage).toHaveBeenCalledWith(10, { type: "wa-send", text: "hello" });
    });
  });

  describe("toggle_page_agent", () => {
    it("sends the existing toggle message and nothing else", async () => {
      const api = fakePageAgentApi({
        query: vi.fn().mockResolvedValue([{ id: 7, active: true }]),
        sendMessage: vi.fn().mockResolvedValue({
          origin: "https://x.example",
          mounted: true,
        }),
      });
      const tools = createPageAgentTools({ pageAgentApi: api });
      await getTool(tools, "toggle_page_agent").execute({}, toolCtx());
      expect(api.sendMessage).toHaveBeenCalledTimes(1);
      expect(api.sendMessage).toHaveBeenCalledWith(7, { type: "wa-toggle" });
    });

    it("reports ON when the reply says mounted", async () => {
      const api = fakePageAgentApi({
        sendMessage: vi.fn().mockResolvedValue({
          origin: "https://x.example",
          mounted: true,
        }),
      });
      const tools = createPageAgentTools({ pageAgentApi: api });
      const result = await getTool(tools, "toggle_page_agent").execute({ tabId: 7 }, toolCtx());
      expect(result.isError).toBeFalsy();
      expect(result.content).toContain("is now ON");
      expect(result.content).toContain("https://x.example");
    });

    it("reports OFF when the reply says not mounted and not foreign", async () => {
      const api = fakePageAgentApi({
        sendMessage: vi.fn().mockResolvedValue({
          origin: "https://x.example",
          mounted: false,
          foreign: false,
          requested: "off",
        }),
      });
      const tools = createPageAgentTools({ pageAgentApi: api });
      const result = await getTool(tools, "toggle_page_agent").execute({ tabId: 7 }, toolCtx());
      expect(result.isError).toBeFalsy();
      expect(result.content).toContain("is now OFF");
    });

    it("reports the state that resulted, not the state requested", async () => {
      const api = fakePageAgentApi({
        sendMessage: vi.fn().mockResolvedValue({
          origin: "https://x.example",
          mounted: false,
          foreign: true,
          requested: "on",
        }),
      });
      const tools = createPageAgentTools({ pageAgentApi: api });
      const result = await getTool(tools, "toggle_page_agent").execute({ tabId: 7 }, toolCtx());
      expect(result.isError).toBe(true);
      expect(result.content).toContain("already has its own agent");
      expect(result.content).not.toContain("is now ON");
    });

    it("a press that asked for ON and did not mount reports a refusal, not a turn-off", async () => {
      const api = fakePageAgentApi({
        sendMessage: vi.fn().mockResolvedValue({
          origin: "https://x.example",
          mounted: false,
          foreign: false,
          requested: "on",
        }),
      });
      const tools = createPageAgentTools({ pageAgentApi: api });
      const result = await getTool(tools, "toggle_page_agent").execute({ tabId: 7 }, toolCtx());
      expect(result.isError).toBe(true);
      expect(result.content).toContain("Could not turn the web agent on in tab #7");
      expect(result.content).toContain("https://x.example");
      expect(result.content).not.toContain("is now OFF");
    });

    it("a press that asked for OFF still reports OFF", async () => {
      const api = fakePageAgentApi({
        sendMessage: vi.fn().mockResolvedValue({
          origin: "https://x.example",
          mounted: false,
          foreign: false,
          requested: "off",
        }),
      });
      const tools = createPageAgentTools({ pageAgentApi: api });
      const result = await getTool(tools, "toggle_page_agent").execute({ tabId: 7 }, toolCtx());
      expect(result.isError).toBeFalsy();
      expect(result.content).toContain("is now OFF");
    });

    it("the foreign reason wins over the refused-turn-on wording", async () => {
      const api = fakePageAgentApi({
        sendMessage: vi.fn().mockResolvedValue({
          origin: "https://x.example",
          mounted: false,
          foreign: true,
          requested: "on",
        }),
      });
      const tools = createPageAgentTools({ pageAgentApi: api });
      const result = await getTool(tools, "toggle_page_agent").execute({ tabId: 7 }, toolCtx());
      expect(result.content).toContain("already has its own agent");
      expect(result.content).not.toContain("Could not turn");
    });

    it("returns 'cannot reach' when sendMessage rejects", async () => {
      const api = fakePageAgentApi({
        sendMessage: vi.fn().mockRejectedValue(new Error("unreachable")),
      });
      const tools = createPageAgentTools({ pageAgentApi: api });
      const result = await getTool(tools, "toggle_page_agent").execute({ tabId: 7 }, toolCtx());
      expect(result.isError).toBe(true);
      expect(result.content).toContain("Cannot reach tab #7");
    });

    it("errors when there is no tab at all", async () => {
      const api = fakePageAgentApi({
        query: vi.fn().mockResolvedValue([]),
      });
      const tools = createPageAgentTools({ pageAgentApi: api });
      const result = await getTool(tools, "toggle_page_agent").execute({}, toolCtx());
      expect(result.isError).toBe(true);
      expect(result.content).toContain("read_tabs");
      expect(api.sendMessage).not.toHaveBeenCalled();
    });

    it("invokes onToggle callback when toggle succeeds", async () => {
      const api = fakePageAgentApi({
        sendMessage: vi.fn().mockResolvedValue({
          origin: "https://x.example",
          mounted: true,
        }),
      });
      const onToggle = vi.fn().mockResolvedValue(undefined);
      const tools = createPageAgentTools({ pageAgentApi: api, onToggle });
      await getTool(tools, "toggle_page_agent").execute({ tabId: 7 }, toolCtx());
      expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it("reports ON only after the probe confirms the mount", async () => {
      const api = fakePageAgentApi({
        sendMessage: replyByType({
          "wa-toggle": { origin: "https://x.example", mounted: true, requested: "on" },
          "wa-state": { origin: "https://x.example", mounted: true },
        }),
      });
      const tools = createPageAgentTools({ pageAgentApi: api, sleep: async () => {} });
      const result = await getTool(tools, "toggle_page_agent").execute({ tabId: 7 }, toolCtx());
      expect(result.isError).toBeFalsy();
      expect(result.content).toContain("is now ON in tab #7");
      const stateCalls = (api.sendMessage as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([, m]) => (m as { type: string }).type === "wa-state",
      );
      expect(stateCalls.length).toBe(1);
    });

    it("a mount the probe never confirms is reported as did-not-come-up", async () => {
      const sleep = vi.fn(async () => {});
      const api = fakePageAgentApi({
        sendMessage: replyByType({
          "wa-toggle": { origin: "https://x.example", mounted: true, requested: "on" },
          "wa-state": { origin: "https://x.example", mounted: false },
        }),
      });
      const tools = createPageAgentTools({ pageAgentApi: api, sleep });
      const result = await getTool(tools, "toggle_page_agent").execute({ tabId: 7 }, toolCtx());
      expect(result.isError).toBe(true);
      expect(result.content).toContain("The web agent did not come up in tab #7");
      expect(result.content).toContain("https://x.example");
      expect(result.content).not.toContain("is now ON");
    });

    it("a press that asked for OFF is never probed", async () => {
      const api = fakePageAgentApi({
        sendMessage: replyByType({
          "wa-toggle": { origin: "https://x.example", mounted: true, requested: "off" },
        }),
      });
      const tools = createPageAgentTools({ pageAgentApi: api, sleep: async () => {} });
      const result = await getTool(tools, "toggle_page_agent").execute({ tabId: 7 }, toolCtx());
      expect(result.content).toContain("is now ON");
      const stateCalls = (api.sendMessage as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([, m]) => (m as { type: string }).type === "wa-state",
      );
      expect(stateCalls.length).toBe(0);
    });

    it("fix-133 — state 'on' on a tab that is already ON sends no toggle", async () => {
      const onToggle = vi.fn();
      const api = fakePageAgentApi({
        sendMessage: replyByType({
          "wa-state": { origin: "https://x.example", mounted: true, foreign: false },
          "wa-toggle": { origin: "https://x.example", mounted: false, requested: "off" },
        }),
      });
      const tools = createPageAgentTools({ pageAgentApi: api, onToggle, sleep: async () => {} });
      const result = await getTool(tools, "toggle_page_agent").execute({ tabId: 7, state: "on" }, toolCtx());
      expect(result.isError).toBeFalsy();
      expect(result.content).toBe("The web agent is already ON in tab #7 (https://x.example). Nothing changed.");
      const toggleCalls = (api.sendMessage as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([, m]) => (m as { type: string }).type === "wa-toggle",
      );
      expect(toggleCalls.length).toBe(0);
      expect(onToggle).not.toHaveBeenCalled();
    });

    it("fix-133 — state 'off' on a tab that is already OFF sends no toggle", async () => {
      const api = fakePageAgentApi({
        sendMessage: replyByType({
          "wa-state": { origin: "https://x.example", mounted: false, foreign: false },
        }),
      });
      const tools = createPageAgentTools({ pageAgentApi: api, sleep: async () => {} });
      const result = await getTool(tools, "toggle_page_agent").execute({ tabId: 7, state: "off" }, toolCtx());
      expect(result.isError).toBeFalsy();
      expect(result.content).toBe("The web agent is already OFF in tab #7 (https://x.example). Nothing changed.");
      const toggleCalls = (api.sendMessage as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([, m]) => (m as { type: string }).type === "wa-toggle",
      );
      expect(toggleCalls.length).toBe(0);
    });

    it("fix-133 — state 'on' on a tab that is OFF toggles once and reports ON", async () => {
      const api = fakePageAgentApi({
        sendMessage: replyByType({
          "wa-state": [
            { origin: "https://x.example", mounted: false, foreign: false },
            { origin: "https://x.example", mounted: true, foreign: false },
          ],
          "wa-toggle": { origin: "https://x.example", mounted: true, requested: "on" },
        }),
      });
      const tools = createPageAgentTools({ pageAgentApi: api, sleep: async () => {} });
      const result = await getTool(tools, "toggle_page_agent").execute({ tabId: 7, state: "on" }, toolCtx());
      expect(result.isError).toBeFalsy();
      expect(result.content).toContain("is now ON in tab #7");
      const toggleCalls = (api.sendMessage as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([, m]) => (m as { type: string }).type === "wa-toggle",
      );
      const stateCalls = (api.sendMessage as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([, m]) => (m as { type: string }).type === "wa-state",
      );
      expect(toggleCalls.length).toBe(1);
      expect(stateCalls.length).toBe(2);
    });

    it("fix-133 — state 'off' on a tab that is ON toggles once and reports OFF", async () => {
      const api = fakePageAgentApi({
        sendMessage: replyByType({
          "wa-state": { origin: "https://x.example", mounted: true, foreign: false },
          "wa-toggle": { origin: "https://x.example", mounted: false, foreign: false, requested: "off" },
        }),
      });
      const tools = createPageAgentTools({ pageAgentApi: api, sleep: async () => {} });
      const result = await getTool(tools, "toggle_page_agent").execute({ tabId: 7, state: "off" }, toolCtx());
      expect(result.isError).toBeFalsy();
      expect(result.content).toContain("is now OFF in tab #7");
      const toggleCalls = (api.sendMessage as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([, m]) => (m as { type: string }).type === "wa-toggle",
      );
      expect(toggleCalls.length).toBe(1);
    });

    it("fix-133 — state set on a tab that cannot be reached reports cannot-reach", async () => {
      const api = fakePageAgentApi({
        sendMessage: vi.fn().mockRejectedValue(new Error("unreachable")),
      });
      const tools = createPageAgentTools({ pageAgentApi: api, sleep: async () => {} });
      const result = await getTool(tools, "toggle_page_agent").execute({ tabId: 7, state: "on" }, toolCtx());
      expect(result.isError).toBe(true);
      expect(result.content).toContain("Cannot reach tab #7");
      expect(api.sendMessage).toHaveBeenCalledTimes(1);
    });

    it("fix-133 — state set on a page with its own agent sends no toggle", async () => {
      const api = fakePageAgentApi({
        sendMessage: replyByType({
          "wa-state": { origin: "https://x.example", mounted: false, foreign: true },
        }),
      });
      const tools = createPageAgentTools({ pageAgentApi: api, sleep: async () => {} });
      const result = await getTool(tools, "toggle_page_agent").execute({ tabId: 7, state: "on" }, toolCtx());
      expect(result.isError).toBe(true);
      expect(result.content).toContain("already has its own agent");
      const toggleCalls = (api.sendMessage as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([, m]) => (m as { type: string }).type === "wa-toggle",
      );
      expect(toggleCalls.length).toBe(0);
    });
  });

  describe("read_page_agent", () => {
    // Every test but the two fake-timer ones passes a fake `sleep` so the
    // suite never really waits 30 or 120 seconds.
    const noWait = async () => {};

    it("resolves the active tab when no tabId is given", async () => {
      const api = fakePageAgentApi({
        query: vi.fn().mockResolvedValue([{ id: 7, active: true, currentWindow: true }]),
        sendMessage: vi.fn().mockResolvedValue({
          origin: "https://x.example",
          mounted: true,
          running: false,
          messages: [],
        }),
      });
      const tools = createPageAgentTools({ pageAgentApi: api, sleep: noWait });
      const result = await getTool(tools, "read_page_agent").execute({ wait: 30 }, toolCtx());
      expect(api.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
      expect(api.sendMessage).toHaveBeenCalledWith(7, { type: "wa-read" });
      expect(result.isError).toBeFalsy();
    });

    it("uses the given tabId and never queries", async () => {
      const api = fakePageAgentApi({
        sendMessage: vi.fn().mockResolvedValue({
          origin: "https://x.example",
          mounted: true,
          running: false,
          messages: [],
        }),
      });
      const tools = createPageAgentTools({ pageAgentApi: api, sleep: noWait });
      await getTool(tools, "read_page_agent").execute({ wait: 30, tabId: 42 }, toolCtx());
      expect(api.query).not.toHaveBeenCalled();
      expect(api.sendMessage).toHaveBeenCalledWith(42, { type: "wa-read" });
    });

    it("rejects invalid wait values with an error naming 30 and 120", async () => {
      const api = fakePageAgentApi();
      const tools = createPageAgentTools({ pageAgentApi: api, sleep: noWait });
      for (const wait of [10, 60]) {
        const result = await getTool(tools, "read_page_agent").execute({ wait, tabId: 7 }, toolCtx());
        expect(result.isError).toBe(true);
        expect(result.content).toContain("30");
        expect(result.content).toContain("120");
      }
      expect(api.sendMessage).not.toHaveBeenCalled();
    });

    it("sleeps for 30s when wait is 30 — a fixed wait, not a condition wait", async () => {
      vi.useFakeTimers();
      try {
        const api = fakePageAgentApi({
          sendMessage: vi.fn().mockResolvedValue({
            origin: "https://x.example",
            mounted: true,
            running: false,
            messages: [],
          }),
        });
        const tools = createPageAgentTools({ pageAgentApi: api });
        let done = false;
        const promise = getTool(tools, "read_page_agent")
          .execute({ wait: 30, tabId: 7 }, toolCtx())
          .then((r) => {
            done = true;
            return r;
          });

        await vi.advanceTimersByTimeAsync(29_999);
        expect(done).toBe(false);
        expect(api.sendMessage).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);
        const result = await promise;
        expect(done).toBe(true);
        expect(result.isError).toBeFalsy();
      } finally {
        vi.useRealTimers();
      }
    });

    it("sleeps for 120s when wait is 120 — a fixed wait, not a condition wait", async () => {
      vi.useFakeTimers();
      try {
        const api = fakePageAgentApi({
          sendMessage: vi.fn().mockResolvedValue({
            origin: "https://x.example",
            mounted: true,
            running: true,
            messages: [],
          }),
        });
        const tools = createPageAgentTools({ pageAgentApi: api });
        let done = false;
        const promise = getTool(tools, "read_page_agent")
          .execute({ wait: 120, tabId: 7 }, toolCtx())
          .then((r) => {
            done = true;
            return r;
          });

        await vi.advanceTimersByTimeAsync(119_999);
        expect(done).toBe(false);
        expect(api.sendMessage).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(1);
        await promise;
        expect(done).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    it("performs exactly one read and no polling loop", async () => {
      const api = fakePageAgentApi({
        sendMessage: vi.fn().mockResolvedValue({
          origin: "https://x.example",
          mounted: true,
          running: true,
          messages: [],
        }),
      });
      const tools = createPageAgentTools({ pageAgentApi: api, sleep: noWait });
      await getTool(tools, "read_page_agent").execute({ wait: 30, tabId: 7 }, toolCtx());
      expect(api.sendMessage).toHaveBeenCalledTimes(1);
    });

    it("formats messages with [role] text and reports RUNNING state", async () => {
      const api = fakePageAgentApi({
        sendMessage: vi.fn().mockResolvedValue({
          origin: "https://x.example",
          mounted: true,
          running: true,
          messages: [
            { role: "user", text: "hello" },
            { role: "assistant", text: "hi there" },
          ],
        }),
      });
      const tools = createPageAgentTools({ pageAgentApi: api, sleep: noWait });
      const result = await getTool(tools, "read_page_agent").execute({ wait: 30, tabId: 7 }, toolCtx());
      expect(result.content).toContain("[user] hello");
      expect(result.content).toContain("[assistant] hi there");
      expect(result.content).toContain("RUNNING");
    });

    it("reports IDLE state when running is false", async () => {
      const api = fakePageAgentApi({
        sendMessage: vi.fn().mockResolvedValue({
          origin: "https://x.example",
          mounted: true,
          running: false,
          messages: [],
        }),
      });
      const tools = createPageAgentTools({ pageAgentApi: api, sleep: noWait });
      const result = await getTool(tools, "read_page_agent").execute({ wait: 30, tabId: 7 }, toolCtx());
      expect(result.content).toContain("IDLE");
    });

    it("reports (no conversation yet) when messages array is empty", async () => {
      const api = fakePageAgentApi({
        sendMessage: vi.fn().mockResolvedValue({
          origin: "https://x.example",
          mounted: true,
          running: false,
          messages: [],
        }),
      });
      const tools = createPageAgentTools({ pageAgentApi: api, sleep: noWait });
      const result = await getTool(tools, "read_page_agent").execute({ wait: 30, tabId: 7 }, toolCtx());
      expect(result.content).toContain("(no conversation yet)");
    });

    it("truncates conversation exceeding maxChars with a visible marker", async () => {
      const api = fakePageAgentApi({
        sendMessage: vi.fn().mockResolvedValue({
          origin: "https://x.example",
          mounted: true,
          running: false,
          messages: [{ role: "assistant", text: "x".repeat(1000) }],
        }),
      });
      const tools = createPageAgentTools({ pageAgentApi: api, sleep: noWait, maxChars: 100 });
      const result = await getTool(tools, "read_page_agent").execute({ wait: 30, tabId: 7 }, toolCtx());
      expect(result.content.length).toBeLessThanOrEqual(100);
      expect(result.content).toContain("…(output truncated)");
    });

    it("returns an error naming toggle_page_agent when the bubble is not mounted", async () => {
      const api = fakePageAgentApi({
        sendMessage: vi.fn().mockResolvedValue({
          origin: "https://x.example",
          mounted: false,
          foreign: false,
        }),
      });
      const tools = createPageAgentTools({ pageAgentApi: api, sleep: noWait });
      const result = await getTool(tools, "read_page_agent").execute({ wait: 30, tabId: 7 }, toolCtx());
      expect(result.isError).toBe(true);
      expect(result.content).toContain("toggle_page_agent");
    });

    it("reports the foreign-agent case distinctly", async () => {
      const api = fakePageAgentApi({
        sendMessage: vi.fn().mockResolvedValue({
          origin: "https://x.example",
          mounted: false,
          foreign: true,
        }),
      });
      const tools = createPageAgentTools({ pageAgentApi: api, sleep: noWait });
      const result = await getTool(tools, "read_page_agent").execute({ wait: 30, tabId: 7 }, toolCtx());
      expect(result.isError).toBe(true);
      expect(result.content).toContain("already has its own agent");
    });

    it("returns an unreachable error when sendMessage rejects or the reply has no origin", async () => {
      const apiRejects = fakePageAgentApi({
        sendMessage: vi.fn().mockRejectedValue(new Error("unreachable")),
      });
      const toolsRejects = createPageAgentTools({ pageAgentApi: apiRejects, sleep: noWait });
      const resultRejects = await getTool(toolsRejects, "read_page_agent").execute({ wait: 30, tabId: 7 }, toolCtx());
      expect(resultRejects.isError).toBe(true);
      expect(resultRejects.content).toContain("Cannot reach tab #7");

      const apiEmpty = fakePageAgentApi({
        sendMessage: vi.fn().mockResolvedValue({}),
      });
      const toolsEmpty = createPageAgentTools({ pageAgentApi: apiEmpty, sleep: noWait });
      const resultEmpty = await getTool(toolsEmpty, "read_page_agent").execute({ wait: 30, tabId: 7 }, toolCtx());
      expect(resultEmpty.isError).toBe(true);
      expect(resultEmpty.content).toContain("Cannot reach tab #7");
    });

    it("errors when there is no active tab", async () => {
      const api = fakePageAgentApi({
        query: vi.fn().mockResolvedValue([]),
      });
      const tools = createPageAgentTools({ pageAgentApi: api, sleep: noWait });
      const result = await getTool(tools, "read_page_agent").execute({ wait: 30 }, toolCtx());
      expect(result.isError).toBe(true);
      expect(result.content).toContain("read_tabs");
      expect(api.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe("pageAgentTools", () => {
    it("provider shape", async () => {
      const providers = pageAgentTools();
      expect(providers).toHaveLength(1);
      expect(providers[0].name).toBe("page-agent-tools");
      expect(providers[0].required).toBe(false);
      const loaded = await providers[0].load();
      expect(loaded.map((t) => t.name)).toEqual(["send_to_page_agent", "toggle_page_agent", "read_page_agent"]);
    });

    it("passes its options through to the tools", async () => {
      const api = fakePageAgentApi({
        sendMessage: vi.fn().mockResolvedValue({
          origin: "https://custom.example",
          mounted: true,
          delivered: true,
        }),
      });
      const providers = pageAgentTools({ pageAgentApi: api });
      const tools = await providers[0].load();
      await getTool(tools, "send_to_page_agent").execute({ text: "test", tabId: 3 }, toolCtx());
      expect(api.sendMessage).toHaveBeenCalledWith(3, { type: "wa-send", text: "test" });
    });
  });
});
