import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAgentSession } from "./controller.js";
import type { SessionState, SessionEvent, AgentSession } from "./controller.js";
import type { TurnFlushRecord } from "./loop/session-lifecycle.js";
import { buttonToMessage, formSubmitToMessage } from "./ui-blocks/bridge.js";
import { setMockScript } from "./transport/registry.js";
import type { CustomToolDef, ToolOutcome, SkillDef, ToolContext } from "./tools/build-tools.js";
import { defaultTools, schedulerTools } from "./tools/builders.js";
import { IdbSessionStore } from "./loop/session-store.js";
import type { SessionMeta, SessionStore, SessionRecordRange, SessionRecordPage } from "./loop/session-store.js";
import type { Message, MessageCreateParams } from "./transport/wire.types.js";
import type { SessionStartPayload, TurnEndPayload } from "./hooks/types.js";
import { DEFAULT_CONTEXT_CONFIG } from "./config.js";
import { z } from "zod";
import { attachmentChipsMeta } from "./attachments/types.js";
import type { UserPromptPayload } from "./hooks/types.js";
import { ContextManager } from "./loop/context-manager.js";

function mkTextResp(text: string): Message {
  return {
    id: "msg_x",
    type: "message",
    role: "assistant",
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    stop_sequence: null,
    model: "test",
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  };
}

function mkEmptyResp(): Message {
  return {
    id: "msg_empty",
    type: "message",
    role: "assistant",
    content: [],
    stop_reason: "end_turn",
    stop_sequence: null,
    model: "test",
    usage: { input_tokens: 6, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  };
}

function mkToolResp(id: string, name: string, input: Record<string, unknown> = {}): Message {
  return {
    id: "msg_x",
    type: "message",
    role: "assistant",
    content: [{ type: "tool_use", id, name, input }],
    stop_reason: "tool_use",
    stop_sequence: null,
    model: "test",
    usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  };
}

function mkMixedResp(text: string, toolId: string, toolName: string, input: unknown): Message {
  return {
    id: "msg_x",
    type: "message",
    role: "assistant",
    content: [
      { type: "text", text },
      { type: "tool_use", id: toolId, name: toolName, input },
    ],
    stop_reason: "tool_use",
    stop_sequence: null,
    model: "test",
    usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  };
}

function mkAnthropicFetch(seq: Array<Message>) {
  let idx = 0;
  return vi.fn().mockImplementation(() => {
    const body = seq[idx] ?? seq[seq.length - 1];
    idx++;
    return Promise.resolve(new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
  });
}

function mkErrorFetch(status: number, message = "mock error") {
  return vi.fn().mockImplementation(() => {
    return Promise.resolve(new Response(
      JSON.stringify({ type: "error", error: { type: "error", message } }),
      { status, headers: { "Content-Type": "application/json" } }
    ));
  });
}

function mkFailThenFetch(failStatus: number, successBody: Message, failTimes = 1) {
  let calls = 0;
  return vi.fn().mockImplementation(() => {
    calls++;
    if (calls <= failTimes) {
      return Promise.resolve(new Response(
        JSON.stringify({ type: "error", error: { type: "error", message: "mock error" } }),
        { status: failStatus, headers: { "Content-Type": "application/json" } }
      ));
    }
    return Promise.resolve(new Response(JSON.stringify(successBody), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
  });
}

/** One turn's TurnFlushRecord — a user entry and an assistant entry sharing a
 *  turnId, built directly rather than through a real turn. Used to seed a
 *  mock store's records without paying for N real HTTP round trips. */
function mkTurnRecord(n: number): TurnFlushRecord {
  const turnId = `t${n}`;
  return {
    _kind: "turn_flush",
    journalDelta: [
      { msg: { role: "user", content: `Q${n}` }, meta: { turnId, stepNo: 0, kinds: [], chars: 2, createdAt: n } },
      { msg: { role: "assistant", content: `A${n}` }, meta: { turnId, stepNo: 1, kinds: [], chars: 2, createdAt: n } },
    ],
    audit: [],
  };
}

describe("AGENTS.md prompt seams", () => {
  const chip = (label: string) => ({ providerId: "test", label });
  const config = () => ({
    persist: false, model: "test-model", endpointType: "anthropic",
    baseURL: "http://localhost:10032/api/anthropic/v1", maxRetries: 0,
  });

  it.each(["createSession", "reset", "switchSession"] as const)("%s never notifies listeners with a new session ID and old messages", async (action) => {
    const session = createAgentSession({ ...config(), todo: { enabled: true },
      fetch: mkAnthropicFetch([mkTextResp("Old reply")]),
    });
    await session.initPromise;
    await session.send([{ type: "text", text: "Old question" }]);
    const oldId = session.getState().activeSessionId;
    const observed: Array<{ id: string; texts: string[] }> = [];
    const unsubscribe = session.subscribe((state) => observed.push({
      id: state.activeSessionId, texts: state.messages.map((message) => message.text),
    }));
    try {
      if (action === "switchSession") await session.switchSession("another-session");
      else await session[action]();
      const newId = session.getState().activeSessionId;
      expect(newId).not.toBe(oldId);
      const newStates = observed.filter((state) => state.id === newId);
      expect(newStates.length).toBeGreaterThan(0);
      expect(newStates.every((state) => state.texts.length === 0)).toBe(true);
      expect(session.getState().messages).toEqual([]);
    } finally {
      unsubscribe();
      session.dispose();
    }
  });

  it("switchSession notifies listeners only after restoring the target journal", async () => {
    const metas = [
      { id: "old", title: "Old", createdAt: 2, updatedAt: 2 },
      { id: "target", title: "Target", createdAt: 1, updatedAt: 1 },
    ];
    const store: SessionStore = {
      createSession: vi.fn().mockResolvedValue(undefined),
      appendRecords: vi.fn().mockResolvedValue(undefined),
      readRange: vi.fn().mockImplementation((id: string) => Promise.resolve({ records: [mkTurnRecord(id === "target" ? 2 : 1)] })),
      truncateAfter: vi.fn().mockResolvedValue(undefined),
      saveMeta: vi.fn().mockResolvedValue(undefined),
      loadAllMetadata: vi.fn().mockResolvedValue(metas),
      deleteByIds: vi.fn().mockResolvedValue(undefined),
    };
    const session = createAgentSession({ ...config(), persist: true, sessionStore: store, todo: { enabled: true } });
    await session.initPromise;
    expect(session.getState().messages.map((message) => message.text)).toEqual(["Q1", "A1"]);
    const seen: string[][] = [];
    const unsubscribe = session.subscribe((state) => {
      if (state.activeSessionId === "target") seen.push(state.messages.map((message) => message.text));
    });
    try {
      await session.switchSession("target");
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every((texts) => texts.join("|") === "Q2|A2")).toBe(true);
    } finally {
      unsubscribe();
      session.dispose();
    }
  });

  it.each(["createSession", "reset"] as const)("%s records tool steps in the new journal and leaves the old journal unchanged", async (action) => {
    const appendSpy = vi.spyOn(ContextManager.prototype, "appendUser");
    let calls = 0;
    const tool: CustomToolDef = {
      name: "journal_probe", description: "Return a probe result", inputSchema: z.object({}),
      execute: () => { calls++; return Promise.resolve({ content: "Probe completed" }); },
    };
    const session = createAgentSession({ ...config(), tools: () => [tool],
      fetch: mkAnthropicFetch([mkTextResp("Old reply"), mkToolResp("probe-1", "journal_probe"), mkTextResp("New reply")]),
    });
    try {
      await session.initPromise;
      await session.send([{ type: "text", text: "Old question" }]);
      const oldCm = appendSpy.mock.instances.at(-1)!;
      const oldJournal = structuredClone(oldCm.journal);
      await session[action]();
      await session.send([{ type: "text", text: "New question" }]);
      const newCm = appendSpy.mock.instances.at(-1)!;
      expect(newCm).not.toBe(oldCm);
      expect(newCm.journal.some((e) => e.msg.role === "tool")).toBe(true);
      expect(newCm.audit.some((e) => e.name === "journal_probe" && e.outcomeSummary === "Probe completed")).toBe(true);
      expect(oldCm.journal).toEqual(oldJournal);
      expect(calls).toBe(1);
      const state = session.getState();
      expect(state.running).toBe(false);
      expect(state.error).toBeUndefined();
      expect(state.messages.filter((m) => m.role === "assistant").flatMap((m) => m.trace ?? [])).toEqual([
        expect.objectContaining({ name: "journal_probe", outcomeSummary: "Probe completed", failed: false }),
      ]);
      expect(state.messages.some((m) => m.text === "Old question")).toBe(false);
      expect(state.messages.some((m) => m.text === "New reply")).toBe(true);
    } finally {
      session.dispose();
      appendSpy.mockRestore();
    }
  });

  it("queued message preserves userDisplayText and promptMeta when drained", async () => {
    let finishFirst!: (r: Response) => void;
    let startedFirst!: () => void;
    const started = new Promise<void>((r) => { startedFirst = r; });
    const fetchFn = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      .mockImplementationOnce(() => new Promise<Response>((r) => { finishFirst = r; startedFirst(); }))
      .mockImplementation(() => Promise.resolve(new Response(JSON.stringify(mkTextResp("ok")))));
    const session = createAgentSession({ ...config(), fetch: fetchFn, hooks: {
      onUserPrompt: ({ parts, displayText }) => ({
        parts: [{ type: "text", text: "Injected" }, ...parts],
        userDisplayText: displayText, meta: attachmentChipsMeta([chip(displayText!)]),
      }),
    } });
    await session.initPromise;
    const first = session.send([{ type: "text", text: "A" }]);
    await started;
    await session.send([{ type: "text", text: "B" }], { userDisplayText: "Display B" });
    await session.send([{ type: "text", text: "C" }], { userDisplayText: "Display C" });
    expect(session.getState().queuedMessages[0]).toMatchObject({ userDisplayText: "Display B", promptMeta: attachmentChipsMeta([chip("Display B")]) });
    finishFirst(new Response(JSON.stringify(mkTextResp("first"))));
    await first;
    const users = session.getState().messages.filter((m) => m.role === "user");
    expect(users[1].text).toBe("Display B\nDisplay C");
    expect(users[1].promptMeta).toEqual(attachmentChipsMeta([chip("Display B"), chip("Display C")]));
    const body = JSON.parse(fetchFn.mock.calls[1][1]!.body as string) as MessageCreateParams;
    expect(JSON.stringify(body.messages.at(-1)?.content)).toContain("Injected\\nB\\nInjected\\nC");
    session.dispose();
  });

  it("restartLastTurn preserves userDisplayText and promptMeta without re-running hooks", async () => {
    const fetchFn = mkAnthropicFetch([mkEmptyResp(), mkTextResp("ok")]);
    const hook = vi.fn(({ parts, displayText }: UserPromptPayload) => ({
      parts: [{ type: "text" as const, text: "Injected" }, ...parts],
      userDisplayText: displayText, meta: attachmentChipsMeta([chip("deck")]),
    }));
    const session = createAgentSession({ ...config(), fetch: fetchFn, hooks: { onUserPrompt: hook } });
    await session.initPromise;
    await session.send([{ type: "text", text: "Hello" }], { userDisplayText: "/skill arg" });
    await session.retryLast();
    expect(hook).toHaveBeenCalledTimes(1);
    const user = session.getState().messages.find((m) => m.role === "user")!;
    expect(user.text).toBe("/skill arg");
    expect(user.promptMeta).toEqual(attachmentChipsMeta([chip("deck")]));
    const bodies = fetchFn.mock.calls.map((c) => JSON.parse(c[1].body as string) as MessageCreateParams);
    expect(bodies[1].messages[0].content).toEqual(bodies[0].messages[0].content);
    expect(JSON.stringify(bodies[1].messages[0].content).match(/Injected/g)).toHaveLength(1);
    session.dispose();
  });

  it("new chat has firstInChat true on turn 1 and commands preserve caller display text", async () => {
    const hook = vi.fn(({ parts, displayText }: UserPromptPayload) => ({ parts: [{ type: "text" as const, text: "Injected" }, ...parts], userDisplayText: displayText }));
    const session = createAgentSession({ ...config(), fetch: mkAnthropicFetch([mkTextResp("ok")]), hooks: { onUserPrompt: hook } });
    await session.initPromise;
    await session.send([{ type: "text", text: "skill body" }], { userDisplayText: "/skill arg" });
    expect(session.getState().messages[0].text).toBe("/skill arg");
    await session.send([{ type: "text", text: "second" }]);
    await session.createSession();
    await session.send([{ type: "text", text: "new" }]);
    expect(hook.mock.calls.map(([p]) => p.firstInChat)).toEqual([true, false, true]);
    session.dispose();
  });

  it("restored session with turns has firstInChat false", async () => {
    const meta = { id: "restored", title: "Saved", createdAt: 1, updatedAt: 1, lastSeq: 1 };
    const store: SessionStore = {
      createSession: vi.fn().mockResolvedValue(undefined),
      appendRecords: vi.fn().mockResolvedValue(undefined),
      readRange: vi.fn().mockResolvedValue({ records: [mkTurnRecord(1)] }),
      truncateAfter: vi.fn().mockResolvedValue(undefined),
      saveMeta: vi.fn().mockResolvedValue(undefined),
      loadAllMetadata: vi.fn().mockResolvedValue([meta]),
      deleteByIds: vi.fn().mockResolvedValue(undefined),
    };
    const hook = vi.fn();
    const session = createAgentSession({ ...config(), persist: true, sessionStore: store, fetch: mkAnthropicFetch([mkTextResp("ok")]), hooks: { onUserPrompt: hook } });
    await session.initPromise;
    await session.send([{ type: "text", text: "next" }]);
    expect(hook).toHaveBeenCalledWith({ parts: [{ type: "text", text: "next" }], sessionId: "restored", firstInChat: false, displayText: "next" });
    session.dispose();
  });

  it("loaded tool provider hooks run after attachments and before host hooks; failed providers contribute none", async () => {
    const order: string[] = [];
    const failedHook = vi.fn();
    const session = createAgentSession({ ...config(), fetch: mkAnthropicFetch([mkTextResp("ok")]),
      attachmentProviders: [{ id: "a", label: "A", icon: "attach_file", pick() {}, hasPending: () => false, onUserPrompt: () => { order.push("attachment"); } }],
      toolProviders: [
        { name: "loaded", required: false, load: () => Promise.resolve([]), hooks: { onUserPrompt: () => { order.push("tool"); } } },
        { name: "failed", required: false, load: () => Promise.reject(new Error("unavailable")), hooks: { onUserPrompt: failedHook } },
      ],
      hooks: { onUserPrompt: () => { order.push("host"); } },
    });
    await session.initPromise;
    await session.send([{ type: "text", text: "Hello" }]);
    expect(order).toEqual(["attachment", "tool", "host"]);
    expect(failedHook).not.toHaveBeenCalled();
    session.dispose();
  });

  it("session without tool providers passes messages unchanged", async () => {
    const fetchFn = mkAnthropicFetch([mkTextResp("ok")]);
    const session = createAgentSession({ ...config(), fetch: fetchFn });
    await session.initPromise;
    await session.send([{ type: "text", text: "Hello" }]);
    expect(session.getState().messages[0].text).toBe("Hello");
    const body = JSON.parse(fetchFn.mock.calls[0][1].body as string) as MessageCreateParams;
    expect(JSON.stringify(body.messages[0].content)).toContain("Hello");
    expect(JSON.stringify(body.messages[0].content)).not.toContain("<agents-md");
    session.dispose();
  });
});

describe("AgentSession Controller", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("initialization sets initial state (running: false, empty messages)", () => {
    const session = createAgentSession({
      persist: false,
      model: "test-model",
    });

    const state = session.getState();
    expect(state.running).toBe(false);
    expect(state.messages).toEqual([]);
    expect(state.usage).toEqual({ input: 0, output: 0 });
    expect(state.contextWindow.used).toBe(0);
  });

  it("subscribe registers listeners and fires on state changes during send, and stops firing after unsubscribe", async () => {
    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: mkAnthropicFetch([mkTextResp("Hello response")]),
    });

    const states: SessionState[] = [];
    const unsubscribe = session.subscribe((s) => {
      states.push(JSON.parse(JSON.stringify(s)) as SessionState);
    });

    // Initial state event
    expect(states.length).toBe(1);
    expect(states[0].running).toBe(false);

    // Call send
    const sendPromise = session.send([{ type: "text", text: "hi" }]);

    // While running, states should be emitted
    expect(states.some((s) => s.running === true)).toBe(true);

    await sendPromise;

    // After done, running is false
    expect(session.getState().running).toBe(false);
    expect(session.getState().messages.length).toBe(2); // user and assistant

    // Unsubscribe and call send again to verify listener stops firing
    unsubscribe();
    const beforeCount = states.length;
    await session.send([{ type: "text", text: "another one" }]);
    expect(states.length).toBe(beforeCount);
  });

  it("send(parts) serialization formats button click into user message history", async () => {
    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: mkAnthropicFetch([mkTextResp("Got button click")]),
    });

    await session.send([{ type: "tool", name: "button", data: "Click me" }]);

    const state = session.getState();
    const userMsg = state.messages.find((m) => m.role === "user");
    expect(userMsg).toBeDefined();
    expect(userMsg?.text).toBe(buttonToMessage("Click me"));
  });

  it("send(parts) serialization formats form submit correctly", async () => {
    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: mkAnthropicFetch([mkTextResp("Got form submit")]),
    });

    await session.send([
      {
        type: "tool",
        name: "form_submit",
        data: { id: "f1", values: { search: "query" } },
      },
    ]);

    const state = session.getState();
    const userMsg = state.messages.find((m) => m.role === "user");
    expect(userMsg).toBeDefined();
    expect(userMsg?.text).toBe(formSubmitToMessage("f1", { search: "query" }));
  });

  it("messages in getState() carry un-sanitized raw markdown in text field", async () => {
    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: mkAnthropicFetch([mkTextResp("**bold reply** with `code`")]),
    });

    await session.send([{ type: "text", text: "*italic prompt*" }]);

    const state = session.getState();
    const userMsg = state.messages.find((m) => m.role === "user");
    const assistantMsg = state.messages.find((m) => m.role === "assistant");

    expect(userMsg?.text).toBe("*italic prompt*");
    expect(assistantMsg?.text).toBe("**bold reply** with `code`");
  });

  it("tool block capture interleaves block into messages blocks and parts", async () => {
    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: mkAnthropicFetch([
        mkMixedResp(
          "Let me show you a spec.",
          "call-block-1",
          "show_generative_ui",
          { type: "buttons", options: [{ label: "Option A", prompt: "A" }] }
        ),
        mkTextResp("Spec shown."),
      ]),
    });

    // Run the turn
    await session.send([{ type: "text", text: "Show UI" }]);

    const state = session.getState();
    const assistantMsg = state.messages.find((m) => m.role === "assistant");
    expect(assistantMsg).toBeDefined();

    // Check that block was captured and interleaved
    expect(assistantMsg?.blocks).toBeDefined();
    expect(assistantMsg?.blocks?.length).toBe(1);
    expect(assistantMsg?.blocks?.[0].type).toBe("buttons");

    expect(assistantMsg?.parts).toBeDefined();
    const blockPart = assistantMsg?.parts?.find((p) => p.kind === "block");
    expect(blockPart).toBeDefined();
    expect(blockPart?.block?.type).toBe("buttons");

    // A block-emitting tool renders as a block and produces NO tool-step part …
    expect(assistantMsg?.parts?.some((p) => p.kind === "tool")).toBe(false);
    // … but it IS recorded in the audit trace. E2E audit assertions must read
    // `trace`, not the rendered tool-step rows (task 016).
    expect(assistantMsg?.trace?.map((t) => t.name)).toEqual(["show_generative_ui"]);
  });

  it("plain multi-tool turn produces interleaved tool parts in order", async () => {
    // 003: the tools must actually be offered, or core refuses each call as
    // `Unknown tool` and (correctly) renders no tool step for it.
    const addToCart: CustomToolDef = {
      name: "add_to_cart",
      description: "Add a product to the cart",
      inputSchema: z.object({ productId: z.string(), qty: z.number() }).strict(),
      execute: () => Promise.resolve({ status: "success" } as unknown as ToolOutcome),
    };
    const queryState: CustomToolDef = {
      name: "query_state",
      description: "Query the cart state",
      inputSchema: z.object({ path: z.string() }).strict(),
      execute: () => Promise.resolve({ status: "success" } as unknown as ToolOutcome),
    };
    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      tools: () => [addToCart, queryState],
      fetch: mkAnthropicFetch([
        mkMixedResp(
          "Adding the salmon cans first.",
          "call-tool-1",
          "add_to_cart",
          { productId: "p01", qty: 2 }
        ),
        mkMixedResp(
          "Now checking your cart.",
          "call-tool-2",
          "query_state",
          { path: "$.cart" }
        ),
        mkTextResp("Done — your cart has 3 items totalling $17."),
      ]),
    });

    // Run the turn
    await session.send([{ type: "text", text: "Add salmon and query cart" }]);

    const state = session.getState();
    const assistantMsg = state.messages.find((m) => m.role === "assistant");
    expect(assistantMsg).toBeDefined();

    // Assert parts kinds alternate
    expect(assistantMsg?.parts).toBeDefined();
    const kinds = assistantMsg?.parts?.map((p) => p.kind);
    expect(kinds).toEqual(["text", "tool", "text", "tool", "text"]);

    // Assert details
    expect(assistantMsg?.parts?.[1]).toMatchObject({
      kind: "tool",
      audit: expect.objectContaining({ name: "add_to_cart" }) as unknown,
    });
    expect(assistantMsg?.parts?.[3]).toMatchObject({
      kind: "tool",
      audit: expect.objectContaining({ name: "query_state" }) as unknown,
    });

    // Assert trace is populated correctly with two items
    expect(assistantMsg?.trace).toBeDefined();
    expect(assistantMsg?.trace?.length).toBe(2);
    expect(assistantMsg?.trace?.[0].name).toBe("add_to_cart");
    expect(assistantMsg?.trace?.[1].name).toBe("query_state");

    // Assert blocks is empty (no UI blocks)
    expect(assistantMsg?.blocks).toBeDefined();
    expect(assistantMsg?.blocks?.length).toBe(0);
  });

  it("transport seam uses custom fetch and sends stream: false", async () => {
    const mockFetch = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockImplementation(() => {
      return Promise.resolve(new Response(
        JSON.stringify({
          id: "msg_x",
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "Hello from mock fetch!" }],
          stop_reason: "end_turn",
          stop_sequence: null,
          model: "test",
          usage: {
            input_tokens: 12,
            output_tokens: 6,
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      ));
    });

    const session = createAgentSession({
      persist: false,
      model: "test-model",
      baseURL: "http://localhost:8080/v1",
      fetch: mockFetch,
    });

    await session.send([{ type: "text", text: "Hello" }]);

    expect(mockFetch).toHaveBeenCalled();

    // Verify stream: false or not stream: true was forced in the body of the call
    const lastCall = mockFetch.mock.calls[0];
    const requestBody = JSON.parse(lastCall[1]!.body as string) as MessageCreateParams;
    expect(requestBody.stream).toBe(false);

    // Verify usage was updated
    const state = session.getState();
    expect(state.usage).toEqual({ input: 12, output: 6 });
  });

  it("autoTitle sets the active session title by running a bare turn", async () => {
    const mockFetch = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockImplementation(() => {
      return Promise.resolve(new Response(
        JSON.stringify({
          id: "msg_x",
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "Mocked Session Title" }],
          stop_reason: "end_turn",
          stop_sequence: null,
          model: "test",
          usage: {
            input_tokens: 12,
            output_tokens: 6,
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      ));
    });

    const metaStore: SessionMeta[] = [];
    const messagesStore: Record<string, TurnFlushRecord[]> = {};
    const mockSessionStore: SessionStore = {
      createSession(meta: SessionMeta) {
        metaStore.push(meta);
        return Promise.resolve();
      },
      appendRecords(sessionId: string, records: TurnFlushRecord[]) {
        if (!messagesStore[sessionId]) messagesStore[sessionId] = [];
        messagesStore[sessionId].push(...records);
        const idx = metaStore.findIndex((m) => m.id === sessionId);
        if (idx !== -1) metaStore[idx] = { ...metaStore[idx], lastSeq: messagesStore[sessionId].length };
        return Promise.resolve();
      },
      readRange(sessionId: string, range: SessionRecordRange): Promise<SessionRecordPage> {
        const all = messagesStore[sessionId] || [];
        const end = range.before ?? all.length;
        const start = Math.max(0, end - range.limit);
        return Promise.resolve({
          records: all.slice(start, end),
          cursor: start >= 1 ? start : undefined,
        });
      },
      truncateAfter(sessionId: string, seq: number) {
        messagesStore[sessionId] = (messagesStore[sessionId] || []).slice(0, seq);
        const idx = metaStore.findIndex((m) => m.id === sessionId);
        if (idx !== -1) metaStore[idx] = { ...metaStore[idx], lastSeq: seq };
        return Promise.resolve();
      },
      saveMeta(sessionId: string, meta: Partial<SessionMeta>) {
        const idx = metaStore.findIndex(m => m.id === sessionId);
        if (idx !== -1) {
          metaStore[idx] = { ...metaStore[idx], ...meta };
        }
        return Promise.resolve();
      },
      loadAllMetadata() {
        return Promise.resolve(metaStore);
      },
      deleteByIds() { return Promise.resolve(); }
    };

    const session = createAgentSession({
      persist: true,
      sessionStore: mockSessionStore,
      model: "test-model",
      baseURL: "http://localhost:8080/v1",
      fetch: mockFetch,
    });

    await session.initPromise;

    // Send a message first to populate context
    await session.send([{ type: "text", text: "Hello" }]);

    mockFetch.mockClear();

    // Call autoTitle
    await session.autoTitle();

    // Verify it called fetch
    expect(mockFetch).toHaveBeenCalled();
    const lastCall = mockFetch.mock.calls[0];
    const requestBody = JSON.parse(lastCall[1]!.body as string) as MessageCreateParams;
    expect(requestBody.stream).toBe(false);
    expect((requestBody.messages[0].content as { text: string }[])[0].text).toContain("Summarize the following conversation");

    // Verify the session title is set
    const state = session.getState();
    const currentMeta = state.sessions.find(s => s.id === state.activeSessionId);
    expect(currentMeta?.title).toBe("Mocked Session Title");
  });

  it("autoTitle does not call fetch when conversation transcript is empty", async () => {
    const mockFetch = vi.fn();
    const mockSaveMeta = vi.fn().mockResolvedValue(undefined);
    const mockSessionStore: SessionStore = {
      createSession: vi.fn().mockResolvedValue(undefined),
      appendRecords: vi.fn().mockResolvedValue(undefined),
      readRange: vi.fn().mockResolvedValue({ records: [] }),
      truncateAfter: vi.fn().mockResolvedValue(undefined),
      saveMeta: mockSaveMeta,
      loadAllMetadata: vi.fn().mockResolvedValue([{ id: "test-sess", title: "", updatedAt: 0 }]),
      deleteByIds: vi.fn().mockResolvedValue(undefined),
    };

    const session = createAgentSession({
      persist: true,
      sessionStore: mockSessionStore,
      model: "test-model",
      fetch: mockFetch,
    });
    await session.initPromise;

    // No messages sent, transcript is empty
    await session.autoTitle();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockSaveMeta).not.toHaveBeenCalled();
  });

  it("autoTitle passes userDisplayText in transcript when present", async () => {
    let promptSent = "";
    const mockFetch = vi.fn().mockImplementation((_url, init) => {
      const body = JSON.parse(init.body as string) as MessageCreateParams;
      promptSent = (body.messages[0].content as { text: string }[])[0].text;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id: "msg_ok",
            type: "message",
            role: "assistant",
            content: [{ type: "text", text: "Viewed Catalog" }],
            stop_reason: "end_turn",
            model: "test",
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );
    });

    const session = createAgentSession({
      persist: true,
      sessionStore: {
        createSession: () => Promise.resolve(),
        appendRecords: () => Promise.resolve(),
        readRange: () => Promise.resolve({ records: [] }),
        truncateAfter: () => Promise.resolve(),
        saveMeta: () => Promise.resolve(),
        loadAllMetadata: () => Promise.resolve([]),
        deleteByIds: () => Promise.resolve(),
      },
      model: "test-model",
      fetch: mockFetch,
    });
    await session.initPromise;
    await session.send([{ type: "text", text: "Internal payload" }], { userDisplayText: "User Display Goal" });

    mockFetch.mockClear();
    await session.autoTitle();

    expect(promptSent).toContain("user: User Display Goal");
  });

  it("send(parts) attaches retryable failed marker to the last message on transient failure (429)", async () => {
    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      maxRetries: 0,
      fetch: mkErrorFetch(429),
    });

    await session.send([{ type: "text", text: "hi" }]);

    const state = session.getState();
    const lastMsg = state.messages[state.messages.length - 1];
    expect(lastMsg?.failed).toBeDefined();
    expect(lastMsg?.failed?.retryable).toBe(true);
  });

  it("send(parts) attaches terminal failed marker to the last message on terminal failure (400)", async () => {
    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      maxRetries: 0,
      fetch: mkErrorFetch(400),
    });

    await session.send([{ type: "text", text: "hi" }]);

    const state = session.getState();
    const lastMsg = state.messages[state.messages.length - 1];
    expect(lastMsg?.failed).toBeDefined();
    expect(lastMsg?.failed?.retryable).toBe(false);
  });

  it("failed turn marker is correctly rehydrated from store", async () => {
    const metaStore: SessionMeta[] = [];
    const messagesStore: Record<string, TurnFlushRecord[]> = {};
    const mockSessionStore: SessionStore = {
      createSession(meta: SessionMeta) {
        metaStore.push(meta);
        return Promise.resolve();
      },
      appendRecords(sessionId: string, records: TurnFlushRecord[]) {
        if (!messagesStore[sessionId]) messagesStore[sessionId] = [];
        messagesStore[sessionId].push(...records);
        const idx = metaStore.findIndex((m) => m.id === sessionId);
        if (idx !== -1) metaStore[idx] = { ...metaStore[idx], lastSeq: messagesStore[sessionId].length };
        return Promise.resolve();
      },
      readRange(sessionId: string, range: SessionRecordRange): Promise<SessionRecordPage> {
        const all = messagesStore[sessionId] || [];
        const end = range.before ?? all.length;
        const start = Math.max(0, end - range.limit);
        return Promise.resolve({
          records: all.slice(start, end),
          cursor: start >= 1 ? start : undefined,
        });
      },
      truncateAfter(sessionId: string, seq: number) {
        messagesStore[sessionId] = (messagesStore[sessionId] || []).slice(0, seq);
        const idx = metaStore.findIndex((m) => m.id === sessionId);
        if (idx !== -1) metaStore[idx] = { ...metaStore[idx], lastSeq: seq };
        return Promise.resolve();
      },
      saveMeta(sessionId: string, meta: Partial<SessionMeta>) {
        const idx = metaStore.findIndex((m) => m.id === sessionId);
        if (idx !== -1) {
          metaStore[idx] = { ...metaStore[idx], ...meta };
        }
        return Promise.resolve();
      },
      loadAllMetadata() {
        return Promise.resolve(metaStore);
      },
      deleteByIds() { return Promise.resolve(); },
    };

    const session1 = createAgentSession({
      persist: true,
      sessionStore: mockSessionStore,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      maxRetries: 0,
      fetch: mkErrorFetch(400),
    });
    await session1.initPromise;
    await session1.send([{ type: "text", text: "hi" }]);

    const session2 = createAgentSession({
      persist: true,
      sessionStore: mockSessionStore,
      model: "test-model",
    });
    await session2.initPromise;

    const state = session2.getState();
    const lastMsg = state.messages[state.messages.length - 1];
    expect(lastMsg?.failed).toBeDefined();
    expect(lastMsg?.failed?.retryable).toBe(false);
  });

  it("updateConfig({ persist: false }) during in-flight session init does not throw (018 race)", async () => {
    // Regression for a race exposed by task 018 (cat-store's session now
    // starts on first bubble click instead of at page load, shrinking the
    // window before a host might flip `persist`): openOrCreateActiveSession()
    // used to read the module-closure `sessionStore` again after an `await`,
    // so a concurrent updateConfig({ persist: false }) — which reassigns that
    // closure variable to undefined via buildConfig() — crashed it with
    // "Cannot read properties of undefined (reading 'createSession')".
    let resolveLoad!: (v: SessionMeta[]) => void;
    const loadAllMetadataMock = vi.fn(() => new Promise<SessionMeta[]>((resolve) => { resolveLoad = resolve; }));
    const mockSessionStore: SessionStore = {
      createSession() { return Promise.resolve(); },
      appendRecords() { return Promise.resolve(); },
      readRange() { return Promise.resolve({ records: [] }); },
      truncateAfter() { return Promise.resolve(); },
      saveMeta() { return Promise.resolve(); },
      loadAllMetadata: loadAllMetadataMock,
      deleteByIds() { return Promise.resolve(); },
    };

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const session = createAgentSession({
      persist: true,
      sessionStore: mockSessionStore,
      model: "test-model",
    });

    // Session init is async (it awaits loadConfiguredToolProviders() first),
    // so wait until it actually reaches — and suspends on — loadAllMetadata()
    // before flipping persist off.
    await vi.waitFor(() => expect(loadAllMetadataMock).toHaveBeenCalled());
    session.updateConfig({ persist: false });

    resolveLoad([]);
    await session.initPromise;

    const sessionInitErrors = consoleErrorSpy.mock.calls.filter((args) =>
      String(args[0]).includes("[session] init failed"));
    expect(sessionInitErrors).toHaveLength(0);

    consoleErrorSpy.mockRestore();
  });

  it("a send() before a slow skillRegistry resolves is not orphaned onto a discarded cm (001/113)", async () => {
    // Found live: task 001's live proof seeds a skill registry entry before
    // the first send, and `chrome.storage.local.get` is a real async round
    // trip — wide enough for a send() to run against the `cm` initAgent()
    // created at session-creation time, before loadConfiguredSkillRegistry()
    // (controller.ts) re-runs initAgent() to fold the registry skill in.
    // Before the fix, that re-run replaced `st.cm` unconditionally, orphaning
    // the in-flight turn onto a `cm` nothing reads any more — delivered:true,
    // zero messages, forever.
    let resolveSkills!: (v: SkillDef[]) => void;
    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: mkAnthropicFetch([mkTextResp("A lighthouse guides ships.")]),
      skillRegistry: {
        list: () => new Promise<SkillDef[]>((resolve) => { resolveSkills = resolve; }),
        get: () => Promise.resolve(undefined),
      },
    });

    // Fire the send in the same tick as session creation — before the
    // registry has any chance to resolve — exactly like a programmatic send
    // reaching a just-mounted bubble.
    const sendPromise = session.send([{ type: "text", text: "In one short sentence, what is a lighthouse for?" }]);

    resolveSkills([{ name: "new", command: true, definition: "say hello" } as SkillDef]);
    await session.initPromise;
    await sendPromise;

    const messages = session.getState().messages;
    expect(messages.some((m) => m.role === "user" && m.text === "In one short sentence, what is a lighthouse for?")).toBe(true);
    expect(messages.some((m) => m.role === "assistant" && m.text === "A lighthouse guides ships.")).toBe(true);
    session.dispose();
  });
});



