// The CDP half of the recorder: what the side panel installs in a
// debugged tab and how a step comes back. Imports only the step shape.
import type { RecordedStep } from "./recorder.types";

/** One installed recorder, per debugged tab. */
export interface DebuggerRecorder {
  /** Installs the binding and the script in every session of the tab, and in
   *  every child that attaches later. Rejects nothing: a frame that fails to
   *  arm is logged and skipped, exactly as `enableChild` does. */
  install(tabId: number, recordingId: string): Promise<void>;
  /** Stops the recorder in every context, removes the scripts and the binding,
   *  and forgets the tab. Best effort. */
  uninstall(tabId: number): Promise<void>;
  /** `globalThis.__waRec.pause()` / `.resume()` in every recorder context. */
  pause(tabId: number): Promise<void>;
  resume(tabId: number): Promise<void>;
  /** Called for every step, already parsed, with its frame chain and origin
   *  filled in. */
  onStep(listener: (tabId: number, step: RecordedStep) => void): void;
  /** Called when a same-document navigation happens in the tab's TOP frame, so
   *  the controller can add the `route` step the page script used to raise.
   *  `seq` is pre-assigned from the driver's own tab-wide seq space — the
   *  same one every recorded step is rebased into — so a route step can never
   *  collide with a step whose delivery is still in flight. */
  onRoute(listener: (tabId: number, path: string, seq: number) => void): void;
}
