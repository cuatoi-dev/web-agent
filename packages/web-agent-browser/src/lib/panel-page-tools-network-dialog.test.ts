import { describe, expect, it, vi } from "vitest";
import type { ToolContext } from "@cuatoi/web-agent-core";
import { testVfs } from "./test-vfs";
import { createDebuggerSession } from "./debugger-session";
import { createNetworkDialogPageTools } from "./panel-page-tools-network-dialog";
import type { HelperWorlds } from "./types";

function toolCtx(): ToolContext {
  return { app: {}, signal: new AbortController().signal };
}

function fakeDebuggerApi() {
  let detachListener: (tabId: number, reason: string) => void = () => {};
  let eventListener: (tabId: number, method: string, params: unknown) => void = () => {};
  const api = {
    attach: vi.fn().mockResolvedValue(undefined),
    detach: vi.fn().mockResolvedValue(undefined),
    sendCommand: vi.fn((_tabId: number, method: string) =>
      Promise.resolve(method === "Runtime.evaluate" ? { result: { type: "string", value: "UA/1" } } : {}),
    ),
    tabUrl: vi.fn().mockResolvedValue("http://localhost:10040/checkout.html"),
    onDetach: vi.fn((l: typeof detachListener) => {
      detachListener = l;
    }),
    onEvent: vi.fn((l: typeof eventListener) => {
      eventListener = l;
    }),
  };
  return {
    api,
    fireDetach: (t: number, r: string) => detachListener(t, r),
    fireEvent: (t: number, m: string, p: unknown) => eventListener(t, m, p),
  };
}

/** 131/002 — page_upload_file now calls through the helper-world seam. */
function fakeHelper(overrides: Partial<HelperWorlds> = {}): HelperWorlds {
  return {
    source: vi.fn().mockResolvedValue(""),
    parseRef: (ref: string) => ({ ok: true, frame: "", backendNodeId: Number(ref) }),
    resolve: (_tabId: number, ref: string) => ({
      ok: true as const,
      at: { frameId: "top", backendNodeId: Number(ref), refPrefix: "" },
    }),
    frameChain: vi.fn().mockResolvedValue([]),
    frameChainAt: vi.fn().mockResolvedValue([]),
    call: vi.fn().mockRejectedValue(new Error("call not stubbed")),
    callOnDocument: vi.fn().mockRejectedValue(new Error("callOnDocument not stubbed")),
    centre: vi.fn().mockRejectedValue(new Error("centre not stubbed")),
    box: vi.fn().mockRejectedValue(new Error("box not stubbed")),
    forget: vi.fn(),
    forgetFrame: vi.fn(),
    ...overrides,
  };
}

function setup(helper: HelperWorlds = fakeHelper()) {
  const debuggerEnv = fakeDebuggerApi();
  const session = createDebuggerSession(debuggerEnv.api);
  const tools = createNetworkDialogPageTools({ vfs: testVfs(), helper, debuggerSession: session });
  const pageNetwork = tools.find((t) => t.name === "page_network")!;
  const pageDialog = tools.find((t) => t.name === "page_dialog")!;
  const pageUploadFile = tools.find((t) => t.name === "page_upload_file")!;
  return { session, debuggerEnv, tools, pageNetwork, pageDialog, pageUploadFile, helper };
}

