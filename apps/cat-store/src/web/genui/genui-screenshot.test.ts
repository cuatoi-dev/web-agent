import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  captureFrameScreenshot,
} from "./genui-screenshot";
import { GENUI_SCREENSHOT_MARKER } from "../../shared/genui-screenshot";
import type { GenuiScreenshotRequest } from "../../shared/genui-screenshot";

function stubFrame(onPost: (msg: GenuiScreenshotRequest) => void): HTMLIFrameElement {
  return {
    contentWindow: { postMessage: onPost },
  } as unknown as HTMLIFrameElement;
}

/** Bare-minimum stand-in for `CaptureOptions.win` — the real type is
 *  `Window`, which this stub cannot structurally satisfy (it implements
 *  only the three members captureFrameScreenshot actually calls), so every
 *  call site casts it through `unknown`. */
function makeStubWin() {
  const listeners: Array<{ type: string; fn: (ev: MessageEvent) => void }> = [];
  return {
    location: { origin: "https://test.example" },
    addEventListener: vi.fn((type: string, fn: (ev: MessageEvent) => void) => {
      listeners.push({ type, fn });
    }),
    removeEventListener: vi.fn((type: string, fn: (ev: MessageEvent) => void) => {
      const idx = listeners.findIndex((l) => l.type === type && l.fn === fn);
      if (idx >= 0) listeners.splice(idx, 1);
    }),
    _listeners: listeners,
    _emit(data: unknown, origin?: string) {
      for (const l of [...listeners]) {
        if (l.type === "message") {
          l.fn({
            data,
            origin: origin ?? "https://test.example",
          } as MessageEvent);
        }
      }
    },
  };
}

type StubWin = ReturnType<typeof makeStubWin>;
const asWindow = (win: StubWin) => win as unknown as Window;