describe("retryLast", () => {
  it("partial-turn cleanup + no double-append + marker cleared on success", async () => {
    const fetchFn = mkFailThenFetch(429, mkTextResp("recovered reply"));
    const session = createAgentSession({
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      maxRetries: 0,
      fetch: fetchFn,
    });
    await session.initPromise;
    await session.send([{ type: "text", text: "hi" }]);

    let state = session.getState();
    expect(state.messages.length).toBe(1);
    expect(state.messages[0].failed).toBeDefined();

    await session.retryLast();
    state = session.getState();
    expect(state.messages.filter((m) => m.role === "user").length).toBe(1);
    expect(state.messages[0].text).toBe("hi");
    expect(state.messages.some((m) => m.failed)).toBe(false);
    expect(state.messages.find((m) => m.role === "assistant")?.text).toBe("recovered reply");
    expect(state.error).toBeUndefined();
  });

  it("second failure re-attaches the marker", async () => {
    const fetchFn = mkFailThenFetch(429, mkTextResp("ok"), 2);
    const session = createAgentSession({
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      maxRetries: 0,
      fetch: fetchFn,
    });
    await session.initPromise;
    await session.send([{ type: "text", text: "hi" }]);

    await session.retryLast();
    const state = session.getState();
    expect(state.messages.filter((m) => m.role === "user").length).toBe(1);
    const lastMsg = state.messages[state.messages.length - 1];
    expect(lastMsg.failed).toBeDefined();
    expect(lastMsg.failed?.retryable).toBe(true);
  });

  it("image input preserved across retry", async () => {
    const fetchFn = mkFailThenFetch(429, mkTextResp("saw image"));
    const session = createAgentSession({
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      maxRetries: 0,
      fetch: fetchFn,
    });
    await session.initPromise;
    await session.send([
      { type: "image", dataUrl: "data:image/png;base64,AAA", mediaType: "image/png" },
      { type: "text", text: "look" },
    ]);

    await session.retryLast();
    const state = session.getState();
    const userMsg = state.messages.find((m) => m.role === "user");
    expect(userMsg?.images?.length).toBe(1);
    expect(userMsg?.text).toBe("look");
    expect(state.messages.find((m) => m.role === "assistant")?.text).toBe("saw image");
  });

  it("no-op when the last turn did not fail", async () => {
    const fetchFn = mkAnthropicFetch([mkTextResp("ok")]);
    const session = createAgentSession({
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: fetchFn,
    });
    await session.initPromise;
    await session.send([{ type: "text", text: "hi" }]);

    const callsBefore = fetchFn.mock.calls.length;
    await session.retryLast();
    expect(fetchFn.mock.calls.length).toBe(callsBefore);
    const state = session.getState();
    expect(state.messages.length).toBe(2);
    expect(state.messages.some((m) => m.failed)).toBe(false);
  });

  it("retryLast re-runs an empty completed turn", async () => {
    const fetchFn = mkAnthropicFetch([mkEmptyResp(), mkTextResp("recovered reply")]);
    const session = createAgentSession({
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: fetchFn,
    });
    await session.initPromise;
    await session.send([{ type: "text", text: "hi" }]);

    let state = session.getState();
    expect(state.messages.some((m) => m.notice)).toBe(true);

    const callsBefore = fetchFn.mock.calls.length;
    await session.retryLast();
    expect(fetchFn.mock.calls.length).toBeGreaterThan(callsBefore);
    state = session.getState();
    expect(state.messages.find((m) => m.role === "assistant")?.text).toBe("recovered reply");
    session.dispose();
  });

  it("retryLast still ignores a normal completed turn", async () => {
    const fetchFn = mkAnthropicFetch([mkTextResp("ok")]);
    const session = createAgentSession({
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: fetchFn,
    });
    await session.initPromise;
    await session.send([{ type: "text", text: "hi" }]);

    const callsBefore = fetchFn.mock.calls.length;
    await session.retryLast();
    expect(fetchFn.mock.calls.length).toBe(callsBefore);
    session.dispose();
  });

  it("no-op while running", async () => {
    let resolveFetch!: (res: Response) => void;
    const deferredFetch = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockImplementation(() => new Promise<Response>((r) => { resolveFetch = r; }));
    const session = createAgentSession({
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: deferredFetch,
    });
    await session.initPromise;
    const sendPromise = session.send([{ type: "text", text: "hi" }]);
    await Promise.resolve();
    expect(session.getState().running).toBe(true);

    await session.retryLast();
    while (!resolveFetch) {
      await new Promise((r) => setTimeout(r, 5));
    }
    resolveFetch(new Response(JSON.stringify(mkTextResp("ok")), { status: 200, headers: { "Content-Type": "application/json" } }));
    await sendPromise;
    const state = session.getState();
    expect(state.messages.length).toBe(2);
  });

  it("events: start->success and start->failure", async () => {
    const fetchSuccess = mkFailThenFetch(429, mkTextResp("ok"));
    const session1 = createAgentSession({
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      maxRetries: 0,
      fetch: fetchSuccess,
    });
    await session1.initPromise;
    await session1.send([{ type: "text", text: "hi" }]);
    const events1: SessionEvent[] = [];
    session1.subscribeEvents((e) => events1.push(e));
    await session1.retryLast();
    expect(events1.map((e) => e.type)).toEqual(["retry:start", "retry:success"]);

    const fetchFail = mkFailThenFetch(429, mkTextResp("ok"), 2);
    const session2 = createAgentSession({
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      maxRetries: 0,
      fetch: fetchFail,
    });
    await session2.initPromise;
    await session2.send([{ type: "text", text: "hi" }]);
    const events2: SessionEvent[] = [];
    session2.subscribeEvents((e) => events2.push(e));
    await session2.retryLast();
    expect(events2.map((e) => e.type)).toEqual(["retry:start", "retry:failure"]);
    expect((events2[1] as Extract<SessionEvent, { type: "retry:failure" }>).error?.retryable).toBe(true);
  });

  it("persisted retry drops the stale failed turn on reload", async () => {
    const metaStore: SessionMeta[] = [];
    const messagesStore: Record<string, TurnFlushRecord[]> = {};
    const mockSessionStore: SessionStore = {
      createSession(meta: SessionMeta) {
        metaStore.push(meta);
        return Promise.resolve();
      },
      appendRecords(sessionId: string, records: TurnFlushRecord[]) {
        if (!messagesStore[sessionId]) messagesStore[sessionId] = [];
        messagesStore[sessionId].push(...records);
        const idx = metaStore.findIndex((m) => m.id === sessionId);
        if (idx !== -1) metaStore[idx] = { ...metaStore[idx], lastSeq: messagesStore[sessionId].length };
        return Promise.resolve();
      },
      readRange(sessionId: string, range: SessionRecordRange): Promise<SessionRecordPage> {
        const all = messagesStore[sessionId] || [];
        const end = range.before ?? all.length;
        const start = Math.max(0, end - range.limit);
        return Promise.resolve({
          records: all.slice(start, end),
          cursor: start >= 1 ? start : undefined,
        });
      },
      truncateAfter(sessionId: string, seq: number) {
        messagesStore[sessionId] = (messagesStore[sessionId] || []).slice(0, seq);
        const idx = metaStore.findIndex((m) => m.id === sessionId);
        if (idx !== -1) metaStore[idx] = { ...metaStore[idx], lastSeq: seq };
        return Promise.resolve();
      },
      saveMeta(sessionId: string, meta: Partial<SessionMeta>) {
        const idx = metaStore.findIndex((m) => m.id === sessionId);
        if (idx !== -1) {
          metaStore[idx] = { ...metaStore[idx], ...meta };
        }
        return Promise.resolve();
      },
      loadAllMetadata() {
        return Promise.resolve(metaStore);
      },
      deleteByIds() { return Promise.resolve(); },
    };

    const fetchFn = mkFailThenFetch(429, mkTextResp("recovered reply"));
    const session1 = createAgentSession({
      persist: true,
      sessionStore: mockSessionStore,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      maxRetries: 0,
      fetch: fetchFn,
    });
    await session1.initPromise;
    await session1.send([{ type: "text", text: "hi" }]);
    await session1.retryLast();

    const session2 = createAgentSession({
      persist: true,
      sessionStore: mockSessionStore,
      model: "test-model",
    });
    await session2.initPromise;
    const state = session2.getState();
    expect(state.messages.filter((m) => m.role === "user").length).toBe(1);
    expect(state.messages.some((m) => m.failed)).toBe(false);
    expect(state.messages.find((m) => m.role === "assistant")?.text).toBe("recovered reply");
  });

  // 001 — resume a failed turn from its last completed step, instead of
  // discarding the whole turn and replaying it from the user message.

  /** A tool with a real side effect, so a second execution is observable. */
  function mkChargeCard() {
    const calls: Record<string, unknown>[] = [];
    const def: CustomToolDef = {
      name: "charge_card",
      description: "Charge the customer's card. Not safe to run twice.",
      inputSchema: z.object({ amount: z.number() }).strict(),
      execute: (input) => {
        calls.push(input);
        return Promise.resolve({ content: `charged ${String(input.amount)}` });
      },
    };
    return { def, calls };
  }

  /** A scripted sequence of model responses, one per call in order. A `number`
   *  entry fails that call with that HTTP status; a `Message` entry is a normal
   *  200 response. The last entry repeats for any call past the end. */
  function mkScriptedFetch(...entries: Array<Message | number>) {
    let idx = 0;
    return vi.fn().mockImplementation(() => {
      const entry = entries[Math.min(idx, entries.length - 1)];
      idx++;
      if (typeof entry === "number") {
        return Promise.resolve(new Response(
          JSON.stringify({ type: "error", error: { type: "error", message: "mock error" } }),
          { status: entry, headers: { "Content-Type": "application/json" } },
        ));
      }
      return Promise.resolve(new Response(JSON.stringify(entry), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    });
  }

  it("resume does not re-run a tool that already completed", async () => {
    const charge = mkChargeCard();
    const fetchFn = mkScriptedFetch(
      mkToolResp("tu_1", "charge_card", { amount: 10 }),
      429,
      mkTextResp("charged once"),
    );
    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      maxRetries: 0,
      
      fetch: fetchFn,
      tools: () => [charge.def],
    });
    await session.initPromise;

    await session.send([{ type: "text", text: "charge me" }]);
    expect(charge.calls.length).toBe(1);
    expect(session.getState().messages.some((m) => m.failed)).toBe(true);

    await session.retryLast();
    // This is the assertion the defect fails — today it is 2.
    expect(charge.calls.length).toBe(1);
    expect(fetchFn.mock.calls.length).toBe(3);

    const body = JSON.parse(fetchFn.mock.calls[2][1]!.body as string) as MessageCreateParams;
    const hasToolResult = body.messages.some(
      (m) => Array.isArray(m.content) && m.content.some((b) => b.type === "tool_result"),
    );
    expect(hasToolResult).toBe(true);

    const promptMsgs = body.messages.filter(
      (m) => m.role === "user" && Array.isArray(m.content) && m.content.some((b) => b.type === "text"),
    );
    expect(promptMsgs.length).toBe(1);

    expect(session.getState().messages.find((m) => m.role === "assistant")?.text).toContain("charged once");
  });

  it("a successful resume clears the failure marker", async () => {
    const charge = mkChargeCard();
    const fetchFn = mkScriptedFetch(
      mkToolResp("tu_1", "charge_card", { amount: 10 }),
      429,
      mkTextResp("charged once"),
    );
    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      maxRetries: 0,
      
      fetch: fetchFn,
      tools: () => [charge.def],
    });
    await session.initPromise;

    await session.send([{ type: "text", text: "charge me" }]);
    await session.retryLast();

    expect(session.getState().messages.some((m) => m.failed)).toBe(false);
    expect(session.getState().error).toBeUndefined();
  });

  it("a second failure re-attaches the marker and the next retry resumes again", async () => {
    const charge = mkChargeCard();
    const fetchFn = mkScriptedFetch(
      mkToolResp("tu_1", "charge_card", { amount: 10 }),
      429,
      429,
      mkTextResp("charged once"),
    );
    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      maxRetries: 0,
      
      fetch: fetchFn,
      tools: () => [charge.def],
    });
    await session.initPromise;

    await session.send([{ type: "text", text: "charge me" }]);
    await session.retryLast();

    const lastMsg = session.getState().messages[session.getState().messages.length - 1];
    expect(lastMsg.failed).toBeDefined();
    expect(lastMsg.failed?.retryable).toBe(true);
    expect(charge.calls.length).toBe(1);

    await session.retryLast();
    // Still 1 — the second retry RESUMED again, it did not restart.
    expect(charge.calls.length).toBe(1);
    expect(session.getState().messages.find((m) => m.role === "assistant")?.text).toContain("charged once");
  });

  it("an aborted turn resumes without re-running the tool", async () => {
    const charge = mkChargeCard();
    let call = 0;
    let resolveSecond!: (r: Response) => void;
    const fetchFn = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockImplementation(() => {
      call++;
      if (call === 1) {
        return Promise.resolve(new Response(
          JSON.stringify(mkToolResp("tu_1", "charge_card", { amount: 10 })),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ));
      }
      if (call === 2) {
        return new Promise<Response>((resolve) => { resolveSecond = resolve; });
      }
      return Promise.resolve(new Response(
        JSON.stringify(mkTextResp("charged once")),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ));
    });
    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      maxRetries: 0,
      
      fetch: fetchFn,
      tools: () => [charge.def],
    });
    await session.initPromise;

    const sendPromise = session.send([{ type: "text", text: "charge me" }]);
    while (charge.calls.length < 1) {
      await new Promise((r) => setTimeout(r, 5));
    }
    session.abort();
    await sendPromise;
    void resolveSecond; // never resolved — the request is aborted, not answered

    expect(session.getState().messages.some((m) => m.failed)).toBe(true);

    await session.retryLast();
    expect(charge.calls.length).toBe(1);
    expect(session.getState().messages.find((m) => m.role === "assistant")?.text).toContain("charged once");
  });

  it("a resumed turn keeps its turnId, continues stepNo, and survives a reload", async () => {
    const metaStore: SessionMeta[] = [];
    const messagesStore: Record<string, TurnFlushRecord[]> = {};
    const truncateAfterSpy = vi.fn((sessionId: string, seq: number) => {
      messagesStore[sessionId] = (messagesStore[sessionId] || []).slice(0, seq);
      const idx = metaStore.findIndex((m) => m.id === sessionId);
      if (idx !== -1) metaStore[idx] = { ...metaStore[idx], lastSeq: seq };
      return Promise.resolve();
    });
    const appendRecordsSpy = vi.fn((sessionId: string, records: TurnFlushRecord[]) => {
      if (!messagesStore[sessionId]) messagesStore[sessionId] = [];
      messagesStore[sessionId].push(...records);
      const idx = metaStore.findIndex((m) => m.id === sessionId);
      if (idx !== -1) metaStore[idx] = { ...metaStore[idx], lastSeq: messagesStore[sessionId].length };
      return Promise.resolve();
    });
    const mockSessionStore: SessionStore = {
      createSession(meta: SessionMeta) { metaStore.push(meta); return Promise.resolve(); },
      appendRecords: appendRecordsSpy,
      readRange(sessionId: string, range: SessionRecordRange): Promise<SessionRecordPage> {
        const all = messagesStore[sessionId] || [];
        const end = range.before ?? all.length;
        const start = Math.max(0, end - range.limit);
        return Promise.resolve({ records: all.slice(start, end), cursor: start >= 1 ? start : undefined });
      },
      truncateAfter: truncateAfterSpy,
      saveMeta(sessionId: string, meta: Partial<SessionMeta>) {
        const idx = metaStore.findIndex((m) => m.id === sessionId);
        if (idx !== -1) metaStore[idx] = { ...metaStore[idx], ...meta };
        return Promise.resolve();
      },
      loadAllMetadata() { return Promise.resolve(metaStore); },
      deleteByIds() { return Promise.resolve(); },
    };

    const charge = mkChargeCard();
    const fetchFn = mkScriptedFetch(
      mkTextResp("A1"),
      mkToolResp("tu_1", "charge_card", { amount: 10 }),
      429,
      mkTextResp("charged once"),
    );
    const session = createAgentSession({
      persist: true,
      sessionStore: mockSessionStore,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      maxRetries: 0,
      
      fetch: fetchFn,
      tools: () => [charge.def],
    });
    await session.initPromise;
    await session.send([{ type: "text", text: "Q1" }]);
    await session.send([{ type: "text", text: "charge me" }]);

    const sessionId = session.getState().activeSessionId;
    const firstRecordBeforeRetry = messagesStore[sessionId][0];

    await session.retryLast();

    expect(truncateAfterSpy.mock.calls[0]).toEqual([sessionId, 1]);
    expect(messagesStore[sessionId][0]).toBe(firstRecordBeforeRetry);

    const entries = messagesStore[sessionId].flatMap((r) => r.journalDelta);
    const turn2 = entries.slice(2); // after Q1's two entries
    const ids = new Set(turn2.map((e) => e.meta.turnId));
    expect(ids.size).toBe(1);
    expect(turn2.map((e) => e.meta.stepNo)).toEqual([0, 1, 1, 2]);
    expect(turn2.some((e) => e.meta.failed)).toBe(false);

    const session2 = createAgentSession({ persist: true, sessionStore: mockSessionStore, model: "test-model" });
    await session2.initPromise;
    const state2 = session2.getState();
    expect(state2.messages.filter((m) => m.role === "user").length).toBe(2);
    expect(state2.messages.some((m) => m.failed)).toBe(false);
    expect([...state2.messages].reverse().find((m) => m.role === "assistant")?.text).toBe("charged once");
  });

  it("a turn that compacted rewinds only its last record", async () => {
    const metaStore: SessionMeta[] = [];
    const messagesStore: Record<string, TurnFlushRecord[]> = {};
    const truncateAfterSpy = vi.fn((sessionId: string, seq: number) => {
      messagesStore[sessionId] = (messagesStore[sessionId] || []).slice(0, seq);
      const idx = metaStore.findIndex((m) => m.id === sessionId);
      if (idx !== -1) metaStore[idx] = { ...metaStore[idx], lastSeq: seq };
      return Promise.resolve();
    });
    const appendRecordsSpy = vi.fn((sessionId: string, records: TurnFlushRecord[]) => {
      if (!messagesStore[sessionId]) messagesStore[sessionId] = [];
      messagesStore[sessionId].push(...records);
      const idx = metaStore.findIndex((m) => m.id === sessionId);
      if (idx !== -1) metaStore[idx] = { ...metaStore[idx], lastSeq: messagesStore[sessionId].length };
      return Promise.resolve();
    });
    const mockSessionStore: SessionStore = {
      createSession(meta: SessionMeta) { metaStore.push(meta); return Promise.resolve(); },
      appendRecords: appendRecordsSpy,
      readRange(sessionId: string, range: SessionRecordRange): Promise<SessionRecordPage> {
        const all = messagesStore[sessionId] || [];
        const end = range.before ?? all.length;
        const start = Math.max(0, end - range.limit);
        return Promise.resolve({ records: all.slice(start, end), cursor: start >= 1 ? start : undefined });
      },
      truncateAfter: truncateAfterSpy,
      saveMeta(sessionId: string, meta: Partial<SessionMeta>) {
        const idx = metaStore.findIndex((m) => m.id === sessionId);
        if (idx !== -1) metaStore[idx] = { ...metaStore[idx], ...meta };
        return Promise.resolve();
      },
      loadAllMetadata() { return Promise.resolve(metaStore); },
      deleteByIds() { return Promise.resolve(); },
    };

    const fetchFn = mkScriptedFetch(
      mkTextResp("t0"),
      mkTextResp("t1"),
      mkToolResp("tu_c", "compact_conversation", { confirmation: true }),
      429,
      mkTextResp("SUMMARY"),
      mkTextResp("recovered"),
    );
    const session = createAgentSession({
      persist: true,
      sessionStore: mockSessionStore,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      maxRetries: 0,
      
      fetch: fetchFn,
      context: { ...DEFAULT_CONTEXT_CONFIG, kTurnsVerbatim: 1 },
      tools: (ctx: ToolContext) => defaultTools(ctx),
    });
    await session.initPromise;
    await session.send([{ type: "text", text: "t0" }]);
    await session.send([{ type: "text", text: "t1" }]);
    await session.send([{ type: "text", text: "trigger" }]);

    const sessionId = session.getState().activeSessionId;

    await session.retryLast();

    expect(truncateAfterSpy.mock.calls[0]).toEqual([sessionId, 3]);

    const entries = messagesStore[sessionId].flatMap((r) => r.journalDelta);
    const prompts = entries.filter((e) => e.msg.role === "user" && e.meta.stepNo === 0 && !e.meta.tombstone);
    expect(prompts.length).toBe(3); // t0, t1, the resumed turn — each once
    expect(entries.filter((e) => e.msg.role === "tool").length).toBe(1);
    expect(entries.filter((e) => e.meta.tombstone).length).toBe(1);

    const session2 = createAgentSession({ persist: true, sessionStore: mockSessionStore, model: "test-model" });
    await session2.initPromise;
    expect(session2.getState().messages.filter((m) => m.role === "user").length).toBe(3);
    // Not asserted: no entry carries meta.failed. The marker on turn 2's FIRST
    // record (from the mid-turn compaction flush) is out of scope for 001 —
    // see "Explicitly out of scope" in the task file.
  });
});

