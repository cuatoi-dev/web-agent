import { describe, it, expect, vi } from "vitest";
import type { ToolContext } from "@cuatoi/web-agent-core";
import { createPanelPageTools, panelPageTools } from "./panel-page-tools";
import { createDebuggerSession } from "./debugger-session";
import type { HelperWorlds } from "./types";

/** The minimum ToolContext the tools under test read, copied from
 *  `page-eval-tool.test.ts:8-10`. */
function toolCtx(): ToolContext {
  return { app: {}, signal: new AbortController().signal };
}

/** 131/002 — the ref tools' page-side calls all go through one `HelperWorlds`
 *  seam now. `callQueue` shifts one reply per `fn` name per call, mirroring
 *  the old `routed()` helper's per-message-type queues. */
function callQueue(replies: Record<string, unknown[]>) {
  const queues: Record<string, unknown[]> = {};
  for (const [k, v] of Object.entries(replies)) queues[k] = [...v];
  return vi.fn((_tabId: number, _ref: string, fn: string) => {
    const queue = queues[fn];
    if (!queue || queue.length === 0) throw new Error(`unexpected helper call: ${fn}`);
    return Promise.resolve(queue.shift());
  });
}

function callOnDocumentQueue(replies: Record<string, unknown[]>) {
  const queues: Record<string, unknown[]> = {};
  for (const [k, v] of Object.entries(replies)) queues[k] = [...v];
  return vi.fn((_tabId: number, fn: string) => {
    const queue = queues[fn];
    if (!queue || queue.length === 0) throw new Error(`unexpected helper callOnDocument: ${fn}`);
    return Promise.resolve(queue.shift());
  });
}

