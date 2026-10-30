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
 *  ajv's default `inlineRefs: true` expands every `$ref` in place, so a
 *  schema that mentions the same subschema three levels deep generates
 *  exponential validator code (`DataQuerySchema` expanded `filterExpr` to
 *  23,024 characters of JavaScript for a 4^3 expansion). Hoisting the shared
 *  object into `$defs` and compiling with `inlineRefs: false` keeps one
 *  validator per shared subschema. */
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
      // strict:false matches the existing draft-2020 check in schema-2020-12.test.ts
      // and keeps unknown keywords/formats non-fatal.
      // meta:false + validateSchema:false skip compiling the eight Draft 2020-12
      // meta-schemas that the first `compile()` would otherwise load just to
      // meta-validate a static internal schema. That load cost about 60 ms of
      // main-thread time per validator instance (measured in iteration 1).
      // `$schema` in a schema is therefore not checked — it is ignored, which is
      // what this module wants: the schemas are ours, not the model's.
      // `inlineRefs: false` and `code: { optimize: false }` keep validator
      // generation linear: the default inlines every `$ref` in place (an
      // exponential expansion on nested filter schemas) and then runs
      // multi-pass AST variable optimization on code that executes only a
      // few times per session.
      return new Ctor({
        strict: false,
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
    validate = ajv.compile(hoistSharedSubschemas(schema));
    compiled.set(schema, validate);
  }
  if (validate(input)) return null;
  // Same builder the zod branch uses, so the two branches cannot drift apart.
  return schemaViolation(name, ajv.errorsText(validate.errors));
}