// ── 006 acceptance guards ──────────────────────────────────────────────
// These pass on the current code (probes A, B, D, E in task 006's plan
// already confirmed the mechanisms below are clean). They guard the
// acceptance criteria — turn count, restore, the queue feature, and
// one-record-per-turn persistence — so a future change cannot silently
// reintroduce a duplicate through one of these paths.
describe("duplicate chat bubble regression guards (006)", () => {
  it("five sequential turns with persist:true render one bubble each", async () => {
    const metaStore: SessionMeta[] = [];
    const messagesStore: Record<string, TurnFlushRecord[]> = {};
    const mockSessionStore: SessionStore = {
      createSession(meta: SessionMeta) { metaStore.push(meta); return Promise.resolve(); },
      appendRecords(sessionId: string, records: TurnFlushRecord[]) {
        if (!messagesStore[sessionId]) messagesStore[sessionId] = [];
        messagesStore[sessionId].push(...records);
        const idx = metaStore.findIndex((m) => m.id === sessionId);
        if (idx !== -1) metaStore[idx] = { ...metaStore[idx], lastSeq: messagesStore[sessionId].length };
        return Promise.resolve();
      },
      readRange(sessionId: string, range: SessionRecordRange): Promise<SessionRecordPage> {
        const all = messagesStore[sessionId] || [];
        const end = range.before ?? all.length;
        const start = Math.max(0, end - range.limit);
        return Promise.resolve({
          records: all.slice(start, end),
          cursor: start >= 1 ? start : undefined,
        });
      },
      truncateAfter(sessionId: string, seq: number) {
        messagesStore[sessionId] = (messagesStore[sessionId] || []).slice(0, seq);
        const idx = metaStore.findIndex((m) => m.id === sessionId);
        if (idx !== -1) metaStore[idx] = { ...metaStore[idx], lastSeq: seq };
        return Promise.resolve();
      },
      saveMeta(sessionId: string, meta: Partial<SessionMeta>) {
        const idx = metaStore.findIndex((m) => m.id === sessionId);
        if (idx !== -1) metaStore[idx] = { ...metaStore[idx], ...meta };
        return Promise.resolve();
      },
      loadAllMetadata() { return Promise.resolve(metaStore); },
      deleteByIds() { return Promise.resolve(); },
    };

    const questions = ["Q1", "Q2", "Q3", "Q4", "Q5"];
    const fetchFn = mkAnthropicFetch(questions.map((_, i) => mkTextResp(`A${i + 1}`)));
    const session = createAgentSession({
      persist: true,
      sessionStore: mockSessionStore,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      maxRetries: 0,
      fetch: fetchFn,
    });
    await session.initPromise;

    for (const q of questions) {
      await session.send([{ type: "text", text: q }]);
    }

    const messages = session.getState().messages;
    expect(messages.length).toBe(10);
    for (let i = 0; i < questions.length; i++) {
      expect(messages[i * 2].role).toBe("user");
      expect(messages[i * 2].text).toBe(questions[i]);
      expect(messages[i * 2 + 1].role).toBe("assistant");
      expect(messages[i * 2 + 1].text).toBe(`A${i + 1}`);
    }
  });

  it("a reload restores history exactly once and the next turn appends one turn", async () => {
    const metaStore: SessionMeta[] = [];
    const messagesStore: Record<string, TurnFlushRecord[]> = {};
    const mockSessionStore: SessionStore = {
      createSession(meta: SessionMeta) { metaStore.push(meta); return Promise.resolve(); },
      appendRecords(sessionId: string, records: TurnFlushRecord[]) {
        if (!messagesStore[sessionId]) messagesStore[sessionId] = [];
        messagesStore[sessionId].push(...records);
        const idx = metaStore.findIndex((m) => m.id === sessionId);
        if (idx !== -1) metaStore[idx] = { ...metaStore[idx], lastSeq: messagesStore[sessionId].length };
        return Promise.resolve();
      },
      readRange(sessionId: string, range: SessionRecordRange): Promise<SessionRecordPage> {
        const all = messagesStore[sessionId] || [];
        const end = range.before ?? all.length;
        const start = Math.max(0, end - range.limit);
        return Promise.resolve({
          records: all.slice(start, end),
          cursor: start >= 1 ? start : undefined,
        });
      },
      truncateAfter(sessionId: string, seq: number) {
        messagesStore[sessionId] = (messagesStore[sessionId] || []).slice(0, seq);
        const idx = metaStore.findIndex((m) => m.id === sessionId);
        if (idx !== -1) metaStore[idx] = { ...metaStore[idx], lastSeq: seq };
        return Promise.resolve();
      },
      saveMeta(sessionId: string, meta: Partial<SessionMeta>) {
        const idx = metaStore.findIndex((m) => m.id === sessionId);
        if (idx !== -1) metaStore[idx] = { ...metaStore[idx], ...meta };
        return Promise.resolve();
      },
      loadAllMetadata() { return Promise.resolve(metaStore); },
      deleteByIds() { return Promise.resolve(); },
    };

    const fetchFn = mkAnthropicFetch([mkTextResp("A1"), mkTextResp("A2"), mkTextResp("A3")]);
    const session1 = createAgentSession({
      persist: true,
      sessionStore: mockSessionStore,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      maxRetries: 0,
      fetch: fetchFn,
    });
    await session1.initPromise;
    await session1.send([{ type: "text", text: "Q1" }]);
    await session1.send([{ type: "text", text: "Q2" }]);

    const beforeReload = session1.getState().messages.map((m) => ({ role: m.role, text: m.text }));
    expect(beforeReload.length).toBe(4);

    // A page reload: a fresh session instance restoring over the SAME store.
    const session2 = createAgentSession({
      persist: true,
      sessionStore: mockSessionStore,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      maxRetries: 0,
      fetch: fetchFn,
    });
    await session2.initPromise;
    const restored = session2.getState().messages.map((m) => ({ role: m.role, text: m.text }));
    expect(restored).toEqual(beforeReload);

    await session2.send([{ type: "text", text: "Q3" }]);
    expect(session2.getState().messages.length).toBe(beforeReload.length + 2);
  });

  it("a message sent while a turn is running is queued and runs once", async () => {
    const metaStore: SessionMeta[] = [];
    const messagesStore: Record<string, TurnFlushRecord[]> = {};
    const mockSessionStore: SessionStore = {
      createSession(meta: SessionMeta) { metaStore.push(meta); return Promise.resolve(); },
      appendRecords(sessionId: string, records: TurnFlushRecord[]) {
        if (!messagesStore[sessionId]) messagesStore[sessionId] = [];
        messagesStore[sessionId].push(...records);
        const idx = metaStore.findIndex((m) => m.id === sessionId);
        if (idx !== -1) metaStore[idx] = { ...metaStore[idx], lastSeq: messagesStore[sessionId].length };
        return Promise.resolve();
      },
      readRange(sessionId: string, range: SessionRecordRange): Promise<SessionRecordPage> {
        const all = messagesStore[sessionId] || [];
        const end = range.before ?? all.length;
        const start = Math.max(0, end - range.limit);
        return Promise.resolve({
          records: all.slice(start, end),
          cursor: start >= 1 ? start : undefined,
        });
      },
      truncateAfter(sessionId: string, seq: number) {
        messagesStore[sessionId] = (messagesStore[sessionId] || []).slice(0, seq);
        const idx = metaStore.findIndex((m) => m.id === sessionId);
        if (idx !== -1) metaStore[idx] = { ...metaStore[idx], lastSeq: seq };
        return Promise.resolve();
      },
      saveMeta(sessionId: string, meta: Partial<SessionMeta>) {
        const idx = metaStore.findIndex((m) => m.id === sessionId);
        if (idx !== -1) metaStore[idx] = { ...metaStore[idx], ...meta };
        return Promise.resolve();
      },
      loadAllMetadata() { return Promise.resolve(metaStore); },
      deleteByIds() { return Promise.resolve(); },
    };

    const resolvers: Array<(res: Response) => void> = [];
    const deferredFetch = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockImplementation(
      () => new Promise<Response>((r) => { resolvers.push(r); })
    );

    const session = createAgentSession({
      persist: true,
      sessionStore: mockSessionStore,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      maxRetries: 0,
      fetch: deferredFetch,
    });
    await session.initPromise;

    // send() awaits maybeDrainQueue() inside driveTurn()'s own finally
    // block, so `sendPromise` does not resolve until the QUEUED turn also
    // finishes — both fetches must be resolved before awaiting it.
    const sendPromise = session.send([{ type: "text", text: "first" }]);
    await Promise.resolve();
    expect(session.getState().running).toBe(true);

    await session.send([{ type: "text", text: "queued while running" }]);
    expect(session.getState().queuedMessages.length).toBe(1);

    resolvers[0](new Response(JSON.stringify(mkTextResp("first reply")), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    while (resolvers.length < 2) { await new Promise((r) => setTimeout(r, 5)); }
    resolvers[1](new Response(JSON.stringify(mkTextResp("second reply")), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    await sendPromise;

    const state = session.getState();
    expect(state.queuedMessages.length).toBe(0);
    const queuedUserMsgs = state.messages.filter(
      (m) => m.role === "user" && m.text === "queued while running"
    );
    expect(queuedUserMsgs.length).toBe(1);
    expect(state.messages.filter((m) => m.role === "assistant").length).toBe(2);
  });

  it("persist:true still writes one record per turn", async () => {
    const metaStore: SessionMeta[] = [];
    const messagesStore: Record<string, TurnFlushRecord[]> = {};
    const mockSessionStore: SessionStore = {
      createSession(meta: SessionMeta) { metaStore.push(meta); return Promise.resolve(); },
      appendRecords(sessionId: string, records: TurnFlushRecord[]) {
        if (!messagesStore[sessionId]) messagesStore[sessionId] = [];
        messagesStore[sessionId].push(...records);
        const idx = metaStore.findIndex((m) => m.id === sessionId);
        if (idx !== -1) metaStore[idx] = { ...metaStore[idx], lastSeq: messagesStore[sessionId].length };
        return Promise.resolve();
      },
      readRange(sessionId: string, range: SessionRecordRange): Promise<SessionRecordPage> {
        const all = messagesStore[sessionId] || [];
        const end = range.before ?? all.length;
        const start = Math.max(0, end - range.limit);
        return Promise.resolve({
          records: all.slice(start, end),
          cursor: start >= 1 ? start : undefined,
        });
      },
      truncateAfter(sessionId: string, seq: number) {
        messagesStore[sessionId] = (messagesStore[sessionId] || []).slice(0, seq);
        const idx = metaStore.findIndex((m) => m.id === sessionId);
        if (idx !== -1) metaStore[idx] = { ...metaStore[idx], lastSeq: seq };
        return Promise.resolve();
      },
      saveMeta(sessionId: string, meta: Partial<SessionMeta>) {
        const idx = metaStore.findIndex((m) => m.id === sessionId);
        if (idx !== -1) metaStore[idx] = { ...metaStore[idx], ...meta };
        return Promise.resolve();
      },
      loadAllMetadata() { return Promise.resolve(metaStore); },
      deleteByIds() { return Promise.resolve(); },
    };

    const fetchFn = mkAnthropicFetch([mkTextResp("A1"), mkTextResp("A2"), mkTextResp("A3")]);
    const session = createAgentSession({
      persist: true,
      sessionStore: mockSessionStore,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      maxRetries: 0,
      fetch: fetchFn,
    });
    await session.initPromise;

    await session.send([{ type: "text", text: "Q1" }]);
    await session.send([{ type: "text", text: "Q2" }]);
    await session.send([{ type: "text", text: "Q3" }]);

    const sessionId = session.getState().activeSessionId;
    const records = messagesStore[sessionId];
    expect(records.length).toBe(3);
    for (const record of records) {
      // One turn's delta is exactly one user + one assistant entry — no
      // duplicate delta from a stale flush window.
      expect(record.journalDelta.filter((e) => e.msg.role === "user").length).toBe(1);
      expect(record.journalDelta.filter((e) => e.msg.role === "assistant").length).toBe(1);
    }
  });

  it("three turns append three records, one each", async () => {
    const metaStore: SessionMeta[] = [];
    const messagesStore: Record<string, TurnFlushRecord[]> = {};
    const appendRecordsSpy = vi.fn((sessionId: string, records: TurnFlushRecord[]) => {
      if (!messagesStore[sessionId]) messagesStore[sessionId] = [];
      messagesStore[sessionId].push(...records);
      const idx = metaStore.findIndex((m) => m.id === sessionId);
      if (idx !== -1) metaStore[idx] = { ...metaStore[idx], lastSeq: messagesStore[sessionId].length };
      return Promise.resolve();
    });
    const mockSessionStore: SessionStore = {
      createSession(meta: SessionMeta) { metaStore.push(meta); return Promise.resolve(); },
      appendRecords: appendRecordsSpy,
      readRange(sessionId: string, range: SessionRecordRange): Promise<SessionRecordPage> {
        const all = messagesStore[sessionId] || [];
        const end = range.before ?? all.length;
        const start = Math.max(0, end - range.limit);
        return Promise.resolve({ records: all.slice(start, end), cursor: start >= 1 ? start : undefined });
      },
      truncateAfter() { return Promise.resolve(); },
      saveMeta(sessionId: string, meta: Partial<SessionMeta>) {
        const idx = metaStore.findIndex((m) => m.id === sessionId);
        if (idx !== -1) metaStore[idx] = { ...metaStore[idx], ...meta };
        return Promise.resolve();
      },
      loadAllMetadata() { return Promise.resolve(metaStore); },
      deleteByIds() { return Promise.resolve(); },
    };

    const fetchFn = mkAnthropicFetch([mkTextResp("A1"), mkTextResp("A2"), mkTextResp("A3")]);
    const session = createAgentSession({
      persist: true,
      sessionStore: mockSessionStore,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      maxRetries: 0,
      fetch: fetchFn,
    });
    await session.initPromise;

    await session.send([{ type: "text", text: "Q1" }]);
    await session.send([{ type: "text", text: "Q2" }]);
    await session.send([{ type: "text", text: "Q3" }]);

    expect(appendRecordsSpy).toHaveBeenCalledTimes(3);
    for (const call of appendRecordsSpy.mock.calls) {
      expect(call[1].length).toBe(1);
    }
  });

  it("session start pages until the cursor runs out", async () => {
    const sessId = "sess-450";
    const metaStore: SessionMeta[] = [
      { id: sessId, title: "", titleManual: false, createdAt: 0, updatedAt: 0, messageCount: 450, lastSeq: 450 },
    ];
    const records: TurnFlushRecord[] = [];
    for (let i = 1; i <= 450; i++) records.push(mkTurnRecord(i));
    const rangeCalls: SessionRecordRange[] = [];
    const mockSessionStore: SessionStore = {
      createSession() { return Promise.resolve(); },
      appendRecords() { return Promise.resolve(); },
      readRange(_sessionId: string, range: SessionRecordRange): Promise<SessionRecordPage> {
        rangeCalls.push(range);
        const end = range.before ?? records.length;
        const start = Math.max(0, end - range.limit);
        return Promise.resolve({ records: records.slice(start, end), cursor: start >= 1 ? start : undefined });
      },
      truncateAfter() { return Promise.resolve(); },
      saveMeta() { return Promise.resolve(); },
      loadAllMetadata() { return Promise.resolve(metaStore); },
      deleteByIds() { return Promise.resolve(); },
    };

    const session = createAgentSession({
      persist: true,
      sessionStore: mockSessionStore,
      model: "test-model",
    });
    await session.initPromise;

    expect(rangeCalls.length).toBe(3);
    expect(rangeCalls[0]).toEqual({ before: undefined, limit: 200 });

    const messages = session.getState().messages;
    expect(messages.length).toBe(900);
    expect(messages[0].text).toBe("Q1");
    expect(messages[899].text).toBe("A450");
  });

  it("a 50-turn session reopens with the same messages", async () => {
    const sessId = "sess-50";
    const metaStore: SessionMeta[] = [
      { id: sessId, title: "", titleManual: false, createdAt: 0, updatedAt: 0, messageCount: 50, lastSeq: 50 },
    ];
    const records: TurnFlushRecord[] = [];
    for (let i = 1; i <= 50; i++) records.push(mkTurnRecord(i));
    const mockSessionStore: SessionStore = {
      createSession() { return Promise.resolve(); },
      appendRecords() { return Promise.resolve(); },
      readRange(_sessionId: string, range: SessionRecordRange): Promise<SessionRecordPage> {
        const end = range.before ?? records.length;
        const start = Math.max(0, end - range.limit);
        return Promise.resolve({ records: records.slice(start, end), cursor: start >= 1 ? start : undefined });
      },
      truncateAfter() { return Promise.resolve(); },
      saveMeta() { return Promise.resolve(); },
      loadAllMetadata() { return Promise.resolve(metaStore); },
      deleteByIds() { return Promise.resolve(); },
    };

    const session1 = createAgentSession({ persist: true, sessionStore: mockSessionStore, model: "test-model" });
    await session1.initPromise;
    const firstMessages = session1.getState().messages;

    const session2 = createAgentSession({ persist: true, sessionStore: mockSessionStore, model: "test-model" });
    await session2.initPromise;
    const secondMessages = session2.getState().messages;

    expect(secondMessages).toEqual(firstMessages);
    expect(secondMessages.length).toBe(100);
  });

  it("retryLast truncates to the last good turn and never rewrites earlier records", async () => {
    const metaStore: SessionMeta[] = [];
    const messagesStore: Record<string, TurnFlushRecord[]> = {};
    const truncateAfterSpy = vi.fn((sessionId: string, seq: number) => {
      messagesStore[sessionId] = (messagesStore[sessionId] || []).slice(0, seq);
      const idx = metaStore.findIndex((m) => m.id === sessionId);
      if (idx !== -1) metaStore[idx] = { ...metaStore[idx], lastSeq: seq };
      return Promise.resolve();
    });
    const appendRecordsSpy = vi.fn((sessionId: string, records: TurnFlushRecord[]) => {
      if (!messagesStore[sessionId]) messagesStore[sessionId] = [];
      messagesStore[sessionId].push(...records);
      const idx = metaStore.findIndex((m) => m.id === sessionId);
      if (idx !== -1) metaStore[idx] = { ...metaStore[idx], lastSeq: messagesStore[sessionId].length };
      return Promise.resolve();
    });
    const mockSessionStore: SessionStore = {
      createSession(meta: SessionMeta) { metaStore.push(meta); return Promise.resolve(); },
      appendRecords: appendRecordsSpy,
      readRange(sessionId: string, range: SessionRecordRange): Promise<SessionRecordPage> {
        const all = messagesStore[sessionId] || [];
        const end = range.before ?? all.length;
        const start = Math.max(0, end - range.limit);
        return Promise.resolve({ records: all.slice(start, end), cursor: start >= 1 ? start : undefined });
      },
      truncateAfter: truncateAfterSpy,
      saveMeta(sessionId: string, meta: Partial<SessionMeta>) {
        const idx = metaStore.findIndex((m) => m.id === sessionId);
        if (idx !== -1) metaStore[idx] = { ...metaStore[idx], ...meta };
        return Promise.resolve();
      },
      loadAllMetadata() { return Promise.resolve(metaStore); },
      deleteByIds() { return Promise.resolve(); },
    };

    let call = 0;
    const fetchFn = vi.fn().mockImplementation(() => {
      call++;
      if (call === 1) {
        return Promise.resolve(new Response(JSON.stringify(mkTextResp("A1")), {
          status: 200, headers: { "Content-Type": "application/json" },
        }));
      }
      if (call === 2) {
        return Promise.resolve(new Response(
          JSON.stringify({ type: "error", error: { type: "error", message: "mock error" } }),
          { status: 429, headers: { "Content-Type": "application/json" } },
        ));
      }
      return Promise.resolve(new Response(JSON.stringify(mkTextResp("recovered reply")), {
        status: 200, headers: { "Content-Type": "application/json" },
      }));
    });

    const session = createAgentSession({
      persist: true,
      sessionStore: mockSessionStore,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      maxRetries: 0,
      fetch: fetchFn,
    });
    await session.initPromise;
    await session.send([{ type: "text", text: "Q1" }]);
    await session.send([{ type: "text", text: "Q2" }]);

    const sessionId = session.getState().activeSessionId;
    const firstRecordBeforeRetry = messagesStore[sessionId][0];
    const appendCountBeforeRetry = appendRecordsSpy.mock.calls.length;

    await session.retryLast();

    expect(truncateAfterSpy).toHaveBeenCalledTimes(1);
    expect(truncateAfterSpy.mock.calls[0]).toEqual([sessionId, 1]);
    expect(messagesStore[sessionId][0]).toBe(firstRecordBeforeRetry);
    expect(appendRecordsSpy.mock.calls.length).toBeGreaterThan(appendCountBeforeRetry);
  });

  it("overwriteMessages is gone from the seam", () => {
    const store = new IdbSessionStore();
    expect("overwriteMessages" in store).toBe(false);
  });
});

describe("auto-retry:attempt events (044-4)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits auto-retry:attempt while the transport retries a transient failure, then succeeds", async () => {
    const fetchFn = mkFailThenFetch(500, mkTextResp("recovered"), 1);
    const session = createAgentSession({
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      maxRetries: 5,
      fetch: fetchFn,
    });
    await session.initPromise;
    const events: SessionEvent[] = [];
    session.subscribeEvents((e) => events.push(e));

    const sendPromise = session.send([{ type: "text", text: "hi" }]);
    await vi.advanceTimersByTimeAsync(1000);
    await sendPromise;

    const attemptEvents = events.filter((e) => e.type === "auto-retry:attempt");
    expect(attemptEvents).toEqual([
      { type: "auto-retry:attempt", attempt: 1, maxRetries: 5, error: { message: expect.any(String) as unknown } },
    ]);
    const state = session.getState();
    expect(state.messages.find((m) => m.role === "assistant")?.text).toBe("recovered");
  });

  it("emits one auto-retry:attempt per retry, culminating in a failed-turn marker when exhausted", async () => {
    const fetchFn = mkErrorFetch(500);
    const session = createAgentSession({
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      maxRetries: 2,
      fetch: fetchFn,
    });
    await session.initPromise;
    const events: SessionEvent[] = [];
    session.subscribeEvents((e) => events.push(e));

    const sendPromise = session.send([{ type: "text", text: "hi" }]);
    await vi.advanceTimersByTimeAsync(1000 + 1000);
    await sendPromise;

    const attemptEvents = events.filter(
      (e): e is Extract<SessionEvent, { type: "auto-retry:attempt" }> => e.type === "auto-retry:attempt"
    );
    expect(attemptEvents.map((e) => [e.attempt, e.maxRetries])).toEqual([
      [1, 2],
      [2, 2],
    ]);
  });
});

describe("provider fallback events (005)", () => {
  it("a provider fallback reaches subscribeEvents", async () => {
    const { createFallbackProviderFactory } = await import("./transport/fallback-provider.js");
    const { providerRegistry } = await import("./transport/registry.js");

    providerRegistry.register("ctrl-fallback-a", () => ({
      provider: "ctrl-fallback-a",
      modelId: "a-model",
      generate() {
        return Promise.reject(new Error("a is down"));
      },
    }));
    providerRegistry.register("ctrl-fallback-b", () => ({
      provider: "ctrl-fallback-b",
      modelId: "b-model",
      generate() {
        return Promise.resolve({
          content: [{ type: "text" as const, text: "answered by b" }],
          finishReason: "stop" as const,
          usage: { inputTokens: 1, outputTokens: 1 },
        });
      },
    }));
    providerRegistry.register(
      "ctrl-fallback-chain",
      createFallbackProviderFactory([
        { endpointType: "ctrl-fallback-a", model: "a-model", baseURL: "" },
        { endpointType: "ctrl-fallback-b", model: "b-model", baseURL: "" },
      ]),
    );

    const session = createAgentSession({
      model: "unused",
      endpointType: "ctrl-fallback-chain",
      persist: false,
      
    });
    await session.initPromise;
    const events: SessionEvent[] = [];
    session.subscribeEvents((e) => events.push(e));

    await session.send([{ type: "text", text: "hi" }]);

    const fallbackEvents = events.filter(
      (e): e is Extract<SessionEvent, { type: "provider:fallback" }> => e.type === "provider:fallback"
    );
    expect(fallbackEvents.length).toBe(1);
    expect(fallbackEvents[0].failed[0].provider).toBe("ctrl-fallback-a");
    expect(fallbackEvents[0].answered?.provider).toBe("ctrl-fallback-b");

    const state = session.getState();
    expect(state.messages.some((m) => (m.text ?? "").toLowerCase().includes("fallback"))).toBe(false);
  });

  it("tool step renders exactly once after fallback chain retry on subsequent step (B-3)", async () => {
    const { createFallbackProviderFactory } = await import("./transport/fallback-provider.js");
    const { providerRegistry } = await import("./transport/registry.js");

    let aCalls = 0;
    providerRegistry.register("ctrl-fb-tool-a", () => ({
      provider: "ctrl-fb-tool-a",
      modelId: "a-model",
      generate() {
        aCalls++;
        if (aCalls === 1) {
          return Promise.resolve({
            content: [
              {
                type: "tool_use" as const,
                id: "call_retried_1",
                name: "test_tool",
                input: { query: "sample" },
              },
            ],
            finishReason: "tool-calls" as const,
            usage: { inputTokens: 5, outputTokens: 5 },
          });
        }
        return Promise.reject(new Error("provider a failed on step 2"));
      },
    }));

    providerRegistry.register("ctrl-fb-tool-b", () => ({
      provider: "ctrl-fb-tool-b",
      modelId: "b-model",
      generate() {
        return Promise.resolve({
          content: [{ type: "text" as const, text: "completed by b" }],
          finishReason: "stop" as const,
          usage: { inputTokens: 10, outputTokens: 5 },
        });
      },
    }));

    providerRegistry.register(
      "ctrl-fb-tool-chain",
      createFallbackProviderFactory([
        { endpointType: "ctrl-fb-tool-a", model: "a-model", baseURL: "" },
        { endpointType: "ctrl-fb-tool-b", model: "b-model", baseURL: "" },
      ]),
    );

    let toolExecutions = 0;
    const testTool: CustomToolDef = {
      name: "test_tool",
      description: "A test tool",
      inputSchema: z.object({ query: z.string() }).strict(),
      execute: () => {
        toolExecutions++;
        return Promise.resolve({ status: "success" } as unknown as ToolOutcome);
      },
    };

    const session = createAgentSession({
      model: "unused",
      endpointType: "ctrl-fb-tool-chain",
      persist: false,
      
      tools: () => [testTool],
    });
    await session.initPromise;

    const events: SessionEvent[] = [];
    session.subscribeEvents((e) => events.push(e));

    await session.send([{ type: "text", text: "run action" }]);

    const fallbackEvents = events.filter((e) => e.type === "provider:fallback");
    expect(fallbackEvents.length).toBe(1);
    expect(toolExecutions).toBe(1);

    const state = session.getState();
    const assistantMessages = state.messages.filter((m) => m.role === "assistant");
    const toolParts = assistantMessages.flatMap((m) => (m.parts ?? []).filter((p) => p.kind === "tool"));
    expect(toolParts.length).toBe(1);
  });

  it("turn with no retry renders tool step exactly once (regression)", async () => {
    const { providerRegistry } = await import("./transport/registry.js");

    let callCount = 0;
    providerRegistry.register("ctrl-single-tool-prov", () => ({
      provider: "ctrl-single-tool-prov",
      modelId: "s-model",
      generate() {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            content: [
              {
                type: "tool_use" as const,
                id: "call_single_1",
                name: "test_tool_single",
                input: { query: "sample" },
              },
            ],
            finishReason: "tool-calls" as const,
            usage: { inputTokens: 5, outputTokens: 5 },
          });
        }
        return Promise.resolve({
          content: [{ type: "text" as const, text: "completed normally" }],
          finishReason: "stop" as const,
          usage: { inputTokens: 10, outputTokens: 5 },
        });
      },
    }));

    let toolExecutions = 0;
    const testTool: CustomToolDef = {
      name: "test_tool_single",
      description: "A test tool",
      inputSchema: z.object({ query: z.string() }).strict(),
      execute: () => {
        toolExecutions++;
        return Promise.resolve({ status: "ok" } as unknown as ToolOutcome);
      },
    };

    const session = createAgentSession({
      model: "unused",
      endpointType: "ctrl-single-tool-prov",
      persist: false,
      
      tools: () => [testTool],
    });
    await session.initPromise;

    await session.send([{ type: "text", text: "run action" }]);

    expect(toolExecutions).toBe(1);

    const state = session.getState();
    const assistantMessages = state.messages.filter((m) => m.role === "assistant");
    const toolParts = assistantMessages.flatMap((m) => (m.parts ?? []).filter((p) => p.kind === "tool"));
    expect(toolParts.length).toBe(1);
  });
});

