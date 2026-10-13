import { describe, it, expect, vi, afterEach } from "vitest";
import { parseSlashInput, buildCommandList, type CoreCommandDef } from "./slash-commands.js";
import type { SkillDef } from "../tools/build-tools.js";

function skill(overrides: Partial<SkillDef> & { name: string }): SkillDef {
  return {
    description: "desc",
    definition: "def",
    ...overrides,
  };
}

function coreCmds(): CoreCommandDef[] {
  return [
    {
      name: "compact",
      aliases: [],
      description: "Summarise to free up context",
      unavailableMessage: "There is nothing to compact yet.",
      action: () => Promise.resolve(true),
    },
    {
      name: "new",
      aliases: ["clear"],
      description: "Start a fresh session",
      unavailableMessage: "Could not start a new session.",
      action: () => Promise.resolve(true),
    },
  ];
}

describe("parseSlashInput", () => {
  it("P1a — /compact", () => {
    expect(parseSlashInput("/compact")).toEqual({ name: "compact", argument: "" });
  });

  it("P1b — /compact with an argument", () => {
    expect(parseSlashInput("/compact now focus on the margins")).toEqual({
      name: "compact",
      argument: "now focus on the margins",
    });
  });

  it("P1c — splits at the FIRST whitespace run, argument trimmed at both ends", () => {
    expect(parseSlashInput("/compact   spaced   out  ")).toEqual({
      name: "compact",
      argument: "spaced   out",
    });
  });

  it("P1d — no leading slash", () => {
    expect(parseSlashInput("hello /compact")).toBeNull();
  });

  it("P1e — empty body", () => {
    expect(parseSlashInput("/")).toBeNull();
  });

  it("P1f — /2 + 2 = ? parses a name of \"2\"", () => {
    expect(parseSlashInput("/2 + 2 = ?")).toEqual({ name: "2", argument: "+ 2 = ?" });
  });

  it("P1g — /what? — name contains ?", () => {
    expect(parseSlashInput("/what?")).toBeNull();
  });

  it("P1h — dash and underscore are legal", () => {
    expect(parseSlashInput("/my-cmd_2")).toEqual({ name: "my-cmd_2", argument: "" });
  });

  it("P1i — non-ASCII fails the pattern", () => {
    expect(parseSlashInput("/新しい")).toBeNull();
  });
});

describe("buildCommandList", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("P2a — a host skill plus the two core commands", () => {
    const s = skill({ name: "summary", command: true, aliases: ["sum"] });
    const { entries } = buildCommandList(coreCmds(), [s]);
    expect(entries).toHaveLength(3);
    const summary = entries.find((e) => e.name === "summary")!;
    expect(summary.matchNames).toEqual(["summary", "sum"]);
    expect(summary.displayName).toBe("summary");
    expect(summary.kind).toBe("skill");
  });

  it("P2b — command absent is not in entries", () => {
    const s = skill({ name: "summary" });
    const { entries } = buildCommandList([], [s]);
    expect(entries).toHaveLength(0);
  });

  it("P2c — command: false is not in entries", () => {
    const s = skill({ name: "summary", command: false });
    const { entries } = buildCommandList([], [s]);
    expect(entries).toHaveLength(0);
  });

  it("P2d — a non-reserved skill still wins its name (host-first rule unchanged)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = skill({ name: "summary", command: true, aliases: ["sum"] });
    const list = buildCommandList(coreCmds(), [s]);
    expect(list.resolve("summary")?.kind).toBe("skill");
    expect(list.resolve("sum")?.kind).toBe("skill");
    expect(warn).not.toHaveBeenCalled();
  });

  it("P2e — skill named 'new' and 'clear' cannot displace core; both names resolve to the core action", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s1 = skill({ name: "new", command: true });
    const s2 = skill({ name: "clear", command: true });
    const list = buildCommandList(coreCmds(), [s1, s2]);
    expect(list.resolve("new")?.kind).toBe("action");
    expect(list.resolve("new")?.description).toBe("Start a fresh session");
    expect(list.resolve("clear")?.kind).toBe("action");
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("P2f — host skill named COMPACT (upper case) cannot claim the reserved name", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = skill({ name: "COMPACT", command: true });
    const list = buildCommandList(coreCmds(), [s]);
    expect(list.resolve("compact")?.kind).toBe("action");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("P2g — two host skills with the same name: both appear, resolve returns the first", () => {
    const s1 = skill({ name: "dup", command: true, definition: "first" });
    const s2 = skill({ name: "dup", command: true, definition: "second" });
    const list = buildCommandList([], [s1, s2]);
    expect(list.entries).toHaveLength(2);
    expect(list.resolve("dup")).toBe(list.entries[0]);
  });

  it("buildCommandList([], []) returns an empty, non-throwing list", () => {
    const list = buildCommandList([], []);
    expect(list.entries).toEqual([]);
    expect(list.resolve("anything")).toBeUndefined();
  });

  it("a skill with command: true and no aliases defaults aliases to []", () => {
    const s = skill({ name: "summary", command: true });
    const { entries } = buildCommandList([], [s]);
    expect(entries[0].aliases).toEqual([]);
    expect(entries[0].matchNames).toEqual(["summary"]);
  });

  // --- Branch B tests (001/113) ---

  it("001/B — a skill named 'new' cannot displace core's command", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = skill({ name: "new", command: true, aliases: [] });
    const list = buildCommandList(coreCmds(), [s]);
    expect(list.resolve("new")?.kind).toBe("action");
    expect(list.resolve("new")?.description).toBe("Start a fresh session");
    warn.mockRestore();
  });

  it("001/B — a skill aliased 'clear' cannot displace core's alias", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = skill({ name: "reset", aliases: ["clear"], command: true });
    const list = buildCommandList(coreCmds(), [s]);
    expect(list.resolve("clear")?.name).toBe("new");   // core owns it
    expect(list.resolve("reset")?.kind).toBe("skill"); // non-reserved name still works
    warn.mockRestore();
  });

  it("001/B — warns once, naming the skill, when a reserved name is refused", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = skill({ name: "myscill", aliases: ["new"], command: true });
    buildCommandList(coreCmds(), [s]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("new");
    expect(String(warn.mock.calls[0][0])).toContain("myscill");
    warn.mockRestore();
  });

  it("001/B — a refused skill still appears in entries", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const s = skill({ name: "new", command: true, aliases: [] });
    const list = buildCommandList(coreCmds(), [s]);
    expect(list.entries.some((e) => e.name === "new" && e.kind === "skill")).toBe(true);
    expect(list.resolve("new")?.kind).toBe("action");
    warn.mockRestore();
  });
});


describe("resolve (P3)", () => {
  it("P3a — resolve(\"compact\")", () => {
    const list = buildCommandList(coreCmds(), []);
    expect(list.resolve("compact")).toBe(list.entries.find((e) => e.name === "compact"));
  });

  it("P3b — resolve is case-insensitive", () => {
    const list = buildCommandList(coreCmds(), []);
    expect(list.resolve("COMPACT")).toBe(list.resolve("compact"));
  });

  it("P3c — resolve(\"clear\") and resolve(\"new\") are the SAME entry", () => {
    const list = buildCommandList(coreCmds(), []);
    expect(list.resolve("clear")).toBe(list.resolve("new"));
  });

  it("P3d — resolve(\"nope\") is undefined", () => {
    const list = buildCommandList(coreCmds(), []);
    expect(list.resolve("nope")).toBeUndefined();
  });
});
