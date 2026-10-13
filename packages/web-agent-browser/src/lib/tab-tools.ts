import { z } from "zod";
import type {
  CustomToolDef,
  ToolProvider,
} from "@cuatoi/web-agent-core";
import { errorMessage } from "./error-message";
import type { TabsApi, TabToolsOptions } from "./types";

export type { TabsApi, TabToolsOptions } from "./types";

export const defaultTabsApi: TabsApi = {
  query: (info) => chrome.tabs.query(info),
  create: (props) => chrome.tabs.create(props),
  update: (id, props) => chrome.tabs.update(id, props),
  reload: (id, props) => chrome.tabs.reload(id, props),
  remove: (id) => chrome.tabs.remove(id),
  get: (id) => chrome.tabs.get(id),
  onUpdated: {
    addListener: (cb) => chrome.tabs.onUpdated.addListener(cb),
    removeListener: (cb) => chrome.tabs.onUpdated.removeListener(cb),
  },
};

/** `chrome.tabs.update()` resolves once navigation STARTS, not once it finishes — the
 *  tab object it hands back can still report the pre-navigation URL. A tool called right
 *  after `navigate_tab` (`refresh_tab`, `read_tabs`) can then act on the page the tab is
 *  navigating away from. Default bound for waiting on the browser's own "complete" status
 *  before `navigate_tab` returns; keeps a slow-loading page from hanging the tool forever. */
const DEFAULT_NAVIGATE_COMPLETE_TIMEOUT_MS = 10_000;

/** Resolves once `tabId` reaches `status: "complete"`, or after `timeoutMs` elapses —
 *  whichever comes first. Never rejects: a page that never finishes loading should not
 *  fail the tool, it should just stop waiting. */
function waitForNavigationComplete(tabs: TabsApi, tabId: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const listener = (updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === "complete") finish();
    };
    const timer = setTimeout(finish, timeoutMs);
    function finish(): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      tabs.onUpdated.removeListener(listener);
      resolve();
    }
    tabs.onUpdated.addListener(listener);
  });
}

