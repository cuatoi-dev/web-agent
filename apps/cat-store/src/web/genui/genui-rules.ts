import type { HtmlRule, RegexRuleOptions, RuleContext, Violation } from "./types";

export type { Violation, RuleContext, HtmlRule, RegexRuleOptions } from "./types";

export function stripHtmlComments(source: string): string {
  return source.replace(/<!--[\s\S]*?-->/g, (match) => {
    return match.replace(/[^\r\n]/g, " ");
  });
}

export function getLineAndColumn(source: string, index: number): { line: number; column: number } {
  const prefix = source.slice(0, index);
  const lines = prefix.split("\n");
  const line = lines.length;
  const column = lines[lines.length - 1].length + 1;
  return { line, column };
}

export function regexRule(options: RegexRuleOptions): HtmlRule {
  return {
    id: options.id,
    promptSnippet: options.promptSnippet,
    check(source: string): Violation[] {
      const textToSearch = options.stripComments ? stripHtmlComments(source) : source;
      const flags = options.pattern.flags.includes("g") ? options.pattern.flags : options.pattern.flags + "g";
      const regex = new RegExp(options.pattern.source, flags);
      const violations: Violation[] = [];
      let match: RegExpExecArray | null;

      while ((match = regex.exec(textToSearch)) !== null) {
        const { line, column } = getLineAndColumn(source, match.index);
        const msg = typeof options.message === "function" ? options.message(match) : options.message;
        violations.push({
          ruleId: options.id,
          message: msg,
          line,
          column,
          snippet: match[0],
        });
      }
      return violations;
    },
  };
}

export function formatViolations(violations: Violation[]): string {
  return violations
    .map((v) => {
      const loc = v.line !== undefined ? ` (line ${v.line}${v.column !== undefined ? `, col ${v.column}` : ""})` : "";
      return `[${v.ruleId}]${loc}: ${v.message}`;
    })
    .join("\n");
}

export async function runRules(source: string, rules: HtmlRule[], ctx: RuleContext): Promise<Violation[]> {
  const allViolations: Violation[] = [];
  for (const rule of rules) {
    const result = await rule.check(source, ctx);
    allViolations.push(...result);
  }
  return allViolations;
}

export function componentEquivalentsRule(map: Record<string, string>): HtmlRule {
  const tags = Object.keys(map);
  if (tags.length === 0) {
    return { id: "component-equivalents", check: () => [] };
  }
  const tagPattern = tags.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const pattern = new RegExp(`<(${tagPattern})(\\s|>|$)`, "gi");

  return regexRule({
    id: "component-equivalents",
    pattern,
    stripComments: true,
    message: (match) => {
      const tag = match[1].toLowerCase();
      const replacement = map[tag] ?? map[Object.keys(map).find((k) => k.toLowerCase() === tag) ?? ""];
      return `Replace <${tag}> with <${replacement}>.`;
    },
    promptSnippet: `Use custom components instead of raw HTML controls: ${Object.entries(map)
      .map(([from, to]) => `<${to}> instead of <${from}>`)
      .join(", ")}.`,
  });
}

