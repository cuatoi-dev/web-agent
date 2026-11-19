// The webpack entry for dist-template/recorder.js. The side panel
// reads this file's TEXT and installs it with
// Page.addScriptToEvaluateOnNewDocument, so it must be one self-contained
// bundle that installs itself on globalThis and nothing else. Never loaded as a
// script by any page.
import * as api from "./lib/page-recorder";

(globalThis as unknown as { __waRec: typeof api }).__waRec = api;
