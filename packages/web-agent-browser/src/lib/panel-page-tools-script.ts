// page_eval, page_fetch and page_console on the Chrome debugger.
// None of them touches the page script: each one gates on the tab's debugger
// session and then talks CDP. The inputs, the validation order and the result
// texts are the ones these tools already had.
import { z } from "zod";
import type { CustomToolDef } from "@cuatoi/web-agent-core";
import {
  DEFAULT_PAGE_CONSOLE_MAX_CHARS,
  DEFAULT_PAGE_EVAL_MAX_CHARS,
  DEFAULT_PAGE_EVAL_TIMEOUT_MS,
  DEFAULT_PAGE_FETCH_MAX_CHARS,
  DEFAULT_PAGE_FETCH_TIMEOUT_MS,
  MAX_PAGE_EVAL_TIMEOUT_MS,
  MIN_PAGE_EVAL_TIMEOUT_MS,
} from "./constants";
import { describeValue, truncate } from "../core/run-eval";
import { PAGE_DESCRIBE_SOURCE, PAGE_FETCH_SOURCE } from "./cdp-page-source";
import { errorMessage, thrownFromDetails } from "./error-message";
import { createHelperWorlds, STALE_REF } from "./debugger-helper-world";
import type { HelperWorlds } from "./debugger-helper-world.types";
import type { DebuggerSession } from "./debugger-tools.types";
import type { DescribedValue, PanelPageToolsOptions } from "./types";

/** `page_eval`'s answer when its own timer fired and the script was stopped. */
const EVAL_STOPPED = (timeoutMs: number) =>
  `page_eval stopped the script after ${timeoutMs} ms: it was still running. The tab is responsive again.`;

/** The session is missing entirely (no debuggerSession option). Same text the
 *  gate gives, so the agent is told the same thing either way. */
const NOT_DEBUGGING = (tabId: number) =>
  `Debugging is not started on tab #${tabId}. Call start_debugging first.`;

/** `page_eval`'s answer when `frame` is a ref, but not an iframe's ref. */
const NOT_A_FRAME = "frame must be the ref of an iframe from page_snapshot.";

/** Which session and context `page_eval` should run in. `{ sessionId }` alone
 *  means "that target's own main world", which is what a cross-site iframe
 *  needs; `contextId` names a same-process frame's main world. */
