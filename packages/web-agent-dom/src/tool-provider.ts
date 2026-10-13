// tool-provider.ts — domTools(): a ToolProvider bundling the DOM/state tool set.
//
// This package owns and constructs its own DomAdapter/StateAdapter (006-1);
// every tool's `execute` closes over THOSE instances. Since 007, core ships
// no adapters of its own at all — this package's `RefTable` is the only one.
import type {
  ToolProvider,
  CustomToolDef,
  ToolContext,
} from "@cuatoi/web-agent-core";
import { TOOL_DEFS } from "@cuatoi/web-agent-core";
import { DomAdapter } from "./adapters/dom-adapter.js";
import { StateAdapter } from "./adapters/state-adapter.js";
import { pickerAttachmentProvider } from "./picker-provider.js";

import type { DomToolsOptions } from "./types.js";

// Re-exported so importers of this module keep their existing import path.
export type { ConfirmInteractionDetail, DomToolsOptions } from "./types.js";

const DEFAULT_AGENT_UI_SELECTOR = "[data-agent-ui]";

/** The `see` success sentence. Byte-identical to what shipped before 007. */
const SEE_CAPTURED_TEXT =
  "Screenshot captured. A screenshot has been added as a user image message for visual analysis.";

/** 007: the "ask"-tier confirm gate. `undefined` means proceed; a string is
 *  the "not confirmed" content to return instead of executing. `"block"`-tier
 *  enforcement needs no gate here — `DomAdapter` throws for it internally. */
async function confirmAskTier(
  action: string,
  ref: string,
  domAdapter: DomAdapter,
  confirmInteraction: DomToolsOptions["confirmInteraction"],
): Promise<string | undefined> {
  if (!confirmInteraction) return undefined;
  const info = domAdapter.describeRef(ref);
  if (info?.permission !== "ask") return undefined;
  const ok = await confirmInteraction({ action, ref, name: info.name, reason: info.permissionReason });
  if (ok) return undefined;
  return `Action "${action}" on [${ref}]${info.name ? ` "${info.name}"` : ""} was not confirmed by the user; not performed.`;
}

async function runWaitFor(
  input: Record<string, unknown>,
  ctx: ToolContext,
  domAdapter: DomAdapter,
  stateAdapter: StateAdapter,
) {
  const condition = input.condition as string;
  const argument = input.argument as string | undefined;
  const timeoutMs = (input.timeout_ms as number | undefined) ?? 5000;

  let ok: boolean;
  switch (condition) {
    case "dom_idle":
      ok = await domAdapter.waitForIdle(timeoutMs, ctx.signal);
      break;
    case "text_present":
      if (!argument) {
        return { content: "text_present requires an 'argument'." };
      }
      ok = await domAdapter.waitForText(argument, timeoutMs, ctx.signal);
      break;
    case "state_path_truthy":
      if (!argument) {
        return { content: "state_path_truthy requires an 'argument' (JSONPath)." };
      }
      ok = await stateAdapter.waitForPathTruthy(argument, timeoutMs, ctx.signal);
      break;
    default:
      return { content: `Unknown condition: ${condition}.` };
  }

  if (ok) {
    return { content: `Condition "${condition}" met.` };
  }
  return {
    content: `Timed out after ${timeoutMs}ms waiting for ${condition}${argument ? ` "${argument}"` : ""}. Condition not met.`,
  };
}

/** One `ToolProvider` bundling `snapshot_page`, `query_state`, `click`, `fill`,
 *  `select_option`, `wait_for` and (unless `images: false`) `see`, plus the
 *  point-at-elements picker as an `attachmentProvider` (006-8). */
