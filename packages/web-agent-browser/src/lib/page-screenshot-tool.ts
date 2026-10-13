import { z } from "zod";
import type { CustomToolDef } from "@cuatoi/web-agent-core";
import { imageReachesModel, modelSupportsVision } from "@cuatoi/web-agent-core";
import { createHelperWorlds, STALE_REF } from "./debugger-helper-world";
import type { HelperDescribe } from "./helper-api";
import type { PanelPageToolsOptions } from "./types";
import type { PageScreenshotToolOptions } from "./page-screenshot-tool.types";

export type { CaptureApi, PageScreenshotToolOptions } from "./page-screenshot-tool.types";

/** A zero-size capture yields "data:," which model APIs reject with
 *  `invalid_image`. Same guard as
 *  `packages/web-agent-dom/src/adapters/screenshot.ts`. */
const EMPTY_CAPTURE =
  "The screenshot came back empty and was discarded, so no image was sent. The tab may be mid-navigation; try again.";

/** Whether an image returned by this tool would actually reach the model.
 *
 *  The same decision the three message converters make when they strip an image
 *  (`message-converter.ts`, `openai-to-anthropic.ts`, `gemini-to-anthropic.ts`
 *  all call `imageReachesModel`), so the tool is offered exactly when the image
 *  would survive the trip — the same reasoning
 *  `apps/cat-store/src/web/components/agent-page.ts:413-426` records. Absent
 *  settings close the gate: an unknown endpoint type cannot be shown to accept
 *  an image. */
export function screenshotReachesModel(options: PageScreenshotToolOptions): boolean {
  return imageReachesModel(
    options.imageInput,
    modelSupportsVision(options.endpointType ?? "", options.model ?? ""),
  );
}

export function createPageScreenshotTool(options: PanelPageToolsOptions = {}): CustomToolDef {
  return {
    name: "page_screenshot",
    description:
      "Take a picture of what is visible in a browser tab right now, or capture the full page or an element. Call read_tabs first and pass the tab ID it reports. Needs start_debugging on the tab first.",
    inputSchema: z.object({
      tabId: z.number().describe("The ID of the tab to photograph. Call read_tabs first and pass the ID it reports."),
      fullPage: z.boolean().optional().describe("Capture the full scrollable page instead of only the viewport."),
      ref: z.string().optional().describe('A ref from a page_snapshot call, e.g. "3", to capture only that element.'),
    }),
    summarize: (input) => {
      const idText = typeof input.tabId === "number" || typeof input.tabId === "string" ? String(input.tabId) : "(none)";
      if (input.fullPage) return `Full-page screenshot tab #${idText}`;
      if (typeof input.ref === "string") return `Screenshot [${input.ref}] in tab #${idText}`;
      return `Screenshot tab #${idText}`;
    },
    execute: async (input) => {
      const tabId = Number(input.tabId);
      if (!Number.isInteger(tabId)) {
        return { content: `Invalid tabId: ${String(input.tabId)}. Call read_tabs and pass the ID it reports.`, isError: true };
      }
      const session = options.debuggerSession;
      if (!session) {
        return { content: `Debugging is not started on tab #${tabId}. Call start_debugging first.`, isError: true };
      }
      const g = session.gate(tabId);
      if (!g.ok) return { content: g.error, isError: true };

      if (input.fullPage && input.ref !== undefined) {
        return { content: "Use fullPage or ref, not both.", isError: true };
      }

      let shotData: string;
      let caption: string;

      if (input.ref !== undefined) {
        const ref = typeof input.ref === "string" ? input.ref : "";
        const helper = options.helper ?? createHelperWorlds(session);
        const d = await helper.call<HelperDescribe>(tabId, ref, "describe", [ref]);
        if (!d.ok) return { content: d.error, isError: true };
        if (!d.value.connected) return { content: STALE_REF(ref), isError: true };
        if (d.value.refusal !== undefined) return { content: d.value.refusal, isError: true };

        const b = await helper.box(tabId, ref);
        if (!b.ok) return { content: b.error, isError: true };

        // b.x/b.y are already in the TOP page's viewport, frame offsets
        // included (131/003), so the clip stays in top-page coordinates and
        // the capture keeps going to the top target.
        const res = (await session.send(tabId, "Page.captureScreenshot", {
          format: "png",
          captureBeyondViewport: true,
          clip: {
            x: b.x + b.scrollX,
            y: b.y + b.scrollY,
            width: b.width,
            height: b.height,
            scale: 1,
          },
        })) as { data?: string };
        shotData = res?.data ?? "";
        caption = `Screenshot of [${ref}] ${d.value.desc}, ${b.width} × ${b.height}.`;
      } else if (input.fullPage) {
        const m = (await session.send(tabId, "Page.getLayoutMetrics")) as {
          cssContentSize?: { width: number; height: number };
        };
        const width = m?.cssContentSize?.width ?? 0;
        const height = m?.cssContentSize?.height ?? 0;
        const res = (await session.send(tabId, "Page.captureScreenshot", {
          format: "png",
          captureBeyondViewport: true,
          clip: { x: 0, y: 0, width, height, scale: 1 },
        })) as { data?: string };
        shotData = res?.data ?? "";
        caption = `Full-page screenshot, ${width} × ${height}.`;
      } else {
        const m = (await session.send(tabId, "Page.getLayoutMetrics").catch(() => ({}))) as {
          cssVisualViewport?: { clientWidth: number; clientHeight: number };
          cssLayoutViewport?: { clientWidth: number; clientHeight: number };
        };
        const width = Math.round(m?.cssVisualViewport?.clientWidth ?? m?.cssLayoutViewport?.clientWidth ?? 0);
        const height = Math.round(m?.cssVisualViewport?.clientHeight ?? m?.cssLayoutViewport?.clientHeight ?? 0);
        const res = (await session.send(tabId, "Page.captureScreenshot", { format: "png" })) as { data?: string };
        shotData = res?.data ?? "";
        caption = width > 0 && height > 0 ? `Viewport screenshot, ${width} × ${height}.` : `Viewport of tab #${tabId} captured.`;
      }

      if (!shotData || shotData.length === 0) {
        return { content: EMPTY_CAPTURE, isError: true };
      }
      const dataUrl = shotData.startsWith("data:") ? shotData : `data:image/png;base64,${shotData}`;
      return {
        content: caption,
        images: [{ dataUrl, mediaType: "image/png" }],
      };
    },
  };
}
