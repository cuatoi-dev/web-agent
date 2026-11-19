import { z } from "zod";
import type { CustomToolDef, ToolContext } from "@cuatoi/web-agent-lit";
import type { GenuiConfig } from "../genui/genui-config";
import type { GenuiDiagnostic } from "../../shared/genui-diagnostics";
import type { GenuiToolHost } from "./types";

export type { GenuiToolHost } from "./types";

/** How long to wait after mount() before draining. The frame reports over
 *  postMessage, which is delivered in a later task than the mount, so an
 *  immediate drain would return nothing. 300 ms is the shortest wait the task
 *  004 e2e spec uses successfully for a mount round trip
 *  (genui-frame-mount.mock.spec.ts:85). Anything that arrives later is NOT
 *  lost: the collector keeps buffering and the next call's drain returns it. */
export const GENUI_DRAIN_SETTLE_MS = 300;

/** Per-entry and per-result diagnostic caps. */
export const DIAGNOSTIC_ENTRY_MAX_CHARS = 500;
export const MAX_DIAGNOSTIC_ENTRIES = 20;
export const DEFAULT_RESULT_MAX_CHARS = 6_000;

const BASE_DESCRIPTION =
  "Render a screen in the generative UI panel on the right of the agent page. " +
  "Pass one `source` string containing HTML and, optionally, <script> blocks. " +
  "The source is validated before anything is rendered: a JavaScript syntax " +
  "error or a rule violation returns an error with the line and column and " +
  "renders nothing, leaving whatever is already on the panel in place. Fix what " +
  "the error names and call this tool again. On success the result reports any " +
  "console output, uncaught error or failed resource from your code, and " +
  "attaches a screenshot of what rendered when the model can see images.";

/** Composes the fixed text with every enabled rule's promptSnippet, so the
 *  model reads the component vocabulary and the colour policy BEFORE it writes
 *  anything. Swapping the rules swaps the words: a Material map names
 *  md-filled-button, a Vaadin map names vaadin-button. */
export function buildGenuiToolDescription(config: GenuiConfig): string {
  const snippets = (config.rules ?? [])
    .map((rule) => rule.promptSnippet)
    .filter((s): s is string => !!s);
  if (snippets.length === 0) return BASE_DESCRIPTION;
  return `${BASE_DESCRIPTION}\n\nRules enforced on your source:\n${snippets
    .map((s) => `- ${s}`)
    .join("\n")}`;
}

function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const removed = text.length - max;
  return `${text.slice(0, max)}… [+${removed} characters cut]`;
}

function renderArg(arg: unknown): string {
  if (arg !== null && typeof arg === "object" && (arg as { type?: string }).type === "error") {
    const e = arg as { name: string; message: string; stack: string };
    return `${e.name}: ${e.message}\n${e.stack}`;
  }
  return String(arg);
}

/** One human-readable line (or short block) per diagnostic. */
export function formatDiagnostic(entry: GenuiDiagnostic): string {
  switch (entry.kind) {
    case "console":
      return cut(
        `[console.${entry.level}] ${entry.args.map(renderArg).join(" ")}`,
        DIAGNOSTIC_ENTRY_MAX_CHARS,
      );
    case "exception":
      return cut(
        `[uncaught error] ${entry.message} (${entry.source}:${entry.line}:${entry.column})\n${entry.stack}`,
        DIAGNOSTIC_ENTRY_MAX_CHARS,
      );
    case "rejection":
      return cut(
        `[unhandled rejection] ${entry.message}\n${entry.stack}`,
        DIAGNOSTIC_ENTRY_MAX_CHARS,
      );
    case "resource":
      return cut(`[resource failed] <${entry.tag}> ${entry.url}`, DIAGNOSTIC_ENTRY_MAX_CHARS);
  }
}

export function formatDiagnostics(entries: GenuiDiagnostic[]): string {
  if (entries.length === 0) return "No console output, errors or failed resources.";
  const shown = entries.slice(0, MAX_DIAGNOSTIC_ENTRIES).map(formatDiagnostic);
  const dropped = entries.length - shown.length;
  const tail = dropped > 0 ? `\n… [+${dropped} more diagnostics not shown]` : "";
  return `Runtime output (${entries.length}):\n${shown.join("\n")}${tail}`;
}

/** The last gate: whatever the pieces above produced, the result never exceeds
 *  the host's own budget, and a cut is always visible and counted. */
export function applyResultBudget(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  const notice = (n: number) => `\n… [result truncated: ${n} characters cut]`;
  const removed = content.length - maxChars + notice(0).length + 8;
  const keep = Math.max(0, maxChars - notice(removed).length);
  return content.slice(0, keep) + notice(content.length - keep);
}

export function createRenderAgentUiTool(host: GenuiToolHost): CustomToolDef {
  return {
    name: "render_agent_ui",
    description: buildGenuiToolDescription(host.genuiConfig),
    inputSchema: z
      .object({
        source: z
          .string()
          .min(1)
          .describe(
            "The complete HTML for the panel, including any <script> blocks. " +
              "It replaces whatever the panel currently shows.",
          ),
      })
      .strict(),
    promptSnippet:
      "Use render_agent_ui({source}) to build a screen in the right-hand panel. " +
      "Read the tool description for the components and colours you may use; a " +
      "violation comes back as an error and nothing is rendered, so fix it and " +
      "call the tool again.",
    execute: async (input: Record<string, unknown>, ctx: ToolContext) => {
      const rawSource = (input as { source?: unknown }).source;
      // `String(rawSource ?? "")` stringified a non-string to "[object Object]"
      // instead of surfacing it; narrow with typeof so a non-string defaults to
      // "" exactly as before, without ever calling String() on an object.
      const source = typeof rawSource === "string" ? rawSource : "";
      const maxChars = ctx.queryResultMaxChars ?? DEFAULT_RESULT_MAX_CHARS;

      const validation = await host.validateSource(source);
      if (!validation.valid) {
        return {
          content: applyResultBudget(
            "Not rendered — the source did not pass validation. The panel is " +
              "unchanged. Fix every item below and call render_agent_ui again.\n" +
              (validation.formattedMessage ?? "Unknown validation failure."),
            maxChars,
          ),
          isError: true,
        };
      }

      try {
        await host.mount(source);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: applyResultBudget(`Not rendered — mounting failed: ${message}`, maxChars),
          isError: true,
        };
      }

      await new Promise((resolve) => setTimeout(resolve, GENUI_DRAIN_SETTLE_MS));
      const diagnostics = host.drainDiagnostics();
      const parts = ["Rendered in the panel.", formatDiagnostics(diagnostics)];

      if (!host.screenshotAvailable) {
        return {
          content: applyResultBudget(
            `${parts.join("\n\n")}\n\nNo screenshot: this model cannot receive images.`,
            maxChars,
          ),
        };
      }

      const shot = await host.screenshot();
      if (!shot.ok) {
        return {
          content: applyResultBudget(
            `${parts.join("\n\n")}\n\nNo screenshot: capture failed (${shot.error}).`,
            maxChars,
          ),
        };
      }
      return {
        content: applyResultBudget(
          `${parts.join("\n\n")}\n\nA screenshot of the panel follows.`,
          maxChars,
        ),
        images: [{ dataUrl: shot.dataUrl, mediaType: "image/png" }],
      };
    },
  };
}