describe("prompt queue (048-1)", () => {
  it("enqueue-while-running does not throw + shows in state", async () => {
    let resolveFetch!: (res: Response) => void;
    const deferredFetch = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockImplementation(() => new Promise<Response>((r) => { resolveFetch = r; }));
    const session = createAgentSession({
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: deferredFetch,
    });
    await session.initPromise;
    const sendPromise = session.send([{ type: "text", text: "A" }]);
    await Promise.resolve();
    expect(session.getState().running).toBe(true);

    await session.send([{ type: "text", text: "B" }]);
    await session.send([{ type: "text", text: "C" }]);

    expect(session.getState().queuedMessages.map((q) => q.text)).toEqual(["B", "C"]);

    session.clearQueue();

    while (!resolveFetch) {
      await new Promise((r) => setTimeout(r, 5));
    }
    resolveFetch(new Response(JSON.stringify(mkTextResp("first")), { status: 200, headers: { "Content-Type": "application/json" } }));
    await sendPromise;
  });

  it("on success ONE concatenated turn fires with all queued content in order", async () => {
    let resolveFetchFirst!: (res: Response) => void;
    let resolveFetchSecond!: (res: Response) => void;
    let callCount = 0;
    const deferredFetch = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockImplementation(() => {
      callCount++;
      return new Promise<Response>((r) => {
        if (callCount === 1) resolveFetchFirst = r;
        else resolveFetchSecond = r;
      });
    });

    const session = createAgentSession({
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: deferredFetch,
    });
    await session.initPromise;

    const sendPromise = session.send([{ type: "text", text: "A" }]);
    await Promise.resolve();

    await session.send([{ type: "text", text: "B" }]);
    await session.send([{ type: "text", text: "C" }]);

    while (!resolveFetchFirst) {
      await new Promise((r) => setTimeout(r, 5));
    }
    resolveFetchFirst(new Response(JSON.stringify(mkTextResp("reply to A")), { status: 200, headers: { "Content-Type": "application/json" } }));

    while (!resolveFetchSecond) {
      await new Promise((r) => setTimeout(r, 5));
    }

    expect(deferredFetch.mock.calls.length).toBe(2);
    const secondCallBody = JSON.parse(deferredFetch.mock.calls[1][1]!.body as string) as MessageCreateParams;
    const messages = secondCallBody.messages;
    const lastUserMsg = messages[messages.length - 1];
    expect(lastUserMsg.content).toEqual([
      { type: "text", text: "B\nC", cache_control: { type: "ephemeral" } },
    ]);

    resolveFetchSecond(new Response(JSON.stringify(mkTextResp("reply to B and C")), { status: 200, headers: { "Content-Type": "application/json" } }));
    await sendPromise;

    expect(session.getState().queuedMessages.length).toBe(0);
    expect(session.getState().messages.map(m => m.text)).toContain("reply to B and C");
  });

  it("hold on failure — queue survives, no auto-fire", async () => {
    let resolveFetchFirst!: (res: Response) => void;
    const deferredFetch = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockImplementation(() => {
      return new Promise<Response>((r) => {
        resolveFetchFirst = r;
      });
    });

    const session = createAgentSession({
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      maxRetries: 0,
      fetch: deferredFetch,
    });
    await session.initPromise;

    const sendPromise = session.send([{ type: "text", text: "A" }]);
    await Promise.resolve();

    await session.send([{ type: "text", text: "B" }]);

    while (!resolveFetchFirst) {
      await new Promise((r) => setTimeout(r, 5));
    }
    resolveFetchFirst(new Response(JSON.stringify({ error: { type: "api_error", message: "fail" } }), { status: 400, headers: { "Content-Type": "application/json" } }));
    await sendPromise;

    expect(deferredFetch.mock.calls.length).toBe(1);
    expect(session.getState().queuedMessages.map(q => q.text)).toEqual(["B"]);
    expect(session.getState().error).toBeDefined();
  });

  it("hold-on-failure then retry drains", async () => {
    let callCount = 0;
    let resolveFirst!: (res: Response) => void;
    let resolveSecond!: (res: Response) => void;
    const deferredFetch = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockImplementation(() => {
      callCount++;
      return new Promise<Response>((r) => {
        if (callCount === 1) resolveFirst = r;
        else resolveSecond = r;
      });
    });

    const session = createAgentSession({
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      maxRetries: 0,
      fetch: deferredFetch,
    });
    await session.initPromise;

    const sendPromise = session.send([{ type: "text", text: "A" }]);
    await Promise.resolve();
    await session.send([{ type: "text", text: "B" }]);

    while (!resolveFirst) {
      await new Promise((r) => setTimeout(r, 5));
    }
    resolveFirst(new Response(JSON.stringify({ error: "bad request" }), { status: 400, headers: { "Content-Type": "application/json" } }));
    await sendPromise;

    expect(session.getState().queuedMessages.map(q => q.text)).toEqual(["B"]);

    let resolveThird!: (res: Response) => void;
    deferredFetch.mockImplementation(() => {
      callCount++;
      return new Promise<Response>((r) => {
        if (callCount === 2) resolveSecond = r;
        else if (callCount === 3) resolveThird = r;
      });
    });

    const retryPromise = session.retryLast();

    while (!resolveSecond) {
      await new Promise((r) => setTimeout(r, 5));
    }
    resolveSecond(new Response(JSON.stringify(mkTextResp("retry of A success")), { status: 200, headers: { "Content-Type": "application/json" } }));

    while (!resolveThird) {
      await new Promise((r) => setTimeout(r, 5));
    }

    expect(callCount).toBe(3);
    const thirdCallBody = JSON.parse(deferredFetch.mock.calls[2][1]!.body as string) as MessageCreateParams;
    const lastMsgText = thirdCallBody.messages[thirdCallBody.messages.length - 1].content;
    expect(lastMsgText).toEqual([
      { type: "text", text: "B", cache_control: { type: "ephemeral" } },
    ]);

    resolveThird(new Response(JSON.stringify(mkTextResp("reply to B")), { status: 200, headers: { "Content-Type": "application/json" } }));
    await retryPromise;

    expect(session.getState().queuedMessages.length).toBe(0);
    expect(session.getState().messages.map(m => m.text)).toContain("reply to B");
  });

  it("cancelQueued(id) removes any item", async () => {
    let resolveFetch!: (res: Response) => void;
    const deferredFetch = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockImplementation(() => new Promise<Response>((r) => { resolveFetch = r; }));
    const session = createAgentSession({
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: deferredFetch,
    });
    await session.initPromise;
    const sendPromise = session.send([{ type: "text", text: "A" }]);
    await Promise.resolve();

    await session.send([{ type: "text", text: "B" }]);
    await session.send([{ type: "text", text: "C" }]);
    await session.send([{ type: "text", text: "D" }]);

    const queued = session.getState().queuedMessages;
    expect(queued.map((q) => q.text)).toEqual(["B", "C", "D"]);

    const targetId = queued[1].id;
    let listenerFired: boolean;
    const unsub = session.subscribe(() => { listenerFired = true; });
    listenerFired = false;

    session.cancelQueued(targetId);
    expect(session.getState().queuedMessages.map((q) => q.text)).toEqual(["B", "D"]);
    expect(listenerFired).toBe(true);
    unsub();

    session.clearQueue();

    while (!resolveFetch) {
      await new Promise((r) => setTimeout(r, 5));
    }
    resolveFetch(new Response(JSON.stringify(mkTextResp("first")), { status: 200, headers: { "Content-Type": "application/json" } }));
    await sendPromise;
  });

  it("popLastQueued() returns + removes the last", async () => {
    let resolveFetch!: (res: Response) => void;
    const deferredFetch = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockImplementation(() => new Promise<Response>((r) => { resolveFetch = r; }));
    const session = createAgentSession({
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: deferredFetch,
    });
    await session.initPromise;
    const sendPromise = session.send([{ type: "text", text: "A" }]);
    await Promise.resolve();

    await session.send([{ type: "text", text: "B" }]);
    await session.send([{ type: "text", text: "C" }]);

    let listenerFired: boolean;
    const unsub = session.subscribe(() => { listenerFired = true; });
    listenerFired = false;

    const popped = session.popLastQueued();
    expect(popped).toEqual({ text: "C", images: undefined });
    expect(session.getState().queuedMessages.map((q) => q.text)).toEqual(["B"]);
    expect(listenerFired).toBe(true);
    unsub();

    const popped2 = session.popLastQueued();
    expect(popped2).toEqual({ text: "B", images: undefined });
    expect(session.getState().queuedMessages.length).toBe(0);

    const poppedEmpty = session.popLastQueued();
    expect(poppedEmpty).toBeUndefined();

    while (!resolveFetch) {
      await new Promise((r) => setTimeout(r, 5));
    }
    resolveFetch(new Response(JSON.stringify(mkTextResp("first")), { status: 200, headers: { "Content-Type": "application/json" } }));
    await sendPromise;
  });

  it("clearQueue() empties the queue", async () => {
    let resolveFetch!: (res: Response) => void;
    const deferredFetch = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockImplementation(() => new Promise<Response>((r) => { resolveFetch = r; }));
    const session = createAgentSession({
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: deferredFetch,
    });
    await session.initPromise;
    const sendPromise = session.send([{ type: "text", text: "A" }]);
    await Promise.resolve();

    await session.send([{ type: "text", text: "B" }]);
    await session.send([{ type: "text", text: "C" }]);

    let listenerFiredCount = 0;
    const unsub = session.subscribe(() => { listenerFiredCount++; });
    listenerFiredCount = 0;

    session.clearQueue();
    expect(session.getState().queuedMessages).toEqual([]);
    expect(listenerFiredCount).toBe(1);

    session.clearQueue();
    expect(listenerFiredCount).toBe(1);
    unsub();

    while (!resolveFetch) {
      await new Promise((r) => setTimeout(r, 5));
    }
    resolveFetch(new Response(JSON.stringify(mkTextResp("first")), { status: 200, headers: { "Content-Type": "application/json" } }));
    await sendPromise;
  });

  it("multiple enqueued preserve order + concat joins with \\n", async () => {
    let resolveFetchFirst!: (res: Response) => void;
    let resolveFetchSecond!: (res: Response) => void;
    let callCount = 0;
    const deferredFetch = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockImplementation(() => {
      callCount++;
      return new Promise<Response>((r) => {
        if (callCount === 1) resolveFetchFirst = r;
        else resolveFetchSecond = r;
      });
    });

    const session = createAgentSession({
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: deferredFetch,
    });
    await session.initPromise;

    const sendPromise = session.send([{ type: "text", text: "A" }]);
    await Promise.resolve();

    await session.send([{ type: "text", text: "B" }]);
    await session.send([{ type: "text", text: "C" }]);
    await session.send([{ type: "text", text: "D" }]);

    while (!resolveFetchFirst) {
      await new Promise((r) => setTimeout(r, 5));
    }
    resolveFetchFirst(new Response(JSON.stringify(mkTextResp("reply to A")), { status: 200, headers: { "Content-Type": "application/json" } }));

    while (!resolveFetchSecond) {
      await new Promise((r) => setTimeout(r, 5));
    }

    expect(deferredFetch.mock.calls.length).toBe(2);
    const secondCallBody = JSON.parse(deferredFetch.mock.calls[1][1]!.body as string) as MessageCreateParams;
    const lastUserMsg = secondCallBody.messages[secondCallBody.messages.length - 1];
    expect(lastUserMsg.content).toEqual([
      { type: "text", text: "B\nC\nD", cache_control: { type: "ephemeral" } },
    ]);

    resolveFetchSecond(new Response(JSON.stringify(mkTextResp("reply to all")), { status: 200, headers: { "Content-Type": "application/json" } }));
    await sendPromise;
  });

  it("concat merges images", async () => {
    let resolveFetchFirst!: (res: Response) => void;
    let resolveFetchSecond!: (res: Response) => void;
    let callCount = 0;
    const deferredFetch = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockImplementation(() => {
      callCount++;
      return new Promise<Response>((r) => {
        if (callCount === 1) resolveFetchFirst = r;
        else resolveFetchSecond = r;
      });
    });

    const session = createAgentSession({
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: deferredFetch,
    });
    await session.initPromise;

    const sendPromise = session.send([{ type: "text", text: "A" }]);
    await Promise.resolve();

    await session.send([
      { type: "image", dataUrl: "data:image/png;base64,B1", mediaType: "image/png" },
      { type: "text", text: "B" }
    ]);
    await session.send([
      { type: "image", dataUrl: "data:image/png;base64,C1", mediaType: "image/png" },
      { type: "text", text: "C" }
    ]);

    while (!resolveFetchFirst) {
      await new Promise((r) => setTimeout(r, 5));
    }
    resolveFetchFirst(new Response(JSON.stringify(mkTextResp("reply to A")), { status: 200, headers: { "Content-Type": "application/json" } }));

    while (!resolveFetchSecond) {
      await new Promise((r) => setTimeout(r, 5));
    }

    expect(deferredFetch.mock.calls.length).toBe(2);
    const secondCallBody = JSON.parse(deferredFetch.mock.calls[1][1]!.body as string) as MessageCreateParams;
    const lastUserMsg = secondCallBody.messages[secondCallBody.messages.length - 1];

    expect(lastUserMsg.content).toEqual([
      { type: "text", text: "B\nC" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "B1" } },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "C1" }, cache_control: { type: "ephemeral" } }
    ]);

    resolveFetchSecond(new Response(JSON.stringify(mkTextResp("reply to all")), { status: 200, headers: { "Content-Type": "application/json" } }));
    await sendPromise;
  });

  it("message queued DURING the drained turn is handled (second drain)", async () => {
    let resolveFirst!: (res: Response) => void;
    let resolveSecond!: (res: Response) => void;
    let resolveThird!: (res: Response) => void;
    let callCount = 0;
    const deferredFetch = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockImplementation(() => {
      callCount++;
      return new Promise<Response>((r) => {
        if (callCount === 1) resolveFirst = r;
        else if (callCount === 2) resolveSecond = r;
        else resolveThird = r;
      });
    });

    const session = createAgentSession({
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: deferredFetch,
    });
    await session.initPromise;

    const sendPromise = session.send([{ type: "text", text: "A" }]);
    await Promise.resolve();

    await session.send([{ type: "text", text: "B" }]);

    while (!resolveFirst) {
      await new Promise((r) => setTimeout(r, 5));
    }
    resolveFirst(new Response(JSON.stringify(mkTextResp("reply to A")), { status: 200, headers: { "Content-Type": "application/json" } }));
    await new Promise((r) => setTimeout(r, 10));

    await session.send([{ type: "text", text: "E" }]);
    expect(session.getState().queuedMessages.map(q => q.text)).toEqual(["E"]);

    while (!resolveSecond) {
      await new Promise((r) => setTimeout(r, 5));
    }
    resolveSecond(new Response(JSON.stringify(mkTextResp("reply to B")), { status: 200, headers: { "Content-Type": "application/json" } }));

    while (!resolveThird) {
      await new Promise((r) => setTimeout(r, 5));
    }

    expect(callCount).toBe(3);
    const thirdCallBody = JSON.parse(deferredFetch.mock.calls[2][1]!.body as string) as MessageCreateParams;
    const lastUserMsg = thirdCallBody.messages[thirdCallBody.messages.length - 1];
    expect(lastUserMsg.content).toEqual([
      { type: "text", text: "E", cache_control: { type: "ephemeral" } },
    ]);

    resolveThird(new Response(JSON.stringify(mkTextResp("reply to E")), { status: 200, headers: { "Content-Type": "application/json" } }));
    await sendPromise;

    expect(session.getState().queuedMessages.length).toBe(0);
  });

  it("queue cleared on createSession/switchSession", async () => {
    const deferredFetch = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockImplementation(() => new Promise<Response>(() => {}));
    const session = createAgentSession({
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: deferredFetch,
    });
    await session.initPromise;
    const sendPromise = session.send([{ type: "text", text: "A" }]);
    await Promise.resolve();

    await session.send([{ type: "text", text: "B" }]);
    expect(session.getState().queuedMessages.map(q => q.text)).toEqual(["B"]);

    await session.createSession();
    expect(session.getState().queuedMessages).toEqual([]);

    try {
      await sendPromise;
    } catch {
      // the pending send may reject once its session is torn down by
      // createSession(); the rejection is the assertion, nothing to inspect here
    }
  });

  it("starts a send after an in-progress new session without an invalid context", async () => {
    const metas: SessionMeta[] = [];
    let releaseCreate: (() => void) | undefined;
    const store: SessionStore = {
      async createSession(meta) {
        if (metas.length > 0) await new Promise<void>((resolve) => { releaseCreate = resolve; });
        metas.push(meta);
      },
      appendRecords: async () => {},
      readRange: () => Promise.resolve({ records: [] }),
      truncateAfter: async () => {},
      saveMeta: async () => {},
      loadAllMetadata: () => Promise.resolve([...metas]),
      deleteByIds: async () => {},
    };
    let releaseReply: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn<typeof fetch>().mockImplementationOnce(() =>
      new Promise<Response>((resolve) => { releaseReply = resolve; })
    ).mockImplementation(() => Promise.resolve(new Response(JSON.stringify(mkTextResp("new reply")), {
      status: 200, headers: { "Content-Type": "application/json" },
    })));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const session = createAgentSession({
      persist: true, sessionStore: store, model: "test-model",
      endpointType: "anthropic", baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: fetchMock, context: { mode: "warn" },
    });
    await session.initPromise;

    const creation = session.createSession();
    const sendDuringCreation = session.send([{ type: "text", text: "new question" }]);
    expect(releaseCreate).toBeDefined();
    releaseCreate!();
    await creation;
    for (let i = 0; i < 20 && !releaseReply; i++) await Promise.resolve();
    expect(releaseReply).toBeDefined();
    releaseReply!(new Response(JSON.stringify(mkTextResp("first reply")), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    await sendDuringCreation;
    await session.send([{ type: "text", text: "follow-up" }]);

    expect(session.getState().messages[0]?.role).toBe("user");
    expect(warn.mock.calls.some(([message]) => String(message).includes("I2 violation"))).toBe(false);
    warn.mockRestore();
  });

  it("keeps an old turn's late reply out of the new session", async () => {
    let releaseOldReply: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn<typeof fetch>().mockImplementationOnce(() =>
      new Promise<Response>((resolve) => { releaseOldReply = resolve; })
    ).mockImplementation(() => Promise.resolve(new Response(JSON.stringify(mkTextResp("new reply")), {
      status: 200, headers: { "Content-Type": "application/json" },
    })));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const session = createAgentSession({
      persist: false, model: "test-model", endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1", fetch: fetchMock,
      context: { mode: "warn" },
    });
    await session.initPromise;
    const oldSend = session.send([{ type: "text", text: "old question" }]);
    for (let i = 0; i < 20 && !releaseOldReply; i++) await Promise.resolve();
    expect(releaseOldReply).toBeDefined();

    await session.createSession();
    await session.send([{ type: "text", text: "new question" }]);
    releaseOldReply!(new Response(JSON.stringify(mkTextResp("old reply")), {
      status: 200, headers: { "Content-Type": "application/json" },
    }));
    await oldSend;

    expect(session.getState().messages.map((message) => message.text)).toEqual(["new question", "new reply"]);
    expect(warn.mock.calls.some(([message]) => String(message).includes("I2 violation"))).toBe(false);
    warn.mockRestore();
  });
});

describe("clearAllSessions", () => {
  it("clears all persisted sessions and starts one fresh", async () => {
    const metaStore: SessionMeta[] = [];
    const messagesStore: Record<string, TurnFlushRecord[]> = {};
    const mockSessionStore: SessionStore = {
      createSession(meta: SessionMeta) {
        metaStore.push(meta);
        return Promise.resolve();
      },
      appendRecords(sessionId: string, records: TurnFlushRecord[]) {
        if (!messagesStore[sessionId]) messagesStore[sessionId] = [];
        messagesStore[sessionId].push(...records);
        const idx = metaStore.findIndex((m) => m.id === sessionId);
        if (idx !== -1) metaStore[idx] = { ...metaStore[idx], lastSeq: messagesStore[sessionId].length };
        return Promise.resolve();
      },
      readRange(sessionId: string, range: SessionRecordRange): Promise<SessionRecordPage> {
        const all = messagesStore[sessionId] || [];
        const end = range.before ?? all.length;
        const start = Math.max(0, end - range.limit);
        return Promise.resolve({
          records: all.slice(start, end),
          cursor: start >= 1 ? start : undefined,
        });
      },
      truncateAfter(sessionId: string, seq: number) {
        messagesStore[sessionId] = (messagesStore[sessionId] || []).slice(0, seq);
        const idx = metaStore.findIndex((m) => m.id === sessionId);
        if (idx !== -1) metaStore[idx] = { ...metaStore[idx], lastSeq: seq };
        return Promise.resolve();
      },
      saveMeta(sessionId: string, meta: Partial<SessionMeta>) {
        const idx = metaStore.findIndex((m) => m.id === sessionId);
        if (idx !== -1) metaStore[idx] = { ...metaStore[idx], ...meta };
        return Promise.resolve();
      },
      loadAllMetadata() {
        return Promise.resolve([...metaStore]);
      },
      deleteByIds(ids: string[]) {
        for (const id of ids) {
          const idx = metaStore.findIndex((m) => m.id === id);
          if (idx !== -1) metaStore.splice(idx, 1);
          delete messagesStore[id];
        }
        return Promise.resolve();
      },
    };

    const session = createAgentSession({
      persist: true,
      sessionStore: mockSessionStore,
      model: "test-model",
    });
    await session.initPromise;

    // Create 2 more sessions (total 3 including initial)
    await session.createSession();
    await session.createSession();
    expect(metaStore.length).toBe(3);

    const originalIds = metaStore.map((m) => m.id);

    await session.clearAllSessions();

    // All original sessions deleted, one fresh one created
    expect(metaStore.some((m) => originalIds.includes(m.id))).toBe(false);
    const state = session.getState();
    expect(state.sessions.length).toBe(1);
    expect(state.messages.length).toBe(0);
    expect(originalIds.includes(state.activeSessionId)).toBe(false);
  });

  it("is no-op-safe with persist:false", async () => {
    const session = createAgentSession({
      persist: false,
      model: "test-model",
    });
    await session.initPromise;

    await expect(session.clearAllSessions()).resolves.toBeUndefined();
    const state = session.getState();
    expect(state.sessions.length).toBe(1);
    expect(state.messages.length).toBe(0);
  });
});

describe("AgentSession.setModel (067)", () => {
  it("getState().model defaults to the config model", () => {
    const session = createAgentSession({ persist: false, model: "test-model" });
    expect(session.getState().model).toBe("test-model");
  });

  it("swaps the model without resetting the conversation", async () => {
    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: mkAnthropicFetch([mkTextResp("hello")]),
    });
    await session.initPromise;
    // Run one turn to populate messages
    await session.send([{ type: "text", text: "hi" }]);
    const before = session.getState().messages.length;
    expect(before).toBeGreaterThan(0);

    session.setModel("s");

    // Conversation survives
    expect(session.getState().messages.length).toBe(before);
    expect(session.getState().model).toBe("s");
  });

  it("routes the new model to the next turn's request", async () => {
    const calls: MessageCreateParams[] = [];
    const fetch = vi.fn<Parameters<typeof globalThis.fetch>, ReturnType<typeof globalThis.fetch>>().mockImplementation((url, init) => {
      const body = JSON.parse(init!.body as string) as MessageCreateParams;
      calls.push(body);
      return Promise.resolve(new Response(JSON.stringify(mkTextResp("ok")), {
        status: 200, headers: { "Content-Type": "application/json" },
      }));
    });
    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch,
    });
    await session.initPromise;
    session.setModel("s");
    await session.send([{ type: "text", text: "hi" }]);
    expect(calls[0].model).toBe("s");
  });

  it("ignores empty or unchanged ids", () => {
    const session = createAgentSession({ persist: false, model: "test-model" });
    expect(() => session.setModel("")).not.toThrow();
    expect(() => session.setModel("test-model")).not.toThrow();
    expect(session.getState().model).toBe("test-model");
  });
});

describe("no toolProviders: the zero-config default (007)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const DOM_TOOL_NAMES = ["snapshot_page", "query_state", "click", "fill", "select_option", "wait_for", "see"];

  it("a session with no toolProviders offers none of the seven DOM tool names on its first turn", async () => {
    const calls: MessageCreateParams[] = [];
    const fetch = vi.fn<Parameters<typeof globalThis.fetch>, ReturnType<typeof globalThis.fetch>>().mockImplementation((_url, init) => {
      calls.push(JSON.parse(init!.body as string) as MessageCreateParams);
      return Promise.resolve(new Response(JSON.stringify(mkTextResp("ok")), {
        status: 200, headers: { "Content-Type": "application/json" },
      }));
    });
    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch,
    });

    await session.send([{ type: "text", text: "hi" }]);

    const sentToolNames = (calls[0].tools ?? []).map((t) => t.name);
    for (const domName of DOM_TOOL_NAMES) {
      expect(sentToolNames).not.toContain(domName);
    }
    expect(sentToolNames).toEqual(
      expect.arrayContaining(["wait", "list_data_sources", "query_data", "show_generative_ui", "search_skills", "load_skill"]),
    );
  });

  it("a send whose only content is an onUserPrompt-contributed promptMeta (no text, no images) still produces a user SessionMessage", async () => {
    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: mkAnthropicFetch([mkTextResp("ok")]),
      hooks: {
        onUserPrompt: () => ({ parts: [], meta: { attachmentChips: [{ providerId: "picker", label: "1 element pointed" }] } }),
      },
    });

    await session.send([]);

    const state = session.getState();
    expect(state.messages[0].role).toBe("user");
    expect(state.messages[0].promptMeta).toBeDefined();
  });
});

describe("mid-turn incremental notify (074)", () => {
  // Helper: sequential fetch returning different bodies on each call
  function mkSeqFetch(seq: Array<Message | { __status: number }>) {
    let idx = 0;
    return vi.fn<Parameters<typeof globalThis.fetch>, ReturnType<typeof globalThis.fetch>>().mockImplementation(() => {
      const body = seq[Math.min(idx, seq.length - 1)];
      idx++;
      if (body && "__status" in body) {
        return Promise.resolve(new Response(
          JSON.stringify({ type: "error", error: { type: "error", message: "mock error" } }),
          { status: body.__status, headers: { "Content-Type": "application/json" } }
        ));
      }
      return Promise.resolve(new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    });
  }

  it("repaints transcript per step, not only at turn end", async () => {
    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: mkSeqFetch([mkToolResp("call-1", "snapshot_page"), mkTextResp("done")]),
    });

    const snapshots: SessionState[] = [];
    session.subscribe((s) => {
      snapshots.push(JSON.parse(JSON.stringify(s)) as SessionState);
    });

    await session.send([{ type: "text", text: "go" }]);

    // Find intermediate running snapshots that already have assistant content
    const intermediate = snapshots.filter(
      (s) =>
        s.running === true &&
        s.messages.some(
          (m) => m.role === "assistant" && (m.parts?.length || m.blocks?.length || m.text)
        )
    );
    expect(intermediate.length).toBeGreaterThan(0);

    // Intermediate must appear before the last snapshot
    const firstIntermediateIdx = snapshots.indexOf(intermediate[0]);
    expect(firstIntermediateIdx).toBeLessThan(snapshots.length - 1);

    // Final state: running false
    expect(session.getState().running).toBe(false);
  });

  it("sets inProgressTurnId + pending during a turn and clears them after", async () => {
    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: mkSeqFetch([mkToolResp("call-1", "snapshot_page"), mkTextResp("done")]),
    });

    const snapshots: SessionState[] = [];
    session.subscribe((s) => {
      snapshots.push(JSON.parse(JSON.stringify(s)) as SessionState);
    });

    await session.send([{ type: "text", text: "go" }]);

    // At least one running snapshot should have inProgressTurnId set
    const runningWithId = snapshots.filter(
      (s) => s.running === true && !!s.inProgressTurnId
    );
    expect(runningWithId.length).toBeGreaterThan(0);

    // That snapshot's assistant message has pending: true
    const withPending = runningWithId.filter((s) =>
      s.messages.some((m) => m.role === "assistant" && m.pending === true)
    );
    expect(withPending.length).toBeGreaterThan(0);

    // After turn ends, inProgressTurnId cleared
    const finalState = session.getState();
    expect(finalState.inProgressTurnId).toBeUndefined();
    expect(finalState.messages.every((m) => !m.pending)).toBe(true);
  });

  it("keeps partial blocks and marks failed when a later step errors", async () => {
    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      // Call 1: tool use succeeds; Call 2: HTTP 400 (terminal, non-retryable)
      fetch: mkSeqFetch([mkToolResp("call-1", "snapshot_page"), { __status: 400 }]),
    });

    await session.send([{ type: "text", text: "go" }]);

    const state = session.getState();
    expect(state.running).toBe(false);
    expect(state.inProgressTurnId).toBeUndefined();

    // Step-1 assistant/tool content is retained in messages
    const assistantMsgs = state.messages.filter((m) => m.role === "assistant");
    expect(assistantMsgs.length).toBeGreaterThan(0);

    // The turn should be marked failed
    const failedMsg = state.messages.find((m) => m.failed);
    expect(failedMsg).toBeDefined();
    expect(failedMsg!.pending).toBeFalsy();
  });

  it("clears in-progress on abort but keeps partial content", async () => {
    let abortCalled = false;
    const sessionRef: { current?: AgentSession } = {};
    let callCount = 0;

    const fetchFn = vi.fn<Parameters<typeof globalThis.fetch>, ReturnType<typeof globalThis.fetch>>().mockImplementation((_url, init) => {
      callCount++;
      if (callCount === 1) {
        // First call: tool use response — step 1 is recorded, onStep fires
        return Promise.resolve(new Response(JSON.stringify(mkToolResp("call-1", "snapshot_page")), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      }
      // Second call: abort the session now that step 1 has been journaled,
      // then propagate the abort through the AbortSignal
      if (!abortCalled) {
        abortCalled = true;
        sessionRef.current?.abort();
      }
      // Honor the abort signal if already aborted
      const signal = init?.signal;
      if (signal?.aborted) {
        return Promise.reject(new DOMException("The user aborted a request.", "AbortError"));
      }
      return new Promise<Response>((_resolve, reject) => {
        if (signal) {
          signal.addEventListener("abort", () =>
            reject(new DOMException("The user aborted a request.", "AbortError"))
          );
        } else {
          reject(new DOMException("The user aborted a request.", "AbortError"));
        }
      });
    });

    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: fetchFn,
    });
    sessionRef.current = session;

    await session.send([{ type: "text", text: "go" }]);

    const state = session.getState();
    expect(state.running).toBe(false);
    expect(state.inProgressTurnId).toBeUndefined();

    // Partial step-1 content should remain
    const assistantMsgs = state.messages.filter((m) => m.role === "assistant");
    expect(assistantMsgs.length).toBeGreaterThan(0);
    expect(assistantMsgs.every((m) => !m.pending)).toBe(true);
  });
});

