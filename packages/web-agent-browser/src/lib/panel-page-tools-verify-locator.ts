// 122/002 — the panel's page_verify and page_generate_locator.
// 131/002 — both moved onto the debugger's helper world; no forwardToTab, no
// activation check.
import { z } from "zod";
import type { CustomToolDef } from "@cuatoi/web-agent-core";
import { AGENT_UI_SELECTOR } from "./constants";
import { createDebuggerSession } from "./debugger-session";
import { createHelperWorlds, STALE_REF } from "./debugger-helper-world";
import { checkEntry, createActionJournal, journalSuffix, notJournaledSuffix } from "./action-journal";
import type { HelperDescribe } from "./helper-api";
import type { VerifyOutcome, PanelPageToolsOptions } from "./types";

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v !== "";

/** The plan's per-kind required input. Returns the error text, or undefined. */
export function verifyInputError(input: Record<string, unknown>): string | undefined {
  const kind = String(input.kind);
  const needs = (field: string) => `page_verify kind "${kind}" needs ${field}.`;
  switch (input.kind) {
    case "element_visible":
      return nonEmpty(input.ref) || nonEmpty(input.role) ? undefined : needs("ref or role");
    case "text_visible":
      return nonEmpty(input.text) ? undefined : needs("text");
    case "value":
      if (!nonEmpty(input.ref)) return needs("ref");
      return typeof input.value === "string" ? undefined : needs("value");
    case "list":
      if (!Array.isArray(input.items) || input.items.length === 0) return needs("items");
      return nonEmpty(input.ref) || nonEmpty(input.role) ? undefined : needs("ref or role");
    default:
      return undefined;
  }
}

export function createVerifyLocatorPageTools(options: PanelPageToolsOptions): CustomToolDef[] {
  const session = options.debuggerSession ?? createDebuggerSession();
  const helper = options.helper ?? createHelperWorlds(session);
  const journal = options.journal ?? createActionJournal();

  const pageVerify: CustomToolDef = {
    name: "page_verify",
    description:
      "Check what a browser tab's page shows and get one PASS or FAIL line. Call read_tabs first and pass the tab ID it reports. kind element_visible needs ref, or role (name optional); text_visible needs text; value needs ref and value; list needs items, and ref or role (name optional). A FAIL is a normal result, not an error. Needs start_debugging on the tab first.",
    inputSchema: z.object({
      tabId: z.number().describe("The ID of the tab. Call read_tabs first and pass the ID it reports."),
      kind: z.enum(["element_visible", "text_visible", "value", "list"]).describe("Which check to run."),
      role: z.string().optional().describe('An ARIA role as page_snapshot prints it, e.g. "button" or "list".'),
      name: z.string().optional().describe("Part of the accessible name; matching ignores case and extra spaces."),
      text: z.string().optional().describe("For text_visible: text that must be visible on the page."),
      ref: z.string().optional().describe("A ref from a page_snapshot call."),
      value: z.string().optional().describe("For value: the exact value the field must have."),
      items: z.array(z.string()).optional().describe("For list: texts the list must show."),
    }),
    summarize: (input) => {
      const tabIdText = typeof input.tabId === "number" || typeof input.tabId === "string" ? String(input.tabId) : "(none)";
      const kind = typeof input.kind === "string" ? input.kind : "";
      return `Verify ${kind} in tab #${tabIdText}`;
    },
    execute: async (input) => {
      const tabId = Number(input.tabId);
      const g = session.gate(tabId);
      if (!g.ok) return { content: g.error, isError: true };
      const inputError = verifyInputError(input);
      if (inputError) return { content: inputError, isError: true };

      // element_visible / value / list WITH a ref act on that element; text_visible
      // and the by-role forms act on the document element, exactly as the plan says.
      const ref = typeof input.ref === "string" && input.ref !== "" ? input.ref : undefined;
      const verifyInput = {
        kind: input.kind,
        role: input.role,
        name: input.name,
        text: input.text,
        ref: input.ref,
        value: input.value,
        items: input.items,
      };
      if (ref !== undefined) {
        const d = await helper.call<HelperDescribe>(tabId, ref, "describe", [ref]);
        if (!d.ok) return { content: d.error, isError: true };
        if (!d.value.connected) return { content: STALE_REF(ref), isError: true };
      }
      const r =
        ref === undefined
          ? await helper.callOnDocument<VerifyOutcome>(tabId, "verify", [verifyInput, AGENT_UI_SELECTOR])
          : await helper.call<VerifyOutcome>(tabId, ref, "verify", [verifyInput, AGENT_UI_SELECTOR]);
      if (!r.ok) return { content: r.error, isError: true };

      if (r.value.isError || !r.value.text.startsWith("PASS ")) {
        return { content: r.value.text, isError: r.value.isError };
      }
      const chain = ref === undefined ? [] : await helper.frameChain(tabId, ref);
      const entry = checkEntry(input, r.value.target, chain);
      if (!entry) return { content: r.value.text + notJournaledSuffix(r.value.target?.label ?? "") };
      return { content: r.value.text + journalSuffix(journal.append([entry])) };
    },
  };

  const pageGenerateLocator: CustomToolDef = {
    name: "page_generate_locator",
    description:
      "Turn a ref from page_snapshot into a Playwright locator that matches exactly one element on a browser tab's page. Call read_tabs first and pass the tab ID it reports. The result ends with \"(by position)\" when only .nth() makes it unique, which is fragile. Needs start_debugging on the tab first.",
    inputSchema: z.object({
      tabId: z.number().describe("The ID of the tab. Call read_tabs first and pass the ID it reports."),
      ref: z.string().describe('A ref from a page_snapshot call, e.g. "7".'),
    }),
    summarize: (input) => {
      const tabIdText = typeof input.tabId === "number" || typeof input.tabId === "string" ? String(input.tabId) : "(none)";
      const ref = typeof input.ref === "string" ? input.ref : "";
      return `Locator for [${ref}] in tab #${tabIdText}`;
    },
    execute: async (input) => {
      const tabId = Number(input.tabId);
      const ref = typeof input.ref === "string" ? input.ref : "";
      const g = session.gate(tabId);
      if (!g.ok) return { content: g.error, isError: true };

      const d = await helper.call<HelperDescribe>(tabId, ref, "describe", [ref]);
      if (!d.ok) return { content: d.error, isError: true };
      if (!d.value.connected) return { content: STALE_REF(ref), isError: true };
      if (d.value.refusal !== undefined) return { content: d.value.refusal, isError: true };

      const built = await helper.call<{ text: string; isError: boolean }>(tabId, ref, "locator", [ref, d.value.desc]);
      if (!built.ok) return { content: built.error, isError: true };
      return built.value.isError ? { content: built.value.text, isError: true } : { content: built.value.text };
    },
  };

  return [pageVerify, pageGenerateLocator];
}
