import { z } from "zod";
import { parseSlashInput, type CustomToolDef, type ToolProvider } from "@cuatoi/web-agent-core";
import {
  DEFAULT_READ_RESULT_MAX_CHARS,
  MOUNT_PROBE_INTERVAL_MS,
  MOUNT_READY_TIMEOUT_MS,
  READ_MESSAGE,
  SEND_MESSAGE,
  STATE_MESSAGE,
  TOGGLE_MESSAGE,
} from "./constants";
import type { PageAgentApi, PageAgentReply, PageAgentToolsOptions } from "./types";

export type {
  PageAgentApi,
  PageAgentConversationMessage,
  PageAgentReply,
  PageAgentToolsOptions,
} from "./types";

export const defaultPageAgentApi: PageAgentApi = {
  query: (info) => chrome.tabs.query(info),
  sendMessage: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
};

/** The tab id to act on: the one the agent named, or the active tab of the
 *  current window. Returns null when there is no tab to act on. */
async function resolveTabId(api: PageAgentApi, input: Record<string, unknown>): Promise<number | null> {
  if (typeof input.tabId === "number") return input.tabId;
  try {
    const [tab] = await api.query({ active: true, currentWindow: true });
    return tab?.id ?? null;
  } catch {
    return null;
  }
}

const UNREACHABLE = (tabId: number) =>
  `Cannot reach tab #${tabId}. The extension has no content script there, so it is not a normal website — a browser page such as chrome:// or an extension page.`;

