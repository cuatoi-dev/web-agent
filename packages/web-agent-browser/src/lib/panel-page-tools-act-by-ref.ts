// The four act-by-ref page tools (122/001): page_snapshot, page_click,
// page_fill_form, page_select_option. Split out of panel-page-tools.ts on
// 2026-09-17 to stay under that file's 500-line cap (eslint.config.mjs
// max-lines) — `createPanelPageTools` spreads `createActByRefPageTools(options)`
// into its own tool list, so the two files share one `PanelPageToolsOptions`
// shape.
//
// 131/002 — every tool below moved off the page script onto the debugger.
// Every ref tool follows this order:
//   1. const tabId = Number(input.tabId)
//   2. const g = session.gate(tabId); if (!g.ok) return { content: g.error, isError: true }
//   3. tool-specific input validation, in today's order and with today's texts
//   4. const d = await helper.call<HelperDescribe>(tabId, ref, "describe", [ref])
//      - d.ok === false                  -> { content: d.error, isError: true }
//      - d.value.connected === false     -> { content: STALE_REF(ref), isError: true }
//      - d.value.refusal !== undefined   -> { content: d.value.refusal, isError: true }
//   5. permission === "ask" && options.confirmInteraction  -> today's confirm and
//      today's "was not confirmed" text on a decline (NOT an error)
//   6. act
//   7. today's result text
// page_hover skips step 5 (it has no confirm today). page_snapshot skips 5-7.
import { z } from "zod";
import type { CustomToolDef } from "@cuatoi/web-agent-core";
import { errorMessage } from "./error-message";
import { createDebuggerSession } from "./debugger-session";
import { createHelperWorlds, SCOPE_MISSING, STALE_REF } from "./debugger-helper-world";
import type { RefTarget } from "./debugger-helper-world.types";
import { renderAxSnapshot } from "./ax-snapshot";
import { collectAxFrames } from "./panel-frame-snapshot";
import type { HelperDescribe } from "./helper-api";
import type { SelectPrepareResult } from "./helper-api-actions";
import type { PanelPageToolsOptions } from "./types";

