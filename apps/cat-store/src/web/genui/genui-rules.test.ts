import { describe, expect, it } from "vitest";
import {
  approvedColoursRule,
  componentEquivalentsRule,
  formatViolations,
  getLineAndColumn,
  regexRule,
  registeredElementsRule,
  runRules,
  stripHtmlComments,
  type RuleContext,
} from "./genui-rules";
import {
  GENUI_APPROVED_COLOUR_TOKENS,
  GENUI_TOKEN_ROLES,
} from "./genui-config";

describe("stripHtmlComments", () => {
  it("preserves line offsets when stripping comments", () => {
    const source = "<!-- line1\nline2 --><div>";
    const stripped = stripHtmlComments(source);
    // Line count must be the same
    expect(stripped.split("\n").length).toBe(source.split("\n").length);
    // Non-whitespace comment content is gone
    expect(stripped).not.toContain("line1");
    expect(stripped).toContain("<div>");
  });
});

describe("getLineAndColumn", () => {
  it("returns line 1 column 1 for index 0", () => {
    expect(getLineAndColumn("abc", 0)).toEqual({ line: 1, column: 1 });
  });

  it("returns correct line and column after newline", () => {
    // "ab\ncd" — index 3 is 'c', which is line 2, column 1
    expect(getLineAndColumn("ab\ncd", 3)).toEqual({ line: 2, column: 1 });
  });
});

describe("regexRule", () => {
  it("calculates line and column for a match", async () => {
    const rule = regexRule({
      id: "test-rule",
      pattern: /foo/,
      message: "found foo",
    });
    const source = "hello\nfoo bar";
    const violations = await rule.check(source, {});
    expect(violations).toHaveLength(1);
    expect(violations[0].line).toBe(2);
    expect(violations[0].column).toBe(1);
    expect(violations[0].ruleId).toBe("test-rule");
  });

  it("calls message function with match array", async () => {
    const rule = regexRule({
      id: "test-rule",
      pattern: /(foo)/,
      message: (m) => `matched: ${m[1]}`,
    });
    const violations = await rule.check("foo", {});
    expect(violations[0].message).toBe("matched: foo");
  });
});

describe("componentEquivalentsRule", () => {
  it("flags raw button with Material mapping", async () => {
    const rule = componentEquivalentsRule({ button: "md-filled-button" });
    const violations = await rule.check("<button>Click</button>", {});
    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain("md-filled-button");
  });

  it("does not flag md-filled-button with Material mapping", async () => {
    const rule = componentEquivalentsRule({ button: "md-filled-button" });
    const violations = await rule.check("<md-filled-button>Click</md-filled-button>", {});
    expect(violations).toHaveLength(0);
  });

  it("flags raw button with Vaadin mapping and names vaadin-button", async () => {
    const rule = componentEquivalentsRule({ button: "vaadin-button" });
    const violations = await rule.check("<button>Click</button>", {});
    expect(violations).toHaveLength(1);
    expect(violations[0].message).toContain("vaadin-button");
  });

  it("does not flag button inside HTML comment", async () => {
    const rule = componentEquivalentsRule({ button: "md-filled-button" });
    const source = "<!-- <button>Click</button> -->";
    const violations = await rule.check(source, {});
    expect(violations).toHaveLength(0);
  });

  it("returns empty violations for empty map", async () => {
    const rule = componentEquivalentsRule({});
    const violations = await rule.check("<button>Click</button>", {});
    expect(violations).toHaveLength(0);
  });
});