export function createPageAgentTools(options: PageAgentToolsOptions = {}): CustomToolDef[] {
  const api = options.pageAgentApi ?? defaultPageAgentApi;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const maxChars = options.maxChars ?? DEFAULT_READ_RESULT_MAX_CHARS;

  /** 001 — ask the tab, repeatedly and briefly, whether the page agent is
   *  mounted yet. STATE_MESSAGE is the read-only probe the panel's own toggle
   *  control already uses (panel-toggle.ts:19): the tab answers it from
   *  `reportState` (content.ts:327-329), which mounts, unmounts and toggles
   *  nothing. A rejected probe means the content script is gone, so the loop
   *  stops there instead of spending the whole budget on a dead tab. The bound
   *  is an attempt count rather than a clock reading, so a unit test that
   *  passes its own `sleep` finishes at once instead of spinning for 3 s. */
  async function awaitMounted(tabId: number): Promise<boolean> {
    const attempts = Math.max(1, Math.ceil(MOUNT_READY_TIMEOUT_MS / MOUNT_PROBE_INTERVAL_MS));
    for (let attempt = 0; attempt < attempts; attempt++) {
      let probe: PageAgentReply | undefined;
      try {
        probe = (await api.sendMessage(tabId, { type: STATE_MESSAGE })) as PageAgentReply;
      } catch {
        return false;
      }
      if (probe?.mounted) return true;
      if (attempt < attempts - 1) await sleep(MOUNT_PROBE_INTERVAL_MS);
    }
    return false;
  }

  const sendToPageAgent: CustomToolDef = {
    name: "send_to_page_agent",
    description:
      "Send a message to the in-page web agent in a browser tab. The message lands in that agent's conversation as if the user had typed it. Two texts are commands rather than messages: \"/compact\" makes that agent summarise its older turns to free up its context, and \"/new\" (or \"/clear\") starts it on a fresh session. Any other text, including text starting with a slash, is delivered as an ordinary user message. The tool does not wait for the in-page agent's answer; it delivers the message and returns. The in-page agent must already be on for that tab — use toggle_page_agent first if it is not.",
    inputSchema: z.object({
      text: z.string().describe("The message to send to the in-page agent."),
      tabId: z.number().optional().describe("The ID of the tab to send to. Defaults to the active tab."),
    }),
    summarize: (input) => `Send a message to the agent in tab #${(typeof input.tabId === "number" || typeof input.tabId === "string" ? String(input.tabId) : "(active)")}`,
    execute: async (input) => {
      const tabId = await resolveTabId(api, input);
      if (tabId === null) {
        return {
          content: "No tab to send to. Call read_tabs and pass a tabId.",
          isError: true,
        };
      }

      const text = typeof input.text === "string" ? input.text : "";
      let reply: PageAgentReply | undefined;
      try {
        reply = (await api.sendMessage(tabId, { type: SEND_MESSAGE, text })) as PageAgentReply;
      } catch {
        return { content: UNREACHABLE(tabId), isError: true };
      }

      if (!reply || typeof reply.origin !== "string") {
        return { content: UNREACHABLE(tabId), isError: true };
      }

      if (!reply.mounted && reply.foreign) {
        return {
          content: `The web agent is not in tab #${tabId} (${reply.origin}): that page already has its own agent, so nothing was added. toggle_page_agent cannot change this.`,
          isError: true,
        };
      }

      // 001 — a mount the toggle already acknowledged can still be settling
      // when the very next tool call arrives: the live run of 2026-09-20 had
      // toggle answer "is now ON" and this send answer "is not on", on the
      // same tab, moments apart. One bounded wait on the read-only probe, then
      // one repeat of the same send. The foreign branch above already returned,
      // so this never runs for a page that owns its agent, and the refusal
      // below is unchanged for a tab that really has no page agent.
      if (!reply.mounted && (await awaitMounted(tabId))) {
        let retry: PageAgentReply | undefined;
        try {
          retry = (await api.sendMessage(tabId, { type: SEND_MESSAGE, text })) as PageAgentReply;
        } catch {
          return { content: UNREACHABLE(tabId), isError: true };
        }
        if (!retry || typeof retry.origin !== "string") {
          return { content: UNREACHABLE(tabId), isError: true };
        }
        reply = retry;
      }

      if (!reply.mounted) {
        return {
          content: `The web agent is not on in tab #${tabId} (${reply.origin}). Call toggle_page_agent for that tab first, then send again.`,
          isError: true,
        };
      }

      if (!reply.delivered) {
        return {
          content: `The web agent in tab #${tabId} (${reply.origin}) did not accept the message.`,
          isError: true,
        };
      }

      // 001/113 — report what the page agent actually did, never what was posted.
      // Claiming a command ran when it did not is what made this bug invisible.
      if (reply.ranCommand) {
        return { content: `Ran /${reply.command ?? ""} in the page agent.` };
      }

      const parsed = parseSlashInput(text);
      if (parsed) {
        return {
          content: `Sent as ordinary text — '${parsed.name}' is not a command in that page agent.`,
        };
      }

      return {
        content: `Sent to the web agent in tab #${tabId} (${reply.origin}): "${text}". It is answering now; this tool does not wait for the answer.`,
      };
    },
  };

  const togglePageAgent: CustomToolDef = {
    name: "toggle_page_agent",
    description:
      "Turn the in-page web agent on or off in a browser tab. It turns on where it is off and off where it is on, and reports the state that actually resulted. A page that already has its own agent gets nothing. Pass state 'on' or 'off' to set that state; if the tab is already in it, nothing changes. Leave state out to flip it.",
    inputSchema: z.object({
      tabId: z.number().optional().describe("The ID of the tab to toggle. Defaults to the active tab."),
      state: z.enum(["on", "off"]).optional().describe("The state to set: \"on\" or \"off\". Leave it out to flip the current state."),
    }),
    summarize: (input) => `Toggle the in-page agent in tab #${(typeof input.tabId === "number" || typeof input.tabId === "string" ? String(input.tabId) : "(active)")}`,
    execute: async (input) => {
      const tabId = await resolveTabId(api, input);
      if (tabId === null) {
        return {
          content: "No tab to toggle. Call read_tabs and pass a tabId.",
          isError: true,
        };
      }

      // A request for a named state is checked first with the read-only
      // probe, so "turn it on" never turns off an agent that is already on.
      // The demo fixture enables the origin up front, and a blind toggle
      // turned that agent OFF. With `state` left out, the toggle below runs
      // exactly as before.
      const target = input.state === "on" || input.state === "off" ? input.state : null;
      if (target !== null) {
        let probe: PageAgentReply | undefined;
        try {
          probe = (await api.sendMessage(tabId, { type: STATE_MESSAGE })) as PageAgentReply;
        } catch {
          return { content: UNREACHABLE(tabId), isError: true };
        }
        if (!probe || typeof probe.origin !== "string") {
          return { content: UNREACHABLE(tabId), isError: true };
        }
        if (probe.foreign) {
          return {
            content: `The web agent is not in tab #${tabId} (${probe.origin}): that page already has its own agent, so nothing was added.`,
            isError: true,
          };
        }
        const current = probe.mounted ? "on" : "off";
        if (current === target) {
          return {
            content: `The web agent is already ${target.toUpperCase()} in tab #${tabId} (${probe.origin}). Nothing changed.`,
          };
        }
      }

      let reply: PageAgentReply | undefined;
      try {
        reply = (await api.sendMessage(tabId, { type: TOGGLE_MESSAGE })) as PageAgentReply;
      } catch {
        return { content: UNREACHABLE(tabId), isError: true };
      }

      if (!reply || typeof reply.origin !== "string") {
        return { content: UNREACHABLE(tabId), isError: true };
      }

      if (options.onToggle) {
        try {
          await options.onToggle();
        } catch {
          // ignore callback error
        }
      }

      // 001 — a press that asked for ON is confirmed with the read-only probe
      // before it is reported. The toggle reports the state it saw at reply
      // time; without this the next send can find the page agent gone, which
      // is the defect this task fixes. Only an ON press is confirmed, so the
      // foreign, refusal and OFF branches below keep their exact behaviour.
      if (reply.mounted && reply.requested === "on" && !(await awaitMounted(tabId))) {
        return {
          content: `The web agent did not come up in tab #${tabId} (${reply.origin}).`,
          isError: true,
        };
      }

      if (reply.mounted) {
        return {
          content: `The web agent is now ON in tab #${tabId} (${reply.origin}).`,
        };
      }

      if (reply.foreign) {
        return {
          content: `The web agent is not in tab #${tabId} (${reply.origin}): that page already has its own agent, so nothing was added.`,
          isError: true,
        };
      }

      // 002 — a press that asked for ON and did not get it is a refusal, not
      // a turn-off. Reporting "now OFF" here told the panel the opposite of
      // what happened.
      if (reply.requested === "on") {
        return {
          content: `Could not turn the web agent on in tab #${tabId} (${reply.origin}). Nothing was added to that page.`,
          isError: true,
        };
      }

      return {
        content: `The web agent is now OFF in tab #${tabId} (${reply.origin}).`,
      };
    },
  };

  const readPageAgent: CustomToolDef = {
    name: "read_page_agent",
    description:
      "Read the in-page web agent's conversation and running state from a browser tab after a mandatory fixed wait. You must provide wait: 30 for the first look after sending a message, or wait: 120 for subsequent checks while the agent is running. The tool sleeps for the specified duration before reading once and returning.",
    inputSchema: z.object({
      wait: z
        .union([z.literal(30), z.literal(120)])
        .describe("Fixed wait in seconds before reading: 30 for the first look after sending, 120 for subsequent checks."),
      tabId: z.number().optional().describe("The ID of the tab to read from. Defaults to the active tab."),
    }),
    summarize: (input) => {
      const tabIdText = typeof input.tabId === "number" || typeof input.tabId === "string" ? String(input.tabId) : "(active)";
      const waitText = typeof input.wait === "number" || typeof input.wait === "string" ? String(input.wait) : "?";
      return `Read in-page agent in tab #${tabIdText} after ${waitText}s wait`;
    },
    execute: async (input) => {
      // A fixed sleep, never a condition wait: this call sleeps exactly the
      // requested duration, then reads exactly once — it never loops until
      // `running` clears and never returns early because the bubble finished
      // sooner. A bubble stuck behind a confirm scrim, crashed, or waiting on
      // the user produces the same shaped result as one that is working,
      // instead of an unbounded wait.
      const wait = input.wait === 30 || input.wait === 120 ? input.wait : null;
      if (wait === null) {
        return {
          content: `Invalid wait: ${String(input.wait)}. The wait argument must be exactly 30 (for the first look after a send) or 120 (for every look after that).`,
          isError: true,
        };
      }

      await sleep(wait * 1000);

      const tabId = await resolveTabId(api, input);
      if (tabId === null) {
        return {
          content: "No tab to read from. Call read_tabs and pass a tabId.",
          isError: true,
        };
      }

      let reply: PageAgentReply | undefined;
      try {
        reply = (await api.sendMessage(tabId, { type: READ_MESSAGE })) as PageAgentReply;
      } catch {
        return { content: UNREACHABLE(tabId), isError: true };
      }

      if (!reply || typeof reply.origin !== "string") {
        return { content: UNREACHABLE(tabId), isError: true };
      }

      if (!reply.mounted && reply.foreign) {
        return {
          content: `The web agent is not in tab #${tabId} (${reply.origin}): that page already has its own agent, so nothing was added. toggle_page_agent cannot change this.`,
          isError: true,
        };
      }

      if (!reply.mounted) {
        return {
          content: `The web agent is not on in tab #${tabId} (${reply.origin}). Call toggle_page_agent for that tab first, then read again.`,
          isError: true,
        };
      }

      const statusText = reply.running ? "RUNNING (still working)" : "IDLE (finished)";
      const msgLines =
        Array.isArray(reply.messages) && reply.messages.length > 0
          ? reply.messages.map((m) => `[${m.role}] ${m.text}`).join("\n")
          : "(no conversation yet)";

      let textOutput = `Web agent in tab #${tabId} (${reply.origin}):\nStatus: ${statusText}\n\nConversation:\n${msgLines}`;
      if (textOutput.length > maxChars) {
        textOutput = textOutput.slice(0, maxChars - 22) + "\n…(output truncated)";
      }

      return {
        content: textOutput,
      };
    },
  };

  return [sendToPageAgent, togglePageAgent, readPageAgent];
}

export function pageAgentTools(options: PageAgentToolsOptions = {}): ToolProvider[] {
  return [
    {
      name: "page-agent-tools",
      required: false,
      load: () => Promise.resolve(createPageAgentTools(options)),
    },
  ];
}
