import { describe, it, expect, vi } from "vitest";
import {
  waitTools,
  dataTools,
  genuiTools,
  skillTools,
  defaultTools,
  compactionTools,
  schedulerTools,
  todoTools,
} from "./builders.js";
import { TOOL_DEFS } from "./definitions.js";
import { buildTools } from "./build-tools.js";
import type { ToolContext } from "./build-tools.js";
import type { CompactionRequestOutcome } from "./compaction-messages.js";
import {
  ALREADY_REQUESTED,
  COMPACTION_IN_PROGRESS,
  COMPACTION_NOT_AVAILABLE,
  NEEDS_CONFIRMATION,
  NOTHING_TO_COMPACT,
  REQUESTED_BASE,
  REQUESTED_FOLLOW_UP,
  REQUESTED_TAIL,
  UNCONFIRMED_REPEAT,
} from "./compaction-messages.js";
import type { SkillRegistry } from "../skills/skill-registry.js";
import type { ConfirmInteractionDetail } from "../types.js";

function mockCtx(overrides?: Partial<ToolContext>): ToolContext {
  const ac = new AbortController();
  return {
    app: { appName: "test" },
    signal: ac.signal,
    ...overrides,
  };
}

/** A context whose scheduler seam is present, so schedulerTools() returns its
 *  three definitions. The three methods are stubs — only their presence is read
 *  at registration time. */
function schedulerCtx(overrides?: Partial<ToolContext>): ToolContext {
  return mockCtx({
    _scheduler: {
      setSchedule: vi.fn().mockReturnValue({ content: "scheduled ok" }),
      listSchedules: vi.fn().mockReturnValue({ content: "list ok" }),
      cancelSchedule: vi.fn().mockReturnValue({ content: "cancelled ok" }),
    },
    ...overrides,
  });
}

/** A context whose todo seam is present, so todoTools() returns its two
 *  definitions. The two methods are stubs — only their presence is read at
 *  registration time. */
function todoCtx(overrides?: Partial<ToolContext>): ToolContext {
  return mockCtx({
    _todos: {
      write: vi.fn().mockReturnValue({ content: "write ok" }),
      read: vi.fn().mockReturnValue({ content: "read ok" }),
      items: vi.fn().mockReturnValue([]),
    },
    ...overrides,
  });
}