describe("lifecycle hooks (controller)", () => {
  it("onSessionStart fires once with the session id and initPromise waits for it", async () => {
    let handlerFired = false;
    const startSpy = vi.fn<[SessionStartPayload], Promise<void>>().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10));
      handlerFired = true;
    });

    const session = createAgentSession({
      persist: false,
      model: "test-model",
      hooks: { onSessionStart: startSpy },
    });

    await session.initPromise;
    expect(handlerFired).toBe(true);
    expect(startSpy).toHaveBeenCalledTimes(1);
    expect(startSpy.mock.calls[0][0]).toEqual({ sessionId: "default-session" });
  });

  it("onSessionStart fires once with the generated session id on persist: true path", async () => {
    let handlerFired = false;
    const startSpy = vi.fn<[SessionStartPayload], Promise<void>>().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 10));
      handlerFired = true;
    });

    const session = createAgentSession({
      persist: true,
      model: "test-model",
      hooks: { onSessionStart: startSpy },
    });

    await session.initPromise;
    expect(handlerFired).toBe(true);
    expect(startSpy).toHaveBeenCalledTimes(1);
    const sid = startSpy.mock.calls[0][0].sessionId;
    expect(typeof sid).toBe("string");
    expect(sid).not.toBe("default-session");
  });

  it("onUserPrompt replacement parts change what the model receives", async () => {
    let capturedBody!: MessageCreateParams;
    const fetchFn = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockImplementation((_url, init) => {
      capturedBody = JSON.parse(init!.body as string) as MessageCreateParams;
      return Promise.resolve(new Response(JSON.stringify(mkTextResp("ok")), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    });

    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: fetchFn,
      hooks: {
        onUserPrompt: () => ({ parts: [{ type: "text", text: "replaced prompt" }] }),
      },
    });

    await session.send([{ type: "text", text: "original prompt" }]);
    const content = capturedBody.messages[0].content;
    const text = typeof content === "string" ? content : (content[0] as { text: string }).text;
    expect(text).toBe("replaced prompt");
  });

  it("onUserPrompt userDisplayText changes only the transcript", async () => {
    let capturedBody!: MessageCreateParams;
    const fetchFn = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockImplementation((_url, init) => {
      capturedBody = JSON.parse(init!.body as string) as MessageCreateParams;
      return Promise.resolve(new Response(JSON.stringify(mkTextResp("ok")), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    });

    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: fetchFn,
      hooks: {
        onUserPrompt: () => ({
          parts: [{ type: "text", text: "for model" }],
          userDisplayText: "for transcript",
        }),
      },
    });

    await session.send([{ type: "text", text: "raw user text" }]);
    const content = capturedBody.messages[0].content;
    const text = typeof content === "string" ? content : (content[0] as { text: string }).text;
    expect(text).toBe("for model");
    expect(session.getState().messages[0].text).toBe("for transcript");
  });

  it("send() opts.userDisplayText hides the raw parts from the transcript with no hook needed (B-7)", async () => {
    let capturedBody!: MessageCreateParams;
    const fetchFn = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockImplementation((_url, init) => {
      capturedBody = JSON.parse(init!.body as string) as MessageCreateParams;
      return Promise.resolve(new Response(JSON.stringify(mkTextResp("ok")), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    });

    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: fetchFn,
    });

    await session.send(
      [{ type: "text", text: "[ui_action:button] View All Products" }],
      { userDisplayText: "View All Products" },
    );
    const content = capturedBody.messages[0].content;
    const text = typeof content === "string" ? content : (content[0] as { text: string }).text;
    expect(text).toBe("[ui_action:button] View All Products");
    expect(session.getState().messages[0].text).toBe("View All Products");
  });

  it("send() opts.userDisplayText survives a logging-only onUserPrompt hook that returns no opinion (B-7 live fail-first)", async () => {
    // cat-store registers onUserPrompt purely for console logging
    // (agent-panel-config.ts) and returns nothing. runHooks() then resolves
    // userDisplayText: undefined — that must not clobber the caller's opts.
    const fetchFn = mkAnthropicFetch([mkTextResp("ok")]);
    const loggedCalls: unknown[] = [];
    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: fetchFn,
      hooks: {
        onUserPrompt: (p) => {
          loggedCalls.push(p);
          // no return — observe-only, matches cat-store's real hook
        },
      },
    });

    await session.send(
      [{ type: "text", text: "[ui_action:button] View All Products" }],
      { userDisplayText: "View All Products" },
    );
    expect(loggedCalls).toHaveLength(1);
    expect(session.getState().messages[0].text).toBe("View All Products");
  });

  it("onUserPrompt meta is persisted and reaches SessionMessage", async () => {
    const fetchFn = mkAnthropicFetch([mkTextResp("ok")]);
    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: fetchFn,
      hooks: {
        onUserPrompt: () => ({ meta: { source: "custom_input" } }),
      },
    });

    await session.send([{ type: "text", text: "hi" }]);
    const userMsg = session.getState().messages[0];
    expect(userMsg.promptMeta).toEqual({ source: "custom_input" });
  });

  it("onTurnEnd fires once with end_turn on normal turn", async () => {
    const endSpy = vi.fn<[TurnEndPayload], void>();
    const fetchFn = mkAnthropicFetch([mkTextResp("model reply")]);
    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: fetchFn,
      hooks: { onTurnEnd: endSpy },
    });

    await session.send([{ type: "text", text: "hi" }]);
    expect(endSpy).toHaveBeenCalledTimes(1);
    expect(endSpy.mock.calls[0][0].stopReason).toBe("end_turn");
    expect(endSpy.mock.calls[0][0].result.assistantText).toBe("model reply");
  });

  it("onTurnEnd fires with error on a failed turn", async () => {
    const endSpy = vi.fn<[TurnEndPayload], void>();
    const fetchFn = vi.fn<Parameters<typeof globalThis.fetch>, ReturnType<typeof globalThis.fetch>>().mockImplementation(() => {
      return Promise.resolve(new Response(
        JSON.stringify({ type: "error", error: { type: "error", message: "terminal error" } }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      ));
    });
    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: fetchFn,
      hooks: { onTurnEnd: endSpy },
    });

    await session.send([{ type: "text", text: "hi" }]);
    expect(endSpy).toHaveBeenCalledTimes(1);
    expect(endSpy.mock.calls[0][0].stopReason).toBe("error");
  });

  it("an onPreTool handler is awaited to completion within the turn", async () => {
    function mkSeqFetch(seq: Array<Message>) {
      let idx = 0;
      return vi.fn<Parameters<typeof globalThis.fetch>, ReturnType<typeof globalThis.fetch>>().mockImplementation(() => {
        const body = seq[Math.min(idx, seq.length - 1)];
        idx++;
        return Promise.resolve(new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      });
    }

    let handlerCompleted = false;
    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: mkSeqFetch([mkToolResp("call-1", "list_data_sources"), mkTextResp("done")]),
      hooks: {
        onPreTool: async () => {
          await new Promise((r) => setTimeout(r, 50));
          handlerCompleted = true;
          return { decision: "allow" };
        },
      },
    });

    await session.send([{ type: "text", text: "hi" }]);
    expect(handlerCompleted).toBe(true);
  });

  it("a throwing handler does not break the turn", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchFn = mkAnthropicFetch([mkTextResp("ok")]);
    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: fetchFn,
      hooks: {
        onUserPrompt: () => { throw new Error("prompt hook error"); },
      },
    });

    await session.send([{ type: "text", text: "hi" }]);
    expect(session.getState().error).toBeUndefined();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("with no hooks the transcript and request body are unchanged", async () => {
    let capturedBody!: MessageCreateParams;
    const fetchFn = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockImplementation((_url, init) => {
      capturedBody = JSON.parse(init!.body as string) as MessageCreateParams;
      return Promise.resolve(new Response(JSON.stringify(mkTextResp("reply")), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    });

    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: fetchFn,
    });

    await session.send([{ type: "text", text: "plain message" }]);
    const content = capturedBody.messages[0].content;
    const text = typeof content === "string" ? content : (content[0] as { text: string }).text;
    expect(text).toBe("plain message");
    expect(session.getState().messages[0].text).toBe("plain message");
  });
});

describe("missing model", () => {
  it("throws at session start when no model is set", () => {
    expect(() => createAgentSession({ persist: false })).toThrow(/model/);
  });

  it("names the model key in the thrown message", () => {
    expect(() => createAgentSession({ persist: false })).toThrow(
      /Missing required config: "model"/,
    );
  });

  it("makes no network request before throwing", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    try {
      expect(() => createAgentSession({ persist: false })).toThrow(/model/);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not throw when the host sets a model", () => {
    const session = createAgentSession({ persist: false, model: "test-model" });
    expect(session.getState()).toBeDefined();
    expect(session.getState().error).toBeUndefined();
  });

  it("keeps the model across updateConfig", () => {
    const session = createAgentSession({ persist: false, model: "test-model" });
    expect(() => session.updateConfig({ maxIterations: 4 })).not.toThrow();
  });
});

