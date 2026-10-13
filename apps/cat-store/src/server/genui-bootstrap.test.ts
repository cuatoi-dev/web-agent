// @vitest-environment node
import { describe, it, expect } from "vitest";
import { renderGenuiBootstrapScript } from "./genui-bootstrap.js";
import { GENUI_DIAGNOSTIC_MARKER } from "../shared/genui-diagnostics.js";

/** The bootstrap script's own event-listener signature — it never uses
 *  `this`, and the fake window below stores whatever it is handed. */
type Listener = (ev: unknown) => void;

/** One diagnostic message posted to `window.parent`. Every field beyond
 *  `kind` and `time` belongs to only some of the four kinds the bootstrap
 *  sends (console/resource/exception/rejection) — see genui-bootstrap.ts:59,
 *  69-73, 77-84, 89-93 — so each optional field on this flat shape stands in
 *  for one kind's own fields. */
interface DiagnosticEntry {
  kind: string;
  time: number;
  level?: string;
  args?: unknown[];
  tag?: string;
  url?: string;
  message?: string;
  stack?: string;
  source?: string;
  line?: number;
  column?: number;
}
interface DiagnosticMessage {
  marker: string;
  entry: DiagnosticEntry;
}

/** The `serialize()` shape for an Error-like value (genui-bootstrap.ts:35-42). */
interface SerializedError {
  type: string;
  name: string;
  message: string;
  stack: string;
}

/** Bare-minimum stand-in for the frame's `window`, built fresh per test so
 *  each test's captured `posted`/`listeners` are independent. Structural,
 *  not a real Window — the bootstrap only ever touches these three members. */
interface FakeWindow {
  location: { origin: string };
  parent: { postMessage: (m: unknown, origin?: string) => void };
  addEventListener: (type: string, fn: Listener, capture?: boolean) => void;
}

/** `new Function(...)` returns the ambient `Function` type, too generic to
 *  call directly (no-unsafe-call) — this is the real shape the compiled
 *  bootstrap script takes once invoked with (window, console). */
type BootstrapFn = (window: FakeWindow, console: Record<string, (...a: unknown[]) => void>) => void;

function runBootstrap() {
  const posted: DiagnosticMessage[] = [];
  const listeners: Record<string, { fn: Listener; capture?: boolean }[]> = {};
  const originalCalls: unknown[][] = [];
  const fakeConsole: Record<string, (...a: unknown[]) => void> = {};
  for (const l of ["log", "info", "warn", "error", "debug"]) {
    fakeConsole[l] = (...a: unknown[]) => originalCalls.push([l, ...a]);
  }
  const fakeWindow: FakeWindow = {
    location: { origin: "http://localhost:10030" },
    parent: { postMessage: (m) => posted.push(m as DiagnosticMessage) },
    addEventListener: (t, fn, capture) => {
      (listeners[t] ??= []).push({ fn, capture });
    },
  };
  // This test compiles the browser bootstrap source genui-bootstrap.ts
  // generates and runs it against a fake window/console — `new Function` IS
  // the thing under test, so the rule cannot be satisfied without changing
  // what the test proves (eslint.config.mjs scopes an override to this file).
  (new Function("window", "console", renderGenuiBootstrapScript()) as BootstrapFn)(
    fakeWindow,
    fakeConsole,
  );
  return { posted, listeners, fakeConsole, originalCalls, fakeWindow };
}