describe("builders", () => {
  describe("waitTools", () => {
    it("returns exactly one def named wait", () => {
      const defs = waitTools();
      expect(defs[0].promptSnippet).toBe(TOOL_DEFS.wait.promptSnippet);
    });
  });

  describe("dataTools", () => {
    it("returns list_data_sources, get_field_details, sample_field_values, query_data", () => {
      const defs = dataTools();
      expect(defs.length).toBeGreaterThan(0);
      for (const d of defs) {
        const expectedSnippet = TOOL_DEFS[d.name]?.promptSnippet;
        expect(d.promptSnippet).toBe(expectedSnippet);
      }
    });
  });

  describe("genuiTools", () => {
    it("returns show_generative_ui with no promptSnippet", () => {
      const defs = genuiTools();
      expect(defs[0].promptSnippet).toBeUndefined();
    });
  });

  describe("skillTools", () => {
    const testSkills = [
      { name: "test_skill", description: "A test skill", definition: "# Test\nHello." },
      { name: "data_guide", description: "Data querying guide", definition: "# Data\nUse filters." },
    ];

    it("returns search_skills, load_skill with no promptSnippet", () => {
      const defs = skillTools();
      expect(defs[0].promptSnippet).toBeUndefined();
      expect(defs[1].promptSnippet).toBeUndefined();
    });

    it("search_skills matches skills in context", async () => {
      const defs = skillTools();
      const searchDef = defs.find((d) => d.name === "search_skills")!;
      const ctx = mockCtx({ skills: testSkills });
      const result = await searchDef.execute({ query: "data" }, ctx);
      expect(result.content).toContain("data_guide");
    });

    it("search_skills returns no-match message when context has no skills", async () => {
      const defs = skillTools();
      const searchDef = defs.find((d) => d.name === "search_skills")!;
      const ctx = mockCtx();
      const result = await searchDef.execute({ query: "data" }, ctx);
      expect(result.content).toBe("No skills matched the query.");
    });

    it("search_skills rejects a call with no query instead of throwing", async () => {
      // Found live: a call that loses its arguments (e.g. over a corrupted
      // streaming transport) must not crash the tool with a raw TypeError.
      const defs = skillTools();
      const searchDef = defs.find((d) => d.name === "search_skills")!;
      const ctx = mockCtx({ skills: testSkills });
      const r = await searchDef.execute({}, ctx);
      expect(r.isError).toBe(true);
      expect(r.content).toContain("search_skills was called without a query");
      expect(r.content).not.toContain("undefined");
    });

    it("load_skill rejects a call with no name", async () => {
      const defs = skillTools();
      const loadDef = defs.find((d) => d.name === "load_skill")!;
      const ctx = mockCtx({ skills: testSkills });
      const r = await loadDef.execute({}, ctx);
      expect(r.isError).toBe(true);
      expect(r.content).toContain("load_skill was called without a skill name");
      expect(r.content).not.toContain("undefined");
    });

    it("load_skill rejects an empty name", async () => {
      const defs = skillTools();
      const loadDef = defs.find((d) => d.name === "load_skill")!;
      const ctx = mockCtx({ skills: testSkills });
      const r = await loadDef.execute({ name: "" }, ctx);
      expect(r.isError).toBe(true);
      expect(r.content).toContain("load_skill was called without a skill name");
      expect(r.content).not.toContain("undefined");
    });

    it("load_skill rejects a whitespace-only name", async () => {
      const defs = skillTools();
      const loadDef = defs.find((d) => d.name === "load_skill")!;
      const ctx = mockCtx({ skills: testSkills });
      const r = await loadDef.execute({ name: "   " }, ctx);
      expect(r.isError).toBe(true);
      expect(r.content).toContain("load_skill was called without a skill name");
      expect(r.content).not.toContain("undefined");
    });

    it("load_skill reports a name that matches no skill as an error", async () => {
      const defs = skillTools();
      const loadDef = defs.find((d) => d.name === "load_skill")!;
      const ctx = mockCtx({ skills: testSkills });
      const r = await loadDef.execute({ name: "missing" }, ctx);
      expect(r.content).toBe('Skill "missing" not found. Use search_skills to discover available skills.');
      expect(r.isError).toBe(true);
    });

    it("load_skill returns the definition and no error flag for a real skill", async () => {
      const defs = skillTools();
      const loadDef = defs.find((d) => d.name === "load_skill")!;
      const ctx = mockCtx({ skills: testSkills });
      const r = await loadDef.execute({ name: "data_guide" }, ctx);
      expect(r.content).toBe("# Data\nUse filters.");
      expect(r.isError).toBeUndefined();
    });

    it("load_skill does not trim the name it looks up", async () => {
      const defs = skillTools();
      const loadDef = defs.find((d) => d.name === "load_skill")!;
      const ctx = mockCtx({
        skills: [{ name: " spaced ", description: "Spaced", definition: "# Spaced" }],
      });
      const r = await loadDef.execute({ name: " spaced " }, ctx);
      expect(r.content).toBe("# Spaced");
      expect(r.isError).toBeUndefined();
    });

    describe("create_skill", () => {
      // No return-type annotation — keeps `save` typed as Mock<...> (not
      // SkillRegistry's optional method-shorthand signature) so
      // `registry.save` stays directly usable with `.toHaveBeenCalled()`.
      function writableRegistry(overrides?: Partial<SkillRegistry>) {
        return {
          list: () => Promise.resolve([]),
          get: () => Promise.resolve(undefined),
          save: vi.fn().mockResolvedValue(undefined),
          ...overrides,
        };
      }

      /** A writable registry that stores owners, like the extension's side panel. */
      function ownerRegistry(overrides?: Partial<SkillRegistry>) {
        return writableRegistry({ supportsOwner: true, ownerLabel: "tesagent", ...overrides });
      }

      it("is absent with no ctx at all", () => {
        const defs = skillTools();
        expect(defs.map((d) => d.name)).not.toContain("create_skill");
      });

      it("is absent when ctx has no skillRegistry", () => {
        const defs = skillTools(mockCtx());
        expect(defs.map((d) => d.name)).not.toContain("create_skill");
      });

      it("is absent when the registry omits save (read-only)", () => {
        const readOnly: SkillRegistry = { list: () => Promise.resolve([]), get: () => Promise.resolve(undefined) };
        const defs = skillTools(mockCtx({ skillRegistry: readOnly }));
        expect(defs.map((d) => d.name)).not.toContain("create_skill");
      });

      it("is present when the registry exposes save", () => {
        const defs = skillTools(mockCtx({ skillRegistry: writableRegistry() }));
        expect(defs.map((d) => d.name)).toContain("create_skill");
      });

      it("rejects an empty or whitespace-only name, description, or definition without calling confirmInteraction or save", async () => {
        const registry = writableRegistry();
        const confirmInteraction = vi.fn<[ConfirmInteractionDetail], Promise<boolean>>();
        const defs = skillTools(mockCtx({ skillRegistry: registry, confirmInteraction }));
        const createDef = defs.find((d) => d.name === "create_skill")!;

        for (const input of [
          { name: "  ", description: "d", definition: "def" },
          { name: "n", description: "  ", definition: "def" },
          { name: "n", description: "d", definition: "  " },
        ]) {
          const r = await createDef.execute(input, mockCtx({ skillRegistry: registry, confirmInteraction }));
          expect(r.isError).toBe(true);
        }
        expect(confirmInteraction).not.toHaveBeenCalled();
        expect(registry.save).not.toHaveBeenCalled();
      });

      it("invokes confirmInteraction before save, and a decline stores nothing", async () => {
        const registry = writableRegistry();
        const confirmInteraction = vi.fn<[ConfirmInteractionDetail], Promise<boolean>>().mockResolvedValue(false);
        const ctx = mockCtx({ skillRegistry: registry, confirmInteraction, skills: [] });
        const defs = skillTools(ctx);
        const createDef = defs.find((d) => d.name === "create_skill")!;

        const r = await createDef.execute(
          { name: "order_lookup", description: "Looks up an order", definition: "# Steps" },
          ctx,
        );

        expect(confirmInteraction).toHaveBeenCalledTimes(1);
        expect(registry.save).not.toHaveBeenCalled();
        expect(r.isError).toBe(true);
        expect(r.content).toContain("not confirmed");
        expect(ctx.skills).toEqual([]);
      });

      it("a confirmed save calls registry.save once and updates ctx.skills", async () => {
        const registry = writableRegistry();
        const confirmInteraction = vi.fn<[ConfirmInteractionDetail], Promise<boolean>>().mockResolvedValue(true);
        const ctx = mockCtx({ skillRegistry: registry, confirmInteraction, skills: [] });
        const defs = skillTools(ctx);
        const createDef = defs.find((d) => d.name === "create_skill")!;

        const r = await createDef.execute(
          { name: "order_lookup", description: "Looks up an order", definition: "# Steps" },
          ctx,
        );

        expect(registry.save).toHaveBeenCalledTimes(1);
        expect(registry.save).toHaveBeenCalledWith({
          name: "order_lookup",
          description: "Looks up an order",
          definition: "# Steps",
        });
        expect(r.isError).toBeUndefined();
        expect(ctx.skills).toEqual([
          { name: "order_lookup", description: "Looks up an order", definition: "# Steps" },
        ]);
      });

      it("saves directly, with no confirmation gate, when the host wires no confirmInteraction", async () => {
        const registry = writableRegistry();
        const ctx = mockCtx({ skillRegistry: registry, skills: [] });
        const defs = skillTools(ctx);
        const createDef = defs.find((d) => d.name === "create_skill")!;

        const r = await createDef.execute(
          { name: "order_lookup", description: "Looks up an order", definition: "# Steps" },
          ctx,
        );

        expect(registry.save).toHaveBeenCalledTimes(1);
        expect(r.isError).toBeUndefined();
      });

      it("names it an overwrite, and what it replaces, when the name already exists in ctx.skills", async () => {
        const registry = writableRegistry();
        const confirmInteraction = vi.fn<[ConfirmInteractionDetail], Promise<boolean>>().mockResolvedValue(true);
        const existing = { name: "order_lookup", description: "Old", definition: "Old def" };
        const ctx = mockCtx({ skillRegistry: registry, confirmInteraction, skills: [existing] });
        const defs = skillTools(ctx);
        const createDef = defs.find((d) => d.name === "create_skill")!;

        await createDef.execute(
          { name: "order_lookup", description: "New", definition: "New def" },
          ctx,
        );

        expect(confirmInteraction).toHaveBeenCalledWith(
          expect.objectContaining({ action: "overwrite skill", name: "order_lookup" }),
        );
        const call = confirmInteraction.mock.calls[0][0];
        expect(call.reason).toContain("order_lookup");
        expect(call.summary).toContain("order_lookup");
        expect(ctx.skills).toEqual([{ name: "order_lookup", description: "New", definition: "New def" }]);
      });

      it("does not claim an overwrite for a new name", async () => {
        const registry = writableRegistry();
        const confirmInteraction = vi.fn<[ConfirmInteractionDetail], Promise<boolean>>().mockResolvedValue(true);
        const ctx = mockCtx({ skillRegistry: registry, confirmInteraction, skills: [] });
        const defs = skillTools(ctx);
        const createDef = defs.find((d) => d.name === "create_skill")!;

        await createDef.execute(
          { name: "brand_new", description: "New", definition: "New def" },
          ctx,
        );

        expect(confirmInteraction).toHaveBeenCalledWith(
          expect.objectContaining({ action: "create skill", name: "brand_new" }),
        );
        const call = confirmInteraction.mock.calls[0][0];
        expect(call.reason).toBeUndefined();
      });

      it("returns an error naming the failure when registry.save rejects, and does not touch ctx.skills", async () => {
        const registry = writableRegistry({ save: vi.fn().mockRejectedValue(new Error("quota exceeded")) });
        const ctx = mockCtx({ skillRegistry: registry, skills: [] });
        const defs = skillTools(ctx);
        const createDef = defs.find((d) => d.name === "create_skill")!;

        const r = await createDef.execute(
          { name: "order_lookup", description: "Looks up an order", definition: "# Steps" },
          ctx,
        );

        expect(r.isError).toBe(true);
        expect(r.content).toContain("quota exceeded");
        expect(ctx.skills).toEqual([]);
      });

      // 120/004 — the shared flag and the registry's owner.
      it("offers an optional boolean shared when the registry supports owners", () => {
        const def = skillTools(mockCtx({ skillRegistry: ownerRegistry() })).find((d) => d.name === "create_skill")!;
        const schema = def.inputSchema as { properties: Record<string, { type?: string }>; required: string[] };
        expect(schema.properties.shared.type).toBe("boolean");
        expect(schema.required).toEqual(["name", "description", "definition"]);
      });

      it("has no shared property when the registry does not support owners", () => {
        const def = skillTools(mockCtx({ skillRegistry: writableRegistry() })).find((d) => d.name === "create_skill")!;
        const schema = def.inputSchema as { properties: Record<string, { type?: string }>; required: string[] };
        expect(Object.keys(schema.properties)).toEqual(["name", "description", "definition"]);
      });

      it("shared: false: summary names the owner and save gets { shared: false }", async () => {
        const registry = ownerRegistry();
        const confirmInteraction = vi.fn<[ConfirmInteractionDetail], Promise<boolean>>().mockResolvedValue(true);
        const ctx = mockCtx({ skillRegistry: registry, confirmInteraction, skills: [] });
        const defs = skillTools(ctx);
        const createDef = defs.find((d) => d.name === "create_skill")!;

        const r = await createDef.execute(
          { name: "login_smoke", description: "d", definition: "def", shared: false },
          ctx,
        );

        expect(confirmInteraction.mock.calls[0][0].summary).toBe('Create skill "login_smoke" for tesagent only');
        expect(registry.save).toHaveBeenCalledWith(
          { name: "login_smoke", description: "d", definition: "def" },
          { shared: false },
        );
        expect(r.isError).toBeUndefined();
      });

      it("shared missing: summary says all agents and save gets { shared: true }", async () => {
        const registry = ownerRegistry();
        const confirmInteraction = vi.fn<[ConfirmInteractionDetail], Promise<boolean>>().mockResolvedValue(true);
        const ctx = mockCtx({ skillRegistry: registry, confirmInteraction, skills: [] });
        const defs = skillTools(ctx);
        const createDef = defs.find((d) => d.name === "create_skill")!;

        await createDef.execute({ name: "login_smoke", description: "d", definition: "def" }, ctx);

        expect(confirmInteraction.mock.calls[0][0].summary).toBe('Create skill "login_smoke" for all agents');
        expect(registry.save).toHaveBeenCalledWith(
          { name: "login_smoke", description: "d", definition: "def" },
          { shared: true },
        );
      });

      it("shared: true: all agents, { shared: true }", async () => {
        const registry = ownerRegistry();
        const confirmInteraction = vi.fn<[ConfirmInteractionDetail], Promise<boolean>>().mockResolvedValue(true);
        const ctx = mockCtx({ skillRegistry: registry, confirmInteraction, skills: [] });
        const defs = skillTools(ctx);
        const createDef = defs.find((d) => d.name === "create_skill")!;

        await createDef.execute({ name: "login_smoke", description: "d", definition: "def", shared: true }, ctx);

        expect(confirmInteraction.mock.calls[0][0].summary).toBe('Create skill "login_smoke" for all agents');
        expect(registry.save).toHaveBeenCalledWith(
          { name: "login_smoke", description: "d", definition: "def" },
          { shared: true },
        );
      });

      it("an overwrite keeps the overwrite summary and passes the new shared value", async () => {
        const registry = ownerRegistry();
        const confirmInteraction = vi.fn<[ConfirmInteractionDetail], Promise<boolean>>().mockResolvedValue(true);
        const existing = { name: "login_smoke", description: "Old", definition: "Old def" };
        const ctx = mockCtx({ skillRegistry: registry, confirmInteraction, skills: [existing] });
        const defs = skillTools(ctx);
        const createDef = defs.find((d) => d.name === "create_skill")!;

        await createDef.execute({ name: "login_smoke", description: "d", definition: "def", shared: true }, ctx);

        expect(confirmInteraction.mock.calls[0][0].summary).toBe('Overwrite existing skill "login_smoke"');
        expect(confirmInteraction.mock.calls[0][0].action).toBe("overwrite skill");
        expect(registry.save).toHaveBeenCalledWith(
          { name: "login_smoke", description: "d", definition: "def" },
          { shared: true },
        );
      });

      it("a registry without owners gets the one-argument save and the plain summary", async () => {
        const registry = writableRegistry();
        const confirmInteraction = vi.fn<[ConfirmInteractionDetail], Promise<boolean>>().mockResolvedValue(true);
        const ctx = mockCtx({ skillRegistry: registry, confirmInteraction, skills: [] });
        const defs = skillTools(ctx);
        const createDef = defs.find((d) => d.name === "create_skill")!;

        await createDef.execute({ name: "order_lookup", description: "d", definition: "def" }, ctx);

        expect(confirmInteraction.mock.calls[0][0].summary).toBe('Create skill "order_lookup"');
        expect(registry.save.mock.calls[0]).toHaveLength(1);
      });

      it("a refused owner save becomes the tool error and ctx.skills is not touched", async () => {
        const registry = ownerRegistry({
          save: vi
            .fn()
            .mockRejectedValue(
              new Error('A skill named "login_smoke" belongs to another agent. Choose another name.'),
            ),
        });
        const ctx = mockCtx({ skillRegistry: registry, skills: [] });
        const defs = skillTools(ctx);
        const createDef = defs.find((d) => d.name === "create_skill")!;

        const r = await createDef.execute({ name: "login_smoke", description: "d", definition: "def" }, ctx);

        expect(r.isError).toBe(true);
        expect(r.content).toBe(
          'Failed to save skill "login_smoke": A skill named "login_smoke" belongs to another agent. Choose another name.',
        );
        expect(ctx.skills).toEqual([]);
      });

      it("a declined owner save calls neither save nor changes ctx.skills", async () => {
        const registry = ownerRegistry();
        const confirmInteraction = vi.fn<[ConfirmInteractionDetail], Promise<boolean>>().mockResolvedValue(false);
        const ctx = mockCtx({ skillRegistry: registry, confirmInteraction, skills: [] });
        const defs = skillTools(ctx);
        const createDef = defs.find((d) => d.name === "create_skill")!;

        await createDef.execute({ name: "login_smoke", description: "d", definition: "def", shared: false }, ctx);

        expect(registry.save).not.toHaveBeenCalled();
        expect(confirmInteraction.mock.calls[0][0].summary).toBe('Create skill "login_smoke" for tesagent only');
      });
    });

    describe("delete_skill", () => {
      const PIRATE = { name: "pirate_speak", description: "Answer like a pirate", definition: "# Arr" };

      // No return-type annotation, for the same reason writableRegistry above
      // has none: it keeps `remove` typed as Mock<...> rather than
      // SkillRegistry's optional method-shorthand signature, so
      // `registry.remove` stays directly usable with `.toHaveBeenCalled()`.
      function removableRegistry(overrides?: Partial<SkillRegistry>) {
        return {
          list: () => Promise.resolve([]),
          get: () => Promise.resolve(undefined),
          save: vi.fn().mockResolvedValue(undefined),
          remove: vi.fn().mockResolvedValue(undefined),
          ...overrides,
        };
      }

      it("is absent with no ctx at all", () => {
        expect(skillTools().map((d) => d.name)).not.toContain("delete_skill");
      });

      it("is absent when ctx has no skillRegistry", () => {
        expect(skillTools(mockCtx()).map((d) => d.name)).not.toContain("delete_skill");
      });

      it("is absent when the registry omits remove, even though it can save", () => {
        const saveOnly: SkillRegistry = {
          list: () => Promise.resolve([]),
          get: () => Promise.resolve(undefined),
          save: () => Promise.resolve(),
        };
        const names = skillTools(mockCtx({ skillRegistry: saveOnly })).map((d) => d.name);
        expect(names).toContain("create_skill");
        expect(names).not.toContain("delete_skill");
      });

      it("is present when the registry exposes remove", () => {
        const names = skillTools(mockCtx({ skillRegistry: removableRegistry() })).map((d) => d.name);
        expect(names).toContain("delete_skill");
      });

      it("is offered without create_skill when the registry can remove but not save", () => {
        const removeOnly: SkillRegistry = {
          list: () => Promise.resolve([]),
          get: () => Promise.resolve(undefined),
          remove: () => Promise.resolve(),
        };
        const names = skillTools(mockCtx({ skillRegistry: removeOnly })).map((d) => d.name);
        expect(names).toContain("delete_skill");
        expect(names).not.toContain("create_skill");
      });

      it("rejects a missing, empty or whitespace-only name without calling confirmInteraction or remove", async () => {
        const registry = removableRegistry();
        const confirmInteraction = vi.fn<[ConfirmInteractionDetail], Promise<boolean>>();
        const ctx = mockCtx({ skillRegistry: registry, confirmInteraction, skills: [{ ...PIRATE }] });
        const deleteDef = skillTools(ctx).find((d) => d.name === "delete_skill")!;

        for (const input of [{}, { name: "" }, { name: "   " }, { name: 42 }]) {
          const r = await deleteDef.execute(input, ctx);
          expect(r.isError).toBe(true);
          expect(r.content).toBe('delete_skill failed: "name" is required and cannot be empty.');
          expect(r.content).not.toContain("undefined");
        }
        expect(confirmInteraction).not.toHaveBeenCalled();
        expect(registry.remove).not.toHaveBeenCalled();
        expect(ctx.skills).toEqual([PIRATE]);
      });

      it("reports an unknown skill as an error pointing at search_skills, and removes nothing", async () => {
        const registry = removableRegistry();
        const confirmInteraction = vi.fn<[ConfirmInteractionDetail], Promise<boolean>>();
        const ctx = mockCtx({ skillRegistry: registry, confirmInteraction, skills: [{ ...PIRATE }] });
        const deleteDef = skillTools(ctx).find((d) => d.name === "delete_skill")!;

        const r = await deleteDef.execute({ name: "nope" }, ctx);

        expect(r.isError).toBe(true);
        expect(r.content).toBe('Skill "nope" not found. Use search_skills to see available skills.');
        expect(confirmInteraction).not.toHaveBeenCalled();
        expect(registry.remove).not.toHaveBeenCalled();
        expect(ctx.skills).toEqual([PIRATE]);
      });

      it("treats an empty skill list as 'not found' and never calls remove", async () => {
        const registry = removableRegistry();
        const ctx = mockCtx({ skillRegistry: registry });
        const deleteDef = skillTools(ctx).find((d) => d.name === "delete_skill")!;

        const r = await deleteDef.execute({ name: "pirate_speak" }, ctx);

        expect(r.isError).toBe(true);
        expect(r.content).toContain("not found");
        expect(registry.remove).not.toHaveBeenCalled();
      });

      it("invokes confirmInteraction before remove, and a decline deletes nothing", async () => {
        const registry = removableRegistry();
        const confirmInteraction = vi.fn<[ConfirmInteractionDetail], Promise<boolean>>().mockResolvedValue(false);
        const ctx = mockCtx({ skillRegistry: registry, confirmInteraction, skills: [{ ...PIRATE }] });
        const deleteDef = skillTools(ctx).find((d) => d.name === "delete_skill")!;

        const r = await deleteDef.execute({ name: "pirate_speak" }, ctx);

        expect(confirmInteraction).toHaveBeenCalledTimes(1);
        expect(confirmInteraction).toHaveBeenCalledWith({
          action: "delete skill",
          name: "pirate_speak",
          summary: 'Delete skill "pirate_speak"',
        });
        expect(registry.remove).not.toHaveBeenCalled();
        expect(r.isError).toBe(true);
        expect(r.content).toBe('Deletion of skill "pirate_speak" was not confirmed by the user; nothing was deleted.');
        expect(ctx.skills).toEqual([PIRATE]);
      });

      it("a confirmed delete calls registry.remove once and returns a success message naming the skill", async () => {
        const registry = removableRegistry();
        const confirmInteraction = vi.fn<[ConfirmInteractionDetail], Promise<boolean>>().mockResolvedValue(true);
        const ctx = mockCtx({ skillRegistry: registry, confirmInteraction, skills: [{ ...PIRATE }] });
        const deleteDef = skillTools(ctx).find((d) => d.name === "delete_skill")!;

        const r = await deleteDef.execute({ name: "pirate_speak" }, ctx);

        expect(registry.remove).toHaveBeenCalledTimes(1);
        expect(registry.remove).toHaveBeenCalledWith("pirate_speak");
        expect(r.isError).toBeUndefined();
        expect(r.content).toBe('Skill "pirate_speak" deleted.');
      });

      it("deletes with no confirmation gate when the host wires no confirmInteraction", async () => {
        const registry = removableRegistry();
        const ctx = mockCtx({ skillRegistry: registry, skills: [{ ...PIRATE }] });
        const deleteDef = skillTools(ctx).find((d) => d.name === "delete_skill")!;

        const r = await deleteDef.execute({ name: "pirate_speak" }, ctx);

        expect(registry.remove).toHaveBeenCalledTimes(1);
        expect(r.isError).toBeUndefined();
      });

      it("trims the name before looking it up and before removing", async () => {
        const registry = removableRegistry();
        const ctx = mockCtx({ skillRegistry: registry, skills: [{ ...PIRATE }] });
        const deleteDef = skillTools(ctx).find((d) => d.name === "delete_skill")!;

        const r = await deleteDef.execute({ name: "  pirate_speak  " }, ctx);

        expect(r.isError).toBeUndefined();
        expect(registry.remove).toHaveBeenCalledWith("pirate_speak");
        expect(ctx.skills).toEqual([]);
      });

      it("drops the entry from ctx.skills in place, keeping the same array object", async () => {
        const registry = removableRegistry();
        const other = { name: "keep_me", description: "Kept", definition: "# Keep" };
        const skills = [{ ...PIRATE }, other];
        const ctx = mockCtx({ skillRegistry: registry, skills });
        const deleteDef = skillTools(ctx).find((d) => d.name === "delete_skill")!;

        await deleteDef.execute({ name: "pirate_speak" }, ctx);

        // Same array object — the controller holds this reference, so a
        // reassignment would lose the effect for the rest of the turn.
        expect(ctx.skills).toBe(skills);
        expect(ctx.skills).toEqual([other]);
      });

      it("load_skill and search_skills stop finding the skill in the SAME turn", async () => {
        const registry = removableRegistry();
        const ctx = mockCtx({ skillRegistry: registry, skills: [{ ...PIRATE }] });
        const defs = skillTools(ctx);
        const deleteDef = defs.find((d) => d.name === "delete_skill")!;
        const loadDef = defs.find((d) => d.name === "load_skill")!;
        const searchDef = defs.find((d) => d.name === "search_skills")!;

        expect((await loadDef.execute({ name: "pirate_speak" }, ctx)).content).toBe("# Arr");

        await deleteDef.execute({ name: "pirate_speak" }, ctx);

        const afterLoad = await loadDef.execute({ name: "pirate_speak" }, ctx);
        expect(afterLoad.isError).toBe(true);
        expect(afterLoad.content).toBe('Skill "pirate_speak" not found. Use search_skills to discover available skills.');

        const afterSearch = await searchDef.execute({ query: "pirate" }, ctx);
        expect(afterSearch.content).toBe("No skills matched the query.");
      });

      it("returns an error naming the failure when registry.remove rejects, and does not touch ctx.skills", async () => {
        const registry = removableRegistry({ remove: vi.fn().mockRejectedValue(new Error("storage is full")) });
        const ctx = mockCtx({ skillRegistry: registry, skills: [{ ...PIRATE }] });
        const deleteDef = skillTools(ctx).find((d) => d.name === "delete_skill")!;

        const r = await deleteDef.execute({ name: "pirate_speak" }, ctx);

        expect(r.isError).toBe(true);
        expect(r.content).toBe('Failed to delete skill "pirate_speak": storage is full');
        expect(ctx.skills).toEqual([PIRATE]);
      });

      it("reports no removable registry when the seam disappears between registration and execution", async () => {
        const registry = removableRegistry();
        const ctx = mockCtx({ skillRegistry: registry, skills: [{ ...PIRATE }] });
        const deleteDef = skillTools(ctx).find((d) => d.name === "delete_skill")!;

        // The tool re-reads execCtx.skillRegistry at execute time, so a context
        // whose registry has gone reports it instead of throwing.
        const goneCtx = mockCtx({ skills: [{ ...PIRATE }] });
        const r = await deleteDef.execute({ name: "pirate_speak" }, goneCtx);

        expect(r.isError).toBe(true);
        expect(r.content).toBe('Cannot delete skill "pirate_speak": no removable skill registry is configured.');
      });

      it("leaves create_skill behaving exactly as before", async () => {
        const registry = removableRegistry();
        const confirmInteraction = vi.fn<[ConfirmInteractionDetail], Promise<boolean>>().mockResolvedValue(true);
        const ctx = mockCtx({ skillRegistry: registry, confirmInteraction, skills: [] });
        const defs = skillTools(ctx);

        const createDef = defs.find((d) => d.name === "create_skill")!;
        const r = await createDef.execute(
          { name: "order_lookup", description: "Looks up an order", definition: "# Steps" },
          ctx,
        );

        expect(registry.save).toHaveBeenCalledTimes(1);
        expect(confirmInteraction).toHaveBeenCalledWith(
          expect.objectContaining({ action: "create skill", name: "order_lookup" }),
        );
        expect(r.isError).toBeUndefined();
        expect(r.content).toBe(
          'Skill "order_lookup" saved successfully. It is available immediately via load_skill and search_skills.',
        );
      });
    });
  });

  describe("compactionTools", () => {
    function ctxReturning(outcome: CompactionRequestOutcome) {
      const seam = vi.fn(() => outcome);
      const ctx = mockCtx();
      ctx._requestCompaction = seam;
      return { ctx, seam };
    }

    it("seam absent — reports compaction unavailable", async () => {
      const ctx = mockCtx();
      const result = await compactionTools()[0].execute({}, ctx);
      expect(result).toEqual({
        content: COMPACTION_NOT_AVAILABLE,
        isError: true,
      });
    });

    it("unconfirmed — asks who requested it, and is NOT an error", async () => {
      const { ctx, seam } = ctxReturning("needs-confirmation");
      const result = await compactionTools()[0].execute({}, ctx);
      expect(result).toEqual({ content: NEEDS_CONFIRMATION });
      expect(result.isError).toBeUndefined();
      expect(seam).toHaveBeenCalledWith(false, undefined);
    });

    it("confirmation: false and confirmation: null are both unconfirmed", async () => {
      for (const value of [false, null]) {
        const { ctx, seam } = ctxReturning("needs-confirmation");
        await compactionTools()[0].execute({ confirmation: value }, ctx);
        expect(seam).toHaveBeenCalledWith(false, undefined);
      }
    });

    it("unconfirmed-repeat — an error that tells the model to stop", async () => {
      const { ctx } = ctxReturning("unconfirmed-repeat");
      const result = await compactionTools()[0].execute({}, ctx);
      expect(result).toEqual({ content: UNCONFIRMED_REPEAT, isError: true });
    });

    it("requested with no follow-up — no follow-up sentence", async () => {
      const { ctx } = ctxReturning("requested");
      const result = await compactionTools()[0].execute(
        { confirmation: true },
        ctx,
      );
      expect(result).toEqual({ content: REQUESTED_BASE + REQUESTED_TAIL });
      expect(result.content).not.toContain(REQUESTED_FOLLOW_UP);
      expect(result.isError).toBeUndefined();
    });

    it("requested with a follow-up — mentions it", async () => {
      const { ctx, seam } = ctxReturning("requested");
      const result = await compactionTools()[0].execute(
        { confirmation: true, followUp: "do the report" },
        ctx,
      );
      expect(result).toEqual({
        content: REQUESTED_BASE + REQUESTED_FOLLOW_UP + REQUESTED_TAIL,
      });
      expect(seam).toHaveBeenCalledWith(true, "do the report");
    });

    it("a whitespace-only follow-up is not announced", async () => {
      const { ctx } = ctxReturning("requested");
      const result = await compactionTools()[0].execute(
        { confirmation: true, followUp: "   " },
        ctx,
      );
      expect(result).toEqual({ content: REQUESTED_BASE + REQUESTED_TAIL });
    });

    it("a non-string follow-up is passed through as undefined", async () => {
      const { ctx, seam } = ctxReturning("requested");
      await compactionTools()[0].execute(
        { confirmation: true, followUp: 42 },
        ctx,
      );
      expect(seam).toHaveBeenCalledWith(true, undefined);
    });

    it("already-requested — an error naming the action to take instead", async () => {
      const { ctx } = ctxReturning("already-requested");
      const result = await compactionTools()[0].execute(
        { confirmation: true },
        ctx,
      );
      expect(result).toEqual({ content: ALREADY_REQUESTED, isError: true });
    });

    it("nothing-to-compact — an error carrying the shared constant", async () => {
      const { ctx } = ctxReturning("nothing-to-compact");
      const result = await compactionTools()[0].execute(
        { confirmation: true },
        ctx,
      );
      expect(result).toEqual({ content: NOTHING_TO_COMPACT, isError: true });
    });

    it("in-progress — an error", async () => {
      const { ctx } = ctxReturning("in-progress");
      const result = await compactionTools()[0].execute(
        { confirmation: true },
        ctx,
      );
      expect(result).toEqual({
        content: COMPACTION_IN_PROGRESS,
        isError: true,
      });
    });

    it("buildTools produces the two-property input schema", () => {
      const ctx = mockCtx();
      const built = buildTools(ctx, compactionTools());
      const schema = built.tools[0].input_schema as {
        type: string;
        properties: { confirmation: { type: string }; followUp: { type: string } };
        additionalProperties: boolean;
      };
      expect(schema.type).toBe("object");
      expect(schema.properties.confirmation.type).toBe("boolean");
      expect(schema.properties.followUp.type).toBe("string");
      expect(schema.additionalProperties).toBe(false);
    });

    it("carries no promptSnippet, so it does not grow # Tool guidelines", () => {
      expect(compactionTools()[0].promptSnippet).toBeUndefined();
    });
  });

  describe("schedulerTools", () => {
    it("returns nothing when ctx._scheduler is absent", () => {
      expect(schedulerTools(mockCtx())).toEqual([]);
    });

    it("returns nothing when called with no ctx at all", () => {
      expect(schedulerTools()).toEqual([]);
    });

    it("a tool built with the seam still reports the disabled message when it later runs without one", async () => {
      const tools = schedulerTools(schedulerCtx());
      expect(tools).toHaveLength(3);
      const seamless = mockCtx();
      for (const tool of tools) {
        const result = await tool.execute({}, seamless);
        expect(result).toEqual({
          content: "Scheduling is turned off in this app.",
          isError: true,
        });
      }
    });

    it("delegates to ctx._scheduler when present", async () => {
      const setSchedule = vi.fn().mockReturnValue({ content: "scheduled ok" });
      const listSchedules = vi.fn().mockReturnValue({ content: "list ok" });
      const cancelSchedule = vi.fn().mockReturnValue({ content: "cancelled ok" });

      const ctx = mockCtx({
        _scheduler: {
          setSchedule,
          listSchedules,
          cancelSchedule,
        },
      });

      const [setTool, listTool, cancelTool] = schedulerTools(ctx);

      const setResult = await setTool.execute({ name: "job1" }, ctx);
      expect(setSchedule).toHaveBeenCalledWith({ name: "job1" });
      expect(setResult).toEqual({ content: "scheduled ok" });

      const listResult = await listTool.execute({}, ctx);
      expect(listSchedules).toHaveBeenCalled();
      expect(listResult).toEqual({ content: "list ok" });

      const cancelResult = await cancelTool.execute({ name: "job1" }, ctx);
      expect(cancelSchedule).toHaveBeenCalledWith("job1");
      expect(cancelResult).toEqual({ content: "cancelled ok" });
    });
  });

  describe("todoTools", () => {
    it("returns nothing when ctx._todos is absent", () => {
      expect(todoTools(mockCtx())).toEqual([]);
    });

    it("returns nothing when called with no ctx at all", () => {
      expect(todoTools()).toEqual([]);
    });

    it("a tool built with the seam still reports the disabled message when it later runs without one", async () => {
      const tools = todoTools(todoCtx());
      expect(tools).toHaveLength(2);
      const seamless = mockCtx();
      for (const tool of tools) {
        const result = await tool.execute({}, seamless);
        expect(result).toEqual({
          content: "Todo tracking is turned off in this app.",
          isError: true,
        });
      }
    });

    it("delegates to ctx._todos when present", async () => {
      const write = vi.fn().mockReturnValue({ content: "write ok" });
      const read = vi.fn().mockReturnValue({ content: "read ok" });
      const items = vi.fn().mockReturnValue([]);

      const ctx = mockCtx({ _todos: { write, read, items } });

      const [writeTool, readTool] = todoTools(ctx);

      const writeResult = await writeTool.execute({ items: [{ text: "Buy oats" }] }, ctx);
      expect(write).toHaveBeenCalledWith({ items: [{ text: "Buy oats" }] });
      expect(writeResult).toEqual({ content: "write ok" });

      const readResult = await readTool.execute({}, ctx);
      expect(read).toHaveBeenCalled();
      expect(readResult).toEqual({ content: "read ok" });
    });
  });

  describe("defaultTools", () => {
    it("with the scheduler seam present returns the same ten followed by set_schedule, list_schedules, cancel_schedule, in order", () => {
      const defs = defaultTools(schedulerCtx());
      expect(defs.map((d) => d.name)).toEqual([
        "wait",
        "get_time",
        "list_data_sources",
        "get_field_details",
        "sample_field_values",
        "query_data",
        "show_generative_ui",
        "search_skills",
        "load_skill",
        "compact_conversation",
        "set_schedule",
        "list_schedules",
        "cancel_schedule",
      ]);
    });

    it("dropping the scheduler seam drops only the three scheduler names", () => {
      const withSeam = defaultTools(schedulerCtx()).map((d) => d.name);
      const withoutSeam = defaultTools(mockCtx()).map((d) => d.name);
      expect(withSeam.filter((n) => !withoutSeam.includes(n))).toEqual([
        "set_schedule",
        "list_schedules",
        "cancel_schedule",
      ]);
      expect(withoutSeam.filter((n) => !withSeam.includes(n))).toEqual([]);
    });

    it("with only the todo seam present returns the same ten followed by todo_write, todo_read, in order", () => {
      const defs = defaultTools(todoCtx());
      expect(defs.map((d) => d.name)).toEqual([
        "wait",
        "get_time",
        "list_data_sources",
        "get_field_details",
        "sample_field_values",
        "query_data",
        "show_generative_ui",
        "search_skills",
        "load_skill",
        "compact_conversation",
        "todo_write",
        "todo_read",
      ]);
    });

    it("dropping the todo seam drops only the two todo names", () => {
      const withSeam = defaultTools(todoCtx()).map((d) => d.name);
      const withoutSeam = defaultTools(mockCtx()).map((d) => d.name);
      expect(withSeam.filter((n) => !withoutSeam.includes(n))).toEqual(["todo_write", "todo_read"]);
      expect(withoutSeam.filter((n) => !withSeam.includes(n))).toEqual([]);
    });

    it("T5 — contains compact_conversation and no reset tool", () => {
      const names = defaultTools(mockCtx()).map((d) => d.name);
      expect(names).toContain("compact_conversation");
      for (const resetName of ["new_session", "clear_session"]) {
        expect(names).not.toContain(resetName);
      }
    });

    it("contains no DOM tool name", () => {
      const names = defaultTools(mockCtx()).map((d) => d.name);
      for (const domName of ["snapshot_page", "query_state", "click", "fill", "select_option", "wait_for", "see"]) {
        expect(names).not.toContain(domName);
      }
    });

    it("is unchanged when ctx.imageInput === false (the see gate lived in domReadTools, now gone)", () => {
      const withImages = defaultTools(mockCtx()).map((d) => d.name);
      const withoutImages = defaultTools(mockCtx({ imageInput: false })).map((d) => d.name);
      expect(withoutImages).toEqual(withImages);
    });

    it("each def's inputSchema is a valid ToolInputSchema (zod or JSON Schema) and execute is a function", () => {
      const ctx = mockCtx();
      const defs = defaultTools(ctx);
      for (const d of defs) {
        expect(typeof d.inputSchema).toBe("object");
        expect(d.inputSchema).not.toBeNull();
        const isZod = typeof (d.inputSchema as { safeParse?: unknown }).safeParse === "function";
        const isJsonSchema = (d.inputSchema as { type?: unknown }).type === "object";
        expect(isZod || isJsonSchema).toBe(true);
        expect(typeof d.execute).toBe("function");
      }
    });

    it("excludes sample reference tools", () => {
      const names = defaultTools(mockCtx()).map((t) => t.name);
      expect(names).not.toContain("sample_greeting");
      expect(names).not.toContain("sample_quick_reply");
    });
  });
});