describe("compaction UI signal (009)", () => {
  // summariseInCachedConversation's provider call forwards cfg.fetch, so the
  // session `fetch` config alone is enough for the compaction summarize call.
  // The global stub stays too, pointed at the same mock instance, so turns
  // and the compaction summarize call share one deterministic, index-based
  // response queue however each path resolves fetch.
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // A small context so 1-2 turns already breach the soft budget and become
  // eligible for compaction, matching compaction.test.ts's TEST_CFG shape.
  // A small context whose 1% soft budget lets the automatic pre-turn check
  // fire on the real low usage a committed turn produces (short text parts
  // estimate to a few dozen tokens), while kTurnsVerbatim=1 leaves an older
  // turn eligible. Used by the automatic-compaction tests.
  const AUTO_CONTEXT = {
    kTurnsVerbatim: 1,
    contextLength: 600,
    autoCompactPercent: 0.01,
    charsPerToken: 4,
    jsonOverhead: 1.15,
    compactionMaxTokens: 100,
  };

  // Like mkAnthropicFetch, but a call made after `hold()` stays pending until
  // `release()` resolves it — lets a test observe the "running" state before
  // the summarize call settles.
  function mkHoldableAnthropicFetch(seq: Message[]) {
    let idx = 0;
    let holdNext = false;
    const pendingResolvers: Array<(r: Response) => void> = [];
    const fn = vi.fn<Parameters<typeof globalThis.fetch>, ReturnType<typeof globalThis.fetch>>().mockImplementation(() => {
      if (holdNext) {
        return new Promise<Response>((resolve) => {
          pendingResolvers.push(resolve);
        });
      }
      const body = seq[idx] ?? seq[seq.length - 1];
      idx++;
      return Promise.resolve(new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    });
    return {
      fn,
      hold: () => {
        holdNext = true;
      },
      release: (body: Message) => {
        holdNext = false;
        const resolve = pendingResolvers.shift();
        if (resolve) {
          resolve(
            new Response(JSON.stringify(body), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          );
        }
      },
      // Same, for a call that must FAIL: the caller owns the status code and
      // body, which `release` cannot express (it always answers 200).
      releaseWith: (response: Response) => {
        holdNext = false;
        const resolve = pendingResolvers.shift();
        if (resolve) resolve(response);
      },
    };
  }

  function lastAssistant(state: ReturnType<ReturnType<typeof createAgentSession>["getState"]>) {
    return [...state.messages].reverse().find((m) => m.role === "assistant");
  }

  it("a manual compaction appends a compaction part with status running, then done", async () => {
    const mock = mkHoldableAnthropicFetch([
      mkTextResp("r1"),
      mkTextResp("r2"),
      mkTextResp("r3"),
      mkTextResp("r4"),
    ]);
    vi.stubGlobal("fetch", mock.fn);
    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: mock.fn,
    });

    for (let i = 1; i <= 4; i++) {
      await session.send([{ type: "text", text: `turn ${i}` }]);
    }

    mock.hold();
    const compactPromise = session.compact();
    await Promise.resolve();
    await Promise.resolve();

    const midState = session.getState();
    expect(midState.compacting).toBe(true);
    const midParts = lastAssistant(midState)?.parts ?? [];
    expect(midParts[midParts.length - 1]).toEqual({
      kind: "compaction",
      compaction: { status: "running" },
    });

    mock.release(mkTextResp("SUMMARY"));
    await compactPromise;

    const finalState = session.getState();
    expect(finalState.compacting).toBe(false);
    const finalParts = lastAssistant(finalState)?.parts ?? [];
    expect(finalParts[finalParts.length - 1]).toEqual({
      kind: "compaction",
      compaction: {
        status: "done",
        stats: {
          tokensBefore: expect.any(Number),
          tokensAfter: expect.any(Number),
          messagesBefore: expect.any(Number),
          messagesAfter: expect.any(Number),
          toolCallsRedacted: expect.any(Number),
          durationMs: expect.any(Number),
        },
      },
    });
  });

  it("an automatic compaction appends the same row with no user interaction", async () => {
    // Turn 3's pre-turn check sees turns 1+2 already above the 1% soft budget,
    // and turn 1 (outside the kTurnsVerbatim=1 window) is eligible, so the
    // compaction fires in the foreground before turn 3 generates.
    const fetchMock = mkAnthropicFetch([mkTextResp("r1"), mkTextResp("r2"), mkTextResp("SUMMARY"), mkTextResp("r3")]);
    vi.stubGlobal("fetch", fetchMock);
    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: fetchMock,
      context: AUTO_CONTEXT,
    });

    await session.send([{ type: "text", text: "first" }]);
    await session.send([{ type: "text", text: "second" }]);

    const compactingSeen: boolean[] = [];
    const unsubscribe = session.subscribe((s) => compactingSeen.push(s.compacting));

    // Turn 3 triggers compaction in the foreground before turn 3 generates.
    await session.send([{ type: "text", text: "third" }]);
    unsubscribe();

    expect(compactingSeen.some((c) => c === true)).toBe(true);

    const state = session.getState();
    expect(state.compacting).toBe(false);
    const parts = state.messages.flatMap((m) => m.parts ?? []);
    expect(parts.some((p) => p.kind === "compaction" && p.compaction?.status === "done")).toBe(true);
  });

  it("does not trigger compaction across >10 turns when usage stays below autoCompactPercent", async () => {
    // The full default context (128k window, 75% threshold) means 12 short
    // turns stay far below the budget — this is the exact regression the old
    // turn-count trigger would have failed (it compacted every 10 turns).
    const fetchMock = mkAnthropicFetch([mkTextResp("r" + Date.now() + "n")]);
    vi.stubGlobal("fetch", fetchMock);
    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: fetchMock,
    });

    const compactingSeen: boolean[] = [];
    const unsubscribe = session.subscribe((s) => compactingSeen.push(s.compacting));

    for (let i = 0; i < 12; i++) {
      await session.send([{ type: "text", text: `turn ${i}` }]);
    }
    unsubscribe();

    const state = session.getState();
    // 12 turns, no compaction row anywhere, no compacting state toggled.
    expect(compactingSeen.some((c) => c === true)).toBe(false);
    const parts = state.messages.flatMap((m) => m.parts ?? []);
    expect(parts.some((p) => p.kind === "compaction")).toBe(false);
    expect(state.contextWindow.used / state.contextWindow.total).toBeLessThan(0.75);
  });

  it("never schedules a compaction after commitTurn", async () => {
    const fetchMock = mkAnthropicFetch([mkTextResp("r1")]);
    vi.stubGlobal("fetch", fetchMock);
    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: fetchMock,
    });

    await session.send([{ type: "text", text: "one short turn" }]);

    // With a single turn in the default (large) context, nothing is above the
    // budget and nothing is eligible, so runCompaction must not have fired.
    const state = session.getState();
    expect(state.compacting).toBe(false);
    const parts = state.messages.flatMap((m) => m.parts ?? []);
    expect(parts.some((p) => p.kind === "compaction")).toBe(false);
  });

  it("a failed automatic compaction throws and aborts the user turn", async () => {
    // Two turns breach the 1% soft budget, so the third send's pre-turn
    // compaction fires in the foreground and fails with a 401. The turn must
    // end with an error and never generate assistant content.
    const okResponses = [mkTextResp("r1"), mkTextResp("r2")];
    let idx = 0;
    const fetchMock = vi.fn<Parameters<typeof globalThis.fetch>, ReturnType<typeof globalThis.fetch>>().mockImplementation(() => {
      if (idx < okResponses.length) {
        const body = okResponses[idx];
        idx++;
        return Promise.resolve(new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      }
      return Promise.resolve(new Response(
        JSON.stringify({ type: "error", error: { type: "error", message: "Compaction model unavailable" } }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      ));
    });
    vi.stubGlobal("fetch", fetchMock);
    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: fetchMock,
      context: AUTO_CONTEXT,
    });

    await session.send([{ type: "text", text: "first" }]);
    await session.send([{ type: "text", text: "second" }]);

    await session.send([{ type: "text", text: "third" }]);

    const state = session.getState();
    expect(state.error).toBeDefined();
    // The aborted third turn must not have appended an assistant message.
    const assistants = state.messages.filter((m) => m.role === "assistant");
    expect(assistants.length).toBe(2);
  });

  it("a manual compaction appends a tombstone to the journal and no visible message", async () => {
    const mock = mkAnthropicFetch([
      mkTextResp("r1"),
      mkTextResp("r2"),
      mkTextResp("r3"),
      mkTextResp("r4"),
      mkTextResp("SUMMARY"),
    ]);
    vi.stubGlobal("fetch", mock);
    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: mock,
    });

    for (let i = 1; i <= 4; i++) {
      await session.send([{ type: "text", text: `turn ${i}` }]);
    }

    const messagesBefore = session.getState().messages;
    await session.compact();

    const messagesAfter = session.getState().messages;
    // Assert message list is unchanged except for the appended compaction part on the last assistant message
    expect(messagesAfter.length).toBe(messagesBefore.length);
    for (let i = 0; i < messagesAfter.length - 1; i++) {
      expect(messagesAfter[i]).toEqual(messagesBefore[i]);
    }
    const lastAss = messagesAfter[messagesAfter.length - 1];
    expect(lastAss.role).toBe("assistant");
    const parts = lastAss.parts ?? [];
    expect(parts[parts.length - 1]).toEqual({
      kind: "compaction",
      compaction: {
        status: "done",
        stats: {
          tokensBefore: expect.any(Number),
          tokensAfter: expect.any(Number),
          messagesBefore: expect.any(Number),
          messagesAfter: expect.any(Number),
          toolCallsRedacted: expect.any(Number),
          durationMs: expect.any(Number),
        },
      },
    });
    // Assert no message has empty text where there was none before
    for (const msg of messagesAfter) {
      for (const p of msg.parts ?? []) {
        if (p.kind === "text") {
          expect(p.text.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("compaction row carries stats matching the token meter delta on completion", async () => {
    const mock = mkAnthropicFetch([
      mkTextResp("r1"),
      mkTextResp("r2"),
      mkTextResp("r3"),
      mkTextResp("r4"),
      mkTextResp("SUMMARY"),
    ]);
    vi.stubGlobal("fetch", mock);
    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: mock,
    });

    for (let i = 1; i <= 4; i++) {
      await session.send([{ type: "text", text: `turn ${i}` }]);
    }
    const tokensBeforeMeter = session.getState().contextWindow.used;

    await session.compact();

    const state = session.getState();
    const parts = lastAssistant(state)?.parts ?? [];
    const row = parts[parts.length - 1];
    expect(row?.kind).toBe("compaction");
    const stats = row?.compaction?.stats;
    expect(stats).toBeDefined();
    // Both numbers are the exact same reads the token meter itself uses
    // (cm.getUsage().tokens before and after the run) — the invariant that
    // tokensAfter < tokensBefore for a REAL run is covered directly against
    // ContextManager in compaction.test.ts; this mock's fixed per-response
    // usage.input_tokens (10, regardless of conversation size) makes that
    // comparison meaningless at the controller-integration level.
    expect(stats?.tokensBefore).toBe(tokensBeforeMeter);
    expect(stats?.tokensAfter).toBe(state.contextWindow.used);
    expect(stats?.messagesBefore).toBeGreaterThan(0);
    expect(stats?.messagesAfter).toBeLessThan(stats!.messagesBefore);
    expect(stats?.toolCallsRedacted).toBeGreaterThanOrEqual(0);
    expect(stats?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("a session rehydrated from the store with a tombstone in its journal renders the single-line fallback row (105/004 reload fix)", async () => {
    const metaStore: SessionMeta[] = [];
    const messagesStore: Record<string, TurnFlushRecord[]> = {};
    const mockSessionStore: SessionStore = {
      createSession(meta: SessionMeta) {
        metaStore.push(meta);
        return Promise.resolve();
      },
      appendRecords(sessionId: string, records: TurnFlushRecord[]) {
        if (!messagesStore[sessionId]) messagesStore[sessionId] = [];
        messagesStore[sessionId].push(...records);
        const idx = metaStore.findIndex((m) => m.id === sessionId);
        if (idx !== -1) metaStore[idx] = { ...metaStore[idx], lastSeq: messagesStore[sessionId].length };
        return Promise.resolve();
      },
      readRange(sessionId: string, range: SessionRecordRange): Promise<SessionRecordPage> {
        const all = messagesStore[sessionId] || [];
        const end = range.before ?? all.length;
        const start = Math.max(0, end - range.limit);
        return Promise.resolve({
          records: all.slice(start, end),
          cursor: start >= 1 ? start : undefined,
        });
      },
      truncateAfter(sessionId: string, seq: number) {
        messagesStore[sessionId] = (messagesStore[sessionId] || []).slice(0, seq);
        const idx = metaStore.findIndex((m) => m.id === sessionId);
        if (idx !== -1) metaStore[idx] = { ...metaStore[idx], lastSeq: seq };
        return Promise.resolve();
      },
      saveMeta(sessionId: string, meta: Partial<SessionMeta>) {
        const idx = metaStore.findIndex((m) => m.id === sessionId);
        if (idx !== -1) metaStore[idx] = { ...metaStore[idx], ...meta };
        return Promise.resolve();
      },
      loadAllMetadata() {
        return Promise.resolve(metaStore);
      },
      deleteByIds() { return Promise.resolve(); },
    };

    const mock = mkAnthropicFetch([
      mkTextResp("r1"),
      mkTextResp("r2"),
      mkTextResp("r3"),
      mkTextResp("r4"),
      mkTextResp("SUMMARY"),
    ]);
    const session1 = createAgentSession({
      persist: true,
      sessionStore: mockSessionStore,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: mock,
    });
    await session1.initPromise;
    for (let i = 1; i <= 4; i++) {
      await session1.send([{ type: "text", text: `turn ${i}` }]);
    }
    await session1.compact();

    // Simulate a page reload: a brand-new controller re-reads the same
    // persisted journal (tombstone included) via openOrCreateActiveSession.
    // compactionRows is in-memory only, so it carries no stats across the
    // reload — but the rehydrate path now repopulates one "done" row per
    // journal tombstone, so the transcript renders the single-line fallback
    // (105/004 review fix) rather than no row at all.
    const session2 = createAgentSession({
      persist: true,
      sessionStore: mockSessionStore,
      model: "test-model",
    });
    await session2.initPromise;

    expect(() => session2.getState()).not.toThrow();
    const state2 = session2.getState();
    const allParts = state2.messages.flatMap((m) => m.parts ?? []);
    const compactionParts = allParts.filter((p) => p.kind === "compaction");
    expect(compactionParts.length).toBe(1);
    // Well-formed and stats-free: the fallback row, not a fabricated detail row.
    expect(compactionParts[0].compaction?.status).toBe("done");
    expect(compactionParts[0].compaction?.stats).toBeUndefined();
  });

  it("switchSession repopulates the fallback compaction row when switching to a session with a persisted tombstone (105/004 review fix)", async () => {
    const metaStore: SessionMeta[] = [];
    const messagesStore: Record<string, TurnFlushRecord[]> = {};
    const mockSessionStore: SessionStore = {
      createSession(meta: SessionMeta) {
        metaStore.push(meta);
        messagesStore[meta.id] = [];
        return Promise.resolve();
      },
      appendRecords(sessionId: string, records: TurnFlushRecord[]) {
        if (!messagesStore[sessionId]) messagesStore[sessionId] = [];
        messagesStore[sessionId].push(...records);
        const idx = metaStore.findIndex((m) => m.id === sessionId);
        if (idx !== -1) metaStore[idx] = { ...metaStore[idx], lastSeq: messagesStore[sessionId].length };
        return Promise.resolve();
      },
      readRange(sessionId: string, range: SessionRecordRange): Promise<SessionRecordPage> {
        const all = messagesStore[sessionId] || [];
        const end = range.before ?? all.length;
        const start = Math.max(0, end - range.limit);
        return Promise.resolve({
          records: all.slice(start, end),
          cursor: start >= 1 ? start : undefined,
        });
      },
      truncateAfter(sessionId: string, seq: number) {
        messagesStore[sessionId] = (messagesStore[sessionId] || []).slice(0, seq);
        const idx = metaStore.findIndex((m) => m.id === sessionId);
        if (idx !== -1) metaStore[idx] = { ...metaStore[idx], lastSeq: seq };
        return Promise.resolve();
      },
      saveMeta(sessionId: string, meta: Partial<SessionMeta>) {
        const idx = metaStore.findIndex((m) => m.id === sessionId);
        if (idx !== -1) metaStore[idx] = { ...metaStore[idx], ...meta };
        return Promise.resolve();
      },
      loadAllMetadata() {
        return Promise.resolve([...metaStore]);
      },
      deleteByIds(ids: string[]) {
        for (const id of ids) {
          const idx = metaStore.findIndex((m) => m.id === id);
          if (idx !== -1) metaStore.splice(idx, 1);
          delete messagesStore[id];
        }
        return Promise.resolve();
      },
    };
    const fetchMock = mkAnthropicFetch([
      mkTextResp("r1"),
      mkTextResp("r2"),
      mkTextResp("r3"),
      mkTextResp("r4"),
      mkTextResp("SUMMARY"),
    ]);
    vi.stubGlobal("fetch", fetchMock);
    const session = createAgentSession({
      persist: true,
      sessionStore: mockSessionStore,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: fetchMock,
    });
    await session.initPromise;
    const compactedSessionId = session.getState().activeSessionId;

    for (let i = 1; i <= 4; i++) {
      await session.send([{ type: "text", text: `turn ${i}` }]);
    }
    await session.compact();
    expect(
      (lastAssistant(session.getState())?.parts ?? []).find((p) => p.kind === "compaction"),
    ).toBeDefined();

    // Switch away, then switch BACK — the real switchSession rehydrate path,
    // not a hand-built CompactionRow.
    await session.createSession();
    expect(
      session.getState().messages.some((m) => (m.parts ?? []).some((p) => p.kind === "compaction")),
    ).toBe(false);

    await session.switchSession(compactedSessionId);

    const afterSwitchBack = session.getState();
    expect(afterSwitchBack.activeSessionId).toBe(compactedSessionId);
    const compactionParts = afterSwitchBack.messages
      .flatMap((m) => m.parts ?? [])
      .filter((p) => p.kind === "compaction");
    expect(compactionParts.length).toBe(1);
    expect(compactionParts[0].compaction?.status).toBe("done");
    expect(compactionParts[0].compaction?.stats).toBeUndefined();
  });

  it("abort() during a compaction marks the row cancelled and leaves the context window unchanged", async () => {
    const mock = mkHoldableAnthropicFetch([
      mkTextResp("r1"),
      mkTextResp("r2"),
      mkTextResp("r3"),
      mkTextResp("r4"),
    ]);
    vi.stubGlobal("fetch", mock.fn);
    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: mock.fn,
    });

    for (let i = 1; i <= 4; i++) {
      await session.send([{ type: "text", text: `turn ${i}` }]);
    }
    const usedBefore = session.getState().contextWindow.used;

    mock.hold();
    const compactPromise = session.compact();
    await Promise.resolve();
    await Promise.resolve();

    session.abort();
    await compactPromise;

    const state = session.getState();
    const parts = lastAssistant(state)?.parts ?? [];
    expect(parts[parts.length - 1]).toEqual({ kind: "compaction", compaction: { status: "cancelled" } });
    expect(state.contextWindow.used).toBe(usedBefore);
  });

  it("a failed compaction marks the row failed", async () => {
    const okResponses = [mkTextResp("r1"), mkTextResp("r2"), mkTextResp("r3"), mkTextResp("r4")];
    let idx = 0;
    const fetchMock = vi.fn<Parameters<typeof globalThis.fetch>, ReturnType<typeof globalThis.fetch>>().mockImplementation(() => {
      if (idx < okResponses.length) {
        const body = okResponses[idx];
        idx++;
        return Promise.resolve(new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      }
      // 401 (not 404/429/5xx) so isRetryableError short-circuits and this
      // test observes the controller's own failed-row wiring, not the
      // transport's retry/backoff timing (covered separately in middleware.test.ts).
      return Promise.resolve(new Response(
        JSON.stringify({ type: "error", error: { type: "error", message: "Compaction model unavailable" } }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      ));
    });
    vi.stubGlobal("fetch", fetchMock);

    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: fetchMock,
    });

    for (let i = 1; i <= 4; i++) {
      await session.send([{ type: "text", text: `turn ${i}` }]);
    }
    await expect(session.compact()).rejects.toThrow();

    const state = session.getState();
    const parts = lastAssistant(state)?.parts ?? [];
    expect(parts[parts.length - 1]).toEqual({ kind: "compaction", compaction: { status: "failed" } });
  });

  it("controller.compact() surfaces failure to transcript and state.error, and rethrows", async () => {
    const okResponses = [mkTextResp("r1"), mkTextResp("r2"), mkTextResp("r3"), mkTextResp("r4")];
    let idx = 0;
    const fetchMock = vi.fn<Parameters<typeof globalThis.fetch>, ReturnType<typeof globalThis.fetch>>().mockImplementation(() => {
      if (idx < okResponses.length) {
        const body = okResponses[idx];
        idx++;
        return Promise.resolve(new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      }
      return Promise.resolve(new Response(
        JSON.stringify({ type: "error", error: { type: "error", message: "Compaction model unavailable" } }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      ));
    });
    vi.stubGlobal("fetch", fetchMock);

    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: fetchMock,
    });

    for (let i = 1; i <= 4; i++) {
      await session.send([{ type: "text", text: `turn ${i}` }]);
    }
    expect(session.getState().error).toBeUndefined();

    // 401 is mapped to a generic AgentError message (errors.ts:mapToAgentError)
    // rather than the raw response body text — same "Authentication error
    // (HTTP 401)" shape asserted for the retry path elsewhere in this suite.
    await expect(session.compact()).rejects.toThrow(/Authentication error \(HTTP 401\)/);

    const state = session.getState();
    expect(state.error).toMatch(/Authentication error \(HTTP 401\)/);
    const parts = lastAssistant(state)?.parts ?? [];
    expect(parts[parts.length - 1]).toEqual({ kind: "compaction", compaction: { status: "failed" } });
  });

  it("compact() is a no-op while a compaction is already running", async () => {
    const mock = mkHoldableAnthropicFetch([
      mkTextResp("r1"),
      mkTextResp("r2"),
      mkTextResp("r3"),
      mkTextResp("r4"),
    ]);
    vi.stubGlobal("fetch", mock.fn);
    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: mock.fn,
    });

    for (let i = 1; i <= 4; i++) {
      await session.send([{ type: "text", text: `turn ${i}` }]);
    }

    mock.hold();
    const first = session.compact();
    await Promise.resolve();
    const second = session.compact();
    await Promise.resolve();

    const midState = session.getState();
    const compactionParts = (lastAssistant(midState)?.parts ?? []).filter((p) => p.kind === "compaction");
    expect(compactionParts.length).toBe(1);

    mock.release(mkTextResp("SUMMARY"));
    await Promise.all([first, second]);
  });

  // 175317/001 — a message the user queues while a MANUAL compaction runs never
  // fired: compact()'s finally cleared `st.running` but, unlike driveTurn's
  // finally, never drained the queue, so nothing ever started it. compact() now
  // drains too, guarded on both the epoch (createSession bumps it) and the
  // active session id (switchSession changes only that).

  it("a message queued during a manual compaction fires as a turn once the compaction finishes", async () => {
    // The 5th element answers the DRAINED turn. The held compaction call is
    // answered by release() with an explicit body, so it consumes no slot.
    const mock = mkHoldableAnthropicFetch([
      mkTextResp("r1"),
      mkTextResp("r2"),
      mkTextResp("r3"),
      mkTextResp("r4"),
      mkTextResp("Cart has 3 items"),
    ]);
    vi.stubGlobal("fetch", mock.fn);
    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: mock.fn,
    });

    for (let i = 1; i <= 4; i++) {
      await session.send([{ type: "text", text: `turn ${i}` }]);
    }

    mock.hold();
    const compactPromise = session.compact();
    await Promise.resolve();
    await Promise.resolve();

    // Sent while `st.running`, so it queues instead of starting a turn.
    await session.send([{ type: "text", text: "What is in my cart?" }]);
    expect(session.getState().queuedMessages.map((q) => q.text)).toEqual(["What is in my cart?"]);

    mock.release(mkTextResp("SUMMARY"));
    await compactPromise;

    const state = session.getState();
    expect(state.queuedMessages).toHaveLength(0);
    expect(state.messages.find((m) => m.role === "user" && m.text === "What is in my cart?")).toBeDefined();
    expect(lastAssistant(state)?.text).toBe("Cart has 3 items");
  });

  it("two messages queued during a manual compaction both fire, in order", async () => {
    const mock = mkHoldableAnthropicFetch([
      mkTextResp("r1"),
      mkTextResp("r2"),
      mkTextResp("r3"),
      mkTextResp("r4"),
      mkTextResp("Cart has 3 items"),
    ]);
    vi.stubGlobal("fetch", mock.fn);
    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: mock.fn,
    });

    for (let i = 1; i <= 4; i++) {
      await session.send([{ type: "text", text: `turn ${i}` }]);
    }

    mock.hold();
    const compactPromise = session.compact();
    await Promise.resolve();
    await Promise.resolve();

    await session.send([{ type: "text", text: "msg-a" }]);
    await session.send([{ type: "text", text: "msg-b" }]);
    expect(session.getState().queuedMessages.map((q) => q.text)).toEqual(["msg-a", "msg-b"]);

    mock.release(mkTextResp("SUMMARY"));
    await compactPromise;

    const state = session.getState();
    expect(state.queuedMessages).toHaveLength(0);
    // maybeDrainQueue joins the text items up to the first command into ONE
    // turn, so both fire in the order they were queued.
    expect(state.messages.find((m) => m.role === "user" && m.text === "msg-a\nmsg-b")).toBeDefined();
    expect(lastAssistant(state)?.text).toBe("Cart has 3 items");
  });

  it("a message queued during a failed manual compaction stays queued and no turn starts", async () => {
    // A 401 is non-retryable, so runCompaction throws straight through and
    // compact()'s catch sets st.error — which is what stops the new drain.
    const mock = mkHoldableAnthropicFetch([
      mkTextResp("r1"),
      mkTextResp("r2"),
      mkTextResp("r3"),
      mkTextResp("r4"),
    ]);
    vi.stubGlobal("fetch", mock.fn);
    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: mock.fn,
    });

    for (let i = 1; i <= 4; i++) {
      await session.send([{ type: "text", text: `turn ${i}` }]);
    }

    mock.hold();
    const compactPromise = session.compact();
    await Promise.resolve();
    await Promise.resolve();

    await session.send([{ type: "text", text: "keep-me" }]);
    expect(session.getState().queuedMessages.map((q) => q.text)).toEqual(["keep-me"]);

    mock.releaseWith(
      new Response(
        JSON.stringify({ type: "error", error: { type: "error", message: "Compaction model unavailable" } }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      ),
    );
    await expect(compactPromise).rejects.toThrow();

    const state = session.getState();
    expect(state.queuedMessages.map((q) => q.text)).toEqual(["keep-me"]);
    expect(state.error).toBeDefined();
    // The 4 seeded turns plus the compaction's own row, and no 5th turn for
    // "keep-me".
    expect(state.messages.filter((m) => m.role === "assistant").length).toBe(4);
    expect(state.messages.some((m) => m.text === "keep-me")).toBe(false);
  });

  it("a message queued during a manual compaction, then a new session started, does not drain", async () => {
    const mock = mkHoldableAnthropicFetch([
      mkTextResp("r1"),
      mkTextResp("r2"),
      mkTextResp("r3"),
      mkTextResp("r4"),
      mkTextResp("should-not-fire"),
    ]);
    vi.stubGlobal("fetch", mock.fn);
    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: mock.fn,
    });

    for (let i = 1; i <= 4; i++) {
      await session.send([{ type: "text", text: `turn ${i}` }]);
    }

    mock.hold();
    const compactPromise = session.compact();
    await Promise.resolve();
    await Promise.resolve();

    await session.send([{ type: "text", text: "stale-msg" }]);
    expect(session.getState().queuedMessages.map((q) => q.text)).toEqual(["stale-msg"]);

    // createSession aborts the compaction, bumps sessionEpoch and clears the
    // queue. The stale finally then runs with a different epoch.
    await session.createSession();

    mock.release(mkTextResp("SUMMARY"));
    await compactPromise;

    const state = session.getState();
    expect(state.queuedMessages).toHaveLength(0);
    expect(state.messages.some((m) => m.text === "stale-msg")).toBe(false);
    expect(state.messages.some((m) => m.text === "should-not-fire")).toBe(false);
  });

  it("the epoch guard: a stale compaction does not drain a message queued in the new session", async () => {
    const mock = mkHoldableAnthropicFetch([
      mkTextResp("r1"),
      mkTextResp("r2"),
      mkTextResp("r3"),
      mkTextResp("r4"),
      mkTextResp("should-not-fire"),
    ]);
    vi.stubGlobal("fetch", mock.fn);
    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: mock.fn,
    });

    for (let i = 1; i <= 4; i++) {
      await session.send([{ type: "text", text: `turn ${i}` }]);
    }

    mock.hold();
    const compactPromise = session.compact();
    await Promise.resolve();
    await Promise.resolve();

    await session.send([{ type: "text", text: "stale-msg" }]);

    // Not awaited: createSession runs synchronously up to `await
    // refreshSessions`, so it aborts, bumps the epoch and clears the queue
    // before the next statement. The enqueue then lands in the NEW session's
    // queue while the stale compaction's finally is still only a pending
    // microtask away — the case the epoch guard exists for.
    const createPromise = session.createSession();
    session.enqueueCommand("new", "", "fresh-msg");
    await createPromise;
    await compactPromise;
    // Release the orphaned held summarize so it is not left pending.
    mock.release(mkTextResp("SUMMARY"));

    const state = session.getState();
    // Without the guard, maybeDrainQueue would have dequeued and RUN the "new"
    // command here, emptying the queue and spending the "should-not-fire" reply.
    expect(state.queuedMessages.map((q) => q.text)).toEqual(["fresh-msg"]);
    expect(state.messages.some((m) => m.text === "stale-msg")).toBe(false);
    expect(state.messages.some((m) => m.text === "should-not-fire")).toBe(false);
  });

  it("a stale compaction does not drain a message queued in a switched-to session", async () => {
    // A switch without storage starts an empty journal. Seed the turns after
    // switching back, then verify that a later switch stops the stale drain.
    const mock = mkHoldableAnthropicFetch([
      mkTextResp("r1"),
      mkTextResp("r2"),
      mkTextResp("r3"),
      mkTextResp("r4"),
      mkTextResp("should-not-fire"),
    ]);
    vi.stubGlobal("fetch", mock.fn);
    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: mock.fn,
    });

    const firstSessionId = session.getState().activeSessionId;
    await session.switchSession("session-b");
    await session.switchSession(firstSessionId);
    expect(session.getState().activeSessionId).toBe(firstSessionId);
    for (let i = 1; i <= 4; i++) {
      await session.send([{ type: "text", text: `turn ${i}` }]);
    }

    mock.hold();
    const compactPromise = session.compact();
    await Promise.resolve();
    await Promise.resolve();

    await session.send([{ type: "text", text: "stale-msg" }]);
    expect(session.getState().queuedMessages.map((q) => q.text)).toEqual(["stale-msg"]);

    // Not awaited: switchSession's body is synchronous up to `await
    // refreshSessions`, so the id changes and the queue clears inside this
    // tick, and the enqueue lands in the switched-to session before the stale
    // compaction's finally can run.
    const switchPromise = session.switchSession("session-b");
    session.enqueueCommand("new", "", "switched-msg");
    await switchPromise;
    await compactPromise;
    // Release the orphaned held summarize so it is not left pending.
    mock.release(mkTextResp("SUMMARY"));

    const state = session.getState();
    // Without the session transition guards, maybeDrainQueue would have dequeued
    // and RUN the "new" command, emptying the queue and spending the
    // "should-not-fire" reply.
    expect(state.queuedMessages.map((q) => q.text)).toEqual(["switched-msg"]);
    expect(state.messages.some((m) => m.text === "should-not-fire")).toBe(false);
    expect(state.activeSessionId).toBe("session-b");
  });

  it("switchSession clears compaction rows", async () => {
    const metaStore: SessionMeta[] = [];
    const messagesStore: Record<string, TurnFlushRecord[]> = {};
    const mockSessionStore: SessionStore = {
      createSession(meta: SessionMeta) {
        metaStore.push(meta);
        messagesStore[meta.id] = [];
        return Promise.resolve();
      },
      appendRecords(sessionId: string, records: TurnFlushRecord[]) {
        if (!messagesStore[sessionId]) messagesStore[sessionId] = [];
        messagesStore[sessionId].push(...records);
        const idx = metaStore.findIndex((m) => m.id === sessionId);
        if (idx !== -1) metaStore[idx] = { ...metaStore[idx], lastSeq: messagesStore[sessionId].length };
        return Promise.resolve();
      },
      readRange(sessionId: string, range: SessionRecordRange): Promise<SessionRecordPage> {
        const all = messagesStore[sessionId] || [];
        const end = range.before ?? all.length;
        const start = Math.max(0, end - range.limit);
        return Promise.resolve({
          records: all.slice(start, end),
          cursor: start >= 1 ? start : undefined,
        });
      },
      truncateAfter(sessionId: string, seq: number) {
        messagesStore[sessionId] = (messagesStore[sessionId] || []).slice(0, seq);
        const idx = metaStore.findIndex((m) => m.id === sessionId);
        if (idx !== -1) metaStore[idx] = { ...metaStore[idx], lastSeq: seq };
        return Promise.resolve();
      },
      saveMeta(sessionId: string, meta: Partial<SessionMeta>) {
        const idx = metaStore.findIndex((m) => m.id === sessionId);
        if (idx !== -1) metaStore[idx] = { ...metaStore[idx], ...meta };
        return Promise.resolve();
      },
      loadAllMetadata() {
        return Promise.resolve([...metaStore]);
      },
      deleteByIds(ids: string[]) {
        for (const id of ids) {
          const idx = metaStore.findIndex((m) => m.id === id);
          if (idx !== -1) metaStore.splice(idx, 1);
          delete messagesStore[id];
        }
        return Promise.resolve();
      },
    };
    const fetchMock = mkAnthropicFetch([
      mkTextResp("r1"),
      mkTextResp("r2"),
      mkTextResp("r3"),
      mkTextResp("r4"),
      mkTextResp("SUMMARY"),
    ]);
    vi.stubGlobal("fetch", fetchMock);
    const session = createAgentSession({
      persist: true,
      sessionStore: mockSessionStore,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: fetchMock,
    });
    // Auto-creates the initial session against an empty metaStore. Seed
    // "session-b" only AFTER init, so it doesn't get picked up as the
    // initial session instead (openOrCreateActiveSession loads the FIRST
    // metaStore entry when one already exists).
    await session.initPromise;
    metaStore.push({ id: "session-b", title: "", titleManual: false, createdAt: 0, updatedAt: 0, messageCount: 0 });
    messagesStore["session-b"] = [];

    for (let i = 1; i <= 4; i++) {
      await session.send([{ type: "text", text: `turn ${i}` }]);
    }
    await session.compact();

    const beforeRow = (lastAssistant(session.getState())?.parts ?? []).find((p) => p.kind === "compaction");
    expect(beforeRow).toBeDefined();

    await session.switchSession("session-b");

    const afterState = session.getState();
    expect(afterState.activeSessionId).toBe("session-b");
    expect(
      afterState.messages.some((m) => (m.parts ?? []).some((p) => p.kind === "compaction")),
    ).toBe(false);
  });

  describe("107/004: sweep before compaction check", () => {
    it("expires tool results before the compaction check, so a freed session does not compact", async () => {
      // Scenario 14: tool with ttl: 1. The mock reports a large input-token
      // count, so the pre-turn fast-path usage is above the threshold. The
      // sweep redacts the oldest result, resets the usage anchor, and the
      // recomputed (redacted) journal is below the threshold — so no
      // compaction fires.
      const largeResult = "X".repeat(5000);
      const bigUsageToolResp = (id: string): Message => ({
        id: "msg_x",
        type: "message",
        role: "assistant",
        content: [{ type: "tool_use", id, name: "big_tool", input: {} }],
        stop_reason: "tool_use",
        stop_sequence: null,
        model: "test",
        usage: { input_tokens: 5000, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      });
      const bigUsageTextResp = (text: string): Message => ({
        id: "msg_x",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text }],
        stop_reason: "end_turn",
        stop_sequence: null,
        model: "test",
        usage: { input_tokens: 5000, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      });
      const fetchMock = mkAnthropicFetch([
        bigUsageToolResp("call-1"),
        bigUsageTextResp("r1"),
        bigUsageToolResp("call-2"),
        bigUsageTextResp("r2"),
        bigUsageTextResp("r3"),
      ]);
      vi.stubGlobal("fetch", fetchMock);

      const hostTools: import("../tools/build-tools.js").CustomToolDef[] = [
        {
          name: "big_tool",
          description: "returns large content",
          inputSchema: z.object({}).strict(),
          ttl: 1,
          execute: () => Promise.resolve({ content: largeResult }),
        },
      ];

      const session = createAgentSession({
        persist: false,
        model: "test-model",
        endpointType: "anthropic",
        baseURL: "http://localhost:8080/api/anthropic/v1",
        fetch: fetchMock,
        tools: () => hostTools,
        context: {
          ...AUTO_CONTEXT,
          contextLength: 6000,
          autoCompactPercent: 0.75,
        },
      });

      // Turn 1: agent calls big_tool, gets large result
      await session.send([{ type: "text", text: "use big tool" }]);
      // Turn 2: another call, so there are 2 big results
      await session.send([{ type: "text", text: "use it again" }]);
      // Turn 3: sweep expires oldest result (ttl: 1 keeps newest 1)
      const compactingSeen: boolean[] = [];
      const unsubscribe = session.subscribe((s) => compactingSeen.push(s.compacting));
      await session.send([{ type: "text", text: "third turn" }]);
      unsubscribe();

      // Compaction must NOT have fired — the sweep freed the space
      expect(compactingSeen.some((c) => c === true)).toBe(false);
    });

    it("still compacts when the expiry sweep frees nothing", async () => {
      // Scenario 15: tool declares neither ttl nor uttl, sweep frees nothing,
      // compaction fires as usual. All mock responses report large input-token
      // counts so the pre-turn fast-path usage is above the threshold.
      const largeResult = "Y".repeat(5000);
      const bigUsageToolResp = (id: string): Message => ({
        id: "msg_x",
        type: "message",
        role: "assistant",
        content: [{ type: "tool_use", id, name: "big_tool", input: {} }],
        stop_reason: "tool_use",
        stop_sequence: null,
        model: "test",
        usage: { input_tokens: 5000, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      });
      const bigUsageTextResp = (text: string): Message => ({
        id: "msg_x",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text }],
        stop_reason: "end_turn",
        stop_sequence: null,
        model: "test",
        usage: { input_tokens: 5000, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      });
      const fetchMock = mkAnthropicFetch([
        bigUsageToolResp("call-1"),
        bigUsageTextResp("r1"),
        bigUsageToolResp("call-2"),
        bigUsageTextResp("r2"),
        bigUsageTextResp("SUMMARY"),
        bigUsageTextResp("r3"),
      ]);
      vi.stubGlobal("fetch", fetchMock);

      const hostTools: import("../tools/build-tools.js").CustomToolDef[] = [
        {
          name: "big_tool",
          description: "returns large content",
          inputSchema: z.object({}).strict(),
          // No ttl, no uttl — sweep frees nothing
          execute: () => Promise.resolve({ content: largeResult }),
        },
      ];

      const session = createAgentSession({
        persist: false,
        model: "test-model",
        endpointType: "anthropic",
        baseURL: "http://localhost:8080/api/anthropic/v1",
        fetch: fetchMock,
        tools: () => hostTools,
        context: {
          ...AUTO_CONTEXT,
          contextLength: 6000,
          autoCompactPercent: 0.75,
        },
      });

      // Two turns with large reported usage breach 75% of 6000
      await session.send([{ type: "text", text: "use big tool" }]);
      await session.send([{ type: "text", text: "use it again" }]);

      // Third turn: pre-turn check fires compaction
      const compactingSeen: boolean[] = [];
      const unsubscribe = session.subscribe((s) => compactingSeen.push(s.compacting));
      await session.send([{ type: "text", text: "third" }]);
      unsubscribe();

      expect(compactingSeen.some((c) => c === true)).toBe(true);
      const state = session.getState();
      expect(state.compacting).toBe(false);
      const parts = state.messages.flatMap((m) => m.parts ?? []);
      expect(parts.some((p) => p.kind === "compaction" && p.compaction?.status === "done")).toBe(true);
    });
  });

  describe("107/005: canCompact state field and memoization", () => {
    it("canCompact is false for turns 1-3 and flips to true upon 4th turn completion", async () => {
      const fetchMock = mkAnthropicFetch([
        mkTextResp("r1"),
        mkTextResp("r2"),
        mkTextResp("r3"),
        mkTextResp("r4"),
      ]);
      vi.stubGlobal("fetch", fetchMock);
      const session = createAgentSession({
        persist: false,
        model: "test-model",
        endpointType: "anthropic",
        baseURL: "http://localhost:8080/api/anthropic/v1",
        fetch: fetchMock,
      });

      expect(session.getState().canCompact).toBe(false);

      await session.send([{ type: "text", text: "turn 1" }]);
      expect(session.getState().canCompact).toBe(false);

      await session.send([{ type: "text", text: "turn 2" }]);
      expect(session.getState().canCompact).toBe(false);

      await session.send([{ type: "text", text: "turn 3" }]);
      expect(session.getState().canCompact).toBe(false);

      await session.send([{ type: "text", text: "turn 4" }]);
      expect(session.getState().canCompact).toBe(true);
    });

    it("canCompact is included in stateKey so subscribers receive the enabled flip with no other interaction", async () => {
      const fetchMock = mkAnthropicFetch([
        mkTextResp("r1"),
        mkTextResp("r2"),
        mkTextResp("r3"),
        mkTextResp("r4"),
      ]);
      vi.stubGlobal("fetch", fetchMock);
      const session = createAgentSession({
        persist: false,
        model: "test-model",
        endpointType: "anthropic",
        baseURL: "http://localhost:8080/api/anthropic/v1",
        fetch: fetchMock,
      });

      const seen: boolean[] = [];
      const unsubscribe = session.subscribe((s) => seen.push(s.canCompact));

      for (let i = 1; i <= 4; i++) {
        await session.send([{ type: "text", text: `turn ${i}` }]);
      }
      unsubscribe();

      expect(seen[seen.length - 1]).toBe(true);
      expect(seen.some((c) => c === true)).toBe(true);
    });

    it("canCompact flips back to false after compaction completes", async () => {
      const mock = mkHoldableAnthropicFetch([
        mkTextResp("r1"),
        mkTextResp("r2"),
        mkTextResp("r3"),
        mkTextResp("r4"),
      ]);
      vi.stubGlobal("fetch", mock.fn);
      const session = createAgentSession({
        persist: false,
        model: "test-model",
        endpointType: "anthropic",
        baseURL: "http://localhost:8080/api/anthropic/v1",
        fetch: mock.fn,
        context: AUTO_CONTEXT,
      });

      for (let i = 1; i <= 4; i++) {
        await session.send([{ type: "text", text: `turn ${i}` }]);
      }
      expect(session.getState().canCompact).toBe(true);

      mock.hold();
      const compactPromise = session.compact();
      await Promise.resolve();
      mock.release(mkTextResp("SUMMARY"));
      await compactPromise;

      expect(session.getState().canCompact).toBe(false);
    });

    it("session.compact() early-returns safely when canCompact is false", async () => {
      const fetchMock = mkAnthropicFetch([mkTextResp("r1"), mkTextResp("r2")]);
      vi.stubGlobal("fetch", fetchMock);
      const session = createAgentSession({
        persist: false,
        model: "test-model",
        endpointType: "anthropic",
        baseURL: "http://localhost:8080/api/anthropic/v1",
        fetch: fetchMock,
      });

      await session.send([{ type: "text", text: "turn 1" }]);
      await session.send([{ type: "text", text: "turn 2" }]);
      expect(session.getState().canCompact).toBe(false);

      await session.compact();

      const state = session.getState();
      expect(state.compacting).toBe(false);
      const parts = state.messages.flatMap((m) => m.parts ?? []);
      expect(parts.some((p) => p.kind === "compaction")).toBe(false);
    });
  });

  describe("complete model responses", () => {
    // A fetch whose calls settle only when the test says so.
    function deferredFetch() {
      const resolvers: Array<(r: Response) => void> = [];
      const rejecters: Array<(e: unknown) => void> = [];
      const bodies: MessageCreateParams[] = [];
      const fn = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockImplementation((_url, init) => {
        bodies.push(JSON.parse(init!.body as string) as MessageCreateParams);
        return new Promise<Response>((resolve, reject) => {
          resolvers.push(resolve);
          rejecters.push(reject);
        });
      });
      const respond = (idx: number, body: Message) =>
        resolvers[idx](new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      return { fn, bodies, respond, reject: (idx: number, e: unknown) => rejecters[idx](e) };
    }

    const base = {
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      persist: false,
      maxRetries: 0,
    };

    const assistantTexts = (s: SessionState) =>
      s.messages.filter((m) => m.role === "assistant").map((m) => m.text || "");

    it("a session shows no partial reply and sends stream: false", async () => {
      const d = deferredFetch();
      const session = createAgentSession({ ...base, fetch: d.fn });
      await session.initPromise;

      const observed: string[][] = [];
      session.subscribe((s) => observed.push(assistantTexts(s)));

      const sending = session.send([{ type: "text", text: "hi" }]);
      await vi.waitFor(() => expect(d.fn).toHaveBeenCalledTimes(1));
      expect(d.bodies[0].stream).toBe(false);
      expect(session.getState().running).toBe(true);
      expect(assistantTexts(session.getState()).every((t) => t === "")).toBe(true);

      d.respond(0, mkTextResp("The whole reply"));
      await sending;

      const final = session.getState();
      expect(final.running).toBe(false);
      expect(assistantTexts(final)).toEqual(["The whole reply"]);
      // Every notification shows either no text or the complete text.
      for (const texts of observed) {
        for (const t of texts) expect(["", "The whole reply"]).toContain(t);
      }
    });

    it("keeps prior messages unchanged while the next reply is pending", async () => {
      const d = deferredFetch();
      const session = createAgentSession({ ...base, fetch: d.fn });
      await session.initPromise;

      const first = session.send([{ type: "text", text: "turn 1" }]);
      await vi.waitFor(() => expect(d.fn).toHaveBeenCalledTimes(1));
      d.respond(0, mkTextResp("First reply"));
      await first;
      const prior = session.getState().messages.slice();

      const second = session.send([{ type: "text", text: "turn 2" }]);
      await vi.waitFor(() => expect(d.fn).toHaveBeenCalledTimes(2));
      const pending = session.getState().messages;
      expect(pending[0]).toBe(prior[0]);
      expect(pending[1]).toBe(prior[1]);
      expect(assistantTexts(session.getState()).filter((t) => t !== "")).toEqual(["First reply"]);

      d.respond(1, mkTextResp("Second reply"));
      await second;
      const texts = assistantTexts(session.getState());
      expect(texts).toEqual(["First reply", "Second reply"]);
    });

    it("running is true while the call is pending; a two-tool reply journals both steps and the final text", async () => {
      const seen: Array<Record<string, unknown>> = [];
      const mkTool = (name: string): CustomToolDef => ({
        name,
        description: name,
        inputSchema: z.object({ query: z.string() }).strict(),
        execute: (input) => {
          seen.push({ tool: name, ...input });
          return Promise.resolve(`${name} result` as unknown as ToolOutcome);
        },
      });
      const twoTools: Message = {
        ...mkToolResp("call_a", "tool_a", { query: "a" }),
        content: [
          { type: "tool_use", id: "call_a", name: "tool_a", input: { query: "a" } },
          { type: "tool_use", id: "call_b", name: "tool_b", input: { query: "b" } },
        ],
      };
      const d = deferredFetch();
      const session = createAgentSession({
        ...base, fetch: d.fn, tools: () => [mkTool("tool_a"), mkTool("tool_b")],
      });
      await session.initPromise;

      const runningFlags: boolean[] = [];
      const observed: string[][] = [];
      session.subscribe((s) => {
        runningFlags.push(s.running);
        observed.push(assistantTexts(s));
      });

      const sending = session.send([{ type: "text", text: "find" }]);
      await vi.waitFor(() => expect(d.fn).toHaveBeenCalledTimes(1));
      expect(session.getState().running).toBe(true);
      d.respond(0, twoTools);
      await vi.waitFor(() => expect(d.fn).toHaveBeenCalledTimes(2));
      d.respond(1, mkTextResp("All done"));
      await sending;

      expect(runningFlags).toContain(true);
      expect(session.getState().running).toBe(false);
      expect(seen).toEqual([{ tool: "tool_a", query: "a" }, { tool: "tool_b", query: "b" }]);
      expect(assistantTexts(session.getState())).toEqual(["All done"]);
      for (const texts of observed) {
        for (const t of texts) expect(["", "All done"]).toContain(t);
      }
    });

    it("cancelling a pending request leaves no assistant text and surfaces the abort", async () => {
      const d = deferredFetch();
      const session = createAgentSession({ ...base, fetch: d.fn });
      await session.initPromise;

      const sending = session.send([{ type: "text", text: "hi" }]);
      await vi.waitFor(() => expect(d.fn).toHaveBeenCalledTimes(1));
      session.abort();
      await sending;

      const state = session.getState();
      expect(state.running).toBe(false);
      expect(state.error).toBeDefined();
      expect(assistantTexts(state).every((t) => t === "")).toBe(true);
      expect(d.fn).toHaveBeenCalledTimes(1);
    });

    it("a rejected network call surfaces the error and leaves no assistant text", async () => {
      const d = deferredFetch();
      const session = createAgentSession({ ...base, fetch: d.fn });
      await session.initPromise;

      const sending = session.send([{ type: "text", text: "hi" }]);
      await vi.waitFor(() => expect(d.fn).toHaveBeenCalledTimes(1));
      d.reject(0, new TypeError("Failed to fetch"));
      await sending;

      const state = session.getState();
      expect(state.running).toBe(false);
      expect(state.error).toBeDefined();
      expect(assistantTexts(state).every((t) => t === "")).toBe(true);
    });
  });

  describe("State and message reference identity caching (Task 007)", () => {
    it("consecutive getState() calls return identical message and parts references", async () => {
      const fetchFn = mkAnthropicFetch([
        mkTextResp("answer 1"),
        mkTextResp("answer 2"),
      ]);
      const session = createAgentSession({
        model: "test-model",
        endpointType: "anthropic",
        baseURL: "http://localhost:8080/api/anthropic/v1",
        fetch: fetchFn,
      });
      await session.initPromise;

      await session.send([{ type: "text", text: "question 1" }]);
      await session.send([{ type: "text", text: "question 2" }]);

      const s1 = session.getState();
      const s2 = session.getState();

      expect(s1.messages).toBe(s2.messages);
      expect(s1.contextWindow).toBe(s2.contextWindow);
      expect(s1.messages.length).toBe(4);

      for (let i = 0; i < s1.messages.length; i++) {
        expect(s1.messages[i]).toBe(s2.messages[i]);
        if (s1.messages[i].parts) {
          expect(s1.messages[i].parts).toBe(s2.messages[i].parts);
        }
      }
    });

    it("the in-progress turn keeps earlier messages by reference across notifications", async () => {
      const probe: CustomToolDef = {
        name: "probe",
        description: "probe",
        inputSchema: z.object({}).strict(),
        execute: () => Promise.resolve("probed" as unknown as ToolOutcome),
      };
      setMockScript([
        { text: "First turn reply", finishReason: "stop", usage: { inputTokens: 10, outputTokens: 5 } },
        {
          content: [{ type: "tool_use", id: "call_1", name: "probe", input: {} }],
          finishReason: "tool-calls",
          usage: { inputTokens: 15, outputTokens: 8 },
        },
        { text: "Second turn reply", finishReason: "stop", usage: { inputTokens: 15, outputTokens: 8 } },
      ]);

      const session = createAgentSession({
        model: "mock-model",
        endpointType: "mock",
        persist: false,
        tools: () => [probe],
      });
      await session.initPromise;

      await session.send([{ type: "text", text: "turn 1" }]);

      const capturedStates: ReturnType<typeof session.getState>[] = [];
      session.subscribe((s) => {
        if (s.running && s.inProgressTurnId && s.messages.length === 4) {
          capturedStates.push(s);
        }
      });

      await session.send([{ type: "text", text: "turn 2" }]);

      expect(capturedStates.length).toBeGreaterThanOrEqual(1);

      for (let k = 0; k < capturedStates.length - 1; k++) {
        const curr = capturedStates[k];
        const next = capturedStates[k + 1];

        // Turn 1 user message preserved
        expect(curr.messages[0]).toBe(next.messages[0]);
        // Turn 1 assistant message and parts preserved
        expect(curr.messages[1]).toBe(next.messages[1]);
        expect(curr.messages[1].parts).toBe(next.messages[1].parts);

        // Turn 2 user message preserved
        expect(curr.messages[2]).toBe(next.messages[2]);
      }
      for (const st of capturedStates) {
        expect(st.messages[3]?.pending).toBe(true);
      }
      expect(session.getState().messages[3].text).toBe("Second turn reply");
    });
  });

  describe("slash commands (105/001)", () => {
    // A call resolves only when explicitly told to; lets a test queue items
    // mid-turn deterministically without a fixed real-time hold/release pair.
    function mkDeferredFetch() {
      const resolvers: Array<(r: Response) => void> = [];
      const fn = vi
        .fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
        .mockImplementation(() => new Promise<Response>((resolve) => { resolvers.push(resolve); }));
      async function resolveCall(idx: number, body: Message): Promise<void> {
        while (resolvers.length <= idx) {
          await new Promise((r) => setTimeout(r, 5));
        }
        resolvers[idx](new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }));
      }
      async function resolveCallWithError(idx: number, status: number, message: string): Promise<void> {
        while (resolvers.length <= idx) {
          await new Promise((r) => setTimeout(r, 5));
        }
        resolvers[idx](new Response(
          JSON.stringify({ type: "error", error: { type: "error", message } }),
          { status, headers: { "Content-Type": "application/json" } },
        ));
      }
      return { fn, resolveCall, resolveCallWithError };
    }

    // kTurnsVerbatim: 1 (instead of the default 3) makes the OLDEST of two
    // completed turns immediately compactable — keeps these tests to two
    // setup turns instead of four. (kTurnsVerbatim: 0 looks tempting but
    // `Array.slice(-0)` is `slice(0)`, i.e. the WHOLE array — it would keep
    // every turn verbatim and never become compactable at all.)
    const IMMEDIATE_COMPACT_CONTEXT = { ...DEFAULT_CONTEXT_CONFIG, kTurnsVerbatim: 1 };

    it("B2 — no host skills: session.commands() returns compact and new", async () => {
      const session = createAgentSession({
        model: "mock-model",
        endpointType: "mock",
        persist: false,
      });
      await session.initPromise;
      const commands = session.commands();
      const newEntry = commands.find((c) => c.name === "new")!;
      expect(newEntry.matchNames).toContain("clear");
    });

    it("scheduler commands are included in commands() when scheduler is enabled", async () => {
      const session = createAgentSession({
        model: "mock-model",
        endpointType: "mock",
        persist: false,
        scheduler: { enabled: true },
      });
      await session.initPromise;
      const names = session.commands().map((c) => c.name);
      expect(names).toContain("schedule");
      expect(names).toContain("schedule-list");
      expect(names).toContain("schedule-cancel");
      for (const name of ["schedule", "schedule-list", "schedule-cancel"]) {
        const entry = session.commands().find((c) => c.name === name)!;
        expect(entry.kind).toBe("skill");
      }
    });

    it("scheduler commands are absent when scheduler is disabled", async () => {
      const session = createAgentSession({
        model: "mock-model",
        endpointType: "mock",
        persist: false,
        scheduler: { enabled: false },
      });
      await session.initPromise;
      const names = session.commands().map((c) => c.name);
      expect(names).not.toContain("schedule");
      expect(names).not.toContain("schedule-list");
      expect(names).not.toContain("schedule-cancel");
    });

    it("scheduler commands are absent when scheduler is omitted", async () => {
      const session = createAgentSession({
        model: "mock-model",
        endpointType: "mock",
        persist: false,
      });
      await session.initPromise;
      const names = session.commands().map((c) => c.name);
      expect(names).not.toContain("schedule");
      expect(names).not.toContain("schedule-list");
      expect(names).not.toContain("schedule-cancel");
    });

    it("P5c — running /schedule sends the scheduler definition prompt", async () => {
      const fetchMock = mkAnthropicFetch([mkTextResp("ask")]);
      vi.stubGlobal("fetch", fetchMock);
      const session = createAgentSession({
        persist: false,
        model: "test-model",
        endpointType: "anthropic",
        baseURL: "http://localhost:8080/api/anthropic/v1",
        fetch: fetchMock,
        scheduler: { enabled: true },
      });
      await session.initPromise;

      const entry = session.resolveCommand("schedule")!;
      const result = await session.runCommand(entry, "");
      expect(result).toEqual({ ran: true, startedTurn: true });

      const userMsg = session.getState().messages.find((m) => m.role === "user")!;
      expect(userMsg.text).toBe("/schedule");
      const callBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string) as MessageCreateParams;
      const lastUserMsg = callBody.messages[callBody.messages.length - 1];
      const lastPart = lastUserMsg.content[lastUserMsg.content.length - 1] as { text: string };
      expect(lastPart.text).toContain("set_schedule");
    });

    it("updateConfig rebuilds the command list without recreating the session", async () => {
      const session = createAgentSession({
        model: "mock-model",
        endpointType: "mock",
        persist: false,
      });
      await session.initPromise;

      const skill: SkillDef = { name: "summary", description: "d", definition: "DEF", command: true };
      session.updateConfig({ skills: [skill] });
      await session.initPromise;

      const names = session.commands().map((c) => c.name);
      expect(names).toContain("summary");
      expect(names).toContain("compact");
    });

    it("P5a — runCommand on a skill entry sends the definition with no argument", async () => {
      const fetchMock = mkAnthropicFetch([mkTextResp("skill reply")]);
      vi.stubGlobal("fetch", fetchMock);
      const skill: SkillDef = { name: "summary", description: "d", definition: "DEFINITION", command: true };
      const session = createAgentSession({
        persist: false,
        model: "test-model",
        endpointType: "anthropic",
        baseURL: "http://localhost:8080/api/anthropic/v1",
        fetch: fetchMock,
        skills: [skill],
      });
      await session.initPromise;

      const entry = session.resolveCommand("summary")!;
      const result = await session.runCommand(entry, "");
      expect(result).toEqual({ ran: true, startedTurn: true });

      const userMsg = session.getState().messages.find((m) => m.role === "user")!;
      expect(userMsg.text).toBe("/summary");
      const assistantMsg = session.getState().messages.find((m) => m.role === "assistant")!;
      expect(assistantMsg.text).toBe("skill reply");
    });

    it("P5b — runCommand on a skill entry appends the argument after a blank line", async () => {
      const fetchMock = mkAnthropicFetch([mkTextResp("skill reply")]);
      vi.stubGlobal("fetch", fetchMock);
      const skill: SkillDef = { name: "summary", description: "d", definition: "DEFINITION", command: true };
      const session = createAgentSession({
        persist: false,
        model: "test-model",
        endpointType: "anthropic",
        baseURL: "http://localhost:8080/api/anthropic/v1",
        fetch: fetchMock,
        skills: [skill],
      });
      await session.initPromise;

      const entry = session.resolveCommand("summary")!;
      await session.runCommand(entry, "March");

      const userMsg = session.getState().messages.find((m) => m.role === "user")!;
      expect(userMsg.text).toBe("/summary March");
      const secondCallBody = JSON.parse(fetchMock.mock.calls[0][1]!.body as string) as MessageCreateParams;
      const lastUserMsg = secondCallBody.messages[secondCallBody.messages.length - 1];
      expect(lastUserMsg.content).toEqual([
        { type: "text", text: "DEFINITION\n\nMarch", cache_control: { type: "ephemeral" } },
      ]);
    });

    it("P5d — runCommand(compactEntry) in a fresh session returns ran:false", async () => {
      const fetchMock = mkAnthropicFetch([]);
      vi.stubGlobal("fetch", fetchMock);
      const session = createAgentSession({
        persist: false,
        model: "test-model",
        endpointType: "anthropic",
        baseURL: "http://localhost:8080/api/anthropic/v1",
        fetch: fetchMock,
      });
      await session.initPromise;

      const entry = session.resolveCommand("compact")!;
      const result = await session.runCommand(entry, "");
      expect(result).toEqual({ ran: false, startedTurn: false });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("P5c — runCommand(compactEntry, \"\") compacts and never calls send", async () => {
      const fetchMock = mkAnthropicFetch([mkTextResp("turn0"), mkTextResp("turn1"), mkTextResp("SUMMARY")]);
      vi.stubGlobal("fetch", fetchMock);
      const session = createAgentSession({
        persist: false,
        model: "test-model",
        endpointType: "anthropic",
        baseURL: "http://localhost:8080/api/anthropic/v1",
        fetch: fetchMock,
        context: IMMEDIATE_COMPACT_CONTEXT,
      });
      await session.send([{ type: "text", text: "turn0" }]);
      await session.send([{ type: "text", text: "turn1" }]);
      expect(session.getState().canCompact).toBe(true);

      const messagesBefore = session.getState().messages.length;
      const entry = session.resolveCommand("compact")!;
      const result = await session.runCommand(entry, "");

      expect(result).toEqual({ ran: true, startedTurn: false });
      // No new user/assistant message was appended by the command itself.
      expect(session.getState().messages.length).toBe(messagesBefore);
      const parts = session.getState().messages.flatMap((m) => m.parts ?? []);
      expect(parts.some((p) => p.kind === "compaction" && p.compaction?.status === "done")).toBe(true);
    });

    it("P5e — runCommand(compactEntry, argument) compacts then sends the argument", async () => {
      const fetchMock = mkAnthropicFetch([
        mkTextResp("turn0"),
        mkTextResp("turn1"),
        mkTextResp("SUMMARY"),
        mkTextResp("margins answer"),
      ]);
      vi.stubGlobal("fetch", fetchMock);
      const session = createAgentSession({
        persist: false,
        model: "test-model",
        endpointType: "anthropic",
        baseURL: "http://localhost:8080/api/anthropic/v1",
        fetch: fetchMock,
        context: IMMEDIATE_COMPACT_CONTEXT,
      });
      await session.send([{ type: "text", text: "turn0" }]);
      await session.send([{ type: "text", text: "turn1" }]);

      const entry = session.resolveCommand("compact")!;
      const result = await session.runCommand(entry, "now focus on the margins");
      expect(result).toEqual({ ran: true, startedTurn: true });

      const parts = session.getState().messages.flatMap((m) => m.parts ?? []);
      expect(parts.some((p) => p.kind === "compaction" && p.compaction?.status === "done")).toBe(true);
      const lastUser = [...session.getState().messages].reverse().find((m) => m.role === "user")!;
      expect(lastUser.text).toBe("/compact now focus on the margins");
      const lastAssistant = [...session.getState().messages].reverse().find((m) => m.role === "assistant")!;
      expect(lastAssistant.text).toBe("margins answer");
    });

    it("P5f — runCommand(newEntry, \"\") resets with no send", async () => {
      const fetchMock = mkAnthropicFetch([mkTextResp("first turn reply")]);
      vi.stubGlobal("fetch", fetchMock);
      const session = createAgentSession({
        persist: false,
        model: "test-model",
        endpointType: "anthropic",
        baseURL: "http://localhost:8080/api/anthropic/v1",
        fetch: fetchMock,
      });
      await session.send([{ type: "text", text: "turn 1" }]);
      expect(session.getState().messages.length).toBeGreaterThan(0);

      const entry = session.resolveCommand("new")!;
      const result = await session.runCommand(entry, "");
      expect(result).toEqual({ ran: true, startedTurn: false });
      expect(session.getState().messages.length).toBe(0);
    });

    it("P5g — runCommand(newEntry, argument) resets, then the bubble reads only the argument", async () => {
      const fetchMock = mkAnthropicFetch([mkTextResp("migration reply")]);
      vi.stubGlobal("fetch", fetchMock);
      const session = createAgentSession({
        persist: false,
        model: "test-model",
        endpointType: "anthropic",
        baseURL: "http://localhost:8080/api/anthropic/v1",
        fetch: fetchMock,
      });
      await session.initPromise;

      const entry = session.resolveCommand("new")!;
      const result = await session.runCommand(entry, "plan the migration");
      expect(result).toEqual({ ran: true, startedTurn: true });

      const userMsg = session.getState().messages.find((m) => m.role === "user")!;
      expect(userMsg.text).toBe("plan the migration");
    });

    it("Q1 — queue [text, command, text]: three separate things in order, no request contains /compact", async () => {
      const { fn, resolveCall } = mkDeferredFetch();
      const session = createAgentSession({
        persist: false,
        model: "test-model",
        endpointType: "anthropic",
        baseURL: "http://localhost:8080/api/anthropic/v1",
        fetch: fn,
        context: IMMEDIATE_COMPACT_CONTEXT,
      });
      await session.initPromise;

      const p0 = session.send([{ type: "text", text: "turn0" }]);
      await resolveCall(0, mkTextResp("turn0-reply"));
      await p0;

      const p1 = session.send([{ type: "text", text: "turn1" }]);
      await Promise.resolve();
      expect(session.getState().running).toBe(true);
      void session.send([{ type: "text", text: "a" }]);
      session.enqueueCommand("compact", "", "/compact");
      void session.send([{ type: "text", text: "b" }]);
      expect(session.getState().queuedMessages.map((q) => q.text)).toEqual(["a", "/compact", "b"]);

      await resolveCall(1, mkTextResp("turn1-reply"));
      await resolveCall(2, mkTextResp("a-reply"));
      await resolveCall(3, mkTextResp("SUMMARY"));
      await resolveCall(4, mkTextResp("b-reply"));
      await p1;

      expect(fn.mock.calls.length).toBe(5);
      for (const call of fn.mock.calls) {
        const bodyStr = call[1]!.body as string;
        expect(bodyStr).not.toContain("/compact");
      }
      const texts = session.getState().messages.map((m) => m.text);
      expect(texts).toContain("a-reply");
      expect(texts).toContain("b-reply");
      expect(session.getState().queuedMessages.length).toBe(0);
      const parts = session.getState().messages.flatMap((m) => m.parts ?? []);
      expect(parts.some((p) => p.kind === "compaction" && p.compaction?.status === "done")).toBe(true);
    });

    it("Q2 — a queued command whose entry no longer resolves is dropped, never sent as text", async () => {
      const { fn, resolveCall } = mkDeferredFetch();
      const session = createAgentSession({
        persist: false,
        model: "test-model",
        endpointType: "anthropic",
        baseURL: "http://localhost:8080/api/anthropic/v1",
        fetch: fn,
      });
      await session.initPromise;

      const p0 = session.send([{ type: "text", text: "turn0" }]);
      await Promise.resolve();
      session.enqueueCommand("ghost", "", "/ghost");
      expect(session.getState().queuedMessages).toHaveLength(1);

      await resolveCall(0, mkTextResp("turn0-reply"));
      await p0;

      expect(fn.mock.calls.length).toBe(1);
      expect(session.getState().queuedMessages).toHaveLength(0);
      const texts = session.getState().messages.map((m) => m.text ?? "");
      expect(texts.join(" ")).not.toContain("/ghost");
    });

    it("Q3 — a queued compact with nothing to compact recurses and stops, no infinite loop", async () => {
      const { fn, resolveCall } = mkDeferredFetch();
      const session = createAgentSession({
        persist: false,
        model: "test-model",
        endpointType: "anthropic",
        baseURL: "http://localhost:8080/api/anthropic/v1",
        fetch: fn,
      });
      await session.initPromise;

      const p0 = session.send([{ type: "text", text: "turn0" }]);
      await Promise.resolve();
      session.enqueueCommand("compact", "", "/compact");

      await resolveCall(0, mkTextResp("turn0-reply"));
      await p0;

      // Only the one turn0 call — the queued /compact found nothing to
      // compact (default kTurnsVerbatim=3, one completed turn), returned
      // ran:false, and the recursive drain found an empty queue and stopped.
      expect(fn.mock.calls.length).toBe(1);
      expect(session.getState().queuedMessages).toHaveLength(0);
      expect(session.getState().running).toBe(false);
    });

    it("Q5 — a queued /new discards the rest of the queue", async () => {
      const { fn, resolveCall } = mkDeferredFetch();
      const session = createAgentSession({
        persist: false,
        model: "test-model",
        endpointType: "anthropic",
        baseURL: "http://localhost:8080/api/anthropic/v1",
        fetch: fn,
      });
      await session.initPromise;

      const p0 = session.send([{ type: "text", text: "turn0" }]);
      await Promise.resolve();
      session.enqueueCommand("new", "", "/new");
      void session.send([{ type: "text", text: "b" }]);
      expect(session.getState().queuedMessages).toHaveLength(2);

      await resolveCall(0, mkTextResp("turn0-reply"));
      await p0;

      expect(fn.mock.calls.length).toBe(1);
      expect(session.getState().queuedMessages).toHaveLength(0);
      expect(session.getState().messages).toHaveLength(0);
    });

    it("T3 — compaction runs after onTurnEnd and before the queue drains", async () => {
      const { fn, resolveCall } = mkDeferredFetch();
      const markers: string[] = [];
      const session = createAgentSession({
        persist: false,
        model: "test-model",
        endpointType: "anthropic",
        baseURL: "http://localhost:8080/api/anthropic/v1",
        fetch: fn,
        context: IMMEDIATE_COMPACT_CONTEXT,
        hooks: { onTurnEnd: () => { markers.push("onTurnEnd"); } },
      });
      await session.initPromise;

      // Two filler turns — kTurnsVerbatim: 1 needs two ALREADY-COMPLETED turns
      // before anything is eligible. 108/001 moved the eligibility check
      // (cm.hasCompactableTurns()) from turn-end into the seam, which runs
      // mid-generate, BEFORE the trigger turn below is committed — so unlike
      // the pre-108/001 version of this test, the trigger turn itself can no
      // longer count toward eligibility. Two prior completed turns are needed,
      // matching the same two-turn setup the command-path tests (P5c/P5e) use.
      const pFiller1 = session.send([{ type: "text", text: "filler1" }]);
      await resolveCall(0, mkTextResp("filler1 reply"));
      await pFiller1;
      const pFiller2 = session.send([{ type: "text", text: "filler2" }]);
      await resolveCall(1, mkTextResp("filler2 reply"));
      await pFiller2;
      markers.length = 0;

      const p0 = session.send([{ type: "text", text: "trigger" }]);
      await Promise.resolve();
      void session.send([{ type: "text", text: "queued" }]);

      // Call 2: the model asks for compact_conversation. 108/001 — the call
      // MUST carry confirmation: true; an unconfirmed call is a question and
      // compacts nothing.
      await resolveCall(2, mkToolResp("call-1", "compact_conversation", { confirmation: true }));
      // Call 3: the tool result is sent back; the model ends the turn.
      await resolveCall(3, mkTextResp("turn complete"));
      // resolveCall(4) only resolves once call index 4 — the end-of-turn
      // compaction's own summarize request — has actually been dispatched.
      // That dispatch happens after the finally block's onTurnEnd hook, so
      // by the time this resolves, the hook has necessarily already run.
      await resolveCall(4, mkTextResp("SUMMARY"));
      expect(markers).toEqual(["onTurnEnd"]);
      // Call 5 — the drained "queued" text turn — exists only if the drain
      // ran after the compaction settled.
      await resolveCall(5, mkTextResp("queued reply"));
      await p0;

      expect(fn.mock.calls.length).toBe(6);
      const texts = session.getState().messages.map((m) => m.text);
      expect(texts).toContain("queued reply");
      const parts = session.getState().messages.flatMap((m) => m.parts ?? []);
      expect(parts.some((p) => p.kind === "compaction" && p.compaction?.status === "done")).toBe(true);
    });

    it("T4 — a failing end-of-turn compaction sets state.error and maybeDrainQueue is still reached", async () => {
      const { fn, resolveCall, resolveCallWithError } = mkDeferredFetch();
      const session = createAgentSession({
        persist: false,
        model: "test-model",
        endpointType: "anthropic",
        baseURL: "http://localhost:8080/api/anthropic/v1",
        fetch: fn,
        context: IMMEDIATE_COMPACT_CONTEXT,
      });
      await session.initPromise;

      // Two filler turns — see T3 for why two ALREADY-COMPLETED turns are
      // needed (108/001 moved the eligibility check before the trigger turn
      // commits).
      const pFiller1 = session.send([{ type: "text", text: "filler1" }]);
      await resolveCall(0, mkTextResp("filler1 reply"));
      await pFiller1;
      const pFiller2 = session.send([{ type: "text", text: "filler2" }]);
      await resolveCall(1, mkTextResp("filler2 reply"));
      await pFiller2;

      const p0 = session.send([{ type: "text", text: "trigger" }]);
      await Promise.resolve();
      void session.send([{ type: "text", text: "queued" }]);

      await resolveCall(2, mkToolResp("call-1", "compact_conversation", { confirmation: true }));
      await resolveCall(3, mkTextResp("turn complete"));
      // 401 is a non-retryable status (isRetryableError excludes 400/401/403)
      // — a retryable one would make the transport retry internally, and this
      // test would need to resolve each retry attempt too.
      await resolveCallWithError(4, 401, "summarize failed");
      await p0;

      expect(session.getState().error).toBeTruthy();
      const parts = session.getState().messages.flatMap((m) => m.parts ?? []);
      expect(parts.some((p) => p.kind === "compaction" && p.compaction?.status === "failed")).toBe(true);
      // maybeDrainQueue() is unconditionally called from the finally block —
      // it IS reached — but the finally passes no options, so its
      // `if (error !== undefined) { if (!opts?.clearStaleError) return; }`
      // guard (110/005 P1) still returns: a turn already in the failed state
      // never fires the queued item as a prompt. The queue survives
      // untouched rather than being silently dropped or sent, exactly as an
      // ordinary failed turn leaves a text-only queue (see "hold on failure"
      // above). Only a scheduler tick, which passes clearStaleError, may
      // clear the error and retry.
      expect(fn.mock.calls.length).toBe(5);
      expect(session.getState().queuedMessages.map((q) => q.text)).toEqual(["queued"]);
    });

    describe("110/005 — the queue recovers after an API error", () => {
      afterEach(() => {
        vi.useRealTimers();
      });

      it("a scheduler tick clears a stale error and drains the queue", async () => {
        // Real timers for setup — mkDeferredFetch's own poll loop uses a real
        // setTimeout, which would never fire under fake timers before the
        // first fetch call has actually happened.
        const { fn, resolveCall, resolveCallWithError } = mkDeferredFetch();
        let capturedCtx: ToolContext | undefined;
        const session = createAgentSession({
          persist: false,
          model: "test-model",
          endpointType: "anthropic",
          baseURL: "http://localhost:8080/api/anthropic/v1",
          fetch: fn,
          scheduler: { enabled: true },
          tools: (ctx) => {
            capturedCtx = ctx;
            return defaultTools(ctx);
          },
        });
        await session.initPromise;

        const p0 = session.send([{ type: "text", text: "trigger" }]);
        await resolveCallWithError(0, 401, "boom");
        await p0;
        expect(session.getState().error).toBeTruthy();

        // Fake timers only from here — advanceTimersByTimeAsync flushes the
        // microtasks in between, so the tick's own fetch call happens before
        // the call returns.
        vi.useFakeTimers();
        capturedCtx?._scheduler?.setSchedule({
          name: "ticker",
          every: "30s",
          repeat: 1,
          prompt: "tick",
        });

        const beforeCalls = fn.mock.calls.length;
        await vi.advanceTimersByTimeAsync(30000);
        expect(fn.mock.calls.length).toBe(beforeCalls + 1);
        await resolveCall(beforeCalls, mkTextResp("recovered"));

        expect(session.getState().error).toBeUndefined();
        expect(session.getState().queuedMessages).toEqual([]);
      });

      it("the error banner is already gone in the first state after the tick", async () => {
        const { fn, resolveCall, resolveCallWithError } = mkDeferredFetch();
        let capturedCtx: ToolContext | undefined;
        const session = createAgentSession({
          persist: false,
          model: "test-model",
          endpointType: "anthropic",
          baseURL: "http://localhost:8080/api/anthropic/v1",
          fetch: fn,
          scheduler: { enabled: true },
          tools: (ctx) => {
            capturedCtx = ctx;
            return defaultTools(ctx);
          },
        });
        await session.initPromise;

        const p0 = session.send([{ type: "text", text: "trigger" }]);
        await resolveCallWithError(0, 401, "boom");
        await p0;
        expect(session.getState().error).toBeTruthy();

        vi.useFakeTimers();
        capturedCtx?._scheduler?.setSchedule({
          name: "ticker",
          every: "30s",
          repeat: 1,
          prompt: "tick",
        });

        const beforeCalls = fn.mock.calls.length;
        await vi.advanceTimersByTimeAsync(30000);
        // The error clears the moment the retry begins draining — before the
        // retried request has even resolved, not just eventually.
        expect(session.getState().error).toBeUndefined();
        expect(fn.mock.calls.length).toBe(beforeCalls + 1);

        await resolveCall(beforeCalls, mkTextResp("recovered"));
      });

      it("a failed turn's own finally still does not drain", async () => {
        const { fn, resolveCall, resolveCallWithError } = mkDeferredFetch();
        const session = createAgentSession({
          persist: false,
          model: "test-model",
          endpointType: "anthropic",
          baseURL: "http://localhost:8080/api/anthropic/v1",
          fetch: fn,
        });
        await session.initPromise;

        const p0 = session.send([{ type: "text", text: "trigger" }]);
        await Promise.resolve();
        void session.send([{ type: "text", text: "queued" }]);
        await resolveCallWithError(0, 401, "boom");
        await p0;

        expect(session.getState().error).toBeTruthy();
        expect(session.getState().queuedMessages.map((q) => q.text)).toEqual(["queued"]);
        expect(fn.mock.calls.length).toBe(1);
        void resolveCall; // unused when the drain never fires a second call
      });

      it("a drain requested while a turn is running is a no-op", async () => {
        const { fn, resolveCall, resolveCallWithError } = mkDeferredFetch();
        let capturedCtx: ToolContext | undefined;
        const session = createAgentSession({
          persist: false,
          model: "test-model",
          endpointType: "anthropic",
          baseURL: "http://localhost:8080/api/anthropic/v1",
          fetch: fn,
          scheduler: { enabled: true },
          tools: (ctx) => {
            capturedCtx = ctx;
            return defaultTools(ctx);
          },
        });
        await session.initPromise;

        const p0 = session.send([{ type: "text", text: "trigger" }]);
        await resolveCallWithError(0, 401, "boom");
        await p0;
        expect(session.getState().error).toBeTruthy();

        // Start a second, still-running turn directly via a fresh send that we
        // never resolve — this is the "running" state the guard must respect.
        // Starting a turn resets `error` on its own (driveTurn's own,
        // pre-existing reset) — that happens regardless of this task's fix, so
        // capture the baseline AFTER the turn has started, not before.
        const pRunning = session.send([{ type: "text", text: "long-running" }]);
        await Promise.resolve();
        expect(session.getState().running).toBe(true);
        const errorBefore = session.getState().error;

        vi.useFakeTimers();
        capturedCtx?._scheduler?.setSchedule({
          name: "ticker",
          every: "30s",
          repeat: 1,
          prompt: "tick",
        });
        await vi.advanceTimersByTimeAsync(30000);

        // The tick's own item queued, but no second turn started and the
        // pre-existing error was not touched.
        expect(session.getState().queuedMessages.map((q) => q.text)).toEqual(["tick"]);
        expect(session.getState().error).toBe(errorBefore);
        expect(fn.mock.calls.length).toBe(2); // trigger + long-running only

        // Real timers again before letting the still-running turn resolve —
        // anything downstream that schedules with setTimeout must not be
        // left waiting on a fake clock nobody advances further.
        vi.useRealTimers();
        await resolveCall(1, mkTextResp("done"));
        // "long-running" finishing with no error drains the queue normally
        // (criterion 18) — its own finally awaits that drain, so pRunning
        // does not resolve until the tick's queued message is also answered.
        await resolveCall(2, mkTextResp("tick done"));
        await pRunning;
      });

      it("after recovery the queue is empty and the schedule keeps its interval", async () => {
        const { fn, resolveCall, resolveCallWithError } = mkDeferredFetch();
        let capturedCtx: ToolContext | undefined;
        const session = createAgentSession({
          persist: false,
          model: "test-model",
          endpointType: "anthropic",
          baseURL: "http://localhost:8080/api/anthropic/v1",
          fetch: fn,
          scheduler: { enabled: true },
          tools: (ctx) => {
            capturedCtx = ctx;
            return defaultTools(ctx);
          },
        });
        await session.initPromise;

        const p0 = session.send([{ type: "text", text: "trigger" }]);
        await resolveCallWithError(0, 401, "boom");
        await p0;

        vi.useFakeTimers();
        capturedCtx?._scheduler?.setSchedule({
          name: "ticker",
          every: "30s",
          repeat: 2,
          prompt: "tick",
        });

        let calls = fn.mock.calls.length;
        await vi.advanceTimersByTimeAsync(30000);
        await resolveCall(calls, mkTextResp("recovered"));
        expect(session.getState().error).toBeUndefined();
        expect(session.getState().queuedMessages).toEqual([]);

        calls = fn.mock.calls.length;
        await vi.advanceTimersByTimeAsync(30000);
        expect(fn.mock.calls.length).toBe(calls + 1);
        await resolveCall(calls, mkTextResp("second tick reply"));

        expect(session.getState().queuedMessages).toEqual([]);
        expect(session.pendingCounts()).toEqual({ schedules: 0, reminders: 0, total: 0 });
      });

      it("a user message queued during a running turn still drains at the end of that turn", async () => {
        const { fn, resolveCall } = mkDeferredFetch();
        const session = createAgentSession({
          persist: false,
          model: "test-model",
          endpointType: "anthropic",
          baseURL: "http://localhost:8080/api/anthropic/v1",
          fetch: fn,
        });
        await session.initPromise;

        const p0 = session.send([{ type: "text", text: "first" }]);
        await Promise.resolve();
        const p1 = session.send([{ type: "text", text: "second" }]);

        // p0 does not resolve until the drained "second" turn also completes
        // (its own finally awaits maybeDrainQueue()), so both fetch calls
        // must be resolved before either promise is awaited.
        await resolveCall(0, mkTextResp("first reply"));
        await resolveCall(1, mkTextResp("second reply"));
        await p0;
        await p1;

        const texts = session.getState().messages.map((m) => m.text);
        expect(texts).toContain("first reply");
        expect(texts).toContain("second reply");
        expect(session.getState().queuedMessages).toEqual([]);
      });
    });
  });
});

