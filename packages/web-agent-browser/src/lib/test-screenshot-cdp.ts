// A fake Chrome/CDP boundary for the page_screenshot target and highlight
// tests. Only the browser is faked: the real session and helper worlds run on
// top of it. Every call that matters is appended to `events`, in order.
import { vi } from "vitest";
import { createDebuggerSession } from "./debugger-session";
import type { FakeChromeOptions, FakeSelection } from "./test-screenshot-cdp.types";

export const SHOT = btoa("png-bytes-not-a-real-png");

export async function fakeChrome(options: FakeChromeOptions) {
  const events: string[] = [];
  const calls: { method: string; params: Record<string, unknown> | undefined; sessionId: string | undefined }[] = [];
  const viewport = options.viewport ?? { width: 800, height: 600 };
  const content = options.content ?? { width: 800, height: 2000 };
  const objects = new Map<string, number>();
  let lastSelection: FakeSelection | undefined;
  let selectionCount = 0;

  const nodeOf = (objectId: unknown): number => objects.get(String(objectId)) ?? -1;

  const respond = (method: string, params: Record<string, unknown> = {}): unknown => {
    switch (method) {
      case "Runtime.evaluate":
        return { result: { type: "string", value: "UA/1" } };
      case "Page.getFrameTree":
        return { frameTree: { frame: { id: "TOP" } } };
      case "Page.createIsolatedWorld":
        return { executionContextId: 7 };
      case "DOM.resolveNode": {
        const id = Number(params.backendNodeId);
        if (!options.nodes[id]) throw new Error("No node with given id found");
        objects.set(`n${id}`, id);
        return { object: { objectId: `n${id}` } };
      }
      case "DOM.describeNode":
        return { node: { backendNodeId: nodeOf(params.objectId) } };
      case "DOM.getBoxModel": {
        const n = options.nodes[Number(params.backendNodeId)];
        if (!n) throw new Error("Could not find node with given id");
        const { x, y, width, height } = n;
        return { model: { content: [x, y, x + width, y, x + width, y + height, x, y + height], width, height } };
      }
      case "Page.getLayoutMetrics":
        return {
          cssLayoutViewport: {
            pageX: options.scrollX ?? 0,
            pageY: options.scrollY ?? 0,
            clientWidth: viewport.width,
            clientHeight: viewport.height,
          },
          cssVisualViewport: { clientWidth: viewport.width, clientHeight: viewport.height },
          cssContentSize: content,
        };
      case "Page.captureScreenshot":
        events.push("capture");
        if (options.captureFails) throw new Error("capture failed");
        return { data: options.captureEmpty ? "" : SHOT };
      case "Runtime.releaseObject":
        events.push(`release ${String(params.objectId)}`);
        return {};
      case "Runtime.callFunctionOn":
        return callFunction(params);
      default:
        return {};
    }
  };

  const callFunction = (params: Record<string, unknown>): unknown => {
    const fn = String(params.functionDeclaration);
    const node = nodeOf(params.objectId);
    if (fn.includes("screenshotSelect")) {
      const args = params.arguments as { value: string }[];
      const key = `${args[0].value}:${args[1].value}`;
      lastSelection = options.selections?.[key] ?? { ok: false, error: `No element matches ${args[1].value}.` };
      return { result: { objectId: `sel${++selectionCount}` } };
    }
    if (fn.includes("this.ok")) {
      return { result: { value: { ok: lastSelection?.ok, error: lastSelection?.error, count: lastSelection?.count } } };
    }
    if (fn.includes("this.element")) {
      objects.set("el", lastSelection?.node ?? -1);
      return { result: { objectId: "el" } };
    }
    if (fn.includes("isConnected")) {
      return { result: { value: options.nodes[node]?.connected !== false } };
    }
    if (fn.includes("screenshotHighlight")) {
      events.push(`outline-on ${node}`);
      return { result: { value: { declarations: [{ name: "outline-offset", value: "7px", priority: "important" }] } } };
    }
    if (fn.includes("screenshotRestore")) {
      events.push(`outline-off ${node}`);
      if (options.nodes[node]?.restoreFails) throw new Error(`restore failed for ${node}`);
      return { result: {} };
    }
    if (fn.includes("screenshotScroll")) {
      events.push(`scroll ${node}`);
      return { result: {} };
    }
    // helper.call(...): the describe call of the ref path.
    return { result: { value: { connected: true, name: "n", desc: 'button "n"', permission: "allow", disabled: false } } };
  };

  const api = {
    attach: vi.fn().mockResolvedValue(undefined),
    detach: vi.fn().mockResolvedValue(undefined),
    sendCommand: vi.fn((_tabId: number, method: string, params?: Record<string, unknown>, sessionId?: string) => {
      calls.push({ method, params, sessionId });
      try {
        return Promise.resolve(respond(method, params));
      } catch (err) {
        return Promise.reject(err instanceof Error ? err : new Error(String(err)));
      }
    }),
    tabUrl: vi.fn().mockResolvedValue("http://localhost:10040/checkout.html"),
    onDetach: vi.fn(),
    onEvent: vi.fn(),
  };
  const session = createDebuggerSession(api);
  await session.start(1);
  calls.length = 0;
  return { api, session, events, calls };
}