export function domTools(options: DomToolsOptions = {}): ToolProvider[] {
  const agentUiSelector = options.agentUiSelector ?? DEFAULT_AGENT_UI_SELECTOR;
  const includeImages = options.images !== false;

  let domAdapter: DomAdapter;
  let stateAdapter: StateAdapter;

  const provider: ToolProvider = {
    name: "dom",
    required: true,
    load(): Promise<CustomToolDef[]> {
      domAdapter = new DomAdapter({
        snapshotMaxChars: options.snapshotMaxChars,
        snapshotMaxDepth: options.snapshotMaxDepth,
        snapshotSubtreeMaxNodes: options.snapshotSubtreeMaxNodes,
        snapshotMaxNodes: options.snapshotMaxNodes,
        agentUiSelector,
        actionCue: options.actionCue,
        typingPaceMs: () => options.typingPaceMs ?? 0,
      });
      stateAdapter = new StateAdapter(options.getState ?? (() => ({})));
      // Core has no state adapter of its own, so nothing else puts the state
      // shape into the prompt. This package's StateAdapter is its own instance
      // (006-1/2). Fold the shape into query_state's own promptSnippet so it
      // reaches the system prompt (via the "# Tool guidelines" section that
      // every tool's promptSnippet feeds).
      const stateShapeSummary = stateAdapter.describeShape();

      const defs: CustomToolDef[] = [
        {
          name: TOOL_DEFS.snapshot_page.name,
          description: TOOL_DEFS.snapshot_page.description,
          inputSchema: TOOL_DEFS.snapshot_page.inputSchema,
          promptSnippet: TOOL_DEFS.snapshot_page.promptSnippet,
          // 107/004: keep the newest 1 snapshot PER argument set, expiring
          // after 2 user turns.
          ttl: 1,
          uttl: 2,
          execute: async (input) => ({
            content: await domAdapter.snapshot(input),
          }),
        },
        {
          name: TOOL_DEFS.query_state.name,
          description: TOOL_DEFS.query_state.description,
          inputSchema: TOOL_DEFS.query_state.inputSchema,
          promptSnippet: `${TOOL_DEFS.query_state.promptSnippet} State shape summary: ${stateShapeSummary}`,
          // 107/004: keep the newest 3 query results per JSONPath, expiring
          // after 2 user turns.
          ttl: 3,
          uttl: 2,
          execute: async (input) => ({
            content: await stateAdapter.query(input as { path: string; keys_only?: boolean; limit?: number }),
          }),
        },
        {
          name: TOOL_DEFS.click.name,
          description: TOOL_DEFS.click.description,
          inputSchema: TOOL_DEFS.click.inputSchema,
          promptSnippet: TOOL_DEFS.click.promptSnippet,
          execute: async (input, ctx) => {
            const ref = input.ref as string;
            const blocked = await confirmAskTier("click", ref, domAdapter, options.confirmInteraction);
            if (blocked) return { content: blocked };
            return { content: await domAdapter.click(ref, ctx.signal) };
          },
        },
        {
          name: TOOL_DEFS.fill.name,
          description: TOOL_DEFS.fill.description,
          inputSchema: TOOL_DEFS.fill.inputSchema,
          promptSnippet: TOOL_DEFS.fill.promptSnippet,
          execute: async (input, ctx) => {
            const ref = input.ref as string;
            const blocked = await confirmAskTier("fill", ref, domAdapter, options.confirmInteraction);
            if (blocked) return { content: blocked };
            return { content: await domAdapter.fill(ref, input.value as string, ctx.signal) };
          },
        },
        {
          name: TOOL_DEFS.select_option.name,
          description: TOOL_DEFS.select_option.description,
          inputSchema: TOOL_DEFS.select_option.inputSchema,
          promptSnippet: TOOL_DEFS.select_option.promptSnippet,
          execute: async (input, ctx) => {
            const ref = input.ref as string;
            const blocked = await confirmAskTier("select_option", ref, domAdapter, options.confirmInteraction);
            if (blocked) return { content: blocked };
            return { content: await domAdapter.selectOption(ref, input.option as string, ctx.signal) };
          },
        },
        {
          name: TOOL_DEFS.wait_for.name,
          description: TOOL_DEFS.wait_for.description,
          inputSchema: TOOL_DEFS.wait_for.inputSchema,
          promptSnippet: TOOL_DEFS.wait_for.promptSnippet,
          execute: async (input, ctx) => runWaitFor(input, ctx, domAdapter, stateAdapter),
        },
      ];

      if (includeImages) {
        defs.push({
          name: TOOL_DEFS.see.name,
          description: TOOL_DEFS.see.description,
          inputSchema: TOOL_DEFS.see.inputSchema,
          promptSnippet: TOOL_DEFS.see.promptSnippet,
          execute: async (input, ctx) => {
            if (ctx.signal.aborted) {
              throw new DOMException("Tool execution aborted.", "AbortError");
            }
            const result = await domAdapter.screenshot(input.ref as string | undefined);
            return {
              content: result.warning
                ? `${SEE_CAPTURED_TEXT} ${result.warning}`
                : SEE_CAPTURED_TEXT,
              images: [{ dataUrl: result.dataUrl, mediaType: result.mediaType }],
            };
          },
        });
      }

      return Promise.resolve(defs);
    },
    attachmentProviders: [
      pickerAttachmentProvider({ agentUiSelector, getDomAdapter: () => domAdapter }),
    ],
  };

  return [provider];
}
