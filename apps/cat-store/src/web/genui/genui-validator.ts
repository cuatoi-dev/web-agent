import type { GenuiConfig } from "./genui-config";
import { formatViolations, runRules } from "./genui-rules";
import { checkSyntax } from "./genui-syntax";
import type { RuleContext, ValidationResult } from "./types";

export type { ValidationResult } from "./types";

export async function validateGenuiSource(
  source: string,
  config: GenuiConfig,
  ctx: RuleContext = {},
): Promise<ValidationResult> {
  // 1. Syntax pre-check
  const syntaxViolations = checkSyntax(source);
  if (syntaxViolations.length > 0) {
    return {
      valid: false,
      violations: syntaxViolations,
      formattedMessage: formatViolations(syntaxViolations),
    };
  }

  // 2. Rule engine
  const rules = config.rules ?? [];
  if (rules.length === 0) {
    return {
      valid: true,
      violations: [],
      formattedMessage: null,
    };
  }

  const ruleViolations = await runRules(source, rules, ctx);
  return {
    valid: ruleViolations.length === 0,
    violations: ruleViolations,
    formattedMessage: ruleViolations.length > 0 ? formatViolations(ruleViolations) : null,
  };
}