describe("scheduler integration", () => {
  it("pendingCounts delegates to scheduler and initializes at zero", async () => {
    const session = createAgentSession({
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: vi.fn(),
      scheduler: { enabled: true },
    });
    await session.initPromise;
    expect(session.pendingCounts()).toEqual({ schedules: 0, reminders: 0, total: 0 });
    session.dispose();
  });

  it("clears schedules on createSession, switchSession, and dispose", async () => {
    let capturedCtx: ToolContext | undefined;
    const customTools = (ctx: ToolContext) => {
      capturedCtx = ctx;
      return defaultTools(ctx);
    };

    const session = createAgentSession({
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: vi.fn(),
      scheduler: { enabled: true },
      tools: customTools,
    });
    await session.initPromise;
    expect(capturedCtx?._scheduler).toBeDefined();

    // Set a schedule
    capturedCtx?._scheduler?.setSchedule({
      name: "timer-1",
      every: "30s",
      repeat: 2,
      prompt: "ping",
    });
    expect(session.pendingCounts()).toEqual({ schedules: 1, reminders: 0, total: 1 });

    // createSession clears all schedules
    await session.createSession();
    expect(session.pendingCounts()).toEqual({ schedules: 0, reminders: 0, total: 0 });

    // Set again
    capturedCtx?._scheduler?.setSchedule({
      name: "timer-2",
      every: "30s",
      repeat: 2,
      prompt: "ping",
    });
    expect(session.pendingCounts()).toEqual({ schedules: 1, reminders: 0, total: 1 });

    // switchSession clears all schedules
    await session.switchSession("other-session-id");
    expect(session.pendingCounts()).toEqual({ schedules: 0, reminders: 0, total: 0 });

    // Set again
    capturedCtx?._scheduler?.setSchedule({
      name: "timer-3",
      every: "30s",
      repeat: 2,
      prompt: "ping",
    });
    expect(session.pendingCounts()).toEqual({ schedules: 1, reminders: 0, total: 1 });

    // dispose clears all schedules
    session.dispose();
    expect(session.pendingCounts()).toEqual({ schedules: 0, reminders: 0, total: 0 });
  });

  it("does not expose _scheduler when scheduler opt-in is absent or false", async () => {
    let capturedCtx: ToolContext | undefined;
    const session = createAgentSession({
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: vi.fn(),
      tools: (ctx) => {
        capturedCtx = ctx;
        return defaultTools(ctx);
      },
    });
    await session.initPromise;
    expect(capturedCtx?._scheduler).toBeUndefined();

    // The session offers no scheduler tools at all now (that is the point of
    // the gate), so build one from a context that HAS the seam and run it
    // against the session's context, which has none. That is the path the
    // SCHEDULER_DISABLED_MESSAGE guard still protects.
    const seamCtx = { ...capturedCtx!, _scheduler: { setSchedule: vi.fn(), listSchedules: vi.fn(), cancelSchedule: vi.fn() } };
    const [setTool] = schedulerTools(seamCtx);
    const res = await setTool.execute({ name: "t", every: "10s", repeat: 1, prompt: "hi" }, capturedCtx!);
    expect(res).toEqual({
      content: "Scheduling is turned off in this app.",
      isError: true,
    });

    const offered = defaultTools(capturedCtx!).map((d) => d.name);
    expect(offered).not.toContain("set_schedule");
    expect(offered).not.toContain("list_schedules");
    expect(offered).not.toContain("cancel_schedule");
    expect(offered).toContain("compact_conversation");
    session.dispose();
  });
});

