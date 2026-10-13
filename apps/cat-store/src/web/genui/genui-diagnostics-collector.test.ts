import { describe, it, expect, beforeEach } from "vitest";
import {
  createGenuiDiagnosticsCollector,
  type GenuiDiagnosticsCollector,
} from "./genui-diagnostics-collector";
import { GENUI_DIAGNOSTIC_MARKER } from "../../shared/genui-diagnostics";

/** A loose diagnostic entry — the collector never inspects its shape (that is
 *  exactly what "never calls instanceof on frame data" below proves), so this
 *  stays a structural record rather than the real GenuiDiagnostic union. */
function makeEntry(kind: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { kind, time: Date.now(), ...extra };
}

function dispatch(
  win: Window,
  data: unknown,
  origin?: string,
): void {
  win.dispatchEvent(
    new MessageEvent("message", {
      data,
      origin: origin ?? win.location.origin,
    }),
  );
}

describe("GenuiDiagnosticsCollector", () => {
  let collector: GenuiDiagnosticsCollector;
  let win: Window;

  beforeEach(() => {
    collector = createGenuiDiagnosticsCollector(window);
    win = window;
  });

  it("buffers entries posted with the marker", () => {
    collector.start();
    dispatch(win, { marker: GENUI_DIAGNOSTIC_MARKER, entry: makeEntry("console") });
    dispatch(win, { marker: GENUI_DIAGNOSTIC_MARKER, entry: makeEntry("exception") });
    expect(collector.size()).toBe(2);
  });

  it("drain returns everything since the last drain and empties the buffer", () => {
    collector.start();
    const e1 = makeEntry("console");
    const e2 = makeEntry("exception");
    dispatch(win, { marker: GENUI_DIAGNOSTIC_MARKER, entry: e1 });
    dispatch(win, { marker: GENUI_DIAGNOSTIC_MARKER, entry: e2 });

    const drained = collector.drain();
    expect(drained).toHaveLength(2);
    expect(drained[0]).toBe(e1);
    expect(drained[1]).toBe(e2);
    expect(collector.size()).toBe(0);

    // Second drain returns empty
    expect(collector.drain()).toEqual([]);
  });

  it("a second batch after a drain is returned by the next drain", () => {
    collector.start();
    dispatch(win, { marker: GENUI_DIAGNOSTIC_MARKER, entry: makeEntry("console") });
    collector.drain(); // drain first batch

    const e2 = makeEntry("exception");
    dispatch(win, { marker: GENUI_DIAGNOSTIC_MARKER, entry: e2 });
    const drained = collector.drain();
    expect(drained).toHaveLength(1);
    expect(drained[0]).toBe(e2);
  });

  it("ignores a message without the marker", () => {
    collector.start();
    dispatch(win, { hello: "world" });
    dispatch(win, { marker: "something-else", entry: {} });
    expect(collector.size()).toBe(0);
  });

  it("ignores a message from another origin", () => {
    collector.start();
    dispatch(
      win,
      { marker: GENUI_DIAGNOSTIC_MARKER, entry: makeEntry("console") },
      "https://evil.example",
    );
    expect(collector.size()).toBe(0);
  });

  it("stop() detaches the listener", () => {
    collector.start();
    collector.stop();
    dispatch(win, { marker: GENUI_DIAGNOSTIC_MARKER, entry: makeEntry("console") });
    expect(collector.size()).toBe(0);
  });

  it("start() twice attaches once", () => {
    collector.start();
    collector.start();
    dispatch(win, { marker: GENUI_DIAGNOSTIC_MARKER, entry: makeEntry("console") });
    expect(collector.size()).toBe(1);
  });

  it("never calls instanceof on frame data", () => {
    collector.start();
    const entry = makeEntry("exception", {
      stack: "Error: boom\n    at agent-ui.js:4:9",
    });
    dispatch(win, { marker: GENUI_DIAGNOSTIC_MARKER, entry });
    const [drained] = collector.drain();
    // The object is the same plain object — no conversion happened
    expect(drained).toBe(entry);
    expect((drained as unknown as Record<string, unknown>).stack).toBe("Error: boom\n    at agent-ui.js:4:9");
  });
});
