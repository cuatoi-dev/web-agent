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

/** What `createPageScreenshotTool` and the vision gate read. The
 *  side panel sets `imageInput` from the current model's `vision` flag, which
 *  wins over the name guess from `endpointType` and `model`. */
export interface PageScreenshotToolOptions {
  /** Overridable for tests only. Defaults to the real chrome calls. */
  captureApi?: CaptureApi;
  imageInput?: boolean;
  /** A wire format — "anthropic", "openai" or "gemini". */
  endpointType?: string;
  /** The API model id. */
  model?: string;
}

/** What one capture produced: the PNG data and the text above the `Saved`
 *  line, or the error to return. */
export type Captured = { shotData: string; caption: string } | { error: string };

/** A rectangle in page CSS pixels. */
export interface PageRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
