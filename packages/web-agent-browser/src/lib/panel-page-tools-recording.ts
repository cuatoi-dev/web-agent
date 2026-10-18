// 124/005 — start_recording and stop_recording. Split out of
// panel-page-tools.ts to stay under that file's 500-line cap
// (eslint.config.mjs max-lines), the same way
// panel-page-tools-debugger.ts is.
import { z } from "zod";
import type { CustomToolDef } from "@cuatoi/web-agent-core";
import { errorMessage } from "./error-message";
import type { PanelPageToolsOptions } from "./types";
import type { RecordingResult } from "./recorder.types";
import { stepLocatorLines } from "./locator-format";

function tabIdText(input: Record<string, unknown>): string {
  return typeof input.tabId === "number" || typeof input.tabId === "string" ? String(input.tabId) : "(none)";
}

/** The plan's stop_recording body. 127/002 — the locator lines go under each
 *  step that has an element. */
function report(result: RecordingResult): string {
  const n = result.steps.length;
  const header = `Recorded ${n} ${n === 1 ? "step" : "steps"} on ${result.host}:`;
  const note = result.note ? `\n${result.note}` : "";
  const lines = result.steps
    .map((s, i) => {
      const prefix = s.frameOrigin === undefined ? "" : `(frame ${s.frameOrigin}) `;
      const locators = stepLocatorLines(s).map((l) => `\n${l}`).join("");
      return `\n${i + 1}. ${prefix}${s.line}${locators}`;
    })
    .join("");
  return header + note + lines;
}

export function createRecordingPageTools(options: PanelPageToolsOptions): CustomToolDef[] {
  const recording = options.recording;
  if (!recording) return [];

  const startRecording: CustomToolDef = {
    name: "start_recording",
    description:
      "Watch the user work in a tab you are already debugging (call start_debugging first) and record what they do: clicks, typing, selections, key presses, scrolling, hovers and single-page-app route changes. The user is asked to confirm first. Call read_tabs first and pass the tab ID it reports. Call stop_recording to get the steps. Your own page tools are never recorded as the user's steps.",
    inputSchema: z.object({
      tabId: z.number().describe("The ID of the tab to record. Call read_tabs first and pass the ID it reports."),
    }),
    summarize: (input) => `Record the user in tab #${tabIdText(input)}`,
    execute: async (input) => {
      const tabId = Number(input.tabId);
      let host: string;
      let url: string;
      try {
        ({ host, url } = await recording.tabInfo(tabId));
      } catch (err) {
        return { content: `start_recording could not read tab #${tabId}: ${errorMessage(err)}`, isError: true };
      }

      if (options.confirmInteraction) {
        const ok = await options.confirmInteraction({
          action: "record",
          summary: `Watch you on ${host} and record your clicks and typing`,
        });
        if (!ok) {
          return { content: `Recording on ${host} was not confirmed by the user; not started.`, isError: true };
        }
      }

      const started = await recording.start(tabId, { host, url }, "tool");
      if (!started.ok) return { content: started.error, isError: true };
      return { content: `Recording on ${host}. Steps appear when the user stops or the page navigates.` };
    },
  };

  const stopRecording: CustomToolDef = {
    name: "stop_recording",
    description:
      "Stop recording the user in a browser tab and list what they did, in order. When reporting recorded steps to the user, list all steps in order and preserve any <password> redaction marker. A recording that already stopped because the tab closed or debugging stopped is returned the same way, with the reason.",
    inputSchema: z.object({
      tabId: z.number().describe("The ID of the tab. Call read_tabs first and pass the ID it reports."),
    }),
    summarize: (input) => `Stop recording tab #${tabIdText(input)}`,
    execute: async (input) => {
      const tabId = Number(input.tabId);

      // A recording that already stopped is returned WITHOUT touching the tab:
      // the tab may be closed, and its steps are the whole point of the call.
      if (recording.state().kind !== "stopped") {
        const gate = options.debuggerSession?.gate(tabId);
        if (gate && !gate.ok) return { content: gate.error, isError: true };
      }

      const result = await recording.stop();
      if ("error" in result) return { content: result.error, isError: true };
      return { content: report(result) };
    },
  };

  return [startRecording, stopRecording];
}
