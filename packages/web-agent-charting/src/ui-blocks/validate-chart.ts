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

const SCHEMA_MAP_KEYS = new Set([
  "properties",
  "patternProperties",
  "$defs",
  "definitions",
  "dependentSchemas",
]);
const SUBSCHEMA_KEYS = ["type", "anyOf", "oneOf", "allOf", "enum", "const"];

function isHoistableSubschema(node: Record<string, unknown>): boolean {
  if ("$ref" in node || "$id" in node) return false;
  const keys = Object.keys(node);
  if (keys.length === 1 && keys[0] === "type" && typeof node.type === "string") return false;
  return SUBSCHEMA_KEYS.some((k) => k in node);
}

/** Rewrite repeated subschema object references to `#/$defs/...` on a shallow
 *  copy before `ajv.compile()`, without mutating the exported schema object.
 *
 *  Mirrors core's `tools/validate-json-schema.ts`, which this package cannot
 *  import (it is not part of core's public API). ajv's default
 *  `inlineRefs: true` expands every `$ref` in place, so `SHOW_CHART_SCHEMA`
 *  expanded `WRAPPED_SCALAR_SCHEMA` ten times and the number-or-wrapped pair
 *  five times, generating 66,928 characters of JavaScript to validate one
 *  chart config. */
function hoistSharedSubschemas(root: Record<string, unknown>): Record<string, unknown> {
  const rawDefs = root.$defs;
  const defsObj =
    rawDefs !== null && typeof rawDefs === "object" && !Array.isArray(rawDefs)
      ? (rawDefs as Record<string, unknown>)
      : null;
  const existingDefNames = new Map<object, string>();
  if (defsObj) {
    for (const [name, val] of Object.entries(defsObj)) {
      if (val !== null && typeof val === "object") existingDefNames.set(val, name);
    }
  }
  const counts = new Map<object, number>();
  const visit = (node: unknown, isRoot: boolean): void => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item, false);
      return;
    }
    const rec = node as Record<string, unknown>;
    if (!isRoot && existingDefNames.has(rec)) return;
    if (!isRoot && isHoistableSubschema(rec)) {
      const prev = counts.get(rec) ?? 0;
      counts.set(rec, prev + 1);
      if (prev >= 1) return;
    }
    for (const [k, v] of Object.entries(rec)) {
      if (isRoot && k === "$defs") continue;
      if (SCHEMA_MAP_KEYS.has(k) && v !== null && typeof v === "object" && !Array.isArray(v)) {
        for (const propSchema of Object.values(v as Record<string, unknown>)) visit(propSchema, false);
      } else {
        visit(v, false);
      }
    }
  };
  visit(root, true);
  if (defsObj) {
    for (const val of Object.values(defsObj)) visit(val, true);
  }

  const refMap = new Map<object, string>(existingDefNames);
  const hoisted: Array<[string, Record<string, unknown>]> = [];
  let idx = 0;
  for (const [obj, count] of counts) {
    if (count >= 2) {
      const name = `__wa_s${idx++}`;
      refMap.set(obj, name);
      hoisted.push([name, obj as Record<string, unknown>]);
    }
  }
  if (refMap.size === 0) return root;

  const rewrite = (node: unknown, isRoot: boolean, allowSelfRef: boolean): unknown => {
    if (node === null || typeof node !== "object") return node;
    if (Array.isArray(node)) return node.map((item) => rewrite(item, false, true));
    const rec = node as Record<string, unknown>;
    if (!isRoot && allowSelfRef && refMap.has(rec)) {
      return { $ref: `#/$defs/${refMap.get(rec)!}` };
    }
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rec)) {
      if (isRoot && k === "$defs") continue;
      let rv: unknown;
      if (SCHEMA_MAP_KEYS.has(k) && v !== null && typeof v === "object" && !Array.isArray(v)) {
        let mapChanged = false;
        const mapOut: Record<string, unknown> = {};
        for (const [pk, pv] of Object.entries(v as Record<string, unknown>)) {
          const rpv = rewrite(pv, false, true);
          if (rpv !== pv) mapChanged = true;
          mapOut[pk] = rpv;
        }
        rv = mapChanged ? mapOut : v;
      } else {
        rv = rewrite(v, false, true);
      }
      if (rv !== v) changed = true;
      out[k] = rv;
    }
    return isRoot || changed ? out : node;
  };

  const rewrittenRoot = rewrite(root, true, false) as Record<string, unknown>;
  const newDefs: Record<string, unknown> = {};
  if (defsObj) {
    for (const [k, v] of Object.entries(defsObj)) newDefs[k] = rewrite(v, true, false);
  }
  for (const [name, obj] of hoisted) newDefs[name] = rewrite(obj, false, false);
  rewrittenRoot.$defs = newDefs;
  return rewrittenRoot;
}

async function getAjv(): Promise<Ajv2020Instance> {
  if (!ajvPromise) {
    ajvPromise = import("ajv/dist/2020.js").then((mod) => {
      const Ctor = ((mod as unknown as { default?: Ajv2020Ctor }).default ??
        (mod as unknown as Ajv2020Ctor));
      // strict:false matches core's validate-json-schema.ts. allErrors:true
      // is charting-local: the pre-migration zod path joined EVERY issue
      // (D6), so this wrapper must collect every ajv violation too, not
      // just the first (ajv's default).
      // meta:false + validateSchema:false skip compiling the eight Draft
      // 2020-12 meta-schemas on the first `compile()` (~60 ms of main-thread
      // time per instance, measured in iteration 1). A `$schema` in a schema is
      // then ignored rather than checked, which is fine: these schemas are ours.
      // `inlineRefs: false` and `code: { optimize: false }` keep validator
      // generation linear: the default inlines every `$ref` in place and then
      // runs multi-pass AST variable optimization on code that executes only a
      // few times per session.
      return new Ctor({
        strict: false,
        allErrors: true,
        meta: false,
        validateSchema: false,
        inlineRefs: false,
        code: { optimize: false },
      });
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
      compiledFn = ajv.compile(hoistSharedSubschemas(schema as Record<string, unknown>));
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