export function approvedColoursRule(options?: {
  allowedPrefix?: string;
  available?: string[];
  roles?: Record<string, string>;
}): HtmlRule {
  const hexPattern = /#([0-9a-fA-F]{3,8})\b(?!\s*\{)/g;
  const rgbPattern = /\b(?:rgb|rgba|hsl|hsla)\([^)]+\)/gi;
  const available = options?.available ?? [];
  const roles = options?.roles;
  // Calling this rule with no `available` keeps the generic prompt string.
  // With a curated list the example (and every violation message) names the
  // FIRST real token, so the model is pointed at a name that actually
  // resolves instead of a placeholder that silently renders as nothing.
  const exampleToken = available[0] ?? "--wa-action-color-info";
  const example = `var(${exampleToken})`;
  const promptSnippet =
    available.length > 0
      ? `Use --wa-* theme tokens instead of literal colors. Real tokens and their roles: ${available
          .map((t) => (roles?.[t] ? `var(${t}) (${roles[t]})` : `var(${t})`))
          .join(", ")}.`
      : "Use --wa-* theme tokens (e.g. var(--wa-action-color-info)) instead of literal colors.";

  return {
    id: "approved-colours",
    promptSnippet,
    check(source: string, ctx: RuleContext): Violation[] {
      const violations: Violation[] = [];
      // `Window` carries no `.CSS` member in lib.dom.d.ts (only the global
      // `CSS` namespace is typed), so a host window's copy needs a structural
      // read for the one member this rule calls.
      const cssOracle: { supports: (property: string, value: string) => boolean } | null =
        (ctx.win as unknown as { CSS?: typeof CSS } | undefined)?.CSS
        ?? (typeof CSS !== "undefined" ? CSS : null);

      let match: RegExpExecArray | null;

      // Check hex literals
      const hexRe = new RegExp(hexPattern.source, hexPattern.flags);
      while ((match = hexRe.exec(source)) !== null) {
        const { line, column } = getLineAndColumn(source, match.index);
        violations.push({
          ruleId: "approved-colours",
          message: `Replace color literal '${match[0]}' with a --wa-* theme token (for example ${example}).`,
          line,
          column,
          snippet: match[0],
        });
      }

      // Check rgb / hsl function calls
      const rgbRe = new RegExp(rgbPattern.source, rgbPattern.flags);
      while ((match = rgbRe.exec(source)) !== null) {
        const { line, column } = getLineAndColumn(source, match.index);
        violations.push({
          ruleId: "approved-colours",
          message: `Replace color literal '${match[0]}' with a --wa-* theme token (for example ${example}).`,
          line,
          column,
          snippet: match[0],
        });
      }

      // Check named color words in style attributes, style blocks, and script assignments
      const colorWordPattern = /(?:color|background-color|border-color|fill|stroke)\s*[:=]\s*['"]?([a-zA-Z]+)['"]?/gi;
      while ((match = colorWordPattern.exec(source)) !== null) {
        const word = match[1].toLowerCase();
        if (word === "transparent" || word === "currentcolor" || word === "inherit" || word === "initial") {
          continue;
        }
        if (cssOracle?.supports && cssOracle.supports("color", word)) {
          const wordOffset = match.index + match[0].lastIndexOf(match[1]);
          const { line, column } = getLineAndColumn(source, wordOffset);
          violations.push({
            ruleId: "approved-colours",
            message: `Replace color literal '${word}' with a --wa-* theme token (for example ${example}).`,
            line,
            column,
            snippet: word,
          });
        }
      }

      return violations;
    },
  };
}

export function registeredElementsRule(options?: { available?: string[] }): HtmlRule {
  const customTagPattern = /(<)([a-z][a-z0-9]*-[a-z0-9-]*)/gi;
  const available = options?.available ?? [];
  const promptSnippet =
    available.length > 0
      ? `Only use custom elements that are registered in the frame. The registered components are: ${available
          .map((tag) => `<${tag}>`)
          .join(", ")}.`
      : "Only use custom elements that are registered in the frame.";

  return {
    id: "registered-elements",
    promptSnippet,
    check(source: string, ctx: RuleContext): Violation[] {
      const textToSearch = stripHtmlComments(source);
      const violations: Violation[] = [];
      const registry = ctx.win?.customElements ?? (typeof customElements !== "undefined" ? customElements : null);
      let match: RegExpExecArray | null;
      const tagRe = new RegExp(customTagPattern.source, customTagPattern.flags);

      while ((match = tagRe.exec(textToSearch)) !== null) {
        const tagName = match[2].toLowerCase();
        if (registry && !registry.get(tagName)) {
          const { line, column } = getLineAndColumn(source, match.index);
          violations.push({
            ruleId: "registered-elements",
            message: `Custom element '<${tagName}>' is not registered in the frame. Check for typos or register the component.`,
            line,
            column,
            snippet: match[0],
          });
        }
      }
      return violations;
    },
  };
}