describe("captureFrameScreenshot", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves with the frame's data URL", async () => {
    let capturedRequest: GenuiScreenshotRequest | undefined;
    const frame = stubFrame((msg) => { capturedRequest = msg; });
    const win = makeStubWin();

    const p = captureFrameScreenshot(frame, { win: asWindow(win) });

    // Reply with the same id
    const id = capturedRequest!.id;
    win._emit({
      marker: GENUI_SCREENSHOT_MARKER,
      kind: "response",
      id,
      ok: true,
      dataUrl: "data:image/png;base64,AAA",
    });

    const result = await p;
    expect(result).toEqual({ ok: true, dataUrl: "data:image/png;base64,AAA" });
  });

  it("a reply with ok: false returns error result", async () => {
    let capturedRequest: GenuiScreenshotRequest | undefined;
    const frame = stubFrame((msg) => { capturedRequest = msg; });
    const win = makeStubWin();

    const p = captureFrameScreenshot(frame, { win: asWindow(win) });
    const id = capturedRequest!.id;

    win._emit({
      marker: GENUI_SCREENSHOT_MARKER,
      kind: "response",
      id,
      ok: false,
      error: "boom",
    });

    const result = await p;
    expect(result).toEqual({ ok: false, error: "boom" });
  });

  it("two captures in flight resolve to their own images (replies out of order)", async () => {
    const requests: GenuiScreenshotRequest[] = [];
    const frame = stubFrame((msg) => { requests.push(msg); });
    const win = makeStubWin();

    const pA = captureFrameScreenshot(frame, { win: asWindow(win) });
    const pB = captureFrameScreenshot(frame, { win: asWindow(win) });

    const idA = requests[0].id;
    const idB = requests[1].id;

    // Reply B first, then A
    win._emit({
      marker: GENUI_SCREENSHOT_MARKER,
      kind: "response",
      id: idB,
      ok: true,
      dataUrl: "dataUrl-B",
    });
    win._emit({
      marker: GENUI_SCREENSHOT_MARKER,
      kind: "response",
      id: idA,
      ok: true,
      dataUrl: "dataUrl-A",
    });

    const [resA, resB] = await Promise.all([pA, pB]);
    expect(resA).toEqual({ ok: true, dataUrl: "dataUrl-A" });
    expect(resB).toEqual({ ok: true, dataUrl: "dataUrl-B" });
  });

  it("a reply with unknown id is ignored, times out", async () => {
    const frame = stubFrame(() => {});
    const win = makeStubWin();

    const p = captureFrameScreenshot(frame, { timeoutMs: 500, win: asWindow(win) });

    win._emit({
      marker: GENUI_SCREENSHOT_MARKER,
      kind: "response",
      id: "other",
      ok: true,
      dataUrl: "wrong",
    });

    vi.advanceTimersByTime(500);
    const result = await p;
    expect(result).toEqual({ ok: false, error: "timeout" });
  });

  it("a reply from another origin is ignored", async () => {
    let capturedRequest: GenuiScreenshotRequest | undefined;
    const frame = stubFrame((msg) => { capturedRequest = msg; });
    const win = makeStubWin();

    const p = captureFrameScreenshot(frame, { timeoutMs: 500, win: asWindow(win) });
    const id = capturedRequest!.id;

    win._emit(
      { marker: GENUI_SCREENSHOT_MARKER, kind: "response", id, ok: true, dataUrl: "evil" },
      "https://evil.example",
    );

    vi.advanceTimersByTime(500);
    const result = await p;
    expect(result).toEqual({ ok: false, error: "timeout" });
  });

  it("a diagnostics marker is ignored", async () => {
    const frame = stubFrame(() => {});
    const win = makeStubWin();

    const p = captureFrameScreenshot(frame, { timeoutMs: 500, win: asWindow(win) });

    win._emit({
      marker: "wa-genui-diagnostic",
      entry: { kind: "console", level: "log", args: ["hi"], time: 1 },
    });

    vi.advanceTimersByTime(500);
    const result = await p;
    expect(result).toEqual({ ok: false, error: "timeout" });
  });

  it("times out with a clear result", async () => {
    const frame = stubFrame(() => {});
    const win = makeStubWin();

    const p = captureFrameScreenshot(frame, { timeoutMs: 1000, win: asWindow(win) });

    vi.advanceTimersByTime(1000);
    const result = await p;
    expect(result).toEqual({ ok: false, error: "timeout" });
  });

  it("no listener is left behind after success", async () => {
    let capturedRequest: GenuiScreenshotRequest | undefined;
    const frame = stubFrame((msg) => { capturedRequest = msg; });
    const win = makeStubWin();

    const p = captureFrameScreenshot(frame, { win: asWindow(win) });

    const id = capturedRequest!.id;
    win._emit({
      marker: GENUI_SCREENSHOT_MARKER,
      kind: "response",
      id,
      ok: true,
      dataUrl: "data:image/png;base64,ok",
    });

    await p;
    expect(win.addEventListener.mock.calls.length).toBe(win.removeEventListener.mock.calls.length);
  });

  it("no listener is left behind after timeout", async () => {
    const frame = stubFrame(() => {});
    const win = makeStubWin();

    const p = captureFrameScreenshot(frame, { timeoutMs: 500, win: asWindow(win) });

    vi.advanceTimersByTime(500);
    await p;
    expect(win.addEventListener.mock.calls.length).toBe(win.removeEventListener.mock.calls.length);
  });

  it("frame with no contentWindow returns frame-unavailable", async () => {
    const iframe = { contentWindow: null } as unknown as HTMLIFrameElement;
    const win = makeStubWin();

    const result = await captureFrameScreenshot(iframe, { win: asWindow(win) });
    expect(result).toEqual({ ok: false, error: "frame-unavailable" });
    expect(win.addEventListener).not.toHaveBeenCalled();
  });

  it("the request carries the marker, kind and a distinct id", async () => {
    const requests: GenuiScreenshotRequest[] = [];
    const frame = stubFrame((msg) => { requests.push(msg); });
    const win = makeStubWin();

    const p1 = captureFrameScreenshot(frame, { timeoutMs: 1, win: asWindow(win) });
    vi.advanceTimersByTime(1);
    await p1;

    const req1 = requests[0];
    expect(req1.marker).toBe(GENUI_SCREENSHOT_MARKER);
    expect(req1.kind).toBe("request");
    expect(typeof req1.id).toBe("string");

    // Fire a second capture
    const p2 = captureFrameScreenshot(frame, { timeoutMs: 1, win: asWindow(win) });
    vi.advanceTimersByTime(1);
    await p2;

    const req2 = requests[1];
    expect(req2.id).not.toBe(req1.id);
  });
});
