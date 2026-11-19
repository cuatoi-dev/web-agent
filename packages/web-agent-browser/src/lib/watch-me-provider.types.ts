// The watch-me composer control's own shapes, split out of
// types.ts to keep it acyclic (imports the recorder's controller type),
// mirroring recorder.types.ts.
import type { AttachmentProvider } from "@cuatoi/web-agent-core";
import type { RecordedStep, RecordingController } from "./recorder.types";

export interface WatchMeProviderOptions {
  controller: RecordingController;
  /** The active tab to start recording on, or null when there is none. */
  getActiveTab: () => Promise<{ tabId: number; host: string; url: string } | null>;
  /** Toast sink. Optional — no notifications when omitted. */
  onNotify?: (message: string, type: "error" | "info") => void;
}

export type WatchMeProviderState =
  | { kind: "idle" }
  | { kind: "recording"; host: string; url: string; steps: RecordedStep[] }
  | {
      kind: "stopped";
      host: string;
      url: string;
      steps: RecordedStep[];
      note?: string;
    };

/** `createWatchMeProvider`'s return type. */
export type WatchMeProvider = AttachmentProvider;