describe("renderGenuiBootstrapScript", () => {
  it("console.log forwards its arguments", () => {
    const { posted, fakeConsole } = runBootstrap();
    fakeConsole.log("hi", 1, true, null);
    expect(posted).toHaveLength(1);
    expect(posted[0].marker).toBe(GENUI_DIAGNOSTIC_MARKER);
    expect(posted[0].entry.kind).toBe("console");
    expect(posted[0].entry.level).toBe("log");
    expect(posted[0].entry.args).toEqual(["hi", 1, true, null]);
    expect(typeof posted[0].entry.time).toBe("number");
  });

  it("console.error serialises an Error with its stack", () => {
    const { posted, fakeConsole } = runBootstrap();
    fakeConsole.error(new Error("boom"));
    expect(posted).toHaveLength(1);
    const arg = posted[0].entry.args![0] as SerializedError;
    expect(arg.type).toBe("error");
    expect(arg.message).toBe("boom");
    expect(arg.name).toBe("Error");
    expect(typeof arg.stack).toBe("string");
    expect(arg.stack.length).toBeGreaterThan(0);
    expect(arg.stack).toContain("boom");
  });

  it("the original console method still runs", () => {
    const { posted, fakeConsole, originalCalls } = runBootstrap();
    fakeConsole.log("hi", 1, true, null);
    expect(posted).toHaveLength(1);
    expect(originalCalls).toHaveLength(1);
    expect(originalCalls[0]).toEqual(["log", "hi", 1, true, null]);
  });

  it("an object argument survives as JSON, a function as a string", () => {
    const { posted, fakeConsole } = runBootstrap();
    fakeConsole.log({ a: 1 }, () => 0);
    expect(posted).toHaveLength(1);
    expect(posted[0].entry.args![0]).toBe('{"a":1}');
    expect(typeof posted[0].entry.args![1]).toBe("string");
  });

  it("a circular object does not throw", () => {
    const { posted, fakeConsole } = runBootstrap();
    const o: Record<string, unknown> = {};
    o.self = o;
    fakeConsole.log(o);
    expect(posted).toHaveLength(1);
    expect(typeof posted[0].entry.args![0]).toBe("string");
  });

  it("the error listener is registered in the capture phase", () => {
    const { listeners } = runBootstrap();
    expect(listeners.error).toBeDefined();
    expect(listeners.error[0].capture).toBe(true);
  });

  it("a resource error is reported as a resource, not an exception", () => {
    const { posted, listeners } = runBootstrap();
    listeners.error[0].fn({
      target: { tagName: "IMG", src: "missing.png" },
    });
    expect(posted).toHaveLength(1);
    expect(posted[0].entry.kind).toBe("resource");
    expect(posted[0].entry.tag).toBe("img");
    expect(posted[0].entry.url).toBe("missing.png");
    expect(posted.some((m) => m.entry.kind === "exception")).toBe(false);
  });

  it("an exception carries the stack, the file and the line", () => {
    const { posted, listeners } = runBootstrap();
    listeners.error[0].fn({
      target: { window: true },
      message: "Uncaught Error: boom",
      filename: "agent-ui.js",
      lineno: 4,
      colno: 9,
      error: { message: "boom", stack: "Error: boom\n    at agent-ui.js:4:9" },
    });
    expect(posted).toHaveLength(1);
    const entry = posted[0].entry;
    expect(entry.kind).toBe("exception");
    expect(entry.stack).toContain("agent-ui.js:4:9");
    expect(entry.line).toBe(4);
    expect(entry.column).toBe(9);
    expect(entry.source).toBe("agent-ui.js");
  });

  it("a syntax-error shape with no Error object yields an empty stack, not a crash", () => {
    const { posted, listeners } = runBootstrap();
    listeners.error[0].fn({
      target: { window: true },
      message: "SyntaxError: Unexpected token",
      filename: "agent-ui.js",
      lineno: 0,
      colno: 0,
    });
    expect(posted).toHaveLength(1);
    const entry = posted[0].entry;
    expect(entry.kind).toBe("exception");
    expect(entry.stack).toBe("");
    expect(entry.message).toContain("SyntaxError");
  });

  it("an unhandled rejection carries reason.stack", () => {
    const { posted, listeners } = runBootstrap();
    listeners.unhandledrejection[0].fn({
      reason: {
        message: "nope",
        stack: "Error: nope\n    at agent-ui.js:2:3",
      },
    });
    expect(posted).toHaveLength(1);
    const entry = posted[0].entry;
    expect(entry.kind).toBe("rejection");
    expect(entry.message).toBe("nope");
    expect(entry.stack).toContain("agent-ui.js:2:3");
  });

  it("a rejection with a non-Error reason still reports", () => {
    const { posted, listeners } = runBootstrap();
    listeners.unhandledrejection[0].fn({ reason: "plain string" });
    expect(posted).toHaveLength(1);
    const entry = posted[0].entry;
    expect(entry.kind).toBe("rejection");
    expect(entry.message).toBe("plain string");
    expect(entry.stack).toBe("");
  });

  it("the message is addressed to this origin, never to *", () => {
    const { fakeConsole } = runBootstrap();
    // Re-run with a custom window that records postMessage args
    const posted2: [unknown, string | undefined][] = [];
    const fakeWindow2: FakeWindow = {
      location: { origin: "http://localhost:10030" },
      parent: {
        postMessage: (m, o) => posted2.push([m, o]),
      },
      addEventListener: () => {},
    };
    (new Function("window", "console", renderGenuiBootstrapScript()) as BootstrapFn)(
      fakeWindow2,
      fakeConsole,
    );
    fakeConsole.log("x");
    expect(posted2.length).toBeGreaterThanOrEqual(1);
    expect(posted2[0][1]).toBe("http://localhost:10030");
  });

  it("a failing parent does not break the mounted code", () => {
    const listeners: Record<string, { fn: Listener; capture?: boolean }[]> = {};
    const originalCalls: unknown[][] = [];
    const fakeConsole: Record<string, (...a: unknown[]) => void> = {};
    for (const l of ["log", "info", "warn", "error", "debug"]) {
      fakeConsole[l] = (...a: unknown[]) => originalCalls.push([l, ...a]);
    }
    const fakeWindow: FakeWindow = {
      location: { origin: "http://localhost:10030" },
      parent: {
        postMessage: () => {
          throw new Error("parent closed");
        },
      },
      addEventListener: (t, fn, capture) => {
        (listeners[t] ??= []).push({ fn, capture });
      },
    };
    (new Function("window", "console", renderGenuiBootstrapScript()) as BootstrapFn)(
      fakeWindow,
      fakeConsole,
    );
    // Must not throw when postMessage fails
    fakeConsole.log("x");
    expect(originalCalls).toHaveLength(1);
    expect(originalCalls[0]).toEqual(["log", "x"]);
  });
});