function fakeHelper(overrides: Partial<HelperWorlds> = {}): HelperWorlds {
  return {
    source: vi.fn().mockResolvedValue(""),
    parseRef: (ref: string) => {
      const n = Number(ref);
      return Number.isInteger(n) && n > 0
        ? { ok: true, frame: "", backendNodeId: n }
        : { ok: false, error: `Invalid ref "${ref}". Take a new snapshot and pass a ref it prints.` };
    },
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

const NO_VISION_NAMES = [
  "page_eval",
  "page_fetch",
  "page_console",
  "page_snapshot",
  "page_click",
  "page_fill_form",
  "page_select_option",
  "page_verify",
  "page_generate_locator",
  "export_test",
  "page_network",
  "page_dialog",
  "page_upload_file",
  "start_debugging",
  "stop_debugging",
  "page_hover",
  "page_press_key",
  "page_emulate",
  "start_recording",
  "stop_recording",
];
const WITH_VISION_NAMES = [...NO_VISION_NAMES, "page_screenshot"];

describe("panelPageTools", () => {
  it("returns one provider that loads page_eval, page_fetch, page_console, the act-by-ref and the verify/locator page tools, and the debugger tools", async () => {
    const providers = panelPageTools();
    expect(providers).toHaveLength(1);
    expect(providers[0].name).toBe("panel-page-tools");
    expect(providers[0].required).toBe(false);

    const tools = await providers[0].load();
    expect(tools).toHaveLength(20);
    expect(tools.map((tool) => tool.name)).toEqual(NO_VISION_NAMES);
    expect(tools[2].description).toBeTruthy();
    expect(tools[2].inputSchema).toBeTruthy();
  });
});

describe("panelPageTools vision gate", () => {
  it("G1: panelPageTools() with no options returns 20 tools", async () => {
    const providers = panelPageTools();
    const tools = await providers[0].load();
    expect(tools.map((t) => t.name)).toEqual(NO_VISION_NAMES);
  });

  it("G2: endpointType gemini and model gemini-flash-lite-latest returns 21 tools", async () => {
    const providers = panelPageTools({
      endpointType: "gemini",
      model: "gemini-flash-lite-latest",
    });
    const tools = await providers[0].load();
    expect(tools.map((t) => t.name)).toEqual(WITH_VISION_NAMES);
  });

  it("G3: endpointType anthropic and model text-only-model returns 20 tools", async () => {
    const providers = panelPageTools({
      endpointType: "anthropic",
      model: "text-only-model",
    });
    const tools = await providers[0].load();
    expect(tools.map((t) => t.name)).toEqual(NO_VISION_NAMES);
  });

  it("G7: endpointType anthropic and model sonnet (the default profile) returns 21 tools", async () => {
    const providers = panelPageTools({
      endpointType: "anthropic",
      model: "sonnet",
    });
    const tools = await providers[0].load();
    expect(tools.map((t) => t.name)).toEqual(WITH_VISION_NAMES);
  });

  it("G4: endpointType anthropic and model claude-3-5-sonnet returns 21 tools", async () => {
    const providers = panelPageTools({
      endpointType: "anthropic",
      model: "claude-3-5-sonnet",
    });
    const tools = await providers[0].load();
    expect(tools.map((t) => t.name)).toEqual(WITH_VISION_NAMES);
  });

  it("G5: endpointType gemini, model gemini-flash-lite-latest, imageInput: false returns 20 tools", async () => {
    const providers = panelPageTools({
      endpointType: "gemini",
      model: "gemini-flash-lite-latest",
      imageInput: false,
    });
    const tools = await providers[0].load();
    expect(tools.map((t) => t.name)).toEqual(NO_VISION_NAMES);
  });

  it("G6: endpointType anthropic, model text-only-model, imageInput: true returns 21 tools", async () => {
    const providers = panelPageTools({
      endpointType: "anthropic",
      model: "text-only-model",
      imageInput: true,
    });
    const tools = await providers[0].load();
    expect(tools.map((t) => t.name)).toEqual(WITH_VISION_NAMES);
  });
});

describe("createPanelPageTools — act-by-ref page tools (122/001, 131/002)", () => {
  function tools(options: Parameters<typeof createPanelPageTools>[0] = {}) {
    const [, , , pageSnapshot, pageClick, pageFillForm, pageSelectOption] = createPanelPageTools(options);
    return { pageSnapshot, pageClick, pageFillForm, pageSelectOption };
  }

  const APPLY_TARGET = { role: "button", name: "Apply", label: '[4] button "Apply"', locator: "getByRole('button', { name: 'Apply' })", isPassword: false };
  const COUPON_TARGET = { role: "textbox", name: "Coupon", label: '[7] textbox "Coupon"', locator: "getByLabel('Coupon')", isPassword: false };
  const EMAIL_TARGET = { role: "textbox", name: "Email", label: '[9] textbox "Email"', locator: "getByLabel('Email')", isPassword: false };

  function started() {
    const detachListeners: ((tabId: number, reason: string) => void)[] = [];
    const api = {
      attach: vi.fn().mockResolvedValue(undefined),
      detach: vi.fn().mockResolvedValue(undefined),
      sendCommand: vi.fn((_tabId: number, method: string) =>
        Promise.resolve(method === "Runtime.evaluate" ? { result: { type: "string", value: "UA/1" } } : {}),
      ),
      tabUrl: vi.fn().mockResolvedValue("http://localhost:10040/checkout.html"),
      onDetach: vi.fn((l: (tabId: number, reason: string) => void) => { detachListeners.push(l); }),
      onEvent: vi.fn(),
    };
    const session = createDebuggerSession(api);
    const fireDetach = (t: number, r: string) => { for (const l of detachListeners) l(t, r); };
    return { api, session, fireDetach };
  }

  describe("page_snapshot", () => {
    it("gates first when debugging is not started", async () => {
      const { pageSnapshot } = tools();
      const result = await pageSnapshot.execute({ tabId: 1 }, toolCtx());
      expect(result).toEqual({ content: "Debugging is not started on tab #1. Call start_debugging first.", isError: true });
    });

    it("returns the accessibility tree rendered by ax-snapshot", async () => {
      const { api, session } = started();
      await session.start(1);
      api.sendCommand.mockImplementation((_tabId: number, method: string) => {
        if (method === "Accessibility.getFullAXTree") {
          return Promise.resolve({
            nodes: [
              { nodeId: "1", role: { type: "internalRole", value: "RootWebArea" }, childIds: ["2"], backendDOMNodeId: 1 },
              { nodeId: "2", role: { type: "role", value: "textbox" }, name: { value: "Coupon" }, value: { value: "SAVE10" }, backendDOMNodeId: 2 },
            ],
          });
        }
        return Promise.resolve({});
      });
      const { pageSnapshot } = tools({ debuggerSession: session });

      const result = await pageSnapshot.execute({ tabId: 1, include_text: "Coupon" }, toolCtx());
      expect(result.isError).toBeFalsy();
      // include_text keeps the matched node's ancestors too — the root line stays.
      expect(result.content).toBe('- RootWebArea [ref=1]\n  - textbox "Coupon" [ref=2]: SAVE10');
    });

    it("scope with a ref not on the page returns the SCOPE_MISSING text", async () => {
      const { api, session } = started();
      await session.start(1);
      api.sendCommand.mockImplementation((_tabId: number, method: string) =>
        Promise.resolve(method === "Accessibility.getFullAXTree" ? { nodes: [{ nodeId: "1", backendDOMNodeId: 1 }] } : {}),
      );
      const { pageSnapshot } = tools({ debuggerSession: session });

      const result = await pageSnapshot.execute({ tabId: 1, scope: "999999" }, toolCtx());
      expect(result).toEqual({ content: "Ref 999999 is not on the page. Take a new snapshot.", isError: true });
    });
  });

  describe("page_click", () => {
    it("gate first, nothing called when debugging is not started", async () => {
      const call = vi.fn();
      const { pageClick } = tools({ helper: fakeHelper({ call }) });

      const result = await pageClick.execute({ tabId: 1, ref: "4" }, toolCtx());
      expect(result).toEqual({
        content: "Debugging is not started on tab #1. Call start_debugging first.",
        isError: true,
      });
      expect(call).not.toHaveBeenCalled();
    });

    it("stale describe returns error without dispatching click", async () => {
      const { api, session } = started();
      await session.start(1);

      const call = callQueue({ describe: [{ ok: true, value: { connected: false } }] });
      const { pageClick } = tools({ debuggerSession: session, helper: fakeHelper({ call }) });

      const result = await pageClick.execute({ tabId: 1, ref: "5" }, toolCtx());
      expect(result).toEqual({
        content: "Ref 5 is no longer on the page. Take a new snapshot.",
        isError: true,
      });
      expect(api.sendCommand).not.toHaveBeenCalledWith(1, "Input.dispatchMouseEvent", expect.anything());
    });

    it("ask + Reject prompts confirm and halts without centre or click", async () => {
      const { api, session } = started();
      await session.start(1);

      const call = callQueue({
        describe: [{ ok: true, value: { connected: true, name: "Place order", desc: 'button "Place order"', permission: "ask", reason: "Charges the card", disabled: false } }],
      });
      const centre = vi.fn();
      const confirmInteraction = vi.fn().mockResolvedValue(false);
      const { pageClick } = tools({ debuggerSession: session, helper: fakeHelper({ call, centre }), confirmInteraction });

      const result = await pageClick.execute({ tabId: 1, ref: "3" }, toolCtx());
      expect(confirmInteraction).toHaveBeenCalledWith({
        action: "click",
        ref: "3",
        name: "Place order",
        reason: "Charges the card",
      });
      expect(result.content).toBe(
        'Action "click" on [3] "Place order" was not confirmed by the user; not performed.',
      );
      expect(centre).not.toHaveBeenCalled();
      expect(api.sendCommand).not.toHaveBeenCalledWith(1, "Input.dispatchMouseEvent", expect.anything());
    });

    it("happy path clicks element using real mouse commands", async () => {
      const { api, session } = started();
      await session.start(1);

      const call = callQueue({
        describe: [{ ok: true, value: { connected: true, name: "Apply", desc: 'button "Apply"', permission: "allow", disabled: false } }],
        target: [{ ok: true, value: APPLY_TARGET }],
      });
      const centre = vi.fn().mockResolvedValue({ ok: true, x: 40, y: 50 });
      const { pageClick } = tools({ debuggerSession: session, helper: fakeHelper({ call, centre }) });

      const result = await pageClick.execute({ tabId: 1, ref: "4" }, toolCtx());
      expect(result).toEqual({ content: 'Clicked [4] button "Apply". (journal #1)' });
      expect(centre).toHaveBeenCalledWith(1, "4");
      expect(api.sendCommand).toHaveBeenCalledWith(1, "Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: 40,
        y: 50,
      });
      expect(api.sendCommand).toHaveBeenCalledWith(1, "Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: 40,
        y: 50,
        button: "left",
        clickCount: 1,
      });
      expect(api.sendCommand).toHaveBeenCalledWith(1, "Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: 40,
        y: 50,
        button: "left",
        clickCount: 1,
      });
    });

    it("click with no locator is not journaled", async () => {
      const { session } = started();
      await session.start(1);

      const call = callQueue({
        describe: [{ ok: true, value: { connected: true, name: "Apply", desc: 'button "Apply"', permission: "allow", disabled: false } }],
        target: [{ ok: true, value: { role: "generic", name: "", label: "[4] generic", isPassword: false } }],
      });
      const centre = vi.fn().mockResolvedValue({ ok: true, x: 40, y: 50 });
      const { pageClick } = tools({ debuggerSession: session, helper: fakeHelper({ call, centre }) });

      const result = await pageClick.execute({ tabId: 1, ref: "4" }, toolCtx());
      expect(result).toEqual({
        content: 'Clicked [4] button "Apply". (not journaled: no stable locator for [4] generic)',
      });
    });

    it("block-policy refusal returns error and does not click", async () => {
      const { api, session } = started();
      await session.start(1);

      const call = callQueue({
        describe: [{ ok: true, value: { connected: true, name: "Clear saved cards", desc: 'button "Clear saved cards"', permission: "block", disabled: false, refusal: 'Blocked by interaction policy ("block"): not allowed to operate [4] "Clear saved cards"; ask the user to do it themselves.' } }],
      });
      const { pageClick } = tools({ debuggerSession: session, helper: fakeHelper({ call }) });

      const result = await pageClick.execute({ tabId: 1, ref: "4" }, toolCtx());
      expect(result).toEqual({
        content: 'Blocked by interaction policy ("block"): not allowed to operate [4] "Clear saved cards"; ask the user to do it themselves.',
        isError: true,
      });
      expect(api.sendCommand).not.toHaveBeenCalledWith(1, "Input.dispatchMouseEvent", expect.anything());
    });

    it("Cancel during the click returns Cancel gate error", async () => {
      const { api, session, fireDetach } = started();
      api.sendCommand.mockImplementation((_tabId: number, method: string) => {
        if (method === "Input.dispatchMouseEvent") {
          fireDetach(1, "canceled_by_user");
          return Promise.reject(new Error("detach"));
        }
        return Promise.resolve({});
      });
      await session.start(1);

      const call = callQueue({
        describe: [{ ok: true, value: { connected: true, name: "Apply", desc: 'button "Apply"', permission: "allow", disabled: false } }],
      });
      const centre = vi.fn().mockResolvedValue({ ok: true, x: 40, y: 50 });
      const { pageClick } = tools({ debuggerSession: session, helper: fakeHelper({ call, centre }) });

      const result = await pageClick.execute({ tabId: 1, ref: "4" }, toolCtx());
      expect(result).toEqual({
        content:
          "Debugging stopped on tab #1: the user pressed Cancel on Chrome's bar. Call start_debugging to continue.",
        isError: true,
      });
    });

    it("other command failure returns error message", async () => {
      const { api, session } = started();
      api.sendCommand.mockImplementation((_tabId: number, method: string) => {
        if (method === "Input.dispatchMouseEvent") {
          return Promise.reject(new Error("No tab with given id 1."));
        }
        return Promise.resolve({});
      });
      await session.start(1);

      const call = callQueue({
        describe: [{ ok: true, value: { connected: true, name: "Apply", desc: 'button "Apply"', permission: "allow", disabled: false } }],
      });
      const centre = vi.fn().mockResolvedValue({ ok: true, x: 40, y: 50 });
      const { pageClick } = tools({ debuggerSession: session, helper: fakeHelper({ call, centre }) });

      const result = await pageClick.execute({ tabId: 1, ref: "4" }, toolCtx());
      expect(result).toEqual({
        content: "No tab with given id 1.",
        isError: true,
      });
    });

    it("description ends with Needs start_debugging on the tab first. and does not say 'activated'", () => {
      const { pageClick } = tools();
      expect(pageClick.description).toMatch(/Needs start_debugging on the tab first\.$/);
      expect(pageClick.description).not.toMatch(/activated/);
    });
  });

  describe("page_fill_form", () => {
    it("gate first, even with empty fields", async () => {
      const { pageFillForm } = tools();
      const result = await pageFillForm.execute({ tabId: 1, fields: [] }, toolCtx());
      expect(result).toEqual({
        content: "Debugging is not started on tab #1. Call start_debugging first.",
        isError: true,
      });
    });

    it("empty fields after start returns named error without calling the helper", async () => {
      const { session } = started();
      await session.start(1);

      const call = vi.fn();
      const { pageFillForm } = tools({ debuggerSession: session, helper: fakeHelper({ call }) });

      const result = await pageFillForm.execute({ tabId: 1, fields: [] }, toolCtx());
      expect(result).toEqual({
        content: "page_fill_form needs at least one field.",
        isError: true,
      });
      expect(call).not.toHaveBeenCalled();
    });

    it("stale describe on the second field returns error without filling the first", async () => {
      const { api, session } = started();
      await session.start(1);

      const describeQueue = [
        { ok: true, value: { connected: true, name: "Coupon", desc: 'textbox "Coupon"', permission: "allow", disabled: false } },
        { ok: true, value: { connected: false } },
      ];
      const call = vi.fn((_tabId: number, _ref: string, fn: string) => {
        if (fn === "describe") return Promise.resolve(describeQueue.shift());
        throw new Error(`unexpected helper call: ${fn}`);
      });
      const { pageFillForm } = tools({ debuggerSession: session, helper: fakeHelper({ call }) });

      const result = await pageFillForm.execute(
        { tabId: 1, fields: [{ ref: "7", value: "SAVE10" }, { ref: "9", value: "x@y.com" }] },
        toolCtx(),
      );
      expect(result).toEqual({
        content: "Ref 9 is no longer on the page. Take a new snapshot.",
        isError: true,
      });
      expect(api.sendCommand).not.toHaveBeenCalledWith(1, "DOM.focus", expect.anything());
    });

    it("ask + Reject prompts confirm and halts if rejected", async () => {
      const { api, session } = started();
      await session.start(1);

      const describeQueue = [
        { ok: true, value: { connected: true, name: "Coupon", desc: 'textbox "Coupon"', permission: "allow", disabled: false } },
        { ok: true, value: { connected: true, name: "Notes", desc: 'textbox "Notes"', permission: "ask", reason: "PII", disabled: false } },
      ];
      const call = vi.fn((_tabId: number, _ref: string, fn: string) => {
        if (fn === "describe") return Promise.resolve(describeQueue.shift());
        throw new Error(`unexpected helper call: ${fn}`);
      });
      const confirmInteraction = vi.fn().mockResolvedValue(false);
      const { pageFillForm } = tools({ debuggerSession: session, helper: fakeHelper({ call }), confirmInteraction });

      const result = await pageFillForm.execute(
        { tabId: 1, fields: [{ ref: "7", value: "SAVE10" }, { ref: "8", value: "hi" }] },
        toolCtx(),
      );
      expect(confirmInteraction).toHaveBeenCalledWith({ action: "fill", ref: "8", name: "Notes", reason: "PII" });
      expect(result.content).toBe('Action "fill" on [8] "Notes" was not confirmed by the user; no fields filled.');
      expect(api.sendCommand).not.toHaveBeenCalledWith(1, "DOM.focus", expect.anything());
    });

    it("happy path, one field with text, one empty", async () => {
      const { api, session } = started();
      await session.start(1);

      const describeQueue = [
        { ok: true, value: { connected: true, name: "Coupon", desc: 'textbox "Coupon"', permission: "allow", disabled: false } },
        { ok: true, value: { connected: true, name: "Email", desc: 'textbox "Email"', permission: "allow", disabled: false } },
      ];
      const fillPrepareQueue = [{ ok: true, value: { ok: true, hadText: true } }, { ok: true, value: { ok: true, hadText: false } }];
      const targetQueue = [{ ok: true, value: COUPON_TARGET }, { ok: true, value: EMAIL_TARGET }];
      const readValueQueue = [{ ok: true, value: { value: "SAVE10" } }, { ok: true, value: { value: "qa@example.com" } }];
      const call = vi.fn((_tabId: number, _ref: string, fn: string) => {
        if (fn === "describe") return Promise.resolve(describeQueue.shift());
        if (fn === "fillPrepare") return Promise.resolve(fillPrepareQueue.shift());
        if (fn === "target") return Promise.resolve(targetQueue.shift());
        if (fn === "readValue") return Promise.resolve(readValueQueue.shift());
        throw new Error(`unexpected helper call: ${fn}`);
      });
      const { pageFillForm } = tools({ debuggerSession: session, helper: fakeHelper({ call }) });

      const result = await pageFillForm.execute(
        {
          tabId: 1,
          fields: [
            { ref: "7", value: "SAVE10" },
            { ref: "9", value: "qa@example.com" },
          ],
        },
        toolCtx(),
      );

      expect(result).toEqual({
        content: 'Filled 2 fields: [7] textbox "Coupon", [9] textbox "Email". (journal #1–#2)',
      });

      const focusCalls = api.sendCommand.mock.calls.filter(([, method]) => method === "DOM.focus");
      expect(focusCalls).toEqual([
        [1, "DOM.focus", { backendNodeId: 7 }],
        [1, "DOM.focus", { backendNodeId: 9 }],
      ]);
      const inputCalls = api.sendCommand.mock.calls.filter(([, method]) => method.startsWith("Input."));
      expect(inputCalls).toEqual([
        [1, "Input.dispatchKeyEvent", { type: "keyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 }],
        [1, "Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 }],
        [1, "Input.insertText", { text: "SAVE10" }],
        [1, "Input.insertText", { text: "qa@example.com" }],
      ]);
    });

    it("preserves spaces in the value it types (card number)", async () => {
      const { api, session } = started();
      await session.start(1);

      const call = vi.fn((_tabId: number, _ref: string, fn: string) => {
        if (fn === "describe") return Promise.resolve({ ok: true, value: { connected: true, name: "Card number", desc: 'textbox "Card number"', permission: "allow", disabled: false } });
        if (fn === "fillPrepare") return Promise.resolve({ ok: true, value: { ok: true, hadText: false } });
        if (fn === "target") return Promise.resolve({ ok: true, value: { role: "textbox", name: "Card number", label: '[7] textbox "Card number"', locator: "getByLabel('Card number')", isPassword: false } });
        if (fn === "readValue") return Promise.resolve({ ok: true, value: { value: "4242 4242 4242 4242" } });
        throw new Error(`unexpected helper call: ${fn}`);
      });
      const { pageFillForm } = tools({ debuggerSession: session, helper: fakeHelper({ call }) });

      const result = await pageFillForm.execute(
        { tabId: 1, fields: [{ ref: "7", value: "4242 4242 4242 4242" }] },
        toolCtx(),
      );

      expect(result.isError).toBeFalsy();
      // The fill path sends the value verbatim through Input.insertText, so the
      // spaces survive. If this fails, the fill path drops spaces and must be
      // fixed — not the spec's whitespace normalisation.
      expect(api.sendCommand).toHaveBeenCalledWith(1, "Input.insertText", { text: "4242 4242 4242 4242" });
    });

    it("mismatch reports read-back mismatch line", async () => {
      const { session } = started();
      await session.start(1);

      const call = vi.fn((_tabId: number, _ref: string, fn: string) => {
        if (fn === "describe") return Promise.resolve({ ok: true, value: { connected: true, name: "Coupon", desc: 'textbox "Coupon"', permission: "allow", disabled: false } });
        if (fn === "fillPrepare") return Promise.resolve({ ok: true, value: { ok: true, hadText: false } });
        if (fn === "target") return Promise.resolve({ ok: true, value: COUPON_TARGET });
        if (fn === "readValue") return Promise.resolve({ ok: true, value: { value: "SAVE1" } });
        throw new Error(`unexpected helper call: ${fn}`);
      });
      const { pageFillForm } = tools({ debuggerSession: session, helper: fakeHelper({ call }) });

      const result = await pageFillForm.execute(
        { tabId: 1, fields: [{ ref: "7", value: "SAVE10" }] },
        toolCtx(),
      );

      expect(result.content).toBe(
        'Filled 1 field: [7] textbox "Coupon".\n[7] textbox "Coupon": set "SAVE10" but value read back as "SAVE1". (journal #1)',
      );
    });

    it("fillPrepare error on second field stops fill and reports partial failure", async () => {
      const { api, session } = started();
      await session.start(1);

      const describeQueue = [
        { ok: true, value: { connected: true, name: "Coupon", desc: 'textbox "Coupon"', permission: "allow", disabled: false } },
        { ok: true, value: { connected: true, name: "Email", desc: 'textbox "Email"', permission: "allow", disabled: false } },
      ];
      const fillPrepareQueue = [
        { ok: true, value: { ok: true, hadText: false } },
        { ok: true, value: { ok: false, message: "Ref 9 is not a text input, textarea, or contenteditable." } },
      ];
      const targetQueue = [{ ok: true, value: COUPON_TARGET }];
      const call = vi.fn((_tabId: number, _ref: string, fn: string) => {
        if (fn === "describe") return Promise.resolve(describeQueue.shift());
        if (fn === "fillPrepare") return Promise.resolve(fillPrepareQueue.shift());
        if (fn === "target") return Promise.resolve(targetQueue.shift());
        if (fn === "readValue") return Promise.resolve({ ok: true, value: { value: "SAVE10" } });
        throw new Error(`unexpected helper call: ${fn}`);
      });
      const { pageFillForm } = tools({ debuggerSession: session, helper: fakeHelper({ call }) });

      const result = await pageFillForm.execute(
        {
          tabId: 1,
          fields: [
            { ref: "7", value: "SAVE10" },
            { ref: "9", value: "qa@example.com" },
          ],
        },
        toolCtx(),
      );

      expect(result).toEqual({
        content: 'Filled 1 of 2 fields: [7] textbox "Coupon". Field [9] failed: Ref 9 is not a text input, textarea, or contenteditable.',
        isError: true,
      });
      expect(api.sendCommand).not.toHaveBeenCalledWith(1, "Input.insertText", { text: "qa@example.com" });
    });

    it("fill with one field without a locator", async () => {
      const { session } = started();
      await session.start(1);

      const describeQueue = [
        { ok: true, value: { connected: true, name: "Coupon", desc: 'textbox "Coupon"', permission: "allow", disabled: false } },
        { ok: true, value: { connected: true, name: "Email", desc: 'textbox "Email"', permission: "allow", disabled: false } },
      ];
      const targetQueue = [
        { ok: true, value: COUPON_TARGET },
        { ok: true, value: { role: "textbox", name: "Email", label: '[9] textbox "Email"', isPassword: false } },
      ];
      const call = vi.fn((_tabId: number, _ref: string, fn: string) => {
        if (fn === "describe") return Promise.resolve(describeQueue.shift());
        if (fn === "fillPrepare") return Promise.resolve({ ok: true, value: { ok: true, hadText: false } });
        if (fn === "target") return Promise.resolve(targetQueue.shift());
        if (fn === "readValue") return Promise.resolve({ ok: true, value: {} });
        throw new Error(`unexpected helper call: ${fn}`);
      });
      const { pageFillForm } = tools({ debuggerSession: session, helper: fakeHelper({ call }) });

      const result = await pageFillForm.execute(
        {
          tabId: 1,
          fields: [
            { ref: "7", value: "SAVE10" },
            { ref: "9", value: "qa@example.com" },
          ],
        },
        toolCtx(),
      );

      expect(result.content).toBe(
        'Filled 2 fields: [7] textbox "Coupon", [9] textbox "Email". (journal #1) (not journaled: no stable locator for [9] textbox "Email")',
      );
    });

    it("Cancel mid-fill returns Cancel gate error", async () => {
      const { api, session, fireDetach } = started();
      api.sendCommand.mockImplementation((_tabId: number, method: string) => {
        if (method === "Input.insertText") {
          fireDetach(1, "canceled_by_user");
          return Promise.reject(new Error("detach"));
        }
        return Promise.resolve({});
      });
      await session.start(1);

      const call = vi.fn((_tabId: number, _ref: string, fn: string) => {
        if (fn === "describe") return Promise.resolve({ ok: true, value: { connected: true, name: "Coupon", desc: 'textbox "Coupon"', permission: "allow", disabled: false } });
        if (fn === "fillPrepare") return Promise.resolve({ ok: true, value: { ok: true, hadText: false } });
        throw new Error(`unexpected helper call: ${fn}`);
      });
      const { pageFillForm } = tools({ debuggerSession: session, helper: fakeHelper({ call }) });

      const result = await pageFillForm.execute(
        { tabId: 1, fields: [{ ref: "7", value: "SAVE10" }] },
        toolCtx(),
      );

      expect(result).toEqual({
        content:
          "Debugging stopped on tab #1: the user pressed Cancel on Chrome's bar. Call start_debugging to continue.",
        isError: true,
      });
    });

    it("description ends with Needs start_debugging on the tab first.", () => {
      const { pageFillForm } = tools();
      expect(pageFillForm.description).toMatch(/Needs start_debugging on the tab first\.$/);
    });
  });

  describe("page_select_option", () => {
    it("rejects empty values with named error", async () => {
      const call = vi.fn();
      const { pageSelectOption } = tools({ helper: fakeHelper({ call }) });

      const result = await pageSelectOption.execute({ tabId: 1, ref: "5", values: [] }, toolCtx());

      expect(result.isError).toBe(true);
      expect(result.content).toBe("page_select_option needs at least one value.");
      expect(call).not.toHaveBeenCalled();
    });

    it("step 1 returns error if single-select passed multiple values", async () => {
      const { session } = started();
      await session.start(1);

      const call = callQueue({
        describe: [{ ok: true, value: { connected: true, name: "Shipping", desc: 'combobox "Shipping"', permission: "allow", disabled: false } }],
        selectPrepare: [{ ok: true, value: { ok: false, message: "Ref 5 is a single-choice select; pass exactly one value." } }],
      });
      const { pageSelectOption } = tools({ debuggerSession: session, helper: fakeHelper({ call }) });

      const result = await pageSelectOption.execute({ tabId: 1, ref: "5", values: ["Standard", "Express"] }, toolCtx());

      expect(result.isError).toBe(true);
      expect(result.content).toBe("Ref 5 is a single-choice select; pass exactly one value.");
    });

    it("step 2 prompts confirmInteraction for ask-tier", async () => {
      const { session } = started();
      await session.start(1);

      const call = callQueue({
        describe: [{ ok: true, value: { connected: true, name: "Shipping", desc: 'combobox "Shipping"', permission: "ask", reason: "Changes billing", disabled: false } }],
        selectPrepare: [{ ok: true, value: { ok: true, name: "Shipping", target: { role: "combobox", name: "Shipping", label: '[5] combobox "Shipping"', isPassword: false } } }],
      });
      const confirmInteraction = vi.fn().mockResolvedValue(false);
      const { pageSelectOption } = tools({ debuggerSession: session, helper: fakeHelper({ call }), confirmInteraction });

      const result = await pageSelectOption.execute({ tabId: 1, ref: "5", values: ["Express"] }, toolCtx());

      expect(confirmInteraction).toHaveBeenCalledWith({
        action: "select_option",
        ref: "5",
        name: "Shipping",
        reason: "Changes billing",
      });
      expect(result.content).toBe(
        'Action "select_option" on [5] "Shipping" was not confirmed by the user; not performed.',
      );
    });

    it("step 3 executes selectOptions and returns text", async () => {
      const { session } = started();
      await session.start(1);

      const call = callQueue({
        describe: [{ ok: true, value: { connected: true, name: "Extras", desc: 'combobox "Extras"', permission: "allow", disabled: false } }],
        selectPrepare: [{
          ok: true,
          value: {
            ok: true,
            name: "Extras",
            target: { role: "listbox", name: "Extras", label: '[6] listbox "Extras"', locator: "getByLabel('Extras')", isPassword: false },
          },
        }],
        selectExecute: [{ ok: true, value: { text: 'Selected "Gift wrap", "Card" in [6] combobox "Extras".' } }],
      });
      const { pageSelectOption } = tools({ debuggerSession: session, helper: fakeHelper({ call }) });

      const result = await pageSelectOption.execute({ tabId: 1, ref: "6", values: ["Gift wrap", "Card"] }, toolCtx());

      expect(result.isError).toBeFalsy();
      expect(result.content).toBe('Selected "Gift wrap", "Card" in [6] combobox "Extras". (journal #1)');
    });
  });

  describe("createPanelPageTools — verify and locator tools (122/002, 131/002)", () => {
    function getVerifyLocatorTools(helper: HelperWorlds, debuggerSession = started().session) {
      const all = createPanelPageTools({ helper, debuggerSession });
      const pageVerify = all.find((t) => t.name === "page_verify");
      const pageGenerateLocator = all.find((t) => t.name === "page_generate_locator");
      if (!pageVerify || !pageGenerateLocator) throw new Error("tools not found");
      return { pageVerify, pageGenerateLocator };
    }

    it("page_verify input errors never call the helper", async () => {
      const { session } = started();
      await session.start(1);
      const call = vi.fn();
      const { pageVerify } = getVerifyLocatorTools(fakeHelper({ call }), session);

      const cases = [
        { input: { tabId: 1, kind: "element_visible" }, error: 'page_verify kind "element_visible" needs ref or role.' },
        { input: { tabId: 1, kind: "text_visible" }, error: 'page_verify kind "text_visible" needs text.' },
        { input: { tabId: 1, kind: "value" }, error: 'page_verify kind "value" needs ref.' },
        { input: { tabId: 1, kind: "value", ref: "2" }, error: 'page_verify kind "value" needs value.' },
        { input: { tabId: 1, kind: "list", role: "list" }, error: 'page_verify kind "list" needs items.' },
        { input: { tabId: 1, kind: "list", items: ["a"] }, error: 'page_verify kind "list" needs ref or role.' },
      ];

      for (const c of cases) {
        const res = await pageVerify.execute(c.input, toolCtx());
        expect(res).toEqual({ content: c.error, isError: true });
      }
      expect(call).not.toHaveBeenCalled();
    });

    it('page_verify value "" is allowed', async () => {
      const { session } = started();
      await session.start(1);
      const call = callQueue({
        describe: [{ ok: true, value: { connected: true, name: "Coupon", desc: 'textbox "Coupon"', permission: "allow", disabled: false } }],
        verify: [{ ok: true, value: { text: 'PASS [2] textbox "Coupon" has value "".', isError: false, target: COUPON_TARGET } }],
      });
      const { pageVerify } = getVerifyLocatorTools(fakeHelper({ call }), session);

      const result = await pageVerify.execute({ tabId: 1, kind: "value", ref: "2", value: "" }, toolCtx());
      expect(result.content).toBe('PASS [2] textbox "Coupon" has value "". (journal #1)');
      expect(result.isError).toBeFalsy();
    });

    it("page_verify returns PASS/FAIL as normal results", async () => {
      const { session } = started();
      await session.start(1);
      const callOnDocument = callOnDocumentQueue({
        verify: [{ ok: true, value: { text: 'FAIL expected text "Enter a code" to be visible; found no matching text.', isError: false } }],
      });
      const { pageVerify } = getVerifyLocatorTools(fakeHelper({ callOnDocument }), session);

      const result = await pageVerify.execute({ tabId: 1, kind: "text_visible", text: "Enter a code" }, toolCtx());
      expect(result.content).toBe('FAIL expected text "Enter a code" to be visible; found no matching text.');
      expect(result.isError).toBeFalsy();
    });

    it("PASS without a locator", async () => {
      const { session } = started();
      await session.start(1);
      const callOnDocument = callOnDocumentQueue({
        verify: [{
          ok: true,
          value: { text: 'PASS button "Apply" is visible.', isError: false, target: { role: "button", name: "Apply", label: 'button "Apply"', isPassword: false } },
        }],
      });
      const { pageVerify } = getVerifyLocatorTools(fakeHelper({ callOnDocument }), session);

      const result = await pageVerify.execute({ tabId: 1, kind: "element_visible", role: "button", name: "Apply" }, toolCtx());
      expect(result.content).toBe(
        'PASS button "Apply" is visible. (not journaled: no stable locator for button "Apply")',
      );
    });

    it("page_verify and page_generate_locator gate before debugging starts", async () => {
      const { session } = started();
      const { pageVerify, pageGenerateLocator } = getVerifyLocatorTools(fakeHelper(), session);

      const vRes = await pageVerify.execute({ tabId: 1, kind: "text_visible", text: "Apply" }, toolCtx());
      expect(vRes).toEqual({
        content: "Debugging is not started on tab #1. Call start_debugging first.",
        isError: true,
      });

      const lRes = await pageGenerateLocator.execute({ tabId: 1, ref: "3" }, toolCtx());
      expect(lRes).toEqual({
        content: "Debugging is not started on tab #1. Call start_debugging first.",
        isError: true,
      });
    });

    it("page_verify with a stale ref returns the stale-ref text", async () => {
      const { session } = started();
      await session.start(1);
      const call = callQueue({ describe: [{ ok: true, value: { connected: false } }] });
      const { pageVerify } = getVerifyLocatorTools(fakeHelper({ call }), session);

      const result = await pageVerify.execute({ tabId: 1, kind: "value", ref: "2", value: "x" }, toolCtx());
      expect(result).toEqual({ content: "Ref 2 is no longer on the page. Take a new snapshot.", isError: true });
    });

    it("page_generate_locator forwards ref and passes isError through", async () => {
      const { session } = started();
      await session.start(1);
      const call = callQueue({
        describe: [{ ok: true, value: { connected: true, name: "", desc: "button", permission: "allow", disabled: false } }],
        locator: [{ ok: true, value: { text: "Could not make a unique locator for [3] button.", isError: true } }],
      });
      const { pageGenerateLocator } = getVerifyLocatorTools(fakeHelper({ call }), session);

      const result = await pageGenerateLocator.execute({ tabId: 1, ref: "3" }, toolCtx());
      expect(result).toEqual({
        content: "Could not make a unique locator for [3] button.",
        isError: true,
      });
    });

    it("summarize", () => {
      const { pageVerify, pageGenerateLocator } = getVerifyLocatorTools(fakeHelper());
      expect(pageVerify.summarize?.({ tabId: 3, kind: "text_visible" })).toBe("Verify text_visible in tab #3");
      expect(pageGenerateLocator.summarize?.({ tabId: 3, ref: "7" })).toBe("Locator for [7] in tab #3");
    });
  });
});

describe("createPanelPageTools — 124/007 phrases", () => {
  const PHRASED_NAMES = [
    "page_snapshot", "page_click", "page_fill_form", "page_select_option",
    "page_verify", "page_generate_locator", "page_network", "page_dialog",
    "start_recording", "stop_recording", "export_test",
    "start_debugging", "stop_debugging", "page_hover", "page_press_key",
    "page_upload_file", "page_emulate", "page_screenshot",
  ];

  function toolsWithVision(overrides: Parameters<typeof createPanelPageTools>[0] = {}) {
    return createPanelPageTools({ endpointType: "anthropic", model: "sonnet", ...overrides });
  }

  it("every page tool carries a phrase", () => {
    const tools = toolsWithVision();
    for (const name of PHRASED_NAMES) {
      const tool = tools.find((t) => t.name === name);
      expect(tool, `${name} must exist`).toBeTruthy();
      expect(typeof tool?.phrase, `${name}.phrase`).toBe("function");
      expect(typeof tool?.inProgressPhrase, `${name}.inProgressPhrase`).toBe("function");
    }
  });

  it("page_eval, page_fetch and page_console carry none", () => {
    const tools = toolsWithVision();
    for (const name of ["page_eval", "page_fetch", "page_console"]) {
      const tool = tools.find((t) => t.name === name);
      expect(tool?.phrase, `${name}.phrase`).toBeUndefined();
      expect(tool?.inProgressPhrase, `${name}.inProgressPhrase`).toBeUndefined();
    }
  });

  it("a real call fills the host map", async () => {
    const api = {
      attach: vi.fn().mockResolvedValue(undefined),
      detach: vi.fn().mockResolvedValue(undefined),
      sendCommand: vi.fn((_tabId: number, method: string) =>
        Promise.resolve(
          method === "Accessibility.getFullAXTree"
            ? { nodes: [{ nodeId: "1", role: { value: "textbox" }, name: { value: "Coupon" }, value: { value: "SAVE10" }, backendDOMNodeId: 1 }] }
            : method === "Runtime.evaluate"
              ? { result: { type: "string", value: "UA/1" } }
              : {},
        ),
      ),
      tabUrl: vi.fn().mockResolvedValue("http://localhost:10040/checkout.html"),
      onDetach: vi.fn(),
      onEvent: vi.fn(),
    };
    const session = createDebuggerSession(api);
    const tools = toolsWithVision({ debuggerSession: session });
    // 131/002 — page_snapshot no longer feeds the host tracker itself; only
    // start_debugging does (panel-page-tools-debugger.ts), so the real tool
    // call is what fills the map, not a direct session.start().
    const startDebugging = tools.find((t) => t.name === "start_debugging")!;
    await startDebugging.execute({ tabId: 5 }, toolCtx());
    const pageSnapshot = tools.find((t) => t.name === "page_snapshot")!;

    const reply = await pageSnapshot.execute({ tabId: 5 }, toolCtx());
    expect(reply.isError).toBeFalsy();

    const line = pageSnapshot.phrase?.({ input: { tabId: 5 }, outcomeSummary: reply.content }, "tesagent");
    expect(line).toMatch(/of localhost:10040$/);
  });

  it("before any call the host is unknown", () => {
    const tools = toolsWithVision();
    const pageSnapshot = tools.find((t) => t.name === "page_snapshot")!;

    const line = pageSnapshot.phrase?.({ input: { tabId: 5 }, outcomeSummary: "Snapshot: 1 node." }, "tesagent");
    expect(line).toMatch(/of the page$/);
  });
});
