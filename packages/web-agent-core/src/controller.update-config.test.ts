import { describe, it, expect, vi, afterEach } from "vitest";
import { createAgentSession } from "./controller.js";
import type { ToolProvider } from "./tools/tool-provider.js";
import type { CustomToolDef } from "./tools/build-tools.js";
import type { SkillRegistry } from "./skills/skill-registry.js";

interface RequestBody {
  model?: string;
  system?: string | { text?: string }[];
  tools?: { name: string }[];
  messages?: { role: string; content: unknown }[];
}

const textResp = (text: string) => ({
  id: "msg_x", type: "message", role: "assistant",
  content: [{ type: "text", text }],
  stop_reason: "end_turn", stop_sequence: null, model: "test-model",
  usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
});
const toolResp = (id: string, name: string, input: Record<string, unknown>) => ({
  id: "msg_x", type: "message", role: "assistant",
  content: [{ type: "tool_use", id, name, input }],
  stop_reason: "tool_use", stop_sequence: null, model: "test-model",
  usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
});
/** Returns bodies[0], bodies[1], … then repeats the last. */
function seqFetch(bodies: unknown[]) {
  let i = 0;
  return vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockImplementation(() => {
    const b = bodies[Math.min(i, bodies.length - 1)];
    i++;
    return Promise.resolve(new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } }));
  });
}
const bodyOf = (f: ReturnType<typeof seqFetch>, call: number) =>
  JSON.parse(f.mock.calls[call][1]!.body as string) as RequestBody;
const systemText = (b: RequestBody) =>
  typeof b.system === "string" ? b.system : (b.system ?? []).map((s) => s.text ?? "").join("\n");
const mkTool = (name: string, execute = vi.fn(() => Promise.resolve({ content: "ok" }))): CustomToolDef => ({
  name, description: `Tool ${name}`, inputSchema: { type: "object", properties: {} }, execute,
});
const baseConfig = (fetchFn: typeof fetch) => ({
  persist: false, model: "test-model", endpointType: "anthropic" as const,
  baseURL: "http://localhost:9999/v1", fetch: fetchFn,
});

