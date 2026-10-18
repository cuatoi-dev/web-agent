import type { CustomToolDef, ToolProvider } from "@cuatoi/web-agent-core";
import { attachPhrases, createHostTracker } from "./page-tool-phrases";
import { createPageScreenshotTool, screenshotReachesModel } from "./page-screenshot-tool";
import { createScriptPageTools } from "./panel-page-tools-script";
import { createActByRefPageTools } from "./panel-page-tools-act-by-ref";
import { createVerifyLocatorPageTools } from "./panel-page-tools-verify-locator";
import { createNetworkDialogPageTools } from "./panel-page-tools-network-dialog";
import { createDebuggerPageTools } from "./panel-page-tools-debugger";
import { createDebuggerSession } from "./debugger-session";
import { createHelperWorlds } from "./debugger-helper-world";
import { createDebuggerRecorder } from "./debugger-recorder";
import { createRecordingPageTools } from "./panel-page-tools-recording";
import { createRecordingController } from "./recording-controller";
import type { PanelPageToolsOptions } from "./types";

export type { PanelPageToolsOptions } from "./types";

export function createPanelPageTools(input: PanelPageToolsOptions = {}): CustomToolDef[] {
  // 124/001 — one session shared by the act-by-ref and debugger tools below.
  // 124/007 — one host map per agent panel. Filled by every forwarded call that
  // passes the activation check; read when a step line renders.
  const hostTracker = createHostTracker();
  const onActivatedOrigin = (tabId: number, origin: string): void => {
    hostTracker.onActivatedOrigin(tabId, origin);
    input.onActivatedOrigin?.(tabId, origin);
  };
  const debuggerSession = input.debuggerSession ?? createDebuggerSession();
  // 131/002 — one helper-world cache shared by every ref tool, so the
  // isolated world is created once per tab rather than once per tool.
  const helper = input.helper ?? createHelperWorlds(debuggerSession);
  // 131/004 — one recorder driver per panel, on the same session the page tools
  // use, so a recording and an agent action share one debugger attach.
  const recorder = input.recorder ?? createDebuggerRecorder(debuggerSession, helper);
  // 124/005 — one recording controller per agent panel, shared by the two
  // recording tools and by the pause bracket every debugger input tool uses.
  const recording =
    input.recording ??
    createRecordingController({ session: debuggerSession, recorder });
  const options: PanelPageToolsOptions = {
    ...input,
    onActivatedOrigin,
    debuggerSession,
    helper,
    recording,
  };
  const tools = [
    ...createScriptPageTools(options),
    ...createActByRefPageTools(options),
    ...createVerifyLocatorPageTools(options),
    ...createNetworkDialogPageTools(options),
    ...createDebuggerPageTools(options),
    ...createRecordingPageTools(options),
  ];

  // 118/004 — the vision gate, applied at provider-load time rather than at
  // call time, following `packages/web-agent-dom/src/tool-provider.ts:187`
  // where `see` is dropped when `images: false`. The agent never sees a tool it
  // cannot use.
  if (screenshotReachesModel(options)) {
    tools.push(createPageScreenshotTool(options));
  }

  // 124/007 — each tool carries its own readable step line from here on.
  return attachPhrases(tools, hostTracker.hostFor);
}

export function panelPageTools(options: PanelPageToolsOptions = {}): ToolProvider[] {
  return [
    {
      name: "panel-page-tools",
      required: false,
      load: () => Promise.resolve(createPanelPageTools(options)),
    },
  ];
}