export function createActByRefPageTools(options: PanelPageToolsOptions): CustomToolDef[] {
  // createPanelPageTools always passes one; a direct caller gets its own.
  const session = options.debuggerSession ?? createDebuggerSession();
  const helper = options.helper ?? createHelperWorlds(session);

  /** A debugger command failed. If Chrome's Cancel or a closed tab caused it,
   *  the gate now says so; otherwise the browser's own message is returned. */
  const commandFailure = (tabId: number, err: unknown): string => {
    const g = session.gate(tabId);
    return g.ok ? errorMessage(err) : g.error;
  };

  const pageSnapshot: CustomToolDef = {
    name: "page_snapshot",
    description:
      "Take a text snapshot of a browser tab's page from Chrome's accessibility tree, with refs for use with page_click, page_fill_form and page_select_option. Call read_tabs first and pass the tab ID it reports. Needs start_debugging on the tab first. A ref stays valid for as long as its element is on the page, across snapshots. A ref inside a cross-site iframe looks like \"f1:12\" — pass it exactly as printed.",
    inputSchema: z.object({
      tabId: z.number().describe("The ID of the tab to snapshot. Call read_tabs first and pass the ID it reports."),
      scope: z.string().optional().describe("A ref from an earlier page_snapshot to expand just that subtree."),
      include_text: z
        .string()
        .optional()
        .describe("Only include elements whose text, label, placeholder or value contains this term."),
    }),
    ttl: 1,
    uttl: 2,
    summarize: (input) => {
      const tabIdText =
        typeof input.tabId === "number" || typeof input.tabId === "string" ? String(input.tabId) : "(none)";
      return `Snapshot tab #${tabIdText}`;
    },
    execute: async (input) => {
      const tabId = Number(input.tabId);
      const g = session.gate(tabId);
      if (!g.ok) return { content: g.error, isError: true };
      const scope = typeof input.scope === "string" ? input.scope : undefined;
      const include_text = typeof input.include_text === "string" ? input.include_text : undefined;

      // 131/003 — a scope ref may name a frame ("f1:23"); only its SHAPE is
      // checked here, because the snapshot itself decides whether the node is
      // still there (SCOPE_MISSING below).
      if (scope !== undefined) {
        const parsed = helper.parseRef(scope);
        if (!parsed.ok) return { content: parsed.error, isError: true };
      }

      let frames;
      try {
        frames = await collectAxFrames(session, tabId);
      } catch (err) {
        return { content: commandFailure(tabId, err), isError: true };
      }
      const rendered = renderAxSnapshot({ frames, scopeRef: scope, includeText: include_text });
      if (rendered.kind === "scope-missing") {
        return { content: SCOPE_MISSING(scope ?? ""), isError: true };
      }
      // Every ref this snapshot printed, and the frame it came from, so a later
      // page_click on "f1:7" knows which session to talk to.
      session.frames.rememberRefs(tabId, rendered.refs);
      return { content: rendered.text };
    },
  };

  const pageClick: CustomToolDef = {
    name: "page_click",
    description:
      "Click an element in a browser tab by its ref from page_snapshot. Call read_tabs first and pass the tab ID it reports. An element with an \"ask\" interaction policy shows the user a confirm dialog first; an element with a \"block\" policy refuses. Needs start_debugging on the tab first.",
    inputSchema: z.object({
      tabId: z.number().describe("The ID of the tab. Call read_tabs first and pass the ID it reports."),
      ref: z.string().describe('A ref from a page_snapshot call, e.g. "3".'),
    }),
    summarize: (input) => {
      const tabIdText =
        typeof input.tabId === "number" || typeof input.tabId === "string" ? String(input.tabId) : "(none)";
      const ref = typeof input.ref === "string" ? input.ref : "";
      return `Click [${ref}] in tab #${tabIdText}`;
    },
    execute: async (input) => {
      const tabId = Number(input.tabId);
      const ref = typeof input.ref === "string" ? input.ref : "";

      const gate = session.gate(tabId);
      if (!gate.ok) return { content: gate.error, isError: true };

      const d = await helper.call<HelperDescribe>(tabId, ref, "describe", [ref]);
      if (!d.ok) return { content: d.error, isError: true };
      if (!d.value.connected) return { content: STALE_REF(ref), isError: true };
      if (d.value.refusal !== undefined) return { content: d.value.refusal, isError: true };

      if (d.value.permission === "ask" && options.confirmInteraction) {
        const ok = await options.confirmInteraction({
          action: "click",
          ref,
          name: d.value.name,
          reason: d.value.reason,
        });
        if (!ok) {
          return {
            content: `Action "click" on [${ref}]${d.value.name ? ` "${d.value.name}"` : ""} was not confirmed by the user; not performed.`,
          };
        }
      }

      const c = await helper.centre(tabId, ref);
      if (!c.ok) return { content: c.error, isError: true };

      await options.recording?.pause(tabId);
      try {
        await session.realClick(tabId, c.x, c.y);
      } catch (err) {
        return { content: commandFailure(tabId, err), isError: true };
      } finally {
        await options.recording?.resume(tabId);
      }

      return { content: `Clicked [${ref}] ${d.value.desc}.` };
    },
  };

  const pageFillForm: CustomToolDef = {
    name: "page_fill_form",
    description:
      "Fill one or more fields in a browser tab by their refs from page_snapshot, in one call. Call read_tabs first and pass the tab ID it reports. Every field is validated before any of them is filled, so a bad ref leaves the whole form untouched. Needs start_debugging on the tab first.",
    inputSchema: z.object({
      tabId: z.number().describe("The ID of the tab. Call read_tabs first and pass the ID it reports."),
      fields: z
        .array(
          z.object({
            ref: z.string().describe("A ref from a page_snapshot call."),
            value: z.string().describe("The text to type into that field."),
          }),
        )
        .describe("One or more fields to fill, each with a ref and a value."),
    }),
    summarize: (input) => {
      const tabIdText =
        typeof input.tabId === "number" || typeof input.tabId === "string" ? String(input.tabId) : "(none)";
      const count = Array.isArray(input.fields) ? input.fields.length : 0;
      return `Fill ${count} field${count === 1 ? "" : "s"} in tab #${tabIdText}`;
    },
    execute: async (input) => {
      const tabId = Number(input.tabId);

      const gate = session.gate(tabId);
      if (!gate.ok) return { content: gate.error, isError: true };

      const fields = Array.isArray(input.fields) ? (input.fields as { ref: string; value: string }[]) : [];
      if (fields.length === 0) {
        return { content: "page_fill_form needs at least one field.", isError: true };
      }

      // Pre-pass: describe every field before filling any, so a bad ref leaves
      // the form untouched (today's PAGE_FILL_PREPARE_MESSAGE two-phase shape).
      const descriptions: HelperDescribe[] = [];
      const targets: RefTarget[] = [];
      for (const f of fields) {
        const parsed = helper.resolve(tabId, f.ref);
        if (!parsed.ok) return { content: parsed.error, isError: true };
        const d = await helper.call<HelperDescribe>(tabId, f.ref, "describe", [f.ref]);
        if (!d.ok) return { content: d.error, isError: true };
        if (!d.value.connected) return { content: STALE_REF(f.ref), isError: true };
        if (d.value.refusal !== undefined) return { content: d.value.refusal, isError: true };
        descriptions.push(d.value);
        targets.push(parsed.at);
      }

      if (options.confirmInteraction) {
        for (let i = 0; i < fields.length; i++) {
          const d = descriptions[i];
          if (d.permission !== "ask") continue;
          const ok = await options.confirmInteraction({ action: "fill", ref: fields[i].ref, name: d.name, reason: d.reason });
          if (!ok) {
            return {
              content: `Action "fill" on [${fields[i].ref}]${d.name ? ` "${d.name}"` : ""} was not confirmed by the user; no fields filled.`,
            };
          }
        }
      }

      const doneDescriptions: string[] = [];
      const mismatches: string[] = [];
      // Same text the removed in-page fill handler produced (content-act-by-ref.ts:152-159).
      const failed = (ref: string, message: string) => {
        const doneList =
          doneDescriptions.length > 0
            ? `Filled ${doneDescriptions.length} of ${fields.length} fields: ${doneDescriptions.join(", ")}.`
            : `Filled ${doneDescriptions.length} of ${fields.length} fields.`;
        return { content: `${doneList} Field [${ref}] failed: ${message}`, isError: true };
      };

      await options.recording?.pause(tabId);
      try {
        for (let i = 0; i < fields.length; i++) {
          const f = fields[i];
          const d = descriptions[i];

          try {
            await session.send(tabId, "DOM.focus", { backendNodeId: targets[i].backendNodeId }, targets[i].sessionId);
          } catch (err) {
            const g = session.gate(tabId);
            if (!g.ok) return { content: g.error, isError: true };
            return failed(f.ref, errorMessage(err));
          }

          const prepared = await helper.call<{ ok: true; hadText: boolean } | { ok: false; message: string }>(
            tabId,
            f.ref,
            "fillPrepare",
            [f.ref],
          );
          if (!prepared.ok) return failed(f.ref, prepared.error);
          if (!prepared.value.ok) return failed(f.ref, prepared.value.message);

          try {
            if (prepared.value.hadText) await session.pressBackspace(tabId);
            await session.insertText(tabId, f.value);
          } catch (err) {
            const g = session.gate(tabId);
            if (!g.ok) return { content: g.error, isError: true };
            return failed(f.ref, errorMessage(err));
          }

          const description = `[${f.ref}] ${d.desc}`.trim();
          doneDescriptions.push(description);

          const readBack = await helper.call<{ value?: string }>(tabId, f.ref, "readValue", []);
          if (readBack.ok && readBack.value.value !== undefined && readBack.value.value !== f.value) {
            mismatches.push(`${description}: set "${f.value}" but value read back as "${readBack.value.value}".`);
          }
        }
      } finally {
        await options.recording?.resume(tabId);
      }

      const plural = doneDescriptions.length === 1 ? "field" : "fields";
      let content = `Filled ${doneDescriptions.length} ${plural}: ${doneDescriptions.join(", ")}.`;
      if (mismatches.length > 0) {
        content += `\n${mismatches.join("\n")}`;
      }
      return { content };
    },
  };

  const pageSelectOption: CustomToolDef = {
    name: "page_select_option",
    description:
      "Choose one or more options in a <select> element in a browser tab by its ref from page_snapshot. Call read_tabs first and pass the tab ID it reports. A single-choice select accepts exactly one value; a multi-select accepts one or more. Needs start_debugging on the tab first.",
    inputSchema: z.object({
      tabId: z.number().describe("The ID of the tab. Call read_tabs first and pass the ID it reports."),
      ref: z.string().describe("A <select> ref from a page_snapshot call."),
      values: z
        .array(z.string())
        .describe("One value for a single-choice select, or one or more values for a multi-select."),
    }),
    summarize: (input) => {
      const tabIdText =
        typeof input.tabId === "number" || typeof input.tabId === "string" ? String(input.tabId) : "(none)";
      const ref = typeof input.ref === "string" ? input.ref : "";
      const values = Array.isArray(input.values) ? input.values.join(", ") : "";
      return `Select ${values} in [${ref}] in tab #${tabIdText}`;
    },
    execute: async (input) => {
      const tabId = Number(input.tabId);
      const ref = typeof input.ref === "string" ? input.ref : "";
      const values = Array.isArray(input.values) ? (input.values as string[]).filter((v) => typeof v === "string") : [];
      if (values.length === 0) {
        return { content: "page_select_option needs at least one value.", isError: true };
      }

      const gate = session.gate(tabId);
      if (!gate.ok) return { content: gate.error, isError: true };

      const d = await helper.call<HelperDescribe>(tabId, ref, "describe", [ref]);
      if (!d.ok) return { content: d.error, isError: true };
      if (!d.value.connected) return { content: STALE_REF(ref), isError: true };
      if (d.value.refusal !== undefined) return { content: d.value.refusal, isError: true };

      const prepared = await helper.call<SelectPrepareResult>(tabId, ref, "selectPrepare", [ref, values]);
      if (!prepared.ok) return { content: prepared.error, isError: true };
      if (!prepared.value.ok) return { content: prepared.value.message, isError: true };

      if (d.value.permission === "ask" && options.confirmInteraction) {
        const ok = await options.confirmInteraction({
          action: "select_option",
          ref,
          name: d.value.name,
          reason: d.value.reason,
        });
        if (!ok) {
          return {
            content: `Action "select_option" on [${ref}]${d.value.name ? ` "${d.value.name}"` : ""} was not confirmed by the user; not performed.`,
          };
        }
      }

      const executed = await helper.call<{ text: string }>(tabId, ref, "selectExecute", [ref, values]);
      if (!executed.ok) return { content: executed.error, isError: true };
      return { content: executed.value.text };
    },
  };

  return [pageSnapshot, pageClick, pageFillForm, pageSelectOption];
}
