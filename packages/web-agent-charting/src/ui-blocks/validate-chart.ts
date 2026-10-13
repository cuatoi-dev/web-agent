/**
 * ajv-backed validation for charting's JSON Schemas.
 *
 * Reached ONLY through a dynamic `import()` inside the async functions below,
 * so `ajv` never enters charting's static import graph. Keep it that way.
 * The subpath MUST carry the `.js` extension — ajv 8 ships no `exports` map.
 */
import { ChartBlockSchema } from "./chart-schema.js";
import type { ChartBlock } from "./chart-schema.js";
import type { Ajv2020Ctor, Ajv2020Instance, CompiledValidator } from "./types.js";

let ajvPromise: Promise<Ajv2020Instance> | null = null;
const compiled = new WeakMap<object, CompiledValidator>();

async function getAjv(): Promise<Ajv2020Instance> {
  if (!ajvPromise) {
    ajvPromise = import("ajv/dist/2020.js").then((mod) => {
      const Ctor = ((mod as unknown as { default?: Ajv2020Ctor }).default ??
        (mod as unknown as Ajv2020Ctor));
      // strict:false matches core's validate-json-schema.ts. allErrors:true
      // is charting-local: the pre-migration zod path joined EVERY issue
      // (D6), so this wrapper must collect every ajv violation too, not
      // just the first (ajv's default).
      return new Ctor({ strict: false, allErrors: true });
    });
  }
  return ajvPromise;
}

/**
 * Validate against a Draft 2020-12 schema, returning the SAME message shape
 * the pre-migration zod path produced: every issue joined as
 * `<prefix>.<field-path>: <message>; …` (see the old show-chart.ts:22-24).
 * An empty `prefix` omits the leading dot, so the join is
 * `<field-path>: <message>; …`.
 */
export async function validateChartSchema(
  prefix: string,
  schema: object,
  input: unknown,
): Promise<string | null> {
  let validate: CompiledValidator;
  try {
    const ajv = await getAjv();
    let compiledFn = compiled.get(schema);
    if (!compiledFn) {
      compiledFn = ajv.compile(schema);
      compiled.set(schema, compiledFn);
    }
    validate = compiledFn;
  } catch (err) {
    // Mirrors build-tools.ts's wrapExecutor (task 004): a bundler-side
    // failure loading or compiling ajv — e.g. the webpack module-id
    // collision documented in docs/tests/0167 — is not the caller's fault.
    // Before JSON Schema validation existed here, these tools ran
    // unvalidated, so degrading to "run unvalidated" is no worse than
    // pre-migration behavior; failing closed would be a new regression for
    // an infrastructure problem, not a data problem.
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[web-agent] Chart schema validation unavailable for "${prefix || "(root)"}" — running unvalidated (${msg}).`,
    );
    return null;
  }
  if (validate(input)) return null;
  const errors = validate.errors ?? [];
  return errors
    .map((e) => {
      let path = e.instancePath.slice(1).replace(/\//g, ".");
      // ajv's "required" error points instancePath at the CONTAINING object
      // and names the missing key in params.missingProperty, unlike zod,
      // which put the missing key in the error path itself. Append it so a
      // missing "data" at the config root still reads "config.data", not
      // "config.root".
      if (e.keyword === "required") {
        const missing = (e.params as { missingProperty?: string }).missingProperty;
        if (missing) path = path ? `${path}.${missing}` : missing;
      }
      path = path || "root";
      const fullPath = prefix ? `${prefix}.${path}` : path;
      return `${fullPath}: ${e.message}`;
    })
    .join("; ");
}

/** Async replacement for the old `ChartBlockSchema.safeParse`. */
export async function validateChartBlock(
  raw: unknown,
): Promise<{ ok: true; value: ChartBlock } | { ok: false; message: string }> {
  const error = await validateChartSchema("", ChartBlockSchema, raw);
  if (error) return { ok: false, message: error };
  return { ok: true, value: raw as ChartBlock };
}