export function createTabTools(options: TabToolsOptions = {}): CustomToolDef[] {
  const tabs = options.tabsApi ?? defaultTabsApi;
  const confirmInteraction = options.confirmInteraction;
  const navigateCompleteTimeoutMs = options.navigateCompleteTimeoutMs ?? DEFAULT_NAVIGATE_COMPLETE_TIMEOUT_MS;

  const readTabs: CustomToolDef = {
    name: "read_tabs",
    description: "List all open browser tabs across all normal windows with their ID, window ID, title, URL, and active status.",
    inputSchema: z.object({}),
    summarize: () => "List open tabs",
    execute: async () => {
      try {
        const tabList = await tabs.query({ windowType: "normal" });
        if (!tabList || tabList.length === 0) {
          return { content: "No open tabs found." };
        }
        const lines = tabList.map((t) => {
          const activeSuffix = t.active ? " (active)" : "";
          const title = t.title || "Untitled";
          const url = t.url || "(restricted or pending)";
          return `- Tab #${t.id} [window ${t.windowId}${activeSuffix}]: "${title}" <${url}>`;
        });
        return {
          content: `Found ${tabList.length} open tab(s):\n${lines.join("\n")}`,
        };
      } catch (err) {
        return { content: `Failed to read tabs: ${errorMessage(err)}`, isError: true };
      }
    },
  };

  const openTab: CustomToolDef = {
    name: "open_tab",
    description: "Open a new browser tab at the specified URL.",
    inputSchema: z.object({
      url: z.string().describe("The URL to open in the new tab."),
      active: z.boolean().optional().describe("Whether the new tab should become active immediately. Defaults to true."),
    }),
    summarize: (input) => `Open tab "${String(input.url)}"`,
    execute: async (input) => {
      const url = String(input.url);
      const active = input.active !== false;
      try {
        const newTab = await tabs.create({ url, active });
        return {
          content: `Opened new tab #${newTab.id} at <${newTab.url || url}>.`,
        };
      } catch (err) {
        return { content: `Failed to open tab at <${url}>: ${errorMessage(err)}`, isError: true };
      }
    },
  };

  const navigateTab: CustomToolDef = {
    name: "navigate_tab",
    description: "Navigate an existing browser tab to a new URL.",
    inputSchema: z.object({
      tabId: z.number().describe("The ID of the tab to navigate."),
      url: z.string().describe("The new URL to navigate the tab to."),
    }),
    summarize: (input) => `Navigate tab #${String(input.tabId)} to "${String(input.url)}"`,
    execute: async (input) => {
      const tabId = Number(input.tabId);
      const url = String(input.url);
      let updated: chrome.tabs.Tab | undefined;
      try {
        updated = await tabs.update(tabId, { url });
      } catch (err) {
        return {
          content: `Failed to navigate tab #${tabId} to <${url}>: ${errorMessage(err)}`,
          isError: true,
        };
      }

      await waitForNavigationComplete(tabs, tabId, navigateCompleteTimeoutMs);

      // Re-fetch rather than trust `updated`: tabs.update() resolves once navigation
      // starts, so its own returned tab can still carry the pre-navigation URL.
      let finalUrl = updated?.url || url;
      try {
        const finalTab = await tabs.get(tabId);
        finalUrl = finalTab.url || finalUrl;
      } catch {
        // Tab may have closed mid-navigation; report the best URL we have.
      }

      return {
        content: `Navigated tab #${tabId} to <${finalUrl}>.`,
      };
    },
  };

  const refreshTab: CustomToolDef = {
    name: "refresh_tab",
    description: "Reload an existing browser tab.",
    inputSchema: z.object({
      tabId: z.number().describe("The ID of the tab to reload."),
      bypassCache: z.boolean().optional().describe("Whether to bypass the browser cache. Defaults to false."),
    }),
    summarize: (input) => `Reload tab #${String(input.tabId)}`,
    execute: async (input) => {
      const tabId = Number(input.tabId);
      const bypassCache = Boolean(input.bypassCache);
      try {
        await tabs.reload(tabId, { bypassCache });
        return {
          content: `Reloaded tab #${tabId}${bypassCache ? " (bypassing cache)" : ""}.`,
        };
      } catch (err) {
        return {
          content: `Failed to reload tab #${tabId}: ${errorMessage(err)}`,
          isError: true,
        };
      }
    },
  };

  const closeTab: CustomToolDef = {
    name: "close_tab",
    description:
      "Close a browser tab. Call it directly: the tool shows the user an Allow/Reject prompt and waits for the answer. Do not ask for confirmation in chat first.",
    inputSchema: z.object({
      tabId: z.number().describe("The ID of the tab to close."),
    }),
    summarize: (input) => `Close tab #${String(input.tabId)}`,
    execute: async (input) => {
      const tabId = Number(input.tabId);
      let tab: chrome.tabs.Tab;
      try {
        tab = await tabs.get(tabId);
      } catch (err) {
        return {
          content: `Cannot close tab #${tabId}: tab not found (${errorMessage(err)}).`,
          isError: true,
        };
      }

      const tabTitle = tab.title || tab.url || `Tab #${tabId}`;
      if (confirmInteraction) {
        const confirmed = await confirmInteraction({
          action: "close tab",
          name: tabTitle,
          summary: `Close tab "${tabTitle}"`,
          reason: `Close tab #${tabId} (${tab.title || tab.url || "Untitled"})`,
        });
        if (!confirmed) {
          return {
            content: `Closing tab #${tabId} ("${tabTitle}") was declined by the user.`,
            isError: true,
          };
        }
      }

      try {
        await tabs.remove(tabId);
        return {
          content: `Closed tab #${tabId} ("${tabTitle}").`,
        };
      } catch (err) {
        return {
          content: `Failed to remove tab #${tabId}: ${errorMessage(err)}`,
          isError: true,
        };
      }
    },
  };

  return [readTabs, openTab, navigateTab, refreshTab, closeTab];
}

export function tabTools(options: TabToolsOptions = {}): ToolProvider[] {
  return [
    {
      name: "tab-tools",
      required: false,
      load: () => Promise.resolve(createTabTools(options)),
    },
  ];
}