describe("panel-page-tools-network-dialog (124/003)", () => {
  it("U4.1: Gate: without start, each tool returns gate error", async () => {
    const { pageNetwork, pageDialog, pageUploadFile } = setup();
    const rNet = await pageNetwork.execute({ tabId: 1 }, toolCtx());
    expect(rNet).toEqual({
      content: "Debugging is not started on tab #1. Call start_debugging first.",
      isError: true,
    });
    const rDlg = await pageDialog.execute({ tabId: 1, accept: false }, toolCtx());
    expect(rDlg).toEqual({
      content: "Debugging is not started on tab #1. Call start_debugging first.",
      isError: true,
    });
    const rUp = await pageUploadFile.execute(
      { tabId: 1, ref: "1", files: [{ name: "a.txt", mimeType: "text/plain", text: "a" }] },
      toolCtx(),
    );
    expect(rUp).toEqual({
      content: "Debugging is not started on tab #1. Call start_debugging first.",
      isError: true,
    });
  });

  it("U4.2: List: lists captured requests with formatted line", async () => {
    const { session, debuggerEnv, pageNetwork } = setup();
    await session.start(1);
    debuggerEnv.fireEvent(1, "Network.requestWillBeSent", {
      requestId: "r1",
      timestamp: 1,
      type: "Document",
      request: { method: "GET", url: "http://localhost:10040/checkout.html", headers: {} },
    });
    debuggerEnv.fireEvent(1, "Network.responseReceived", {
      requestId: "r1",
      response: { status: 200, mimeType: "text/html", headers: {} },
    });
    debuggerEnv.fireEvent(1, "Network.loadingFinished", { requestId: "r1", timestamp: 1.1 });

    debuggerEnv.fireEvent(1, "Network.requestWillBeSent", {
      requestId: "r2",
      timestamp: 2,
      type: "Fetch",
      request: { method: "POST", url: "http://localhost:10040/api/coupon", headers: {} },
    });
    debuggerEnv.fireEvent(1, "Network.responseReceived", {
      requestId: "r2",
      response: { status: 500, mimeType: "application/json", headers: {} },
    });
    debuggerEnv.fireEvent(1, "Network.loadingFinished", { requestId: "r2", timestamp: 2.02 });

    const res = await pageNetwork.execute({ tabId: 1 }, toolCtx());
    expect(res).toEqual({
      content:
        "Requests since debugging started (2):\n" +
        "#1 GET /checkout.html → 200 document (100 ms)\n" +
        "#2 POST /api/coupon → 500 fetch (20 ms)",
    });
  });

  it("U4.3: Filter is case-insensitive", async () => {
    const { session, debuggerEnv, pageNetwork } = setup();
    await session.start(1);
    debuggerEnv.fireEvent(1, "Network.requestWillBeSent", {
      requestId: "r1",
      timestamp: 1,
      type: "Document",
      request: { method: "GET", url: "http://localhost:10040/checkout.html", headers: {} },
    });
    debuggerEnv.fireEvent(1, "Network.responseReceived", {
      requestId: "r1",
      response: { status: 200, mimeType: "text/html", headers: {} },
    });
    debuggerEnv.fireEvent(1, "Network.loadingFinished", { requestId: "r1", timestamp: 1.1 });

    debuggerEnv.fireEvent(1, "Network.requestWillBeSent", {
      requestId: "r2",
      timestamp: 2,
      type: "Fetch",
      request: { method: "POST", url: "http://localhost:10040/api/coupon", headers: {} },
    });
    debuggerEnv.fireEvent(1, "Network.responseReceived", {
      requestId: "r2",
      response: { status: 500, mimeType: "application/json", headers: {} },
    });
    debuggerEnv.fireEvent(1, "Network.loadingFinished", { requestId: "r2", timestamp: 2.02 });

    const res = await pageNetwork.execute({ tabId: 1, filter: "COUPON" }, toolCtx());
    expect(res).toEqual({
      content:
        'Requests since debugging started (1 matching "COUPON"):\n' +
        "#2 POST /api/coupon → 500 fetch (20 ms)",
    });
  });

  it("U4.4: Empty log or filter with no match", async () => {
    const { session, pageNetwork } = setup();
    await session.start(1);
    const empty = await pageNetwork.execute({ tabId: 1 }, toolCtx());
    expect(empty).toEqual({ content: "No requests captured since debugging started." });

    const noMatch = await pageNetwork.execute({ tabId: 1, filter: "zzz" }, toolCtx());
    expect(noMatch).toEqual({ content: 'No requests captured since debugging started matching "zzz".' });
  });

  it("U4.5: Dialogs appended to list text", async () => {
    const { session, pageNetwork } = setup();
    await session.start(1);
    session.state.get(1)!.dialogs.push('confirm "x" → dismissed (no answer was set)');
    const res = await pageNetwork.execute({ tabId: 1 }, toolCtx());
    expect(res.content).toBe(
      'No requests captured since debugging started.\nDialogs:\nconfirm "x" → dismissed (no answer was set)',
    );
  });

  it("U4.6: Index detail with postData", async () => {
    const { session, debuggerEnv, pageNetwork } = setup();
    debuggerEnv.api.sendCommand = vi.fn((_tabId: number, method: string) => {
      if (method === "Runtime.evaluate") return Promise.resolve({ result: { type: "string", value: "UA/1" } });
      if (method === "Network.getResponseBody") {
        return Promise.resolve({ body: '{"error":"x"}', base64Encoded: false });
      }
      return Promise.resolve({});
    });
    await session.start(1);
    debuggerEnv.fireEvent(1, "Network.requestWillBeSent", {
      requestId: "r2",
      timestamp: 2,
      type: "Fetch",
      request: {
        method: "POST",
        url: "http://localhost:10040/api/coupon",
        headers: { "content-type": "application/json" },
        postData: '{"code":"a"}',
        hasPostData: true,
      },
    });
    debuggerEnv.fireEvent(1, "Network.responseReceived", {
      requestId: "r2",
      response: {
        status: 500,
        mimeType: "application/json",
        headers: { "content-type": "application/json" },
      },
    });
    debuggerEnv.fireEvent(1, "Network.loadingFinished", { requestId: "r2", timestamp: 2.02 });

    const res = await pageNetwork.execute({ tabId: 1, index: 1 }, toolCtx());
    expect(res.content).toBe(
      "#1 POST /api/coupon → 500 fetch (20 ms)\n" +
        "Request headers\ncontent-type: application/json\n" +
        'Request body\n{"code":"a"}\n' +
        "Response headers\ncontent-type: application/json\n" +
        'Response body\n{"error":"x"}',
    );
    expect(debuggerEnv.api.sendCommand).not.toHaveBeenCalledWith(1, "Network.getRequestPostData", expect.anything());
  });

  it("U4.7: hasPostData without postData fetches post data via CDP", async () => {
    const { session, debuggerEnv, pageNetwork } = setup();
    debuggerEnv.api.sendCommand = vi.fn((_tabId: number, method: string) => {
      if (method === "Runtime.evaluate") return Promise.resolve({ result: { type: "string", value: "UA/1" } });
      if (method === "Network.getRequestPostData") return Promise.resolve({ postData: "p=1" });
      if (method === "Network.getResponseBody") return Promise.resolve({ body: "ok", base64Encoded: false });
      return Promise.resolve({});
    });
    await session.start(1);
    debuggerEnv.fireEvent(1, "Network.requestWillBeSent", {
      requestId: "r1",
      timestamp: 1,
      type: "Fetch",
      request: { method: "POST", url: "/api/test", headers: {}, hasPostData: true },
    });
    const res = await pageNetwork.execute({ tabId: 1, index: 1 }, toolCtx());
    expect(res.content).toContain("\nRequest body\np=1");
  });

  it("U4.8: GET request with no post data has no Request body section", async () => {
    const { session, debuggerEnv, pageNetwork } = setup();
    debuggerEnv.api.sendCommand = vi.fn((_tabId: number, method: string) => {
      if (method === "Runtime.evaluate") return Promise.resolve({ result: { type: "string", value: "UA/1" } });
      if (method === "Network.getResponseBody") return Promise.resolve({ body: "ok", base64Encoded: false });
      return Promise.resolve({});
    });
    await session.start(1);
    debuggerEnv.fireEvent(1, "Network.requestWillBeSent", {
      requestId: "r1",
      timestamp: 1,
      type: "Document",
      request: { method: "GET", url: "/checkout.html", headers: {} },
    });
    const res = await pageNetwork.execute({ tabId: 1, index: 1 }, toolCtx());
    expect(res.content).not.toContain("Request body");
  });

  it("U4.9: base64 encoded response body formatted as binary bytes", async () => {
    const { session, debuggerEnv, pageNetwork } = setup();
    debuggerEnv.api.sendCommand = vi.fn((_tabId: number, method: string) => {
      if (method === "Runtime.evaluate") return Promise.resolve({ result: { type: "string", value: "UA/1" } });
      if (method === "Network.getResponseBody") return Promise.resolve({ body: "aGVsbG8=", base64Encoded: true });
      return Promise.resolve({});
    });
    await session.start(1);
    debuggerEnv.fireEvent(1, "Network.requestWillBeSent", {
      requestId: "r1",
      timestamp: 1,
      type: "Image",
      request: { method: "GET", url: "/logo.png", headers: {} },
    });
    const res = await pageNetwork.execute({ tabId: 1, index: 1 }, toolCtx());
    expect(res.content).toContain("\nResponse body\n(binary, 5 bytes)");
  });

  it("U4.10: getResponseBody error results in body no longer available", async () => {
    const { session, debuggerEnv, pageNetwork } = setup();
    debuggerEnv.api.sendCommand = vi.fn((_tabId: number, method: string) => {
      if (method === "Runtime.evaluate") return Promise.resolve({ result: { type: "string", value: "UA/1" } });
      if (method === "Network.getResponseBody") return Promise.reject(new Error("No resource"));
      return Promise.resolve({});
    });
    await session.start(1);
    debuggerEnv.fireEvent(1, "Network.requestWillBeSent", {
      requestId: "r1",
      timestamp: 1,
      type: "Fetch",
      request: { method: "GET", url: "/api/test", headers: {} },
    });
    const res = await pageNetwork.execute({ tabId: 1, index: 1 }, toolCtx());
    expect(res.content).toContain("\nResponse body\n(body no longer available)");
  });

  it("U4.11: body exceeding 8000 characters is capped", async () => {
    const { session, debuggerEnv, pageNetwork } = setup();
    const largeBody = "x".repeat(9000);
    debuggerEnv.api.sendCommand = vi.fn((_tabId: number, method: string) => {
      if (method === "Runtime.evaluate") return Promise.resolve({ result: { type: "string", value: "UA/1" } });
      if (method === "Network.getResponseBody") return Promise.resolve({ body: largeBody, base64Encoded: false });
      return Promise.resolve({});
    });
    await session.start(1);
    debuggerEnv.fireEvent(1, "Network.requestWillBeSent", {
      requestId: "r1",
      timestamp: 1,
      type: "Fetch",
      request: { method: "GET", url: "/api/test", headers: {} },
    });
    const res = await pageNetwork.execute({ tabId: 1, index: 1 }, toolCtx());
    expect(res.content).toContain("… (1000 more characters)");
  });

  it("U4.12: Unknown index returns not seen error", async () => {
    const { session, pageNetwork } = setup();
    await session.start(1);
    const res = await pageNetwork.execute({ tabId: 1, index: 42 }, toolCtx());
    expect(res).toEqual({ content: "Request #42 was not seen, or it fell out of the 200-entry buffer." });
  });

  it("U4.13: page_dialog configures dialogPlan and reports lastDialog", async () => {
    const { session, pageDialog } = setup();
    await session.start(1);
    const r1 = await pageDialog.execute({ tabId: 1, accept: false }, toolCtx());
    expect(r1.content).toBe("The next dialog will be dismissed.");
    expect(session.state.get(1)!.dialogPlan).toEqual({ accept: false });

    const r2 = await pageDialog.execute({ tabId: 1, accept: true, promptText: "hi" }, toolCtx());
    expect(r2.content).toBe('The next dialog will be accepted. A prompt will receive "hi".');
    expect(session.state.get(1)!.dialogPlan).toEqual({ accept: true, promptText: "hi" });

    session.state.get(1)!.lastDialog = 'confirm "Continue?" → dismissed';
    const r3 = await pageDialog.execute({ tabId: 1, accept: false }, toolCtx());
    expect(r3.content).toBe('The next dialog will be dismissed. Last dialog: confirm "Continue?" → dismissed');
  });

  it("U4.14: page_upload_file validation error returns error", async () => {
    const { session, pageUploadFile } = setup();
    await session.start(1);
    const res = await pageUploadFile.execute({ tabId: 1, ref: "1", files: [] }, toolCtx());
    expect(res).toEqual({ content: "Pass at least one file.", isError: true });
  });

  it("U4.15: page_upload_file ok reports uploaded files and sizes", async () => {
    const target = {
      role: "button",
      name: "Attachments",
      label: '[5] file "Attachments"',
      isPassword: false,
    };
    const call = vi.fn((_tabId: number, _ref: string, fn: string) => {
      if (fn === "describe") {
        return Promise.resolve({ ok: true, value: { connected: true, name: "Attachments", desc: 'file "Attachments"', permission: "allow", disabled: false } });
      }
      if (fn === "setFiles") {
        return Promise.resolve({ ok: true, value: { ok: true, desc: 'file "Attachments"', sizes: [8], target } });
      }
      throw new Error(`unexpected helper call: ${fn}`);
    });
    const { session, pageUploadFile } = setup(fakeHelper({ call }));
    await session.start(1);
    const res = await pageUploadFile.execute(
      {
        tabId: 1,
        ref: "5",
        files: [{ name: "orders.csv", mimeType: "text/csv", text: "a,b\n1,2\n" }],
      },
      toolCtx(),
    );
    expect(res).toEqual({
      content: 'Uploaded 1 file to [5] file "Attachments": orders.csv (8 B).',
    });
    expect(call).toHaveBeenCalledWith(1, "5", "setFiles", ["5", [{ name: "orders.csv", mimeType: "text/csv", text: "a,b\n1,2\n" }]]);

    const call2 = vi.fn((_tabId: number, _ref: string, fn: string) => {
      if (fn === "describe") {
        return Promise.resolve({ ok: true, value: { connected: true, name: "Attachments", desc: 'file "Attachments"', permission: "allow", disabled: false } });
      }
      if (fn === "setFiles") {
        return Promise.resolve({ ok: true, value: { ok: true, desc: 'file "Attachments"', sizes: [8, 5242880], target } });
      }
      throw new Error(`unexpected helper call: ${fn}`);
    });
    const { session: s2, pageUploadFile: p2 } = setup(fakeHelper({ call: call2 }));
    await s2.start(1);
    const res2 = await p2.execute(
      {
        tabId: 1,
        ref: "5",
        files: [
          { name: "a.csv", mimeType: "text/csv", text: "a,b\n1,2\n" },
          { name: "big.bin", mimeType: "application/octet-stream", size: 5242880, fill: "A" },
        ],
      },
      toolCtx(),
    );
    expect(res2.content).toBe('Uploaded 2 files to [5] file "Attachments": a.csv (8 B), big.bin (5.0 MB).');
  });

  it("U4.16: page_upload_file setFiles error reply returns isError", async () => {
    const call = vi.fn((_tabId: number, _ref: string, fn: string) => {
      if (fn === "describe") {
        return Promise.resolve({ ok: true, value: { connected: true, name: "Apply", desc: 'button "Apply"', permission: "allow", disabled: false } });
      }
      if (fn === "setFiles") {
        return Promise.resolve({ ok: true, value: { ok: false, message: 'Element [5] button "Apply" is not a file input.' } });
      }
      throw new Error(`unexpected helper call: ${fn}`);
    });
    const { session, pageUploadFile } = setup(fakeHelper({ call }));
    await session.start(1);
    const res = await pageUploadFile.execute(
      { tabId: 1, ref: "5", files: [{ name: "a.txt", mimeType: "text/plain", text: "a" }] },
      toolCtx(),
    );
    expect(res).toEqual({
      content: 'Element [5] button "Apply" is not a file input.',
      isError: true,
    });
  });

  it("U4.18: summarize formats descriptions correctly", () => {
    const { pageNetwork, pageDialog, pageUploadFile } = setup();
    expect(pageNetwork.summarize?.({ tabId: 1 })).toBe("Network log in tab #1");
    expect(pageDialog.summarize?.({ tabId: 1, accept: true })).toBe("Configure next dialog in tab #1: accept=true");
    expect(
      pageUploadFile.summarize?.({
        tabId: 1,
        ref: "5",
        files: [{ name: "a.txt", mimeType: "text/plain", text: "a" }],
      }),
    ).toBe("Upload 1 file to [5] in tab #1");
  });
});
