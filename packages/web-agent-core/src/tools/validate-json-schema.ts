/**
 * ajv-backed argument validation for tools authored with a raw JSON Schema.
 *
 * This module is reached ONLY through dynamic `import()` calls from `wrapExecutor`
 * (tools/build-tools.ts), `validateDataQuery` (datasource/types.ts) and
 * `validateUIBlock` / `validateRenderableBlock` (ui-blocks/schema.ts), so `ajv`
 * never enters core's static import graph. Keep
 * it that way: do not import this module at the top level of any other core file.
 *
 * The subpath MUST carry the `.js` extension — ajv 8 ships no `exports` map, so
 * native ESM resolves it by path and `"ajv/dist/2020"` fails with
 * ERR_MODULE_NOT_FOUND (measured 2026-08-05, Node v24).
 */
import { schemaViolation } from "./error-messages.js";
import type { Ajv2020Ctor, Ajv2020Instance, CompiledValidator } from "./validate-json-schema.types.js";

let ajvPromise: Promise<Ajv2020Instance> | null = null;
const compiled = new WeakMap<object, CompiledValidator>();

async function getAjv(): Promise<Ajv2020Instance> {
  if (!ajvPromise) {
    ajvPromise = import("ajv/dist/2020.js").then((mod) => {
      const Ctor = ((mod as unknown as { default?: Ajv2020Ctor }).default ??
        (mod as unknown as Ajv2020Ctor));
      // strict:false matches the existing draft-2020 check in schema-2020-12.test.ts
      // and keeps unknown keywords/formats non-fatal.
      return new Ctor({ strict: false });
    });
  }
  return ajvPromise;
}

/**
 * Validate `input` against a draft 2020-12 JSON Schema.
 * Returns `null` when valid, or a message when not — matching the design's
 * schema-violation wording: `Invalid input for {name}: {ajvStyleMessage}.`
 */
export async function validateJsonSchemaInput(
  name: string,
  schema: { type: "object"; [key: string]: unknown },
  input: Record<string, unknown>,
): Promise<string | null> {
  const ajv = await getAjv();
  let validate = compiled.get(schema);
  if (!validate) {
    validate = ajv.compile(schema);
    compiled.set(schema, validate);
  }
  if (validate(input)) return null;
  // Same builder the zod branch uses, so the two branches cannot drift apart.
  return schemaViolation(name, ajv.errorsText(validate.errors));
}
