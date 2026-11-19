import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  LocalStorageSkillRegistry,
  mergeSkills,
  loadRegistrySkills,
  modelVisibleSkills,
  type SkillRegistry,
} from "./skill-registry.js";
import { skillTools } from "../tools/builders.js";
import type { SkillDef } from "../tools/build-tools.js";

describe("LocalStorageSkillRegistry", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("list() returns [] when the key is absent", async () => {
    const r = new LocalStorageSkillRegistry();
    expect(await r.list()).toEqual([]);
  });

  it("list() returns [] for an empty stored value", async () => {
    localStorage.setItem("web-agent-skills", "");
    const r = new LocalStorageSkillRegistry();
    expect(await r.list()).toEqual([]);
  });

  it("list() returns [] for unparsable JSON and does not throw", async () => {
    localStorage.setItem("web-agent-skills", "not json at all");
    const r = new LocalStorageSkillRegistry();
    await expect(r.list()).resolves.toEqual([]);
  });

  it("list() returns [] for valid JSON that is not an array", async () => {
    localStorage.setItem("web-agent-skills", JSON.stringify({ a: 1 }));
    const r = new LocalStorageSkillRegistry();
    expect(await r.list()).toEqual([]);
  });

  it("save then list returns the skill", async () => {
    const r = new LocalStorageSkillRegistry();
    const skill: SkillDef = {
      name: "test_skill",
      description: "A test skill",
      definition: "Do test things",
    };
    await r.save(skill);
    const list = await r.list();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("test_skill");
  });

  it("get returns the saved skill by exact name", async () => {
    const r = new LocalStorageSkillRegistry();
    const skill: SkillDef = {
      name: "test_skill",
      description: "A test skill",
      definition: "Do test things",
    };
    await r.save(skill);
    const found = await r.get("test_skill");
    expect(found).toEqual(skill);
  });

  it("get returns undefined for an unknown name", async () => {
    const r = new LocalStorageSkillRegistry();
    expect(await r.get("nope")).toBeUndefined();
  });

  it("save with an existing name overwrites in place", async () => {
    const r = new LocalStorageSkillRegistry();
    await r.save({ name: "x", description: "d1", definition: "1" });
    await r.save({ name: "x", description: "d2", definition: "2" });
    const list = await r.list();
    expect(list).toHaveLength(1);
    expect(list[0].definition).toBe("2");
    expect(list[0].description).toBe("d2");
  });

  it("remove deletes the skill", async () => {
    const r = new LocalStorageSkillRegistry();
    await r.save({ name: "x", description: "d", definition: "def" });
    await r.remove("x");
    expect(await r.get("x")).toBeUndefined();
    expect((await r.list()).find((s) => s.name === "x")).toBeUndefined();
  });

  it("remove of an unknown name is a no-op", async () => {
    const r = new LocalStorageSkillRegistry();
    await r.save({ name: "x", description: "d", definition: "def" });
    await r.remove("y");
    const list = await r.list();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("x");
  });

  it("a new instance with the same namespace reads what an earlier one wrote", async () => {
    const r1 = new LocalStorageSkillRegistry("cat-store");
    await r1.save({ name: "persisted", description: "p", definition: "persisted-def" });

    const r2 = new LocalStorageSkillRegistry("cat-store");
    const list = await r2.list();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("persisted");
    expect(await r2.get("persisted")).toEqual({
      name: "persisted",
      description: "p",
      definition: "persisted-def",
    });
  });

  it("two namespaces are isolated", async () => {
    const rAlpha = new LocalStorageSkillRegistry("alpha");
    await rAlpha.save({ name: "only_alpha", description: "a", definition: "alpha-def" });

    const rBeta = new LocalStorageSkillRegistry("beta");
    expect(await rBeta.list()).toEqual([]);
    expect(await rBeta.get("only_alpha")).toBeUndefined();
  });

  it("the default namespace and a named namespace are isolated", async () => {
    const rDefault = new LocalStorageSkillRegistry();
    await rDefault.save({ name: "default_skill", description: "def", definition: "def-val" });

    const rNamed = new LocalStorageSkillRegistry("custom");
    expect(await rNamed.list()).toEqual([]);
    expect(await rNamed.get("default_skill")).toBeUndefined();
  });
});

