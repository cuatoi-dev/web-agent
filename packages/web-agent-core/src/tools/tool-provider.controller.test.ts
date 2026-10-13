import { describe, it, expect, vi, afterEach } from "vitest";
import { createAgentSession } from "../controller.js";
import type { ToolProvider } from "./tool-provider.js";
import type { CustomToolDef } from "./build-tools.js";
import type { AttachmentProvider } from "../attachments/types.js";
import type { SessionMeta, SessionStore, SessionRecordRange, SessionRecordPage } from "../loop/session-store.js";
import type { TurnFlushRecord } from "../loop/session-lifecycle.js";
import type { PostToolPayload } from "../hooks/types.js";

interface AnthropicRequestBody {
  tools?: { name: string }[];
}

const endTurnResponse = (text = "done") =>
  new Response(
    JSON.stringify({
      id: "msg_x",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      stop_sequence: null,
      model: "test-model",
      usage: { input_tokens: 5, output_tokens: 3, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );

const toolUseResponse = (id: string, name: string) =>
  new Response(
    JSON.stringify({
      id: "msg_tool",
      type: "message",
      role: "assistant",
      content: [{ type: "tool_use", id, name, input: {} }],
      stop_reason: "tool_use",
      stop_sequence: null,
      model: "test-model",
      usage: { input_tokens: 5, output_tokens: 3, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );

const mkTool = (name: string): CustomToolDef => ({
  name,
  description: `Tool ${name}`,
  inputSchema: { type: "object", properties: {} },
  execute: () => Promise.resolve({ content: "ok" }),
});

describe("Controller — ToolProvider integration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("session with no toolProviders calls no load() and leaves state.error undefined", async () => {
    // A ToolProvider built but never passed to createAgentSession — proves
    // load() is never called when no toolProviders are configured.
    const loadMock = vi.fn(() => Promise.resolve([]));
    const session = createAgentSession({ persist: false, model: "test-model" });
    await session.initPromise;
    expect(loadMock).not.toHaveBeenCalled();
    expect(session.getState().error).toBeUndefined();
  });

  it("provider tools are available on turn 1", async () => {
    const provider: ToolProvider = {
      name: "prov",
      required: true,
      load: () => Promise.resolve([mkTool("prov_do_thing")]),
    };

    const fakeFetch = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "msg_x",
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "done" }],
          stop_reason: "end_turn",
          stop_sequence: null,
          model: "test-model",
          usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:9999/v1",
      fetch: fakeFetch,
      toolProviders: [provider],
    });
    await session.initPromise;

    await session.send([{ type: "text", text: "hi" }]);
    expect(fakeFetch).toHaveBeenCalled();
    const body = JSON.parse(fakeFetch.mock.calls[0][1]!.body as string) as AnthropicRequestBody;
    const toolNames = (body.tools ?? []).map((t) => t.name);
    expect(toolNames).toContain("prov_do_thing");
  });

  it("a required provider failure rejects initPromise and sets state.error", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const provider: ToolProvider = {
      name: "bad-prov",
      required: true,
      load: async () => {
        // `require-await`: dropping `async` would turn this into a
        // synchronous throw instead of a rejection — the whole point of
        // this test is exercising a REJECTING load().
        await Promise.resolve();
        throw new TypeError("boom");
      },
    };

    const session = createAgentSession({
      persist: false,
      model: "test-model",
      toolProviders: [provider],
    });

    await expect(session.initPromise).rejects.toThrow(/Required tool provider/);
    expect(session.getState().error).toBeDefined();
    expect(session.getState().error).toContain("bad-prov");
    expect(errorSpy).toHaveBeenCalled();
  });

  it("an optional provider failure leaves the session usable", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const provider: ToolProvider = {
      name: "opt-prov",
      required: false,
      load: async () => {
        // `require-await`: dropping `async` would turn this into a
        // synchronous throw instead of a rejection — the whole point of
        // this test is exercising a REJECTING load().
        await Promise.resolve();
        throw new TypeError("opt fail");
      },
    };

    const fakeFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "msg_x",
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "ok" }],
          stop_reason: "end_turn",
          stop_sequence: null,
          model: "test-model",
          usage: { input_tokens: 5, output_tokens: 3, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:9999/v1",
      fetch: fakeFetch,
      toolProviders: [provider],
    });

    await session.initPromise;
    expect(session.getState().error).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();

    await session.send([{ type: "text", text: "hi" }]);
    expect(fakeFetch).toHaveBeenCalled();
  });

  it("dispose() disposes loaded providers", async () => {
    const disposeFn = vi.fn(async () => {});
    const provider: ToolProvider = {
      name: "prov",
      required: true,
      load: () => Promise.resolve([mkTool("t1")]),
      dispose: disposeFn,
    };

    const session = createAgentSession({
      persist: false,
      model: "test-model",
      toolProviders: [provider],
    });
    await session.initPromise;

    session.dispose();
    await new Promise((r) => setTimeout(r, 0));

    expect(disposeFn).toHaveBeenCalledTimes(1);
  });

  it("getAttachmentProviders() merges a provider's attachmentProviders with config.attachmentProviders (006)", async () => {
    const fromProvider: AttachmentProvider = {
      id: "from-provider",
      label: "From provider",
      icon: "ads_click",
      pick: () => {},
      hasPending: () => false,
      onUserPrompt: () => undefined,
    };
    const fromConfig: AttachmentProvider = {
      id: "from-config",
      label: "From config",
      icon: "attach_file",
      pick: () => {},
      hasPending: () => false,
      onUserPrompt: () => undefined,
    };
    const provider: ToolProvider = {
      name: "with-attachments",
      required: true,
      load: () => Promise.resolve([mkTool("t1")]),
      attachmentProviders: [fromProvider],
    };

    const session = createAgentSession({
      persist: false,
      model: "test-model",
      toolProviders: [provider],
      attachmentProviders: [fromConfig],
    });
    await session.initPromise;

    const ids = session.getAttachmentProviders().map((p) => p.id);
    expect(ids).toEqual(["from-provider", "from-config"]);
  });

  it("a provider's attachmentProvider onUserPrompt is composed into hooks before turn 1 (006)", async () => {
    const onUserPrompt = vi.fn(() => undefined);
    const pickerLike: AttachmentProvider = {
      id: "picker",
      label: "Picker",
      icon: "ads_click",
      pick: () => {},
      hasPending: () => false,
      onUserPrompt,
    };
    const provider: ToolProvider = {
      name: "with-picker",
      required: true,
      load: () => Promise.resolve([]),
      attachmentProviders: [pickerLike],
    };

    const fakeFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "msg_x",
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "done" }],
          stop_reason: "end_turn",
          stop_sequence: null,
          model: "test-model",
          usage: { input_tokens: 5, output_tokens: 3, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:9999/v1",
      fetch: fakeFetch,
      toolProviders: [provider],
    });
    await session.initPromise;

    await session.send([{ type: "text", text: "hi" }]);
    expect(onUserPrompt).toHaveBeenCalled();
  });

  it("dispose() disposes a provider's attachmentProviders too (006)", async () => {
    const attachmentDispose = vi.fn();
    const provider: ToolProvider = {
      name: "with-attachments",
      required: true,
      load: () => Promise.resolve([mkTool("t1")]),
      attachmentProviders: [
        {
          id: "from-provider",
          label: "From provider",
          icon: "ads_click",
          pick: () => {},
          hasPending: () => false,
          onUserPrompt: () => undefined,
          dispose: attachmentDispose,
        },
      ],
    };

    const session = createAgentSession({
      persist: false,
      model: "test-model",
      toolProviders: [provider],
    });
    await session.initPromise;

    session.dispose();
    expect(attachmentDispose).toHaveBeenCalledTimes(1);
  });

  it("updateConfig() without a toolProviders change does not reload providers", async () => {
    const loadFn = vi.fn(() => Promise.resolve([mkTool("t1")]));
    const provider: ToolProvider = {
      name: "prov",
      required: true,
      load: loadFn,
    };

    const session = createAgentSession({
      persist: false,
      model: "test-model",
      toolProviders: [provider],
    });
    await session.initPromise;
    expect(loadFn).toHaveBeenCalledTimes(1);

    session.updateConfig({ model: "other-model" });
    expect(loadFn).toHaveBeenCalledTimes(1);
  });

  it("a provider tool's own phrase resolves through availableTools() after a reload, before any turn (069/001 rejection fix)", async () => {
    const phraseTool: CustomToolDef = {
      ...mkTool("vfs_write_file"),
      phrase: () => "Whiskers wrote the file",
    };
    const provider: ToolProvider = {
      name: "vfs",
      required: true,
      load: () => Promise.resolve([phraseTool]),
    };

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

    const fakeFetch = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "msg_x",
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "wrote it" }],
          stop_reason: "end_turn",
          stop_sequence: null,
          model: "test-model",
          usage: { input_tokens: 5, output_tokens: 3, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const session1 = createAgentSession({
      persist: true,
      sessionStore: mockSessionStore,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:9999/v1",
      fetch: fakeFetch,
      toolProviders: [provider],
    });
    await session1.initPromise;
    await session1.send([{ type: "text", text: "save it" }]);
    session1.dispose();

    // A page reload: a brand-new controller restoring the SAME store, with
    // the same host-supplied toolProviders. No send() runs on it — proving
    // availableTools() resolves the provider tool's own phrase before any
    // turn on this instance.
    const session2 = createAgentSession({
      persist: true,
      sessionStore: mockSessionStore,
      model: "test-model",
      toolProviders: [provider],
    });
    await session2.initPromise;

    const restoredTool = session2.availableTools().find((t) => t.name === "vfs_write_file");
    expect(restoredTool).toBeDefined();
    expect(restoredTool!.phrase?.({ input: {}, outcomeSummary: "ok" }, "Whiskers")).toBe(
      "Whiskers wrote the file",
    );
    session2.dispose();
  });

  // 002: a loaded provider's onPostTool runs before the host's, and the final
  // rewritten result is what the model receives on the next request.
  it("composes a provider onPostTool before the host onPostTool and sends the final result", async () => {
    const seen: PostToolPayload[] = [];
    const tool: CustomToolDef = {
      name: "prov_tool",
      description: "provides",
      inputSchema: { type: "object", properties: {} },
      execute: () => Promise.resolve({ content: "payload" }),
    };
    const providerHookCalls: PostToolPayload[] = [];
    const provider: ToolProvider = {
      name: "rewriter",
      required: true,
      load: () => Promise.resolve([tool]),
      hooks: {
        onPostTool: (p) => {
          providerHookCalls.push(p);
          return { outcome: { ...p.outcome, content: p.outcome.content + "|PROV" } };
        },
      },
    };

    const bodies: string[] = [];
    let call = 0;
    const fakeFetch = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockImplementation((_input, init) => {
      bodies.push(typeof init?.body === "string" ? init.body : "");
      call += 1;
      return Promise.resolve(call % 2 === 1 ? toolUseResponse("tu_1", "prov_tool") : endTurnResponse());
    });

    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:9999/v1",
      fetch: fakeFetch,
      toolProviders: [provider],
      hooks: {
        onPostTool: (p) => {
          seen.push(p);
          return { outcome: { ...p.outcome, content: p.outcome.content + "|HOST" } };
        },
      },
    });
    await session.initPromise;
    await session.send([{ type: "text", text: "go" }]);

    // The host handler ran once, saw the provider's rewrite and the call id.
    expect(providerHookCalls).toHaveLength(1);
    expect(seen).toHaveLength(1);
    expect(seen[0].toolCallId).toBe("tu_1");
    expect(seen[0].outcome.content).toBe("payload|PROV");
    // The tool result in the next model request is the fully rewritten text.
    expect(bodies[1]).toContain("payload|PROV|HOST");

    session.updateConfig({ model: "test-model" });
    await session.send([{ type: "text", text: "again" }]);
    expect(providerHookCalls).toHaveLength(2);
    expect(seen).toHaveLength(2);
    session.dispose();
  });

  it("a session with no post-tool handlers preserves the tool result", async () => {
    const tool: CustomToolDef = {
      name: "plain_tool",
      description: "plain",
      inputSchema: { type: "object", properties: {} },
      execute: () => Promise.resolve({ content: "untouched" }),
    };
    const provider: ToolProvider = { name: "plain", required: true, load: () => Promise.resolve([tool]) };

    const bodies: string[] = [];
    let call = 0;
    const fakeFetch = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockImplementation((_input, init) => {
      bodies.push(typeof init?.body === "string" ? init.body : "");
      call += 1;
      return Promise.resolve(call % 2 === 1 ? toolUseResponse("tu_2", "plain_tool") : endTurnResponse());
    });

    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:9999/v1",
      fetch: fakeFetch,
      toolProviders: [provider],
    });
    await session.initPromise;
    await session.send([{ type: "text", text: "go" }]);

    expect(bodies[1]).toContain("untouched");
    expect(bodies[1]).not.toContain("|PROV");
    session.dispose();
  });
});
