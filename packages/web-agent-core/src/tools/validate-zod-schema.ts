import type { z } from "zod";
import { schemaViolation } from "./error-messages.js";

/**
 * Argument validation for tools authored with a zod schema — the counterpart of
 * `validateJsonSchemaInput` for the other branch of `ToolInputSchema`.
 *
 * Unlike that module this one is imported statically: `zod` is already in
 * core's static graph (`tools/build-tools.ts` imports it), so there is no
 * bundle cost to defer. Do NOT import `validate-json-schema.js` from here —
 * that would drag `ajv` into the eager graph.
 */

/**
 * Flatten one zod error into `path: message` lines.
 *
 * `error.flatten()` is deliberately NOT used: it collapses a nested path to its
 * top-level key, which would report `config: Invalid input` where the model
 * needs `config.data.datasets.0.data.0: Expected number, received string`.
 *
 * A failed `z.union` arrives as a single `invalid_union` issue whose own
 * message is the useless string "Invalid input"; the real reasons sit in
 * `unionErrors`, and their paths are already absolute — so recurse into them
 * and do not re-prefix. Measured against zod 3.25.76 on 2026-09-03.
 */
function issueLines(error: z.ZodError): string[] {
  return error.issues.flatMap((issue) =>
    issue.code === "invalid_union"
      ? issue.unionErrors.flatMap((inner) => issueLines(inner))
      : [`${issue.path.join(".") || "root"}: ${issue.message}`],
  );
}

/**
 * Validate `input` against a zod schema. Returns `null` when valid, or the
 * schema-violation message when not — the same wording the JSON-Schema branch
 * produces, via the same builder.
 *
 * Validation only: `parsed.data` is discarded, so `execute` keeps receiving the
 * object the model actually sent and a valid call behaves exactly as before.
 */
export function validateZodInput(
  name: string,
  schema: z.ZodType,
  input: Record<string, unknown>,
): string | null {
  const parsed = schema.safeParse(input);
  if (parsed.success) return null;
  const detail = [...new Set(issueLines(parsed.error))].join("; ");
  return schemaViolation(name, detail);
}
