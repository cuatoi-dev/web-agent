import { describeThing } from "@cuatoi/web-agent-lit/chat-ui/tool-phrases";
import type { CustomToolDef } from "@cuatoi/web-agent-core";
import type { HostTracker, ToolPhraseEntry } from "./page-tool-phrases.types";

export type { ToolPhraseEntry } from "./page-tool-phrases.types";

/** What `hostFor` returns when the tab's origin is unknown or unparsable. The
 *  side panel's map is empty after a reload, so a history line reads this. */
export const UNKNOWN_HOST = "the page";

export function createHostTracker(): HostTracker {
  const originByTab = new Map<number, string>();
  return {
    onActivatedOrigin: (tabId, origin) => {
      originByTab.set(tabId, origin);
    },
    hostFor: (tabId) => {
      const id = Number(tabId);
      const origin = Number.isFinite(id) ? originByTab.get(id) : undefined;
      if (!origin) return UNKNOWN_HOST;
      try {
        return new URL(origin).host || UNKNOWN_HOST;
      } catch {
        return UNKNOWN_HOST;
      }
    },
  };
}

/** The two texts every page tool can fail with, plus the two the debugger tools
 *  add. Verified against the source 2026-09-18 — see the task file's
 *  "Result texts re-verified" table for each file:line. */