describe("todo integration", () => {
  function mkMetaStore() {
    const metaStore: SessionMeta[] = [];
    const messagesStore: Record<string, TurnFlushRecord[]> = {};
    const store: SessionStore = {
      createSession(meta: SessionMeta) {
        metaStore.push(meta);
        return Promise.resolve();
      },
      appendRecords(sessionId: string, records: TurnFlushRecord[]) {
        if (!messagesStore[sessionId]) messagesStore[sessionId] = [];
        messagesStore[sessionId].push(...records);
        const idx = metaStore.findIndex((m) => m.id === sessionId);
        if (idx !== -1) metaStore[idx] = { ...metaStore[idx], lastSeq: messagesStore[sessionId].length };
        return Promise.resolve();
      },
      readRange(sessionId: string, range: SessionRecordRange): Promise<SessionRecordPage> {
        const all = messagesStore[sessionId] || [];
        const end = range.before ?? all.length;
        const start = Math.max(0, end - range.limit);
        return Promise.resolve({
          records: all.slice(start, end),
          cursor: start >= 1 ? start : undefined,
        });
      },
      truncateAfter(sessionId: string, seq: number) {
        messagesStore[sessionId] = (messagesStore[sessionId] || []).slice(0, seq);
        const idx = metaStore.findIndex((m) => m.id === sessionId);
        if (idx !== -1) metaStore[idx] = { ...metaStore[idx], lastSeq: seq };
        return Promise.resolve();
      },
      saveMeta(sessionId: string, meta: Partial<SessionMeta>) {
        const idx = metaStore.findIndex((m) => m.id === sessionId);
        if (idx !== -1) {
          metaStore[idx] = { ...metaStore[idx], ...meta };
        }
        return Promise.resolve();
      },
      loadAllMetadata() {
        return Promise.resolve(metaStore);
      },
      deleteByIds() {
        return Promise.resolve();
      },
    };
    return { store, metaStore };
  }

  it("todos() delegates to the todo store and starts empty", async () => {
    const session = createAgentSession({
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: vi.fn(),
      todo: { enabled: true },
    });
    await session.initPromise;
    expect(session.todos()).toEqual([]);
    session.dispose();
  });

  it("resets todos on createSession and restores them on switchSession", async () => {
    let capturedCtx: ToolContext | undefined;
    const session = createAgentSession({
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: vi.fn(),
      todo: { enabled: true },
      tools: (ctx) => {
        capturedCtx = ctx;
        return defaultTools(ctx);
      },
    });
    await session.initPromise;
    expect(capturedCtx?._todos).toBeDefined();

    capturedCtx?._todos?.write({ items: [{ text: "first plan" }] });
    expect(session.todos()).toEqual([{ id: "t1", text: "first plan", status: "pending" }]);

    await session.createSession();
    expect(session.todos()).toEqual([]);

    capturedCtx?._todos?.write({ items: [{ text: "second-session plan" }] });
    expect(session.todos()).toEqual([
      { id: expect.any(String), text: "second-session plan", status: "pending" },
    ]);

    await session.switchSession("other-session-id");
    expect(session.todos()).toEqual([]);

    session.dispose();
  });

  it("persists a write to the SessionStore via saveMeta", async () => {
    const { store, metaStore } = mkMetaStore();
    let capturedCtx: ToolContext | undefined;
    const session = createAgentSession({
      persist: true,
      sessionStore: store,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: vi.fn(),
      todo: { enabled: true },
      tools: (ctx) => {
        capturedCtx = ctx;
        return defaultTools(ctx);
      },
    });
    await session.initPromise;

    capturedCtx?._todos?.write({ items: [{ text: "buy oats" }] });

    const activeId = session.getState().activeSessionId;
    const savedMeta = metaStore.find((m) => m.id === activeId);
    expect(savedMeta?.todos).toEqual(session.todos());
    session.dispose();
  });

  it("restores the persisted list when a new session opens against the same store (reload)", async () => {
    const { store } = mkMetaStore();
    let capturedCtx: ToolContext | undefined;
    const first = createAgentSession({
      persist: true,
      sessionStore: store,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: vi.fn(),
      todo: { enabled: true },
      tools: (ctx) => {
        capturedCtx = ctx;
        return defaultTools(ctx);
      },
    });
    await first.initPromise;
    capturedCtx?._todos?.write({ items: [{ text: "survive reload", status: "in_progress" }] });
    const expected = first.todos();
    first.dispose();

    // Simulate a reload: a fresh controller against the SAME store.
    const second = createAgentSession({
      persist: true,
      sessionStore: store,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: vi.fn(),
      todo: { enabled: true },
    });
    await second.initPromise;
    expect(second.todos()).toEqual(expected);
    second.dispose();
  });

  it("loads a legacy session record with no todos field as an empty list, without error", async () => {
    const { store, metaStore } = mkMetaStore();
    const now = Date.now();
    metaStore.push({
      id: "legacy-session",
      title: "",
      titleManual: false,
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      // no `todos` field — the pre-existing shape.
    });

    const session = createAgentSession({
      persist: true,
      sessionStore: store,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: vi.fn(),
      todo: { enabled: true },
    });
    await session.initPromise;

    expect(session.todos()).toEqual([]);
    expect(metaStore.find((m) => m.id === "legacy-session")?.todos).toBeUndefined();
    session.dispose();
  });

  it("logs and does not throw when saveMeta rejects; the in-memory list is unaffected", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { store } = mkMetaStore();
    const failingStore: SessionStore = {
      ...store,
      saveMeta: () => Promise.reject(new Error("write failed")),
    };
    let capturedCtx: ToolContext | undefined;
    const session = createAgentSession({
      persist: true,
      sessionStore: failingStore,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: vi.fn(),
      todo: { enabled: true },
      tools: (ctx) => {
        capturedCtx = ctx;
        return defaultTools(ctx);
      },
    });
    await session.initPromise;

    const result = capturedCtx?._todos?.write({ items: [{ text: "buy oats" }] });
    expect(result?.isError).toBeUndefined();
    expect(session.todos()).toEqual([{ id: "t1", text: "buy oats", status: "pending" }]);

    // saveMeta rejects asynchronously — flush the microtask queue.
    await Promise.resolve();
    await Promise.resolve();
    expect(consoleError).toHaveBeenCalledWith("[todo] saveMeta failed:", expect.any(Error));

    consoleError.mockRestore();
    session.dispose();
  });

  it("keeps todo item text out of the outgoing request body until todo_read is called", async () => {
    let capturedCtx: ToolContext | undefined;
    const fetchMock = mkAnthropicFetch([mkTextResp("ok")]);
    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: fetchMock,
      todo: { enabled: true },
      tools: (ctx) => {
        capturedCtx = ctx;
        return defaultTools(ctx);
      },
    });
    await session.initPromise;

    capturedCtx?._todos?.write({
      items: [{ text: "a very distinctive uncalled-for todo string" }],
    });

    await session.send([{ type: "text", text: "hi" }]);

    const lastCall = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
    const requestBody = lastCall[1]!.body as string;
    expect(requestBody).not.toContain("a very distinctive uncalled-for todo string");
    session.dispose();
  });

  it("does not expose _todos when todo opt-in is absent or false", async () => {
    let capturedCtx: ToolContext | undefined;
    const session = createAgentSession({
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: vi.fn(),
      tools: (ctx) => {
        capturedCtx = ctx;
        return defaultTools(ctx);
      },
    });
    await session.initPromise;
    expect(capturedCtx?._todos).toBeUndefined();

    const offered = defaultTools(capturedCtx!).map((d) => d.name);
    expect(offered).not.toContain("todo_write");
    expect(offered).not.toContain("todo_read");
    session.dispose();
  });
});

describe("availableTools() (110/004)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("reports the built-in list right after construction, before any turn runs (069/001)", () => {
    // Seeded by initAgent() at session construction (controller-config.ts),
    // not just at turn start (controller-turn.ts) — this is what lets a
    // restored (page-reload) history line resolve a tool's own phrase
    // without a new turn.
    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: mkAnthropicFetch([mkTextResp("ok")]),
    });

    const names = session.availableTools().map((t) => t.name);
    expect(names).toContain("wait");
    expect(names).toContain("get_time");
    expect(names).toContain("compact_conversation");
    session.dispose();
  });

  it("reports the resolved list after one turn", async () => {
    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: mkAnthropicFetch([mkTextResp("ok")]),
    });

    await session.send([{ type: "text", text: "hi" }]);

    const tools = session.availableTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("wait");
    expect(names).toContain("get_time");
    expect(names).toContain("compact_conversation");
    expect(names.length).toBeGreaterThan(0);
    for (const t of tools) {
      expect(t.description.length).toBeGreaterThan(0);
    }
    session.dispose();
  });

  it("includes the scheduler tools when scheduling is enabled", async () => {
    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: mkAnthropicFetch([mkTextResp("ok")]),
      scheduler: { enabled: true },
    });

    await session.send([{ type: "text", text: "hi" }]);

    const names = session.availableTools().map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining(["set_schedule", "list_schedules", "cancel_schedule"])
    );
    session.dispose();
  });

  it("omits the scheduler tools when scheduling is not configured", async () => {
    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: mkAnthropicFetch([mkTextResp("ok")]),
    });

    await session.send([{ type: "text", text: "hi" }]);

    const names = session.availableTools().map((t) => t.name);
    expect(names).not.toContain("set_schedule");
    expect(names).not.toContain("list_schedules");
    expect(names).not.toContain("cancel_schedule");
    session.dispose();
  });

  it("includes the todo tools when todo is enabled", async () => {
    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: mkAnthropicFetch([mkTextResp("ok")]),
      todo: { enabled: true },
    });

    await session.send([{ type: "text", text: "hi" }]);

    const names = session.availableTools().map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["todo_write", "todo_read"]));
    session.dispose();
  });

  it("omits the todo tools when todo is not configured", async () => {
    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: mkAnthropicFetch([mkTextResp("ok")]),
    });

    await session.send([{ type: "text", text: "hi" }]);

    const names = session.availableTools().map((t) => t.name);
    expect(names).not.toContain("todo_write");
    expect(names).not.toContain("todo_read");
    session.dispose();
  });

  it("omits the todo tools when todo is explicitly disabled", async () => {
    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: mkAnthropicFetch([mkTextResp("ok")]),
      todo: { enabled: false },
    });

    await session.send([{ type: "text", text: "hi" }]);

    const names = session.availableTools().map((t) => t.name);
    expect(names).not.toContain("todo_write");
    expect(names).not.toContain("todo_read");
    session.dispose();
  });

  it("includes create_skill only when the registry can save", async () => {
    const writableSession = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: mkAnthropicFetch([mkTextResp("ok")]),
      skillRegistry: {
        list: () => Promise.resolve([]),
        get: () => Promise.resolve(undefined),
        save: () => Promise.resolve(),
      },
    });
    await writableSession.initPromise;
    await writableSession.send([{ type: "text", text: "hi" }]);
    expect(writableSession.availableTools().map((t) => t.name)).toContain("create_skill");
    writableSession.dispose();

    const readOnlySession = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: mkAnthropicFetch([mkTextResp("ok")]),
      skillRegistry: {
        list: () => Promise.resolve([]),
        get: () => Promise.resolve(undefined),
      },
    });
    await readOnlySession.initPromise;
    await readOnlySession.send([{ type: "text", text: "hi" }]);
    expect(readOnlySession.availableTools().map((t) => t.name)).not.toContain("create_skill");
    readOnlySession.dispose();
  });

  it("hands back a copy the caller cannot use to change the session", async () => {
    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      fetch: mkAnthropicFetch([mkTextResp("ok")]),
    });

    await session.send([{ type: "text", text: "hi" }]);

    const first = session.availableTools();
    const beforeLength = first.length;
    const beforeName = first[0].name;
    first.length = 0;

    const second = session.availableTools();
    expect(second.length).toBe(beforeLength);
    expect(second[0].name).toBe(beforeName);

    session.availableTools()[0].name = "hacked";
    expect(session.availableTools()[0].name).toBe(beforeName);
    session.dispose();
  });
});


// ---------------------------------------------------------------------------
// appContext.appInstructions reaches the wire
// ---------------------------------------------------------------------------
// Regression guard for a severed seam. `applyAgentBrand` (web-agent-browser)
// wrote `appContext.appInstructions`, and `buildSystemPromptParts` read
// `app.appInstructions` to render the `# App instructions` section — both ends
// had unit tests and both were green. But `initAgent()` rebuilt `ctx.app` as an
// explicit object literal that omitted the field, so the value was dropped
// between them and the section was never emitted. Nothing tested the seam, so a
// host's (or a brand's) per-agent prompt silently never reached the model.
//
// This asserts the relationship host config -> outbound system prompt, by
// reading what the provider was actually called with. It fails if the field is
// dropped anywhere along that path, wherever the break is introduced.
describe("appContext.appInstructions", () => {
  it("reaches the system prompt the provider is called with", async () => {
    const MARKER = "SEAM_MARKER_APP_INSTRUCTIONS";
    let seenSystem: string | undefined;

    setMockScript((opts) => {
      seenSystem ??= opts.systemPrompt ?? "";
      return { text: "ok" };
    });

    const session = createAgentSession({
      model: "mock-model",
      endpointType: "mock",
      persist: false,
      appContext: {
        appName: "Acme",
        appDescription: "An app.",
        appInstructions: `You are the Acme Assistant. ${MARKER}`,
      },
    });
    await session.initPromise;
    await session.send([{ type: "text", text: "hi" }]);

    expect(seenSystem, "provider was never called").toBeDefined();
    expect(seenSystem).toContain("# App instructions");
    expect(seenSystem).toContain(MARKER);

    session.dispose();
  });

  it("emits no App instructions section when the host sets none", async () => {
    let seenSystem: string | undefined;

    setMockScript((opts) => {
      seenSystem ??= opts.systemPrompt ?? "";
      return { text: "ok" };
    });

    const session = createAgentSession({
      model: "mock-model",
      endpointType: "mock",
      persist: false,
      appContext: { appName: "Acme", appDescription: "An app." },
    });
    await session.initPromise;
    await session.send([{ type: "text", text: "hi" }]);

    expect(seenSystem).toBeDefined();
    expect(seenSystem).not.toContain("# App instructions");

    session.dispose();
  });
});

describe("ToolContext.sessionId (069/001)", () => {
  it("equals the active chat's id, and tracks the id after createSession()", async () => {
    let capturedCtx: ToolContext | undefined;

    setMockScript(() => ({ text: "ok" }));

    const session = createAgentSession({
      model: "mock-model",
      endpointType: "mock",
      persist: false,
      tools: (ctx) => {
        capturedCtx = ctx;
        return [];
      },
    });
    await session.initPromise;
    await session.send([{ type: "text", text: "hi" }]);

    const firstId = session.getState().activeSessionId;
    expect(capturedCtx?.sessionId).toBe(firstId);

    await session.createSession();
    await session.send([{ type: "text", text: "hi again" }]);

    const secondId = session.getState().activeSessionId;
    expect(secondId).not.toBe(firstId);
    expect(capturedCtx?.sessionId).toBe(secondId);

    session.dispose();
  });
});

describe("default step limit (155400-001)", () => {
  it("a session with no maxIterations from the host stops a turn after 200 tool steps", async () => {
    let modelCalls = 0;
    let toolRuns = 0;
    const loopTool: CustomToolDef = {
      name: "loop_step",
      description: "Counts one step",
      inputSchema: z.object({}).strict(),
      execute: () => {
        toolRuns++;
        return Promise.resolve("ok" as unknown as ToolOutcome);
      },
    };
    setMockScript(() => {
      modelCalls++;
      return {
        content: [{ type: "tool_use", id: `call_${modelCalls}`, name: "loop_step", input: {} }],
        finishReason: "tool-calls",
        usage: { inputTokens: 10, outputTokens: 5 },
      };
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const session = createAgentSession({
      model: "mock-model",
      endpointType: "mock",
      persist: false,
      
      tools: () => [loopTool],
    });
    await session.initPromise;
    await session.send([{ type: "text", text: "loop" }]);
    expect(modelCalls).toBe(200);
    expect(toolRuns).toBe(200);
    expect(warn).toHaveBeenCalledWith("[web-agent] Turn ended: max_iterations exceeded (200 steps)");
    warn.mockRestore();
    session.dispose();
  }, 60_000);
});

describe("tool images persist (003)", () => {
  it("persists tool images to journal and restores on reload and session switch", async () => {
    const metaStore: SessionMeta[] = [];
    const messagesStore: Record<string, TurnFlushRecord[]> = {};
    const truncateAfterSpy = vi.fn((sessionId: string, seq: number) => {
      messagesStore[sessionId] = (messagesStore[sessionId] || []).slice(0, seq);
      const idx = metaStore.findIndex((m) => m.id === sessionId);
      if (idx !== -1) metaStore[idx] = { ...metaStore[idx], lastSeq: seq };
      return Promise.resolve();
    });
    const appendRecordsSpy = vi.fn((sessionId: string, records: TurnFlushRecord[]) => {
      if (!messagesStore[sessionId]) messagesStore[sessionId] = [];
      messagesStore[sessionId].push(...records);
      const idx = metaStore.findIndex((m) => m.id === sessionId);
      if (idx !== -1) metaStore[idx] = { ...metaStore[idx], lastSeq: messagesStore[sessionId].length };
      return Promise.resolve();
    });
    const mockSessionStore: SessionStore = {
      createSession(meta: SessionMeta) { metaStore.push(meta); return Promise.resolve(); },
      appendRecords: appendRecordsSpy,
      readRange(sessionId: string, range: SessionRecordRange): Promise<SessionRecordPage> {
        const all = messagesStore[sessionId] || [];
        const end = range.before ?? all.length;
        const start = Math.max(0, end - range.limit);
        return Promise.resolve({ records: all.slice(start, end), cursor: start >= 1 ? start : undefined });
      },
      truncateAfter: truncateAfterSpy,
      saveMeta(sessionId: string, meta: Partial<SessionMeta>) {
        const idx = metaStore.findIndex((m) => m.id === sessionId);
        if (idx !== -1) metaStore[idx] = { ...metaStore[idx], ...meta };
        return Promise.resolve();
      },
      loadAllMetadata() { return Promise.resolve(metaStore); },
      deleteByIds() { return Promise.resolve(); },
    };

    const imgA = { dataUrl: "data:image/png;base64,AAAA", mediaType: "image/png" };
    const imgTool: CustomToolDef = {
      name: "img_tool",
      description: "Returns an image",
      inputSchema: z.object({}),
      execute: () => Promise.resolve({
        content: "img done",
        images: [imgA],
      }),
    };

    const fetchFn = mkAnthropicFetch([mkToolResp("tu_1", "img_tool"), mkTextResp("saw it")]);

    const session = createAgentSession({
      persist: true,
      
      imageInput: true,
      endpointType: "anthropic",
      baseURL: "http://localhost:8080/api/anthropic/v1",
      model: "test-model",
      maxRetries: 0,
      fetch: fetchFn,
      sessionStore: mockSessionStore,
      tools: () => [imgTool],
    });


      await session.initPromise;
      await session.send([{ type: "text", text: "go" }]);

      const sessionId = session.getState().activeSessionId;

      // 1. The flushed journal entries contain exactly one entry with meta.toolImages, equal to { tu_1: [imgA] }
      const entries = messagesStore[sessionId].flatMap((r) => r.journalDelta);
      const withToolImages = entries.filter((e) => e.meta && e.meta.toolImages);
      expect(withToolImages).toHaveLength(1);
      expect(withToolImages[0].meta.toolImages).toEqual({ tu_1: [imgA] });

      // 2. For every record, JSON.stringify(record.audit) does not contain "data:image" and no audit entry has images
      for (const record of messagesStore[sessionId]) {
        expect(JSON.stringify(record.audit)).not.toContain("data:image");
        for (const a of record.audit) {
          expect("images" in a).toBe(false);
        }
      }

      // 3. The live state: the assistant message's tool part has audit.images toEqual [imgA]
      const liveAssistant = session.getState().messages.find((m) => m.role === "assistant");
      const liveToolPart = liveAssistant?.parts?.find((p) => p.kind === "tool");
      expect(liveToolPart?.kind === "tool" ? liveToolPart.audit?.images : undefined).toEqual([imgA]);

      // 4. Reload: const session2 = createAgentSession({ persist: true, sessionStore: mockSessionStore, model: "test-model" }); await session2.initPromise;
      const session2 = createAgentSession({
        persist: true,
        sessionStore: mockSessionStore,
        model: "test-model",
      });
      await session2.initPromise;
      const reloadAssistant = session2.getState().messages.find((m) => m.role === "assistant");
      const reloadToolPart = reloadAssistant?.parts?.find((p) => p.kind === "tool");
      expect(reloadToolPart?.kind === "tool" ? reloadToolPart.audit?.images : undefined).toEqual([imgA]);

      // 5. Switch: record const firstId = session2.getState().activeSessionId;, then createSession() and switchSession(firstId)
      const firstId = session2.getState().activeSessionId;
      await session2.createSession();
      await session2.switchSession(firstId);
      const switchAssistant = session2.getState().messages.find((m) => m.role === "assistant");
      const switchToolPart = switchAssistant?.parts?.find((p) => p.kind === "tool");
      expect(switchToolPart?.kind === "tool" ? switchToolPart.audit?.images : undefined).toEqual([imgA]);

      session.dispose();
      session2.dispose();
    });
  });