describe("Controller — updateConfig applies live and keeps the conversation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the conversation across updateConfig({ appContext })", async () => {
    const f = seqFetch([textResp("ok"), textResp("Tofu")]);
    const session = createAgentSession(baseConfig(f));
    await session.initPromise;
    await session.send([{ type: "text", text: "My cat is named Tofu" }]);
    session.updateConfig({ appContext: { appName: "Changed App" } });
    expect(session.getState().messages.length).toBe(2);
    await session.send([{ type: "text", text: "What is my cat's name?" }]);
    expect(JSON.stringify(bodyOf(f, 1).messages)).toContain("My cat is named Tofu");
    expect(systemText(bodyOf(f, 1))).toContain("Changed App");
    expect(session.getState().messages.length).toBe(4);
  });

  it("updateConfig({ model }) uses the new model on the next turn and keeps the conversation", async () => {
    const f = seqFetch([textResp("ok"), textResp("reply2")]);
    const session = createAgentSession(baseConfig(f));
    await session.initPromise;
    await session.send([{ type: "text", text: "turn 1 text" }]);
    session.updateConfig({ model: "other-model" });
    await session.send([{ type: "text", text: "turn 2 text" }]);
    expect(bodyOf(f, 0).model).toBe("test-model");
    expect(bodyOf(f, 1).model).toBe("other-model");
    expect(JSON.stringify(bodyOf(f, 1).messages)).toContain("turn 1 text");
  });

  it("a new toolProviders array disposes the old providers and loads the new ones", async () => {
    const oldDispose = vi.fn();
    const oldProvider: ToolProvider = {
      name: "old", required: false,
      load: () => Promise.resolve([mkTool("old_tool")]),
      dispose: oldDispose,
    };
    const newExec = vi.fn(() => Promise.resolve({ content: "new ok" }));
    const newProvider: ToolProvider = {
      name: "new", required: false,
      load: () => Promise.resolve([mkTool("new_tool", newExec)]),
    };
    const f = seqFetch([toolResp("t1", "new_tool", {}), textResp("done")]);
    const session = createAgentSession({ ...baseConfig(f), toolProviders: [oldProvider] });
    await session.initPromise;
    expect(session.availableTools().map((t) => t.name)).toContain("old_tool");

    session.updateConfig({ toolProviders: [newProvider] });
    expect(oldDispose).toHaveBeenCalledTimes(1);
    expect(session.availableTools().map((t) => t.name)).not.toContain("old_tool");

    await vi.waitFor(() => expect(session.availableTools().map((t) => t.name)).toContain("new_tool"));
    await session.send([{ type: "text", text: "go" }]);
    expect(newExec).toHaveBeenCalledTimes(1);
    const body0Tools = bodyOf(f, 0).tools?.map((t) => t.name) ?? [];
    expect(body0Tools).toContain("new_tool");
    expect(body0Tools).not.toContain("old_tool");
  });

  it("the same toolProviders array does not reload", async () => {
    const load = vi.fn(() => Promise.resolve([mkTool("t1")]));
    const list: ToolProvider[] = [{ name: "p", required: false, load }];
    const session = createAgentSession({ ...baseConfig(seqFetch([textResp("ok")])), toolProviders: list });
    await session.initPromise;
    session.updateConfig({ toolProviders: list });
    session.updateConfig({ model: "m2" });
    await new Promise((r) => setTimeout(r, 0));
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("a startup load superseded by updateConfig is dropped and disposed", async () => {
    let releaseA!: (t: CustomToolDef[]) => void;
    const aLoad = new Promise<CustomToolDef[]>((r) => { releaseA = r; });
    const aDispose = vi.fn();
    const a: ToolProvider = { name: "a", required: false, load: () => aLoad, dispose: aDispose };
    const b: ToolProvider = { name: "b", required: false, load: () => Promise.resolve([mkTool("b_tool")]) };
    const session = createAgentSession({ ...baseConfig(seqFetch([textResp("ok")])), toolProviders: [a] });
    session.updateConfig({ toolProviders: [b] });
    await vi.waitFor(() => expect(session.availableTools().map((t) => t.name)).toContain("b_tool"));
    releaseA([mkTool("a_tool")]);
    await session.initPromise;
    expect(aDispose).toHaveBeenCalledTimes(1);
    expect(session.availableTools().map((t) => t.name)).toContain("b_tool");
    expect(session.availableTools().map((t) => t.name)).not.toContain("a_tool");
    expect(session.getState().error).toBeUndefined();
  });

  it("a required provider failing on reload sets state.error", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const session = createAgentSession(baseConfig(seqFetch([textResp("ok")])));
    await session.initPromise;
    session.updateConfig({
      toolProviders: [{ name: "broken", required: true, load: () => Promise.reject(new Error("boom")) }],
    });
    await vi.waitFor(() => expect(session.getState().error).toContain("broken"));
    expect(errSpy).toHaveBeenCalledWith("[tools] tool provider reload failed:", expect.anything());
  });

  it("a new skillRegistry lists its skills in the next turn", async () => {
    const registry: SkillRegistry = {
      list: () => Promise.resolve([{ name: "reg_skill", description: "From the new registry", definition: "Do it.", command: true }]),
      get: () => Promise.resolve(undefined),
    };
    const f = seqFetch([textResp("ok")]);
    const session = createAgentSession(baseConfig(f));
    await session.initPromise;
    session.updateConfig({ skillRegistry: registry });
    await vi.waitFor(() => expect(session.commands().map((c) => c.name)).toContain("reg_skill"));
    await session.send([{ type: "text", text: "hi" }]);
    expect(systemText(bodyOf(f, 0))).toContain("- reg_skill — From the new registry");
  });

  it("replacing the skillRegistry drops the old registry's skills", async () => {
    const regA: SkillRegistry = {
      list: () => Promise.resolve([{ name: "a_skill", description: "Skill A", definition: "Def A", command: true }]),
      get: () => Promise.resolve(undefined),
    };
    const regB: SkillRegistry = {
      list: () => Promise.resolve([{ name: "b_skill", description: "Skill B", definition: "Def B", command: true }]),
      get: () => Promise.resolve(undefined),
    };
    const session = createAgentSession({ ...baseConfig(seqFetch([textResp("ok")])), skillRegistry: regA });
    await session.initPromise;
    expect(session.commands().map((c) => c.name)).toContain("a_skill");
    session.updateConfig({ skillRegistry: regB });
    expect(session.commands().map((c) => c.name)).not.toContain("a_skill");
    await vi.waitFor(() => expect(session.commands().map((c) => c.name)).toContain("b_skill"));
  });

  it("updateConfig during a running turn does not orphan the turn", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const f = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>(async () => {
      await gate;
      return new Response(JSON.stringify(textResp("late reply")), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const session = createAgentSession(baseConfig(f));
    await session.initPromise;
    const sending = session.send([{ type: "text", text: "hi" }]);
    await vi.waitFor(() => expect(f).toHaveBeenCalled());
    session.updateConfig({ appContext: { appName: "Mid" } });
    release();
    await sending;
    const msgs = session.getState().messages;
    expect(msgs.length).toBe(2);
    const lastMsg = msgs[1];
    const text = lastMsg.text ?? (lastMsg.parts ?? []).filter((x) => x.kind === "text").map((x) => x.text).join("");
    expect(text).toBe("late reply");
  });
});
