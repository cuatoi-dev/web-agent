import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createAgentSession } from "../controller.js";
import { coreSkills } from "./default-skills.js";
import { LocalStorageSkillRegistry, type SkillRegistry } from "./skill-registry.js";
import type { SkillDef } from "../tools/build-tools.js";
import { defaultTools } from "../tools/builders.js";
import type { ToolContext } from "../tools/build-tools.js";

interface AnthropicRequestBody {
  system?: string | { text?: string }[];
}

function getSystemText(body: AnthropicRequestBody): string {
  if (typeof body.system === "string") return body.system;
  if (Array.isArray(body.system)) {
    return body.system.map((b) => b.text || "").join("\n");
  }
  return "";
}

function makeAnthropicResponse(text = "done") {
  return new Response(
    JSON.stringify({
      id: "msg_test",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      stop_sequence: null,
      model: "test-model",
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function makeToolUseResponse(id: string, name: string, input: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({
      id: "msg_test",
      type: "message",
      role: "assistant",
      content: [{ type: "tool_use", id, name, input }],
      stop_reason: "tool_use",
      stop_sequence: null,
      model: "test-model",
      usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

/** Sequenced fetch stub: returns responses[0], responses[1], … in order, then
 *  repeats the last one for any extra call. */
function sequencedFetch(responses: Response[]) {
  let idx = 0;
  return vi.fn().mockImplementation(async () => {
    // `require-await`: no internal await, but r.clone() can throw (a
    // fully-consumed body), so dropping `async` would turn that into a
    // synchronous throw instead of a rejection.
    await Promise.resolve();
    const r = responses[Math.min(idx, responses.length - 1)];
    idx++;
    // Response bodies are single-use — clone so each call gets a fresh stream.
    return r.clone();
  });
}

describe("Controller — SkillRegistry integration", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registry skills are in the # Skills prompt section on turn 1", async () => {
    const fakeFetch = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(makeAnthropicResponse());
    const registry: SkillRegistry = {
      list: () => Promise.resolve([
        {
          name: "storage_only_skill",
          description: "Stored in the browser",
          definition: "Step 1: Do stored thing",
        },
      ]),
      get: (name: string) =>
        Promise.resolve(name === "storage_only_skill"
          ? {
              name: "storage_only_skill",
              description: "Stored in the browser",
              definition: "Step 1: Do stored thing",
            }
          : undefined),
    };

    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:9999/v1",
      fetch: fakeFetch,
      skillRegistry: registry,
    });
    await session.initPromise;

    await session.send([{ type: "text", text: "hi" }]);
    expect(fakeFetch).toHaveBeenCalled();
    const body = JSON.parse(fakeFetch.mock.calls[0][1]!.body as string) as AnthropicRequestBody;
    const systemText = getSystemText(body);
    expect(systemText).toContain("- storage_only_skill — Stored in the browser");
  });

  it("registry skills are in ctx.skills, so search_skills matches them", async () => {
    const fakeFetch = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(makeAnthropicResponse());
    const registry: SkillRegistry = {
      list: () => Promise.resolve([
        {
          name: "storage_only_skill",
          description: "Stored in the browser",
          definition: "Step 1: Do stored thing",
        },
      ]),
      get: (name: string) =>
        Promise.resolve(name === "storage_only_skill"
          ? {
              name: "storage_only_skill",
              description: "Stored in the browser",
              definition: "Step 1: Do stored thing",
            }
          : undefined),
    };

    let capturedCtx: ToolContext | undefined;
    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:9999/v1",
      fetch: fakeFetch,
      skillRegistry: registry,
      tools: (ctx) => {
        capturedCtx = ctx;
        return defaultTools(ctx);
      },
    });
    await session.initPromise;

    await session.send([{ type: "text", text: "hi" }]);
    const tools = defaultTools(capturedCtx!);
    const searchTool = tools.find((t) => t.name === "search_skills")!;
    const loadTool = tools.find((t) => t.name === "load_skill")!;

    const searchRes = await searchTool.execute({ query: "storage_only" }, capturedCtx!);
    expect(searchRes.content).toContain("storage_only_skill — Stored in the browser");

    const loadRes = await loadTool.execute({ name: "storage_only_skill" }, capturedCtx!);
    expect(loadRes.content).toBe("Step 1: Do stored thing");
  });

  it("a registry skill with a clashing name replaces the config.skills entry", async () => {
    const fakeFetch = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(makeAnthropicResponse());
    const hostSkill: SkillDef = {
      name: "dup",
      description: "Host description",
      definition: "HOST",
    };
    const registrySkill: SkillDef = {
      name: "dup",
      description: "Registry description",
      definition: "REGISTRY",
    };
    const registry: SkillRegistry = {
      list: () => Promise.resolve([registrySkill]),
      get: (name) => Promise.resolve(name === "dup" ? registrySkill : undefined),
    };

    let capturedCtx: ToolContext | undefined;
    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:9999/v1",
      fetch: fakeFetch,
      skills: [hostSkill],
      skillRegistry: registry,
      tools: (ctx) => {
        capturedCtx = ctx;
        return defaultTools(ctx);
      },
    });
    await session.initPromise;

    await session.send([{ type: "text", text: "hi" }]);
    const body = JSON.parse(fakeFetch.mock.calls[0][1]!.body as string) as AnthropicRequestBody;
    const systemText = getSystemText(body);

    const dupLines = systemText
      .split("\n")
      .filter((line) => line.startsWith("- dup —"));
    expect(dupLines).toHaveLength(1);
    expect(dupLines[0]).toBe("- dup — Registry description");

    const tools = defaultTools(capturedCtx!);
    const loadTool = tools.find((t) => t.name === "load_skill")!;
    const loadRes = await loadTool.execute({ name: "dup" }, capturedCtx!);
    expect(loadRes.content).toBe("REGISTRY");
  });

  it("no skillRegistry leaves the skill list exactly as configured", async () => {
    const fakeFetch = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(makeAnthropicResponse());
    const customSkills: SkillDef[] = [
      { name: "custom_a", description: "Desc A", definition: "Def A" },
      { name: "custom_b", description: "Desc B", definition: "Def B" },
    ];

    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:9999/v1",
      fetch: fakeFetch,
      skills: customSkills,
    });
    await session.initPromise;

    await session.send([{ type: "text", text: "hi" }]);
    const body = JSON.parse(fakeFetch.mock.calls[0][1]!.body as string) as AnthropicRequestBody;
    const systemText = getSystemText(body);

    expect(systemText).toContain("- custom_a — Desc A");
    expect(systemText).toContain("- custom_b — Desc B");
  });

  it("no skillRegistry and no skills falls back to coreSkills()", async () => {
    const fakeFetch = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(makeAnthropicResponse());

    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:9999/v1",
      fetch: fakeFetch,
    });
    await session.initPromise;

    await session.send([{ type: "text", text: "hi" }]);
    const body = JSON.parse(fakeFetch.mock.calls[0][1]!.body as string) as AnthropicRequestBody;
    const systemText = getSystemText(body);

    for (const s of coreSkills()) {
      expect(systemText).toContain(`- ${s.name} — `);
    }
  });

  it("a rejecting list() does not reject initPromise and leaves state.error undefined", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fakeFetch = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(makeAnthropicResponse());
    const hostSkill: SkillDef = {
      name: "host_skill",
      description: "Host skill desc",
      definition: "Host def",
    };
    const registry: SkillRegistry = {
      list: async () => {
        // `require-await`: dropping `async` would turn this into a
        // synchronous throw instead of a rejection — the whole point of
        // this test is exercising a REJECTING list().
        await Promise.resolve();
        throw new Error("boom");
      },
      get: () => Promise.resolve(undefined),
    };

    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:9999/v1",
      fetch: fakeFetch,
      skills: [hostSkill],
      skillRegistry: registry,
    });

    await expect(session.initPromise).resolves.toBeUndefined();
    expect(session.getState().error).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();

    await session.send([{ type: "text", text: "hi" }]);
    const body = JSON.parse(fakeFetch.mock.calls[0][1]!.body as string) as AnthropicRequestBody;
    const systemText = getSystemText(body);
    expect(systemText).toContain("- host_skill — Host skill desc");
  });

  it("initPromise does not resolve until a slow list() resolves", async () => {
    const fakeFetch = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(makeAnthropicResponse());
    let resolveDeferred!: (skills: SkillDef[]) => void;
    const deferredPromise = new Promise<SkillDef[]>((res) => {
      resolveDeferred = res;
    });

    const registry: SkillRegistry = {
      list: () => deferredPromise,
      get: () => Promise.resolve(undefined),
    };

    const session = createAgentSession({
      persist: false,
      model: "test-model",
      endpointType: "anthropic",
      baseURL: "http://localhost:9999/v1",
      fetch: fakeFetch,
      skillRegistry: registry,
    });

    const notSettledSentinel = Symbol("not-settled");
    const raceResult = await Promise.race([
      session.initPromise.then(() => "settled"),
      new Promise((res) => setTimeout(() => res(notSettledSentinel), 30)),
    ]);
    expect(raceResult).toBe(notSettledSentinel);

    resolveDeferred([
      { name: "slow_skill", description: "Slow loaded", definition: "Slow def" },
    ]);
    await expect(session.initPromise).resolves.toBeUndefined();

    await session.send([{ type: "text", text: "hi" }]);
    const body = JSON.parse(fakeFetch.mock.calls[0][1]!.body as string) as AnthropicRequestBody;
    const systemText = getSystemText(body);
    expect(systemText).toContain("- slow_skill — Slow loaded");
  });

  it("session with no skillRegistry never touches localStorage", async () => {
    const session = createAgentSession({
      persist: false,
      model: "test-model",
    });
    await session.initPromise;
    expect(localStorage.length).toBe(0);
  });

  describe("create_skill tool", () => {
    it("a confirmed create_skill call saves to the registry and load_skill returns it in the SAME turn", async () => {
      const registry = new LocalStorageSkillRegistry("create-skill-same-turn");
      const confirmInteraction = vi.fn().mockResolvedValue(true);
      const fakeFetch = sequencedFetch([
        makeToolUseResponse("call_1", "create_skill", {
          name: "order_lookup",
          description: "Looks up an order by id",
          definition: "# Order lookup\n1. Ask for the order id.\n2. Call query_data.",
        }),
        makeToolUseResponse("call_2", "load_skill", { name: "order_lookup" }),
        makeAnthropicResponse("Saved and loaded the order_lookup skill."),
      ]);

      const session = createAgentSession({
        persist: false,
        model: "test-model",
        endpointType: "anthropic",
        baseURL: "http://localhost:9999/v1",
        fetch: fakeFetch,
        tools: (ctx) => defaultTools(ctx),
        skillRegistry: registry,
        confirmInteraction,
      });
      await session.initPromise;

      await session.send([{ type: "text", text: "Please save a reusable order-lookup skill." }]);

      expect(confirmInteraction).toHaveBeenCalledTimes(1);
      expect(confirmInteraction).toHaveBeenCalledWith(
        expect.objectContaining({ action: "create skill", name: "order_lookup" }),
      );

      // registry.save actually happened — a fresh registry with the same
      // namespace sees it (asserted again, more thoroughly, below).
      const saved = await registry.get("order_lookup");
      expect(saved?.definition).toBe("# Order lookup\n1. Ask for the order id.\n2. Call query_data.");

      // load_skill, called by the model in the SAME turn right after
      // create_skill, found the just-created skill — not "not found".
      const state = session.getState();
      const assistantMsg = state.messages.find((m) => m.role === "assistant" && m.trace?.some((t) => t.name === "load_skill"));
      const loadTrace = assistantMsg?.trace?.find((t) => t.name === "load_skill");
      expect(loadTrace?.outcomeSummary).toBe("# Order lookup\n1. Ask for the order id.\n2. Call query_data.");
    });

    it("a declined create_skill call saves nothing and the tool result reflects the refusal", async () => {
      const registry = new LocalStorageSkillRegistry("create-skill-decline");
      const confirmInteraction = vi.fn().mockResolvedValue(false);
      const fakeFetch = sequencedFetch([
        makeToolUseResponse("call_1", "create_skill", {
          name: "order_lookup",
          description: "Looks up an order by id",
          definition: "# Order lookup",
        }),
        makeAnthropicResponse("Understood, I will not save it."),
      ]);

      const session = createAgentSession({
        persist: false,
        model: "test-model",
        endpointType: "anthropic",
        baseURL: "http://localhost:9999/v1",
        fetch: fakeFetch,
        tools: (ctx) => defaultTools(ctx),
        skillRegistry: registry,
        confirmInteraction,
      });
      await session.initPromise;

      await session.send([{ type: "text", text: "Please save a reusable order-lookup skill." }]);

      expect(confirmInteraction).toHaveBeenCalledTimes(1);
      expect(await registry.list()).toEqual([]);

      const state = session.getState();
      const assistantMsg = state.messages.find((m) => m.role === "assistant" && m.trace?.some((t) => t.name === "create_skill"));
      const createTrace = assistantMsg?.trace?.find((t) => t.name === "create_skill");
      expect(createTrace?.outcomeSummary).toContain("not confirmed");
    });

    it("overwriting a name already in the merged list confirms as an overwrite, and the saved copy wins the merge", async () => {
      const registry = new LocalStorageSkillRegistry("create-skill-overwrite");
      const confirmInteraction = vi.fn().mockResolvedValue(true);
      const hostSkill: SkillDef = { name: "dup", description: "Host description", definition: "HOST" };
      const fakeFetch = sequencedFetch([
        makeToolUseResponse("call_1", "create_skill", {
          name: "dup",
          description: "New description",
          definition: "NEW DEFINITION",
        }),
        makeAnthropicResponse("Overwritten."),
      ]);

      const session = createAgentSession({
        persist: false,
        model: "test-model",
        endpointType: "anthropic",
        baseURL: "http://localhost:9999/v1",
        fetch: fakeFetch,
        tools: (ctx) => defaultTools(ctx),
        skills: [hostSkill],
        skillRegistry: registry,
        confirmInteraction,
      });
      await session.initPromise;

      await session.send([{ type: "text", text: "Overwrite the dup skill." }]);

      expect(confirmInteraction).toHaveBeenCalledWith(
        expect.objectContaining({ action: "overwrite skill", name: "dup" }),
      );
      const saved = await registry.get("dup");
      expect(saved?.definition).toBe("NEW DEFINITION");
    });

    it("registry.save rejecting returns an error and does not stop the session", async () => {
      const failingRegistry: SkillRegistry = {
        list: () => Promise.resolve([]),
        get: () => Promise.resolve(undefined),
        save: async () => {
          // `require-await`: dropping `async` would turn this into a
          // synchronous throw instead of a rejection — the whole point of
          // this test is exercising a REJECTING save().
          await Promise.resolve();
          throw new Error("storage quota exceeded");
        },
      };
      const confirmInteraction = vi.fn().mockResolvedValue(true);
      const fakeFetch = sequencedFetch([
        makeToolUseResponse("call_1", "create_skill", {
          name: "order_lookup",
          description: "Looks up an order",
          definition: "# Steps",
        }),
        makeAnthropicResponse("The save failed, so I did not proceed."),
      ]);

      const session = createAgentSession({
        persist: false,
        model: "test-model",
        endpointType: "anthropic",
        baseURL: "http://localhost:9999/v1",
        fetch: fakeFetch,
        tools: (ctx) => defaultTools(ctx),
        skillRegistry: failingRegistry,
        confirmInteraction,
      });
      await session.initPromise;

      await session.send([{ type: "text", text: "Save a skill." }]);

      const state = session.getState();
      expect(state.error).toBeUndefined();
      const assistantMsg = state.messages.find((m) => m.role === "assistant" && m.trace?.some((t) => t.name === "create_skill"));
      const createTrace = assistantMsg?.trace?.find((t) => t.name === "create_skill");
      expect(createTrace?.outcomeSummary).toContain("storage quota exceeded");
    });

    it("a skill saved in one session is present in list() for a new registry built with the same namespace, and the next initAgent() lists it in the prompt", async () => {
      const namespace = "create-skill-persist-reload";
      const registry1 = new LocalStorageSkillRegistry(namespace);
      const confirmInteraction = vi.fn().mockResolvedValue(true);
      const fakeFetch = sequencedFetch([
        makeToolUseResponse("call_1", "create_skill", {
          name: "reload_skill",
          description: "Survives a reload",
          definition: "# Reload skill",
        }),
        makeAnthropicResponse("Saved."),
      ]);

      const session1 = createAgentSession({
        persist: false,
        model: "test-model",
        endpointType: "anthropic",
        baseURL: "http://localhost:9999/v1",
        fetch: fakeFetch,
        tools: (ctx) => defaultTools(ctx),
        skillRegistry: registry1,
        confirmInteraction,
      });
      await session1.initPromise;
      await session1.send([{ type: "text", text: "Save a skill that should survive a reload." }]);

      // A registry built afterwards, same namespace, sees it — simulating a
      // page reload where a new LocalStorageSkillRegistry(namespace) is
      // constructed fresh.
      const registry2 = new LocalStorageSkillRegistry(namespace);
      const list2 = await registry2.list();
      expect(list2).toEqual([{ name: "reload_skill", description: "Survives a reload", definition: "# Reload skill" }]);

      // A brand-new session (fresh initAgent()) built on that registry lists
      // the skill in the # Skills prompt section.
      const fakeFetch2 = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>().mockResolvedValue(makeAnthropicResponse("hi"));
      const session2 = createAgentSession({
        persist: false,
        model: "test-model",
        endpointType: "anthropic",
        baseURL: "http://localhost:9999/v1",
        fetch: fakeFetch2,
        skillRegistry: registry2,
      });
      await session2.initPromise;
      await session2.send([{ type: "text", text: "hi" }]);
      const body = JSON.parse(fakeFetch2.mock.calls[0][1]!.body as string) as AnthropicRequestBody;
      expect(getSystemText(body)).toContain("- reload_skill — Survives a reload");
    });
  });

  describe("delete_skill tool", () => {
    it("a confirmed delete_skill call removes from the registry and load_skill no longer finds it in the SAME turn", async () => {
      const registry = new LocalStorageSkillRegistry("delete-skill-same-turn");
      await registry.save({
        name: "order_lookup",
        description: "Looks up an order by id",
        definition: "# Order lookup",
      });
      const confirmInteraction = vi.fn().mockResolvedValue(true);
      const fakeFetch = sequencedFetch([
        makeToolUseResponse("call_1", "delete_skill", { name: "order_lookup" }),
        makeToolUseResponse("call_2", "load_skill", { name: "order_lookup" }),
        makeAnthropicResponse("Deleted the order_lookup skill."),
      ]);

      const session = createAgentSession({
        persist: false,
        model: "test-model",
        endpointType: "anthropic",
        baseURL: "http://localhost:9999/v1",
        fetch: fakeFetch,
        tools: (ctx) => defaultTools(ctx),
        skillRegistry: registry,
        confirmInteraction,
      });
      await session.initPromise;

      await session.send([{ type: "text", text: "Please delete the order-lookup skill." }]);

      expect(confirmInteraction).toHaveBeenCalledTimes(1);
      expect(confirmInteraction).toHaveBeenCalledWith(
        expect.objectContaining({ action: "delete skill", name: "order_lookup" }),
      );

      // It really left storage.
      expect(await registry.get("order_lookup")).toBeUndefined();

      // load_skill, called in the SAME turn right after delete_skill, no
      // longer finds it.
      const state = session.getState();
      const assistantMsg = state.messages.find((m) => m.role === "assistant" && m.trace?.some((t) => t.name === "load_skill"));
      const loadTrace = assistantMsg?.trace?.find((t) => t.name === "load_skill");
      expect(loadTrace?.outcomeSummary).toBe('Skill "order_lookup" not found. Use search_skills to discover available skills.');
    });

    it("a declined delete_skill call leaves the skill in the registry", async () => {
      const registry = new LocalStorageSkillRegistry("delete-skill-decline");
      await registry.save({
        name: "order_lookup",
        description: "Looks up an order by id",
        definition: "# Order lookup",
      });
      const confirmInteraction = vi.fn().mockResolvedValue(false);
      const fakeFetch = sequencedFetch([
        makeToolUseResponse("call_1", "delete_skill", { name: "order_lookup" }),
        makeAnthropicResponse("Understood, I will not delete it."),
      ]);

      const session = createAgentSession({
        persist: false,
        model: "test-model",
        endpointType: "anthropic",
        baseURL: "http://localhost:9999/v1",
        fetch: fakeFetch,
        tools: (ctx) => defaultTools(ctx),
        skillRegistry: registry,
        confirmInteraction,
      });
      await session.initPromise;

      await session.send([{ type: "text", text: "Please delete the order-lookup skill." }]);

      expect((await registry.get("order_lookup"))?.definition).toBe("# Order lookup");

      const state = session.getState();
      const assistantMsg = state.messages.find((m) => m.role === "assistant" && m.trace?.some((t) => t.name === "delete_skill"));
      const deleteTrace = assistantMsg?.trace?.find((t) => t.name === "delete_skill");
      expect(deleteTrace?.outcomeSummary).toBe('Deletion of skill "order_lookup" was not confirmed by the user; nothing was deleted.');
    });
  });
});