async function evalTargetFor(
  session: DebuggerSession,
  helper: HelperWorlds,
  tabId: number,
  frameRef: string,
): Promise<{ ok: true; sessionId?: string; contextId?: number } | { ok: false; error: string }> {
  const r = helper.resolve(tabId, frameRef);
  if (!r.ok) return r;
  const { at } = r;
  const described = await session
    .send(tabId, "DOM.describeNode", { backendNodeId: at.backendNodeId }, at.sessionId)
    .catch(() => undefined);
  const node = isRecord(described) && isRecord(described.node) ? described.node : undefined;
  const tag = typeof node?.nodeName === "string" ? node.nodeName.toLowerCase() : "";
  if (tag !== "iframe" && tag !== "frame") return { ok: false, error: NOT_A_FRAME };
  // DOM.Node.frameId is set on frame-owner elements only, and is the id of the
  // frame that element hosts (protocol.d.ts, DOM.Node).
  const frameId = typeof node?.frameId === "string" ? node.frameId : "";
  if (frameId === "") return { ok: false, error: STALE_REF(frameRef) };
  const child = session.frames.childByFrameId(tabId, frameId);
  if (child) return { ok: true, sessionId: child.sessionId };
  const ctx = session.frames.defaultContext(tabId, at.sessionId, frameId);
  // No context means the frame's main world was never announced, so there is
  // nothing to run in; the agent's move is a fresh snapshot.
  if (!ctx) return { ok: false, error: STALE_REF(frameRef) };
  return { ok: true, ...(at.sessionId === undefined ? {} : { sessionId: at.sessionId }), contextId: ctx.contextId };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** A last-resort string for an argument the agent supplied that failed
 *  validation. Moved from panel-page-tools.ts:56-58 unchanged. */
function stringifyInput(value: { toString(): string } | null): string {
  return String(value);
}

/** Race a CDP command against a deadline. The abandoned promise is caught, so
 *  a late rejection is never reported against the panel. */
const DEADLINE: unique symbol = Symbol("cdp-deadline");
async function withDeadline<T>(
  work: Promise<T>,
  timeoutMs: number,
): Promise<{ kind: "ok"; value: T } | { kind: "error"; error: unknown } | { kind: "deadline" }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guarded = work.then(
    (value) => ({ kind: "ok", value }) as const,
    (error: unknown) => ({ kind: "error", error }) as const,
  );
  const deadline = new Promise<typeof DEADLINE>((resolve) => {
    timer = setTimeout(() => resolve(DEADLINE), timeoutMs);
  });
  try {
    const first = await Promise.race([guarded, deadline]);
    return first === DEADLINE ? { kind: "deadline" } : first;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Describe the value `Runtime.evaluate` returned. An object has an objectId,
 *  so the description is computed IN THE PAGE with the same code the bubble
 *  uses. A primitive has no objectId to call on, so the panel describes it
 *  here, with `describeValue` itself. */
async function describeResult(
  session: DebuggerSession,
  tabId: number,
  result: Record<string, unknown>,
  sessionId?: string,
): Promise<DescribedValue> {
  const objectId = str(result.objectId);
  if (objectId) {
    try {
      const answer = await session.send(
        tabId,
        "Runtime.callFunctionOn",
        {
          functionDeclaration: PAGE_DESCRIBE_SOURCE,
          objectId,
          returnByValue: true,
        },
        sessionId,
      );
      const inner = isRecord(answer) && isRecord(answer.result) ? answer.result.value : undefined;
      if (isRecord(inner) && typeof inner.kind === "string" && typeof inner.text === "string") {
        return { kind: inner.kind, text: inner.text };
      }
    } catch {
      // The page navigated and the handle is gone: fall through to the words
      // the RemoteObject already carries.
    } finally {
      void session.send(tabId, "Runtime.releaseObject", { objectId }, sessionId).catch(() => {});
    }
    return {
      kind: str(result.className) ?? str(result.subtype) ?? str(result.type) ?? "object",
      text: str(result.description) ?? "",
    };
  }
  if (result.type === "undefined") return describeValue(undefined);
  if (result.type === "object" && result.subtype === "null") return describeValue(null);
  const unserializable = str(result.unserializableValue);
  if (unserializable !== undefined) {
    return { kind: result.type === "bigint" ? "bigint" : String(result.type), text: unserializable };
  }
  if (result.type === "symbol") return { kind: "symbol", text: str(result.description) ?? "Symbol()" };
  return describeValue(result.value);
}

export function createScriptPageTools(options: PanelPageToolsOptions): CustomToolDef[] {
  const session = options.debuggerSession;
  const helperWorlds = options.helper ?? (session ? createHelperWorlds(session) : undefined);
  const maxChars = options.maxChars ?? DEFAULT_PAGE_EVAL_MAX_CHARS;
  const lastSeenDocumentId = options.lastSeenDocumentId ?? new Map<number, string>();

  const pageEval: CustomToolDef = {
    name: "page_eval",
    description:
      "Run JavaScript in a browser tab's own realm and return the result. Call read_tabs first and pass the tab ID it reports. The code you supply is the body of an async function: use `return` to send a value back, and `await` for anything asynchronous. It sees everything that tab's own scripts see — window, document, and any global, object or function the site defines — so use it to read a page's state, call a function the page already provides, or change the page itself. The user must have activated the extension on that page first. The result is serialized and capped; a value that cannot be serialized comes back described. The code runs on that page's own thread and cannot be interrupted once it starts, so it is bounded by timeoutMs instead. Pass frame with an iframe's ref from page_snapshot to run the code inside that iframe instead of the top page.",
    inputSchema: z.object({
      tabId: z
        .number()
        .describe("The ID of the tab to run the code in. Call read_tabs first and pass the ID it reports."),
      code: z
        .string()
        .describe(
          "JavaScript to run as an async function body in that tab's realm. Use `return` to send a value back, for example: return document.title",
        ),
      timeoutMs: z
        .number()
        .optional()
        .describe(
          "How long to wait for the code, in milliseconds. Between 1000 and 300000. Defaults to 10000. A value outside that range runs nothing.",
        ),
      frame: z
        .string()
        .optional()
        .describe("The ref of an iframe from page_snapshot, to run the code inside that frame."),
    }),
    summarize: (input) => {
      const tabIdText =
        typeof input.tabId === "number" || typeof input.tabId === "string" ? String(input.tabId) : "(none)";
      const code = typeof input.code === "string" ? input.code.trim() : "";
      const firstLine = code.split("\n")[0] ?? "";
      const shown = firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine;
      return `Run JavaScript in tab #${tabIdText}: ${shown}`;
    },
    execute: async (input) => {
      const tabId = Number(input.tabId);
      if (!session) return { content: NOT_DEBUGGING(tabId), isError: true };
      const g = session.gate(tabId);
      if (!g.ok) return { content: g.error, isError: true };

      // Order kept from panel-page-tools.ts:123-141: timeoutMs before the code,
      // and an out-of-range value runs nothing at all.
      const timeoutMs = input.timeoutMs === undefined ? DEFAULT_PAGE_EVAL_TIMEOUT_MS : Number(input.timeoutMs);
      if (!Number.isFinite(timeoutMs) || timeoutMs < MIN_PAGE_EVAL_TIMEOUT_MS || timeoutMs > MAX_PAGE_EVAL_TIMEOUT_MS) {
        return {
          content: `Invalid timeoutMs: ${String(input.timeoutMs)}. Must be between ${MIN_PAGE_EVAL_TIMEOUT_MS} and ${MAX_PAGE_EVAL_TIMEOUT_MS}.`,
          isError: true,
        };
      }
      const code = typeof input.code === "string" ? input.code.trim() : "";
      if (!code) return { content: "No code provided to page_eval.", isError: true };

      // `frame` is validated AFTER timeoutMs and the code, so the
      // existing order of those two messages is unchanged.
      const frameRef = typeof input.frame === "string" ? input.frame : undefined;
      let target: { sessionId?: string; contextId?: number } = {};
      if (frameRef !== undefined) {
        if (!helperWorlds) return { content: NOT_DEBUGGING(tabId), isError: true };
        const chosen = await evalTargetFor(session, helperWorlds, tabId, frameRef);
        if (!chosen.ok) return { content: chosen.error, isError: true };
        target = {
          ...(chosen.sessionId === undefined ? {} : { sessionId: chosen.sessionId }),
          ...(chosen.contextId === undefined ? {} : { contextId: chosen.contextId }),
        };
      }

      // The timer stops the script IN THE PAGE. Terminating makes the pending
      // Runtime.evaluate REJECT (measured 2026-09-19), so `stopped` is what
      // tells the two failure cases apart.
      const stopped = { value: false };
      const timer = setTimeout(() => {
        stopped.value = true;
        // The same session the code runs in, or the script keeps running.
        void session.send(tabId, "Runtime.terminateExecution", undefined, target.sessionId).catch(() => {});
      }, timeoutMs);

      let answer: unknown;
      try {
        answer = await session.send(
          tabId,
          "Runtime.evaluate",
          {
            expression: `(async () => {\n${code}\n})()`,
            awaitPromise: true,
            returnByValue: false,
            ...(target.contextId === undefined ? {} : { contextId: target.contextId }),
          },
          target.sessionId,
        );
      } catch (err) {
        if (stopped.value) return { content: EVAL_STOPPED(timeoutMs), isError: true };
        return { content: `page_eval could not run on tab #${tabId}: ${errorMessage(err)}`, isError: true };
      } finally {
        clearTimeout(timer);
      }
      if (stopped.value) return { content: EVAL_STOPPED(timeoutMs), isError: true };

      const outer = isRecord(answer) ? answer : {};
      if (isRecord(outer.exceptionDetails)) {
        const { name, message } = thrownFromDetails(outer.exceptionDetails);
        return { content: `The code threw ${name}: ${message}`, isError: true };
      }
      const described = await describeResult(
        session,
        tabId,
        isRecord(outer.result) ? outer.result : {},
        target.sessionId,
      );
      return { content: `Result type: ${described.kind}\n\n${truncate(described.text, maxChars)}` };
    },
  };

  const pageFetch: CustomToolDef = {
    name: "page_fetch",
    description:
      "Perform an HTTP request to an activated tab's page origin using that tab's browser session (cookies and credentials). Same-origin only: URLs or paths on other origins are rejected. Returns the HTTP status, content type, and response body.",
    inputSchema: z.object({
      tabId: z
        .number()
        .describe("The ID of the tab to perform the fetch in. Call read_tabs first and pass the ID it reports."),
      url: z
        .string()
        .describe("The relative path (e.g. '/api/items') or same-origin URL (e.g. 'http://localhost:10040/api/items') to fetch."),
      method: z
        .enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])
        .optional()
        .default("GET")
        .describe("HTTP method to use. Defaults to GET."),
      headers: z
        .record(z.string())
        .optional()
        .describe("Optional HTTP headers as key-value pairs."),
      body: z
        .string()
        .optional()
        .describe("Optional request body string (e.g. JSON string)."),
    }),
    summarize: (input) => {
      const tabIdText =
        typeof input.tabId === "number" || typeof input.tabId === "string" ? String(input.tabId) : "(none)";
      const method = typeof input.method === "string" ? input.method : "GET";
      const url = typeof input.url === "string" ? input.url : "";
      return `Fetch in tab #${tabIdText}: ${method} ${url}`.trim();
    },
    execute: async (input) => {
      const tabId = Number(input.tabId);
      if (!session) return { content: NOT_DEBUGGING(tabId), isError: true };
      const g = session.gate(tabId);
      if (!g.ok) return { content: g.error, isError: true };

      const rawUrl = typeof input.url === "string" ? input.url.trim() : "";
      if (!rawUrl) return { content: "No URL or path provided to page_fetch.", isError: true };

      const args = {
        url: rawUrl,
        method: typeof input.method === "string" ? input.method : "GET",
        headers: isRecord(input.headers) ? (input.headers as Record<string, string>) : undefined,
        body: typeof input.body === "string" ? input.body : undefined,
      };
      const raced = await withDeadline(
        session.send(tabId, "Runtime.evaluate", {
          expression: `(${PAGE_FETCH_SOURCE})(${JSON.stringify(args)})`,
          awaitPromise: true,
          returnByValue: true,
        }),
        DEFAULT_PAGE_FETCH_TIMEOUT_MS,
      );
      if (raced.kind === "deadline") {
        return {
          content: `page_fetch timed out after ${DEFAULT_PAGE_FETCH_TIMEOUT_MS} ms waiting for tab #${tabId}.`,
          isError: true,
        };
      }
      if (raced.kind === "error") {
        return { content: `page_fetch could not run on tab #${tabId}: ${errorMessage(raced.error)}`, isError: true };
      }
      const outer = isRecord(raced.value) ? raced.value : {};
      if (isRecord(outer.exceptionDetails)) {
        const { name, message } = thrownFromDetails(outer.exceptionDetails);
        return { content: `The request failed: ${name}: ${message}`, isError: true };
      }
      const reply = isRecord(outer.result) && isRecord(outer.result.value) ? outer.result.value : {};

      if (reply.kind === "cross-origin") {
        return {
          content: `Cross-origin request blocked: requested origin "${str(reply.requested) ?? ""}" does not match page origin "${str(reply.pageOrigin) ?? ""}". The page_fetch tool only allows same-origin requests.`,
          isError: true,
        };
      }
      if (reply.kind === "invalid-url") {
        return { content: str(reply.message) ?? "", isError: true };
      }
      if (reply.kind === "throw") {
        return {
          content: `The request failed: ${str(reply.name) ?? "Error"}: ${str(reply.message) ?? ""}`,
          isError: true,
        };
      }
      const statusText = str(reply.statusText) ?? "";
      const statusLine = `Status: ${String(reply.status)}${statusText ? ` ${statusText}` : ""}`.trim();
      const output = `${statusLine}\nContent-Type: ${str(reply.contentType) ?? ""}\n\n${str(reply.body) ?? ""}`;
      return { content: truncate(output, options.maxChars ?? DEFAULT_PAGE_FETCH_MAX_CHARS) };
    },
  };

  const pageConsole: CustomToolDef = {
    name: "page_console",
    description:
      "Read console output and uncaught errors from an activated browser tab. Captures console.log, console.info, console.warn, console.error, uncaught runtime exceptions, and unhandled promise rejections recorded in an always-on ring buffer since document start. Call read_tabs first and pass the tab ID it reports. Optionally filter by log level ('log', 'info', 'warn', 'error') and limit the number of entries returned (1 to 200, defaults to 50).",
    inputSchema: z.object({
      tabId: z
        .number()
        .describe("The ID of the tab to read console logs from. Call read_tabs first and pass the ID it reports."),
      level: z
        .string()
        .optional()
        .describe("Optional log level filter: 'log', 'info', 'warn', or 'error'. Omit to return all levels."),
      limit: z
        .number()
        .optional()
        .describe("Maximum number of most recent matching entries to return. Between 1 and 200. Defaults to 50."),
    }),
    summarize: (input) => {
      const tabIdText =
        typeof input.tabId === "number" || typeof input.tabId === "string" ? String(input.tabId) : "(none)";
      const levelText = typeof input.level === "string" ? ` [${input.level}]` : "";
      const limitText = typeof input.limit === "number" ? ` (limit ${input.limit})` : "";
      return `Read console in tab #${tabIdText}${levelText}${limitText}`.trim();
    },
    // No CDP round trip: the console buffer lives on the session already, so
    // this reads it directly rather than awaiting a debugger command — hence
    // no `async` here, unlike page_eval and page_fetch.
    execute: (input) => {
      const tabId = Number(input.tabId);
      if (!session) return Promise.resolve({ content: NOT_DEBUGGING(tabId), isError: true });
      const g = session.gate(tabId);
      if (!g.ok) return Promise.resolve({ content: g.error, isError: true });

      if (input.level !== undefined) {
        const lvl = stringifyInput(input.level);
        if (!["log", "info", "warn", "error"].includes(lvl)) {
          return Promise.resolve({
            content: `Invalid level: ${lvl}. Use log, info, warn or error, or omit it for all.`,
            isError: true,
          });
        }
      }
      if (input.limit !== undefined) {
        const lim = Number(input.limit);
        if (!Number.isInteger(lim) || lim < 1 || lim > 200) {
          return Promise.resolve({
            content: `Invalid limit: ${stringifyInput(input.limit)}. Must be between 1 and 200.`,
            isError: true,
          });
        }
      }

      const level = typeof input.level === "string" ? input.level : undefined;
      const limit = typeof input.limit === "number" ? input.limit : undefined;
      const reply = session.readConsole(tabId, { level, limit });

      // Unchanged from panel-page-tools.ts:314-339.
      const reloadDetected = lastSeenDocumentId.has(tabId) && lastSeenDocumentId.get(tabId) !== reply.documentId;
      lastSeenDocumentId.set(tabId, reply.documentId);
      const reloadHeader = reloadDetected
        ? "The page reloaded since the last read; entries below start from that load.\n"
        : "";
      if (reply.entries.length === 0) {
        const noOutput = `No console output captured for this document` + (level ? ` at level ${level}.` : ".");
        return Promise.resolve({ content: `${reloadHeader}${noOutput}` });
      }
      let header = reloadHeader;
      if (reply.dropped > 0) {
        header += `${reply.dropped} earlier entries fell out of the 200-entry buffer.\n`;
      }
      const lines = reply.entries.map((e) => `[${e.level}] ${e.text}`);
      const body = `Console (${reply.total} matching):\n` + lines.join("\n");
      return Promise.resolve({
        content: truncate(`${header}${body}`, options.maxChars ?? DEFAULT_PAGE_CONSOLE_MAX_CHARS),
      });
    },
  };

  return [pageEval, pageFetch, pageConsole];
}
