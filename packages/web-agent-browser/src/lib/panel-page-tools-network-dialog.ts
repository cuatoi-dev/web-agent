// page_network, page_dialog and page_upload_file on the debugger.
// The network log and dialog answers live in the side panel's debugger session
// (debugger-session.ts); only page_upload_file reaches into the page, to build
// the files there. Replaces the earlier in-page hooks.
import { z } from "zod";
import type { CustomToolDef } from "@cuatoi/web-agent-core";
import { DEFAULT_NETWORK_REQ_BODY_CHARS, DEFAULT_NETWORK_RES_BODY_CHARS } from "./constants";
import { base64ByteLength, cap, formatHeaders, networkLine, originOf } from "./debugger-network";
import { createDebuggerSession } from "./debugger-session";
import { createHelperWorlds, STALE_REF } from "./debugger-helper-world";
import { basename, formatSize, resolveFiles } from "./upload-files";
import type { HelperDescribe } from "./helper-api";
import type { ElementTarget, PanelPageToolsOptions } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function tabIdText(input: Record<string, unknown>): string {
  return typeof input.tabId === "number" || typeof input.tabId === "string" ? String(input.tabId) : "(none)";
}

export function createNetworkDialogPageTools(options: PanelPageToolsOptions): CustomToolDef[] {
  // createPanelPageTools always passes one; a direct caller gets its own.
  const session = options.debuggerSession ?? createDebuggerSession();
  const helper = options.helper ?? createHelperWorlds(session);

  const pageNetwork: CustomToolDef = {
    name: "page_network",
    description:
      "Read every request an activated browser tab's page made since start_debugging: page loads, scripts, stylesheets, images, fetch and XHR, including page requests a service worker answers. Requests a service worker makes itself are not listed. Call read_tabs first and pass the tab ID it reports. Pass index to get one request's headers and bodies, or filter to list only requests whose URL contains that text. The dialogs answered while debugging are listed at the end. Needs start_debugging on the tab first.",
    inputSchema: z.object({
      tabId: z.number().describe("The ID of the tab. Call read_tabs first and pass the ID it reports."),
      filter: z.string().optional().describe("Only list requests whose URL contains this text (case does not matter)."),
      index: z.number().optional().describe("The request number to show in full, e.g. 3 for #3."),
    }),
    summarize: (input) => `Network log in tab #${tabIdText(input)}`,
    execute: async (input) => {
      const tabId = Number(input.tabId);
      const g = session.gate(tabId);
      if (!g.ok) return { content: g.error, isError: true };
      const s = g.state;
      const pageOrigin = originOf(await session.tabUrl(tabId));

      if (typeof input.index === "number") {
        const index = input.index;
        const e = s.network.find((entry) => entry.seq === index);
        if (!e) return { content: `Request #${index} was not seen, or it fell out of the 200-entry buffer.` };
        let requestBody = e.postData;
        if (requestBody === undefined && e.hasPostData) {
          const r = await session.send(tabId, "Network.getRequestPostData", { requestId: e.requestId });
          requestBody = isRecord(r) && typeof r.postData === "string" ? r.postData : undefined;
        }
        let responseBody: string;
        try {
          const r = await session.send(tabId, "Network.getResponseBody", { requestId: e.requestId });
          const body = isRecord(r) && typeof r.body === "string" ? r.body : "";
          responseBody = isRecord(r) && r.base64Encoded === true ? `(binary, ${base64ByteLength(body)} bytes)` : body;
        } catch {
          responseBody = "(body no longer available)";
        }
        return {
          content:
            networkLine(e, pageOrigin) +
            "\nRequest headers\n" +
            formatHeaders(e.requestHeaders) +
            (requestBody ? "\nRequest body\n" + cap(requestBody, DEFAULT_NETWORK_REQ_BODY_CHARS) : "") +
            "\nResponse headers\n" +
            formatHeaders(e.responseHeaders ?? {}) +
            "\nResponse body\n" +
            cap(responseBody, DEFAULT_NETWORK_RES_BODY_CHARS),
        };
      }

      const filter = typeof input.filter === "string" && input.filter !== "" ? input.filter : undefined;
      const rows = filter
        ? s.network.filter((e) => e.url.toLowerCase().includes(filter.toLowerCase()))
        : s.network;
      let out = rows.length
        ? `Requests since debugging started (${rows.length}${filter ? ` matching "${filter}"` : ""}):\n` +
          rows.map((e) => networkLine(e, pageOrigin)).join("\n")
        : "No requests captured since debugging started" + (filter ? ` matching "${filter}".` : ".");
      if (s.dialogs.length) out += "\nDialogs:\n" + s.dialogs.join("\n");
      return { content: out };
    },
  };

  const pageDialog: CustomToolDef = {
    name: "page_dialog",
    description:
      "Choose how the next alert, confirm, prompt or \"Leave site?\" dialog on a browser tab is answered, in any frame. The answer applies to one dialog only; a dialog with no answer set is dismissed. Call read_tabs first and pass the tab ID it reports. Needs start_debugging on the tab first.",
    inputSchema: z.object({
      tabId: z.number().describe("The ID of the tab. Call read_tabs first and pass the ID it reports."),
      accept: z.boolean().describe("Accept the next dialog (true) or dismiss it (false)."),
      promptText: z.string().optional().describe("Text a prompt receives when accepted."),
    }),
    summarize: (input) => `Configure next dialog in tab #${tabIdText(input)}: accept=${String(input.accept)}`,
    execute: (input) => {
      const tabId = Number(input.tabId);
      const g = session.gate(tabId);
      if (!g.ok) return Promise.resolve({ content: g.error, isError: true });
      const accept = Boolean(input.accept);
      const promptText = typeof input.promptText === "string" ? input.promptText : undefined;
      g.state.dialogPlan = promptText !== undefined ? { accept, promptText } : { accept };
      return Promise.resolve({
        content:
          `The next dialog will be ${accept ? "accepted" : "dismissed"}.` +
          (promptText !== undefined ? ` A prompt will receive "${promptText}".` : "") +
          (g.state.lastDialog ? ` Last dialog: ${g.state.lastDialog}` : ""),
      });
    },
  };

  const pageUploadFile: CustomToolDef = {
    name: "page_upload_file",
    description:
      "Set files on a file input in a browser tab by its ref from page_snapshot, then fire its input and change events. You write each file's content yourself: text, base64, or a size in bytes with a one-character fill. Or pass path to upload a file from your file system, such as a screenshot saved by page_screenshot; name and mimeType then default from the path. At most 10 MB in total per call. Call read_tabs first and pass the tab ID it reports. Needs start_debugging on the tab first.",
    inputSchema: z.object({
      tabId: z.number().describe("The ID of the tab. Call read_tabs first and pass the ID it reports."),
      ref: z.string().describe('The ref of an <input type="file"> from a page_snapshot call, e.g. "14".'),
      files: z
        .array(
          z.object({
            path: z
              .string()
              .optional()
              .describe(
                "An absolute path in your file system, e.g. the path page_screenshot reports. Pass instead of text, base64, or size and fill.",
              ),
            name: z
              .string()
              .optional()
              .describe('File name, e.g. "orders.csv". Optional with path (defaults from path); required otherwise.'),
            mimeType: z
              .string()
              .optional()
              .describe('MIME type, e.g. "text/csv". Optional with path (defaults from path); required otherwise.'),
            text: z.string().optional().describe("The file content as text (stored as UTF-8)."),
            base64: z.string().optional().describe("The file content as base64."),
            size: z.number().optional().describe("A generated file's size in bytes; pass with fill."),
            fill: z.string().optional().describe("One character repeated to fill a generated file; pass with size."),
          }),
        )
        .describe("The files. Each file passes exactly one of: text, base64, size and fill, or path."),
    }),
    summarize: (input) => {
      const ref = typeof input.ref === "string" ? input.ref : "";
      const files = Array.isArray(input.files) ? input.files : [];
      const n = files.length;
      if (n === 1 && isRecord(files[0]) && typeof files[0].path === "string" && files[0].path !== "") {
        const p = files[0].path;
        const name = typeof files[0].name === "string" && files[0].name !== "" ? files[0].name : basename(p);
        return `Upload ${name} from ${p} to [${ref}] in tab #${tabIdText(input)}`;
      }
      return `Upload ${n} ${n === 1 ? "file" : "files"} to [${ref}] in tab #${tabIdText(input)}`;
    },
    execute: async (input) => {
      const tabId = Number(input.tabId);
      const g = session.gate(tabId);
      if (!g.ok) return { content: g.error, isError: true };
      const resolved = await resolveFiles(input.files, options.vfs);
      if (!resolved.ok) return { content: resolved.error, isError: true };
      const ref = typeof input.ref === "string" ? input.ref : "";

      const d = await helper.call<HelperDescribe>(tabId, ref, "describe", [ref]);
      if (!d.ok) return { content: d.error, isError: true };
      if (!d.value.connected) return { content: STALE_REF(ref), isError: true };
      if (d.value.refusal !== undefined) return { content: d.value.refusal, isError: true };

      const set = await helper.call<
        { ok: true; desc: string; sizes: number[]; target: ElementTarget } | { ok: false; message: string }
      >(tabId, ref, "setFiles", [ref, resolved.files]);
      if (!set.ok) return { content: set.error, isError: true };
      const result = set.value;
      if (!result.ok) return { content: result.message, isError: true };

      const n = resolved.files.length;
      const list = resolved.files
        .map((f, i) => {
          const sizeText = formatSize(result.sizes[i] ?? 0);
          const src = resolved.sources[i];
          return src ? `${f.name} (${sizeText}, from ${src})` : `${f.name} (${sizeText})`;
        })
        .join(", ");
      const content = `Uploaded ${n} ${n === 1 ? "file" : "files"} to [${ref}] ${result.desc}: ${list}.`;
      return { content };
    },
  };

  return [pageNetwork, pageDialog, pageUploadFile];
}