describe("approvedColoursRule", () => {
  const noCtx: RuleContext = {};

  it("flags hex color literals", async () => {
    const rule = approvedColoursRule();
    const violations = await rule.check("color: #ff0000;", noCtx);
    expect(violations.some((v) => v.snippet?.startsWith("#ff0000"))).toBe(true);
  });

  it("does not flag CSS variable theme tokens", async () => {
    const rule = approvedColoursRule();
    const violations = await rule.check("color: var(--wa-primary);", noCtx);
    expect(violations).toHaveLength(0);
  });

  it("does not flag CSS id selectors", async () => {
    const rule = approvedColoursRule();
    const violations = await rule.check("#abc { width: 100px; }", noCtx);
    // #abc followed by { should not be flagged
    expect(violations).toHaveLength(0);
  });

  it("flags hex color inside script el.style assignment", async () => {
    const rule = approvedColoursRule();
    const source = "<script>el.style.color = '#00ff00';</script>";
    const violations = await rule.check(source, noCtx);
    expect(violations.some((v) => v.snippet?.includes("#00ff00"))).toBe(true);
  });

  it("flags rgb() function calls", async () => {
    const rule = approvedColoursRule();
    const violations = await rule.check("color: rgb(255, 0, 0);", noCtx);
    expect(violations.some((v) => v.snippet?.startsWith("rgb("))).toBe(true);
  });

  it("flags named colors when CSS.supports oracle is provided", async () => {
    const rule = approvedColoursRule();
    const cssOracle = { supports: (_prop: string, val: string) => val === "red" };
    const ctx: RuleContext = { win: { CSS: cssOracle } as unknown as Window };
    const violations = await rule.check("color: red;", ctx);
    expect(violations.some((v) => v.snippet === "red")).toBe(true);
  });

  it("does not flag transparent, inherit, initial, currentColor", async () => {
    const rule = approvedColoursRule();
    const cssOracle = { supports: () => false };
    const ctx: RuleContext = { win: { CSS: cssOracle } as unknown as Window };
    for (const word of ["transparent", "inherit", "initial", "currentColor"]) {
      const violations = await rule.check(`color: ${word};`, ctx);
      expect(violations).toHaveLength(0);
    }
  });

  it("the snippet is unchanged when no vocabulary is given", () => {
    const noArg = approvedColoursRule().promptSnippet;
    const emptyArr = approvedColoursRule({ available: [] }).promptSnippet;
    expect(noArg).toBe(emptyArr);
    // The default example must name a token that actually resolves. It used
    // to be --wa-primary, which is declared in no theme, so the model was
    // taught a name it would emit into generated UI as a frozen fallback.
    expect(noArg).toContain("var(--wa-action-color-info)");
    expect(noArg).not.toContain("--wa-primary)");
  });

  it("the snippet and every violation message name a real, curated token", async () => {
    const rule = approvedColoursRule({ available: ["--wa-action-color-error", "--wa-background-color"] });
    expect(rule.promptSnippet).toContain("var(--wa-action-color-error)");
    expect(rule.promptSnippet).toContain("var(--wa-background-color)");
    // The defect this guards: a required example that names a token
    // which is not in the served stylesheet (--wa-primary is not real,
    // and neither is --wa-primary-color — a legacy name wa-tokens.css
    // itself documents as replaced by --wa-action-color-info).
    expect(rule.promptSnippet).not.toContain("--wa-primary)");
    expect(rule.promptSnippet).not.toContain("--wa-primary-color)");
    const violations = await rule.check("color: #ff0000;", {});
    expect(violations[0]?.message).toContain("var(--wa-action-color-error)");
  });

  it("prompt snippet names every approved token with its role and restricts action-text", () => {
    const rule = approvedColoursRule({
      available: GENUI_APPROVED_COLOUR_TOKENS,
      roles: GENUI_TOKEN_ROLES,
    });
    for (const token of GENUI_APPROVED_COLOUR_TOKENS) {
      expect(rule.promptSnippet).toContain(`var(${token})`);
      expect(rule.promptSnippet).toContain(GENUI_TOKEN_ROLES[token]);
    }
    const actionTextTokens = GENUI_APPROVED_COLOUR_TOKENS.filter((t) => t.includes("-action-text-"));
    expect(actionTextTokens.length).toBeGreaterThan(0);
    for (const token of actionTextTokens) {
      const role = GENUI_TOKEN_ROLES[token];
      expect(role).toMatch(/only on.*matching/i);
    }
  });
});

describe("registeredElementsRule", () => {
  it("flags unregistered custom elements", async () => {
    const rule = registeredElementsRule();
    const registry = { get: (tag: string) => (tag === "md-filled-button" ? class extends HTMLElement {} : undefined) };
    const ctx: RuleContext = { win: { customElements: registry } as unknown as Window };
    const violations = await rule.check("<md-buton>text</md-buton>", ctx);
    expect(violations.some((v) => v.message.includes("md-buton"))).toBe(true);
  });

  it("does not flag registered custom elements", async () => {
    const rule = registeredElementsRule();
    const registry = { get: () => class extends HTMLElement {} };
    const ctx: RuleContext = { win: { customElements: registry } as unknown as Window };
    const violations = await rule.check("<md-filled-button>text</md-filled-button>", ctx);
    expect(violations).toHaveLength(0);
  });

  it("does not flag custom elements inside comments", async () => {
    const rule = registeredElementsRule();
    const registry = { get: () => undefined };
    const ctx: RuleContext = { win: { customElements: registry } as unknown as Window };
    const source = "<!-- <md-buton>Click</md-buton> -->";
    const violations = await rule.check(source, ctx);
    expect(violations).toHaveLength(0);
  });

  it("the snippet is unchanged when no vocabulary is given", () => {
    const noArg = registeredElementsRule().promptSnippet;
    const emptyArr = registeredElementsRule({ available: [] }).promptSnippet;
    expect(noArg).toBe(emptyArr);
    expect(noArg).not.toContain("<");
  });

  it("the snippet names every available component", () => {
    const snippet = registeredElementsRule({
      available: ["md-filled-button", "md-checkbox"],
    }).promptSnippet!;
    expect(snippet).toContain("<md-filled-button>");
    expect(snippet).toContain("<md-checkbox>");
  });
});

describe("formatViolations", () => {
  it("renders single readable string with rule id and location", () => {
    const formatted = formatViolations([
      { ruleId: "test", message: "do something", line: 3, column: 7 },
    ]);
    expect(formatted).toContain("[test]");
    expect(formatted).toContain("line 3");
    expect(formatted).toContain("col 7");
    expect(formatted).toContain("do something");
  });

  it("joins multiple violations with newlines", () => {
    const formatted = formatViolations([
      { ruleId: "a", message: "msg a" },
      { ruleId: "b", message: "msg b" },
    ]);
    const lines = formatted.split("\n");
    expect(lines).toHaveLength(2);
  });
});

describe("runRules", () => {
  it("runs all rules and collects violations", async () => {
    const ruleA = { id: "a", check: () => [{ ruleId: "a", message: "a violation" }] };
    const ruleB = { id: "b", check: () => [{ ruleId: "b", message: "b violation" }] };
    const violations = await runRules("source", [ruleA, ruleB], {});
    expect(violations).toHaveLength(2);
  });

  it("returns empty array for empty rule list", async () => {
    const violations = await runRules("source", [], {});
    expect(violations).toHaveLength(0);
  });
});
