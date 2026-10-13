// ajv-derived aliases for `validate-json-schema.ts`. Kept out of the shared
// `tools/types.ts` so nothing else pulls ajv's types into its import graph.

export type Ajv2020Ctor = typeof import("ajv/dist/2020.js").default;
export type Ajv2020Instance = InstanceType<Ajv2020Ctor>;
export type CompiledValidator = ReturnType<Ajv2020Instance["compile"]>;
