import { z } from "zod";
import type { CustomToolDef } from "@cuatoi/web-agent-core";
import { imageReachesModel, modelSupportsVision } from "@cuatoi/web-agent-core";
import { createHelperWorlds } from "./debugger-helper-world";
import type { ScreenshotHighlightHandle } from "./debugger-helper-world.types";
import { capture, EMPTY_CAPTURE } from "./page-screenshot-capture";
import { errorMessage } from "./error-message";
import { localFileStamp } from "./file-save-path";
import type { PanelPageToolsOptions } from "./types";
import type { Captured, PageScreenshotToolOptions } from "./page-screenshot-tool.types";

export type { CaptureApi, PageScreenshotToolOptions } from "./page-screenshot-tool.types";

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

export function createPageScreenshotTool(options: PanelPageToolsOptions): CustomToolDef {
  return {
    name: "page_screenshot",
    description:
      "Take a picture of what is visible in a browser tab right now, or capture the full page or an element. Call read_tabs first and pass the tab ID it reports. Needs start_debugging on the tab first. Every capture is also saved as a PNG in the file system, where the user can download it, and the saved path is in the result. Use only one of ref, css, xpath or fullPage. highlight adds temporary red outlines and can be used with any capture mode.",
    inputSchema: z.object({
      tabId: z.number().describe("The ID of the tab to photograph. Call read_tabs first and pass the ID it reports."),
      fullPage: z.boolean().optional().describe("Capture the full scrollable page instead of only the viewport."),
      ref: z.string().optional().describe('A ref from a page_snapshot call, e.g. "3", to capture only that element.'),
      css: z.string().optional().describe("Capture the first CSS match. Falls back to open shadow roots when the top document has no match."),
      xpath: z.string().optional().describe("Capture the first XPath match in the top document. Does not enter shadow roots."),
      highlight: z.array(z.string()).optional().describe("Snapshot refs to outline in red during capture. A viewport capture scrolls the first into view."),
      save_to: z.string().optional().describe(
        "Save the PNG at this virtual path. Defaults to /tmp/screenshots/<local timestamp>-tab<id>.png.",
      ),
    }),
    summarize: (input) => {
      const idText = typeof input.tabId === "number" || typeof input.tabId === "string" ? String(input.tabId) : "(none)";
      if (input.fullPage) return `Full-page screenshot tab #${idText}`;
      if (typeof input.ref === "string") return `Screenshot [${input.ref}] in tab #${idText}`;
      if (typeof input.css === "string") return `Screenshot CSS ${input.css} in tab #${idText}`;
      if (typeof input.xpath === "string") return `Screenshot XPath ${input.xpath} in tab #${idText}`;
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

      const targetCount = [input.ref, input.css, input.xpath]
        .filter((value) => value !== undefined).length + Number(input.fullPage === true);
      if (targetCount > 1) {
        return { content: "Use only one of ref, css, xpath or fullPage.", isError: true };
      }

      const helper = options.helper ?? createHelperWorlds(session);
      const handles: ScreenshotHighlightHandle[] = [];
      let captured: Captured;
      let cleanupFailure: string | undefined;
      try {
        captured = await capture(session, helper, tabId, input, handles);
      } catch (err) {
        captured = { error: errorMessage(err) };
      } finally {
        // Restore in reverse order and attempt every handle, even after a failure.
        const restored = await Promise.allSettled([...handles].reverse().map((handle) => handle.restore()));
        const failures = restored.flatMap((r) => (r.status === "rejected" ? [errorMessage(r.reason)] : []));
        if (failures.length > 0) cleanupFailure = `Outline cleanup failed: ${failures.join("; ")}`;
      }
      if (cleanupFailure !== undefined) {
        const primary = "error" in captured ? `${captured.error}\n` : "";
        return { content: primary + cleanupFailure, isError: true };
      }
      if ("error" in captured) return { content: captured.error, isError: true };
      const { shotData, caption } = captured;

      if (!shotData || shotData.length === 0) {
        return { content: EMPTY_CAPTURE, isError: true };
      }
      const dataUrl = shotData.startsWith("data:") ? shotData : `data:image/png;base64,${shotData}`;
      const saveTo = typeof input.save_to === "string" && input.save_to.trim() !== ""
        ? input.save_to
        : `/tmp/screenshots/${localFileStamp()}-tab${tabId}.png`;
      try {
        // 127/003 — the bytes, not the base64 string: the backends store
        // base64 themselves, through `VfsHandle.write`. A save that fails
        // fails the call, so the model is never told about a file that is
        // not there.
        const binary = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        await options.vfs.write(saveTo, new Blob([bytes], { type: "image/png" }));
      } catch (err) {
        return { content: errorMessage(err), isError: true };
      }
      return {
        content: caption + "\nSaved " + saveTo,
        images: [{ dataUrl, mediaType: "image/png" }],
      };
    },
  };
}