export function isPageFailure(toolName: string, summary: string): boolean {
  return (
    summary.startsWith("The web agent is not on in tab #") ||
    summary.startsWith(`${toolName} timed out after`) ||
    summary.startsWith("Debugging is not started on tab #") ||
    summary.startsWith("Debugging stopped on tab #")
  );
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** `role "name"` for page_verify's element/list targets, or the bare ref. */
function verifyTarget(input: Record<string, unknown>): string {
  const role = str(input.role);
  const name = str(input.name);
  if (role) return describeThing(name ? `${role} "${name}"` : role);
  return `element [${str(input.ref) ?? ""}]`;
}

export function pageToolPhrases(hostFor: (tabId: unknown) => string): Record<string, ToolPhraseEntry> {
  return {
    page_snapshot: {
      phrase: ({ input, failed }, agent) =>
        failed
          ? `${agent} tried to read the page outline`
          : `${agent} read the page outline of ${hostFor(input.tabId)}`,
      inProgressPhrase: (agent) => `${agent} is reading the page outline…`,
    },

    page_click: {
      phrase: ({ outcomeSummary, failed }, agent) => {
        if (failed) return `${agent} tried to click an element`;
        const m = /^Clicked \[[^\]]+\] ([^.]+)\./.exec(outcomeSummary);
        return m ? `${agent} clicked ${describeThing(m[1].trim())}` : `${agent} clicked an element`;
      },
      inProgressPhrase: (agent) => `${agent} is clicking…`,
    },

    page_fill_form: {
      phrase: ({ input, outcomeSummary, failed }, agent) => {
        if (failed) {
          const k = Array.isArray(input.fields) ? input.fields.length : 0;
          return `${agent} tried to fill in ${k} ${plural(k, "field", "fields")}`;
        }
        const m = /^Filled (\d+) (?:field|fields): /.exec(outcomeSummary);
        const n = m ? Number(m[1]) : (Array.isArray(input.fields) ? input.fields.length : 0);
        return `${agent} filled ${n} ${plural(n, "field", "fields")}`;
      },
      inProgressPhrase: (agent) => `${agent} is filling in fields…`,
    },

    page_select_option: {
      phrase: ({ input, failed }, agent) => {
        if (failed) return `${agent} tried to select an option`;
        const values = Array.isArray(input.values)
          ? input.values.filter((v): v is string => typeof v === "string")
          : [];
        return values.length
          ? `${agent} selected ${values.map((v) => `"${v}"`).join(", ")}`
          : `${agent} selected an option`;
      },
      inProgressPhrase: (agent) => `${agent} is selecting an option…`,
    },

    page_verify: {
      phrase: ({ input, outcomeSummary, failed }, agent) => {
        if (failed) return `${agent} tried to run a check`;
        const result = outcomeSummary.startsWith("PASS ")
          ? "PASS"
          : outcomeSummary.startsWith("FAIL ")
            ? "FAIL"
            : undefined;
        if (!result) return `${agent} tried to run a check`;
        switch (str(input.kind)) {
          case "text_visible":
            return `${agent} checked the text "${str(input.text) ?? ""}" — ${result}`;
          case "element_visible":
            return `${agent} checked that ${verifyTarget(input)} is visible — ${result}`;
          case "value":
            return `${agent} checked the value of element [${str(input.ref) ?? ""}] — ${result}`;
          case "list":
            return `${agent} checked the list ${verifyTarget(input)} — ${result}`;
          default:
            return `${agent} tried to run a check`;
        }
      },
      inProgressPhrase: (agent) => `${agent} is running a check…`,
    },

    page_generate_locator: {
      phrase: ({ input, failed }, agent) =>
        failed
          ? `${agent} tried to make a locator`
          : `${agent} made a locator for element [${str(input.ref) ?? ""}]`,
      inProgressPhrase: (agent) => `${agent} is making a locator…`,
    },

    page_network: {
      phrase: ({ input, failed }, agent) => {
        if (failed) return `${agent} tried to read the network requests`;
        const index = num(input.index);
        return index === undefined
          ? `${agent} read the network requests`
          : `${agent} read request #${index}`;
      },
      inProgressPhrase: (agent) => `${agent} is reading the network requests…`,
    },

    page_dialog: {
      phrase: ({ input, failed }, agent) =>
        failed
          ? `${agent} tried to set up a dialog answer`
          : `${agent} set the next dialog to be ${input.accept ? "accepted" : "dismissed"}`,
      inProgressPhrase: (agent) => `${agent} is setting up a dialog answer…`,
    },

    start_recording: {
      phrase: ({ input, failed }, agent) =>
        failed
          ? `${agent} tried to start recording`
          : `${agent} started recording on ${hostFor(input.tabId)}`,
      inProgressPhrase: (agent) => `${agent} is starting a recording…`,
    },

    stop_recording: {
      phrase: ({ outcomeSummary, failed }, agent) => {
        if (failed) return `${agent} tried to stop recording`;
        const m = /^Recorded (\d+) (?:step|steps) on /.exec(outcomeSummary);
        const n = m ? Number(m[1]) : 0;
        return `${agent} stopped recording: ${n} ${plural(n, "step", "steps")}`;
      },
      inProgressPhrase: (agent) => `${agent} is stopping the recording…`,
    },

    export_test: {
      phrase: ({ input, failed }, agent) => {
        if (failed) return `${agent} tried to export a test`;
        const format = str(input.format);
        if (format === "playwright") {
          return `${agent} exported a Playwright spec`;
        }
        if (format === "bdd") {
          return `${agent} exported a BDD case`;
        }
        return `${agent} exported a test`;
      },
      inProgressPhrase: (agent) => `${agent} is exporting a test…`,
    },

    start_debugging: {
      phrase: ({ input, failed }, agent) =>
        failed
          ? `${agent} tried to start debugging`
          : `${agent} started debugging ${hostFor(input.tabId)}`,
      inProgressPhrase: (agent) => `${agent} is starting to debug…`,
    },

    stop_debugging: {
      phrase: ({ input, failed }, agent) =>
        failed
          ? `${agent} tried to stop debugging`
          : `${agent} stopped debugging ${hostFor(input.tabId)}`,
      inProgressPhrase: (agent) => `${agent} is stopping debugging…`,
    },

    page_hover: {
      phrase: ({ outcomeSummary, failed }, agent) => {
        if (failed) return `${agent} tried to hover over an element`;
        const m = /^Hovered \[[^\]]+\] ([^.]+)\./.exec(outcomeSummary);
        return m ? `${agent} hovered over ${describeThing(m[1].trim())}` : `${agent} hovered over an element`;
      },
      inProgressPhrase: (agent) => `${agent} is hovering…`,
    },

    page_press_key: {
      phrase: ({ outcomeSummary, failed }, agent) => {
        if (failed) return `${agent} tried to press a key`;
        const m = /^Pressed (.+?)\./.exec(outcomeSummary);
        return m ? `${agent} pressed ${m[1]}` : `${agent} pressed a key`;
      },
      inProgressPhrase: (agent) => `${agent} is pressing a key…`,
    },

    page_upload_file: {
      phrase: ({ outcomeSummary, failed }, agent) => {
        if (failed) return `${agent} tried to upload a file`;
        const m = /^Uploaded (\d+) (?:file|files) /.exec(outcomeSummary);
        const n = m ? Number(m[1]) : 1;
        return `${agent} uploaded ${n} ${plural(n, "file", "files")}`;
      },
      inProgressPhrase: (agent) => `${agent} is uploading…`,
    },

    page_emulate: {
      phrase: ({ input, outcomeSummary, failed }, agent) => {
        if (failed) return `${agent} tried to change the emulation`;
        if (outcomeSummary.startsWith("Emulation was reset.")) return `${agent} reset the emulation`;
        const preset = str(input.preset);
        if (preset) return `${agent} set the emulation to ${preset}`;
        const w = num(input.width);
        const h = num(input.height);
        return w !== undefined && h !== undefined
          ? `${agent} set the emulation to ${w} × ${h}`
          : `${agent} set the emulation`;
      },
      inProgressPhrase: (agent) => `${agent} is changing the emulation…`,
    },

    page_screenshot: {
      phrase: ({ input, outcomeSummary, failed }, agent) => {
        if (failed) return `${agent} tried to take a screenshot`;
        if (input.fullPage === true) return `${agent} took a full-page screenshot`;
        const m = /^Screenshot of \[[^\]]+\] (.+), \d+ × \d+\.$/.exec(outcomeSummary);
        if (m) return `${agent} took a screenshot of ${describeThing(m[1].trim())}`;
        return `${agent} took a screenshot`;
      },
      inProgressPhrase: (agent) => `${agent} is taking a screenshot…`,
    },
  };
}

/** Returns a copy of `tools` with each tool's own phrase attached. A tool with
 *  no entry is returned unchanged, so `page_eval`, `page_fetch` and
 *  `page_console` keep their "used the tool" lines. */
export function attachPhrases(
  tools: CustomToolDef[],
  hostFor: (tabId: unknown) => string,
): CustomToolDef[] {
  const table = pageToolPhrases(hostFor);
  return tools.map((t) => {
    const entry = table[t.name];
    return entry ? { ...t, phrase: entry.phrase, inProgressPhrase: entry.inProgressPhrase } : t;
  });
}
