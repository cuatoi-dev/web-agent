import { describe, it, expect, vi } from "vitest";
import type { CommandEntry } from "@cuatoi/web-agent-core";
import {
  SLASH_ICON_ACTION,
  SLASH_ICON_SKILL,
  filterCommandEntries,
  aliasHintFor,
  renderSlashMenu,
  type SlashMenuModel,
} from "./slash-menu.js";

describe("slash-menu", () => {
  const demo = {
    name: "demo",
    displayName: "demo",
    description: "Run the full capability demo",
    aliases: [],
    matchNames: ["demo"],
    kind: "skill",
  } as CommandEntry;

  const finance = {
    name: "finance-demo",
    displayName: "finance-demo",
    description: "Finance chart demo",
    aliases: ["finance"],
    matchNames: ["finance-demo", "finance"],
    kind: "skill",
  } as CommandEntry;

  const shop = {
    name: "shop-manager-report",
    displayName: "shop-manager-report",
    description: "Monthly shop report",
    argumentHint: "[month]",
    aliases: ["report"],
    matchNames: ["shop-manager-report", "report"],
    kind: "skill",
  } as CommandEntry;

  const compact = {
    name: "compact",
    displayName: "compact",
    description: "Summarise to free up context",
    argumentHint: "[then…]",
    aliases: [],
    matchNames: ["compact"],
    kind: "action",
  } as CommandEntry;

  const fresh = {
    name: "new",
    displayName: "new",
    description: "Start a fresh session",
    argumentHint: "[then…]",
    aliases: ["clear"],
    matchNames: ["new", "clear"],
    kind: "action",
  } as CommandEntry;

  const ALL: CommandEntry[] = [demo, finance, shop, compact, fresh];

  describe("filterCommandEntries", () => {
    it("empty query keeps registration order", () => {
      const res = filterCommandEntries(ALL, "");
      expect(res.map((e) => e.displayName)).toEqual([
        "demo",
        "finance-demo",
        "shop-manager-report",
        "compact",
        "new",
      ]);
    });

    it("empty query returns a COPY", () => {
      const before = ALL.length;
      const res = filterCommandEntries(ALL, "");
      expect(res).not.toBe(ALL);
      res.pop();
      expect(ALL.length).toBe(before);
    });

    it("'sho' matches one entry", () => {
      expect(filterCommandEntries(ALL, "sho")).toEqual([shop]);
    });

    it("'sh' returns exactly one entry shop-manager-report (rank tiering excludes rank 3)", () => {
      expect(filterCommandEntries(ALL, "sh")).toEqual([shop]);
    });

    it("'SH' matches the same entry (case-insensitive)", () => {
      expect(filterCommandEntries(ALL, "SH")).toEqual([shop]);
    });

    it("matches mid-word description hit with query under 3 characters", () => {
      // 'mm' matches 'Summarise' in compact's description (rank 3)
      expect(filterCommandEntries(ALL, "mm")).toEqual([compact]);
    });

    it("description-only query with no name/alias match still returns its rank-3 entries", () => {
      // 'fresh' matches 'Start a fresh session' in new's description (rank 3)
      expect(filterCommandEntries(ALL, "fresh")).toEqual([fresh]);
    });

    it("'clear' reaches new through matchNames", () => {
      expect(filterCommandEntries(ALL, "clear")).toEqual([fresh]);
    });

    it("'report' reaches shop through matchNames, not through name prefix", () => {
      expect(filterCommandEntries(ALL, "report")).toEqual([shop]);
    });

    it("rank tiering: a name prefix match retains only rank 0 and excludes description hits", () => {
      const prefixEntry = {
        name: "cat",
        displayName: "cat",
        description: "something else",
        aliases: [],
        matchNames: ["cat"],
        kind: "skill",
      } as CommandEntry;
      const descEntry = {
        name: "dog",
        displayName: "dog",
        description: "likes cat food",
        aliases: [],
        matchNames: ["dog"],
        kind: "skill",
      } as CommandEntry;
      const res = filterCommandEntries([descEntry, prefixEntry], "cat");
      expect(res).toEqual([prefixEntry]);
    });

    it("rank ties keep registration order", () => {
      // Both demo and shop have 'o' in displayName (rank 2)
      const res = filterCommandEntries(ALL, "o");
      expect(res.includes(demo)).toBe(true);
      expect(res.includes(shop)).toBe(true);
      expect(res.indexOf(demo)).toBeLessThan(res.indexOf(shop));
    });

    it("no match returns empty array", () => {
      expect(filterCommandEntries(ALL, "zzz")).toEqual([]);
    });
  });

  describe("filterCommandEntries (scheduler commands)", () => {
    const sch = {
      name: "schedule",
      displayName: "schedule",
      description: "Repeat a task, or remind me once",
      aliases: [],
      matchNames: ["schedule"],
      kind: "skill",
    } as CommandEntry;
    const schList = {
      name: "schedule-list",
      displayName: "schedule-list",
      description: "Show what is pending",
      aliases: [],
      matchNames: ["schedule-list"],
      kind: "skill",
    } as CommandEntry;
    const schCancel = {
      name: "schedule-cancel",
      displayName: "schedule-cancel",
      description: "Cancel one by name",
      aliases: [],
      matchNames: ["schedule-cancel"],
      kind: "skill",
    } as CommandEntry;
    const SCHEDULER = [
      sch,
      schList,
      schCancel,
      demo,
      finance,
      compact,
    ];

    it("'sch' matches all three scheduler commands", () => {
      const res = filterCommandEntries(SCHEDULER, "sch");
      expect(res.map((e) => e.displayName)).toEqual([
        "schedule",
        "schedule-list",
        "schedule-cancel",
      ]);
      for (const entry of res) {
        expect(entry.kind).toBe("skill");
      }
    });

    it("'sch' matches 0 when scheduler commands are absent", () => {
      expect(filterCommandEntries(ALL, "sch")).toEqual([]);
    });
  });

  describe("aliasHintFor", () => {
    it("aliasHintFor(fresh) equals 'or /clear'", () => {
      expect(aliasHintFor(fresh)).toBe("or /clear");
    });

    it("aliasHintFor(shop) equals 'or /report'", () => {
      expect(aliasHintFor(shop)).toBe("or /report");
    });

    it("aliasHintFor(demo) equals ''", () => {
      expect(aliasHintFor(demo)).toBe("");
    });

    it("aliasHintFor ignores case when removing display name", () => {
      const entry = {
        name: "demo",
        displayName: "demo",
        description: "Test",
        aliases: [],
        matchNames: ["demo", "DEMO"],
        kind: "skill",
      } as CommandEntry;
      expect(aliasHintFor(entry)).toBe("");
    });
  });

  describe("renderSlashMenu", () => {
    it("builds one option per entry", () => {
      const container = document.createElement("div");
      renderSlashMenu(container, {
        entries: ALL,
        highlight: 0,
        idPrefix: "wa-opt-",
        onPick: vi.fn(),
      });
      expect(container.querySelectorAll('[role="option"]').length).toBe(ALL.length);
    });

    it("ids are idPrefix + index", () => {
      const container = document.createElement("div");
      renderSlashMenu(container, {
        entries: ALL,
        highlight: 0,
        idPrefix: "x-",
        onPick: vi.fn(),
      });
      const options = container.querySelectorAll('[role="option"]');
      expect(options[0].id).toBe("x-0");
      expect(options[4].id).toBe("x-4");
    });

    it("exactly one row is selected and carries is-highlighted", () => {
      const container = document.createElement("div");
      renderSlashMenu(container, {
        entries: ALL,
        highlight: 2,
        idPrefix: "x-",
        onPick: vi.fn(),
      });
      const options = container.querySelectorAll('[role="option"]');
      options.forEach((opt, idx) => {
        if (idx === 2) {
          expect(opt.getAttribute("aria-selected")).toBe("true");
          expect(opt.classList.contains("is-highlighted")).toBe(true);
        } else {
          expect(opt.getAttribute("aria-selected")).toBe("false");
          expect(opt.classList.contains("is-highlighted")).toBe(false);
        }
      });
    });

    it("action and skill glyphs differ and equal exported constants", () => {
      const container = document.createElement("div");
      renderSlashMenu(container, {
        entries: ALL,
        highlight: 0,
        idPrefix: "x-",
        onPick: vi.fn(),
      });
      const demoIcon = container.querySelector("#x-0 .wa-slash-icon")!;
      const compactIcon = container.querySelector("#x-3 .wa-slash-icon")!;
      expect(demoIcon.innerHTML).not.toBe(compactIcon.innerHTML);
      expect(demoIcon.innerHTML).toBe(SLASH_ICON_SKILL);
      expect(compactIcon.innerHTML).toBe(SLASH_ICON_ACTION);
    });

    it("every glyph is hidden from assistive tech", () => {
      const container = document.createElement("div");
      renderSlashMenu(container, {
        entries: ALL,
        highlight: 0,
        idPrefix: "x-",
        onPick: vi.fn(),
      });
      const icons = container.querySelectorAll(".wa-slash-icon");
      icons.forEach((icon) => {
        expect(icon.getAttribute("aria-hidden")).toBe("true");
      });
    });

    it("argument hint renders only when present", () => {
      const container = document.createElement("div");
      renderSlashMenu(container, {
        entries: ALL,
        highlight: 0,
        idPrefix: "x-",
        onPick: vi.fn(),
      });
      const shopArg = container.querySelector("#x-2 .wa-slash-arg");
      expect(shopArg?.textContent).toBe("[month]");
      const demoArg = container.querySelector("#x-0 .wa-slash-arg");
      expect(demoArg).toBeNull();
    });

    it("alias hint renders only when there is one", () => {
      const container = document.createElement("div");
      renderSlashMenu(container, {
        entries: ALL,
        highlight: 0,
        idPrefix: "x-",
        onPick: vi.fn(),
      });
      const freshAlias = container.querySelector("#x-4 .wa-slash-alias");
      expect(freshAlias?.textContent).toBe("or /clear");
      const demoAlias = container.querySelector("#x-0 .wa-slash-alias");
      expect(demoAlias).toBeNull();
    });

    it("description renders", () => {
      const container = document.createElement("div");
      renderSlashMenu(container, {
        entries: ALL,
        highlight: 0,
        idPrefix: "x-",
        onPick: vi.fn(),
      });
      const desc = container.querySelector("#x-0 .wa-slash-desc");
      expect(desc?.textContent).toBe(demo.description);
    });

    it("no provenance badge", () => {
      const container = document.createElement("div");
      renderSlashMenu(container, {
        entries: ALL,
        highlight: 0,
        idPrefix: "x-",
        onPick: vi.fn(),
      });
      expect(container.textContent).not.toContain("HOST");
    });

    it("legend states both kinds in words, shows both glyphs, and key hint is present", () => {
      const container = document.createElement("div");
      renderSlashMenu(container, {
        entries: ALL,
        highlight: 0,
        idPrefix: "x-",
        onPick: vi.fn(),
      });
      expect(container.textContent).toContain("runs an action");
      expect(container.textContent).toContain("briefs the agent");
      const legendIcons = container.querySelectorAll(".wa-slash-legend .wa-slash-icon");
      expect(legendIcons.length).toBe(2);
      const keys = container.querySelector(".wa-slash-keys");
      expect(keys?.textContent).toBe("↑↓ · Tab · Esc");
    });

    it("clicking a row calls onPick with that entry", () => {
      const container = document.createElement("div");
      const onPick = vi.fn();
      renderSlashMenu(container, {
        entries: ALL,
        highlight: 0,
        idPrefix: "x-",
        onPick,
      });
      const row3 = container.querySelector("#x-3") as HTMLElement;
      row3.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(onPick).toHaveBeenCalledTimes(1);
      expect(onPick).toHaveBeenCalledWith(ALL[3]);
    });

    it("a second render replaces, never appends", () => {
      const container = document.createElement("div");
      const model: SlashMenuModel = {
        entries: ALL,
        highlight: 0,
        idPrefix: "x-",
        onPick: vi.fn(),
      };
      renderSlashMenu(container, model);
      renderSlashMenu(container, model);
      expect(container.querySelectorAll('[role="option"]').length).toBe(ALL.length);
    });
  });
});
