// The shapes for page_screenshot: the Chrome capture seam and the options that
// control whether the tool is offered to the model.

/** The three chrome calls `page_screenshot` needs, as narrow function types so
 *  a unit test can supply fakes without a chrome global.
 *  `captureVisibleTab` photographs the ACTIVE tab of the window
 *  it is given, which is why `get` is needed first. */
export interface CaptureApi {
  get: (tabId: number) => Promise<chrome.tabs.Tab>;
  captureVisibleTab: (windowId: number, options: { format: string }) => Promise<string>;
  isOriginEnabled: (origin: string) => Promise<boolean>;
}

/** What `createPageScreenshotTool` and the vision gate read. `imageInput` is
 *  the host's own flag and is normally undefined in the side panel, which never
 *  sets it; `endpointType` and `model` come from the saved settings. */
export interface PageScreenshotToolOptions {
  /** Overridable for tests only. Defaults to the real chrome calls. */
  captureApi?: CaptureApi;
  imageInput?: boolean;
  /** `AgentSettings.wireFormat` — "anthropic", "openai" or "gemini". */
  endpointType?: string;
  /** `AgentSettings.model`. */
  model?: string;
}