describe("mergeSkills", () => {
  const skillA: SkillDef = { name: "a", description: "desc a", definition: "def a" };
  const skillB: SkillDef = { name: "b", description: "desc b", definition: "def b" };
  const skillC: SkillDef = { name: "c", description: "desc c", definition: "def c" };

  it("appends a registry skill whose name is not in the base list", () => {
    const base = [skillA];
    const registry = [skillB];
    const merged = mergeSkills(base, registry);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toEqual(skillA);
    expect(merged[1]).toEqual(skillB);
  });

  it("replaces a base skill of the same name with the registry definition", () => {
    const base = [skillA];
    const registrySkillA: SkillDef = {
      name: "a",
      description: "override a",
      definition: "override def a",
    };
    const merged = mergeSkills(base, [registrySkillA]);
    expect(merged).toHaveLength(1);
    expect(merged[0].definition).toBe("override def a");
    expect(merged[0].description).toBe("override a");
  });

  it("preserves base order when replacing", () => {
    const base = [skillA, skillB, skillC];
    const registrySkillB: SkillDef = {
      name: "b",
      description: "override b",
      definition: "override def b",
    };
    const merged = mergeSkills(base, [registrySkillB]);
    expect(merged.map((s) => s.name)).toEqual(["a", "b", "c"]);
    expect(merged[1].definition).toBe("override def b");
  });

  it("returns the base list unchanged for an empty registry list", () => {
    const base = [skillA, skillB];
    const originalCopy = [...base];
    const merged = mergeSkills(base, []);
    expect(merged).toEqual(originalCopy);
    expect(base).toEqual(originalCopy);
  });

  it("a later registry entry wins over an earlier one with the same name", () => {
    const base: SkillDef[] = [];
    const r1: SkillDef = { name: "x", description: "d1", definition: "v1" };
    const r2: SkillDef = { name: "x", description: "d2", definition: "v2" };
    const merged = mergeSkills(base, [r1, r2]);
    expect(merged).toHaveLength(1);
    expect(merged[0].definition).toBe("v2");
  });
});

describe("modelVisibleSkills", () => {
  it("M5 — a list with no opted-out skill returns the same contents", () => {
    const list: SkillDef[] = [
      { name: "a", description: "d", definition: "def" },
      { name: "b", description: "d", definition: "def" },
    ];
    expect(modelVisibleSkills(list)).toEqual(list);
  });

  it("removes exactly the opted-out entries and preserves order", () => {
    const list: SkillDef[] = [
      { name: "a", description: "d", definition: "def" },
      { name: "secret", description: "d", definition: "def", disableModelInvocation: true },
      { name: "b", description: "d", definition: "def" },
    ];
    expect(modelVisibleSkills(list).map((s) => s.name)).toEqual(["a", "b"]);
  });

  it("M1 — a filtered ctx.skills hides an opted-out skill from search_skills", async () => {
    const secret: SkillDef = {
      name: "secret",
      description: "shh",
      definition: "def",
      command: true,
      disableModelInvocation: true,
    };
    const visible = modelVisibleSkills([secret]);
    const searchDef = skillTools().find((d) => d.name === "search_skills")!;
    const ctx = { app: {}, signal: new AbortController().signal, skills: visible };
    const result = await searchDef.execute({ query: "secret" }, ctx);
    expect(result.content).toBe("No skills matched the query.");
  });

  it("M2 — a filtered ctx.skills makes load_skill report the opted-out skill as not found", async () => {
    const secret: SkillDef = {
      name: "secret",
      description: "shh",
      definition: "def",
      command: true,
      disableModelInvocation: true,
    };
    const visible = modelVisibleSkills([secret]);
    const loadDef = skillTools().find((d) => d.name === "load_skill")!;
    const ctx = { app: {}, signal: new AbortController().signal, skills: visible };
    const result = await loadDef.execute({ name: "secret" }, ctx);
    expect(result.content).toBe('Skill "secret" not found. Use search_skills to discover available skills.');
    expect(result.isError).toBe(true);
  });
});

describe("loadRegistrySkills", () => {
  it("returns [] for an undefined registry and never calls anything", async () => {
    const result = await loadRegistrySkills(undefined);
    expect(result).toEqual([]);
  });

  it("returns the registry's list", async () => {
    const registry: SkillRegistry = {
      list() {
        return Promise.resolve([{ name: "r_skill", description: "rd", definition: "rdef" }]);
      },
      get(name: string) {
        return Promise.resolve(name === "r_skill"
          ? { name: "r_skill", description: "rd", definition: "rdef" }
          : undefined);
      },
    };
    const result = await loadRegistrySkills(registry);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("r_skill");
  });

  it("returns [] and warns when list() rejects", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const registry: SkillRegistry = {
      async list() {
        // `require-await`: dropping `async` would turn this into a
        // synchronous throw instead of a rejection — the whole point of
        // this test is exercising a REJECTING list().
        await Promise.resolve();
        throw new Error("registry boom");
      },
      get() {
        return Promise.resolve(undefined);
      },
    };
    const result = await loadRegistrySkills(registry);
    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("skill registry failed to load");
    warnSpy.mockRestore();
  });

  it("returns [] when list() resolves to undefined", async () => {
    const registry = {
      list: () => Promise.resolve(undefined as unknown as SkillDef[]),
      get: () => Promise.resolve(undefined),
    } as SkillRegistry;
    const result = await loadRegistrySkills(registry);
    expect(result).toEqual([]);
  });
});
