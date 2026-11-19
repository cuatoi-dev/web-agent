// The shapes for page-tool-phrases.ts.

import type { AvailableTool } from "@cuatoi/web-agent-core";

type Phrase = NonNullable<AvailableTool["phrase"]>;
type InProgress = NonNullable<AvailableTool["inProgressPhrase"]>;

export interface ToolPhraseEntry {
  phrase?: Phrase;
  inProgressPhrase?: InProgress;
}

export interface HostTracker {
  /** Pass as `PanelPageToolsOptions.onActivatedOrigin`. */
  onActivatedOrigin: (tabId: number, origin: string) => void;
  /** The tab's host, or `UNKNOWN_HOST`. Read when the line renders. */
  hostFor: (tabId: unknown) => string;
}
