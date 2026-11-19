import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { validateZodInput } from "./validate-zod-schema.js";
import { downscaleToolImage, mediaTypeOf } from "../utils/image.js";
import type { Tool, ToolExecutor, ToolExecutorResult, ToolImage, JsonSchemaObject } from "../types.js";
import type {
  CustomToolDef,
  ToolContext,
  ToolInputSchema,
  ToolOutcome,
} from "./types.js";
export type {
  AppContext,
  CustomToolDef,
  JsonSchemaObject,
  SchedulerControllerSeam,
  TodoControllerSeam,
  SkillDef,
  ToolContext,
  ToolInputSchema,
  ToolOutcome,
  ToolRenderer,
  ToolStepPhraseInput,
} from "./types.js";

import { runWait } from "./wait.js";
import { runListDataSources } from "./list-data-sources.js";
import { runGetFieldDetails } from "./get-field-details.js";
import { runSampleFieldValues } from "./sample-field-values.js";
import { runQueryData } from "./query-data.js";
import { runShowGenerativeUi } from "./show-generative-ui.js";
import { runHooks } from "../hooks/run-hooks.js";

function wrapExecutor(
  def: CustomToolDef,
  ctx: ToolContext,
  jsonSchema?: Tool["input_schema"],
): ToolExecutor {
  return async (
    input: Record<string, unknown>,
    options: { abortSignal?: AbortSignal; toolCallId: string },
  ): Promise<ToolExecutorResult> => {
    if (options.abortSignal?.aborted) {
      return { content: "Tool execution aborted." };
    }
    try {
      if (jsonSchema) {
        // JSON-Schema branch. Lazily imported so ajv stays out of core's static
        // import graph — hosts with no JSON-Schema tool never load it.
        // The load/validate step is wrapped on its own: a host bundler can fail
        // this dynamic import for reasons that have nothing to do with the
        // caller's input (e.g. a webpack module-id collision inside ajv's own
        // dependency graph, observed in a live run). That
        // failure is NON-FATAL to the call: before this tool's schema moved to
        // JSON Schema, it ran with no validation at all, so falling
        // back to "run unvalidated" here is strictly no worse than that, and
        // it keeps the tool working when ajv itself is unavailable. Only an
        // actual schema-violation verdict from a successfully loaded ajv
        // rejects the call.
        try {
          const { validateJsonSchemaInput } = await import("./validate-json-schema.js");
          const error = await validateJsonSchemaInput(def.name, jsonSchema, input);
          if (error) return { content: error, isError: true };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(
            `[web-agent] JSON Schema validation unavailable for "${def.name}" — running the call WITHOUT argument validation (${msg}).`,
          );
        }
      } else if (isZodSchema(def.inputSchema)) {
        // zod branch. Every core, DOM, charting and host tool is authored
        // this way, so without this branch none of them is validated. Statically
        // imported: zod is already in core's graph, ajv is not involved.
        const error = validateZodInput(def.name, def.inputSchema, input);
        if (error) return { content: error, isError: true };
      }
      const turnCtx: ToolContext = {
        ...ctx,
        signal: options.abortSignal ?? ctx.signal,
      };

      let effectiveInput = input;
      if (ctx.hooks) {
        let summary: string | undefined;
        if (def.summarize) {
          try {
            summary = def.summarize(input, turnCtx);
          } catch (err) {
            console.error(`[hooks] ${def.name}.summarize threw — ignored:`, err);
          }
        }
        const decision = await runHooks(ctx.hooks, "onPreTool", {
          name: def.name,
          input,
          summary,
          ctx: turnCtx,
        });
        if (decision.decision === "deny") {
          const denied: ToolOutcome = {
            content: decision.reason ?? `Tool "${def.name}" was denied.`,
            isError: true,
          };
          // the tool's own code is never entered
          return { content: denied.content, isError: true };
        }
        if (decision.decision === "ask") {
          // A handler flagged "ask" but none resolved it into "allow"/"deny"
          // (e.g. no confirmation UI is wired) — treat as unconfirmed.
          const unconfirmed: ToolOutcome = {
            content: decision.reason ?? `Interaction required confirmation ("ask" policy) but no confirmation dialog was confirmed; not performed.`,
            isError: true,
          };
          // the tool's own code is never entered
          return { content: unconfirmed.content, isError: true };
        }
        effectiveInput = decision.input;
      }

      let outcome: ToolOutcome;
      try {
        outcome = await def.execute(effectiveInput, turnCtx);
      } catch (err: unknown) {
        // A throwing tool must still reach the host's onPostTool — before
        // this, the throw jumped to the outer catch and the host saw onPreTool
        // with no partner. The hook chain may rewrite the error TEXT; the text
        // it returns is sent to the model. The error flag stays forced true, and
        // outcome.block / outcome.images are never read from the result, so a
        // hook cannot turn a failure into a silent success. err.message is used
        // — never err.stack.
        const msg = err instanceof Error ? err.message : String(err);
        let failure: ToolOutcome = { content: msg, isError: true };
        if (ctx.hooks) {
          try {
            failure = await runHooks(ctx.hooks, "onPostTool", {
              name: def.name,
              input: effectiveInput,
              toolCallId: options.toolCallId,
              outcome: failure,
            });
          } catch (hookErr) {
            console.error("[hooks] onPostTool threw on the failure path — ignored:", hookErr);
          }
        }
        // Same flag as before; the (possibly rewritten) text is now sent.
        return { content: failure.content, isError: true };
      }
      // The TOOL owns the verdict. Read it before the hook chain runs, so a
      // host hook that rewrites the outcome cannot clear (or set) the flag.
      const toolFailed = outcome.isError === true;
      if (ctx.hooks) {
        outcome = await runHooks(ctx.hooks, "onPostTool", {
          name: def.name,
          input: effectiveInput,
          toolCallId: options.toolCallId,
          outcome,
        });
      }
      // Every image is downscaled to the tool-image limits. One that cannot
      // be decoded (or is empty) is dropped with a warning; the text result
      // still reaches the model.
      const images: ToolImage[] = [];
      for (const img of outcome.images ?? []) {
        try {
          const dataUrl = await downscaleToolImage(img.dataUrl);
          images.push({ dataUrl, mediaType: mediaTypeOf(dataUrl) ?? img.mediaType });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn(`[web-agent] tool image dropped (${def.name}): ${msg}`);
        }
      }
      if (outcome.block && ctx._onToolBlock) {
        ctx._onToolBlock(options.toolCallId, outcome.block);
      }
      return {
        content: outcome.content,
        ...(toolFailed ? { isError: true } : {}),
        ...(images.length > 0 ? { images } : {}),
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { content: msg };
    }
  };
}

export function draft07ToDraft2020(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(draft07ToDraft2020);
  }
  if (node !== null && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(obj)) {
      result[key] = draft07ToDraft2020(obj[key]);
    }
    if (Array.isArray(result.items)) {
      result.prefixItems = result.items;
      delete result.items;
      if ("additionalItems" in result) {
        result.items = result.additionalItems;
        delete result.additionalItems;
      }
    }
    return result;
  }
  return node;
}

/** `buildTools()` runs on every `initAgent()`, and a session runs that two or
 *  three times while the panel opens. Both conversions below are pure functions
 *  of the definition object, so their result is cached on that identity. */
const zodInputSchemaCache = new WeakMap<object, Tool["input_schema"]>();
const jsonInputSchemaCache = new WeakMap<object, Tool["input_schema"]>();

/** True when any `items` in the tree is an ARRAY (the draft-07 tuple form) and
 *  so must still be rewritten to `prefixItems`. */
function hasDraft07TupleItems(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(hasDraft07TupleItems);
  if (node !== null && typeof node === "object") {
    const obj = node as Record<string, unknown>;
    if (Array.isArray(obj.items)) return true;
    for (const key of Object.keys(obj)) {
      if (hasDraft07TupleItems(obj[key])) return true;
    }
  }
  return false;
}

function zodToInputSchema(schema: z.ZodType): Tool["input_schema"] {
  const cached = zodInputSchemaCache.get(schema);
  if (cached) return cached;
  const raw = zodToJsonSchema(schema) as Record<string, unknown>;
  const input_schema = { ...raw };
  delete input_schema.$schema;
  const processed = draft07ToDraft2020(input_schema) as Tool["input_schema"];
  zodInputSchemaCache.set(schema, processed);
  return processed;
}

/**
 * Duck-typed, not `instanceof` — a host bundling its own copy of zod would fail an
 * `instanceof z.ZodType` check. `safeParse` is the same surface
 * `validateZodInput` (tools/validate-zod-schema.ts) relies on.
 */
function isZodSchema(schema: ToolInputSchema): schema is z.ZodType {
  return typeof (schema as z.ZodType).safeParse === "function";
}

/** Raw JSON Schema → model-facing draft 2020-12, mirroring `zodToInputSchema`.
 *
 *  A schema already in draft 2020-12 with no tuple `items` is returned as the
 *  SAME object, not a clone. That identity is what lets `wrapExecutor` and
 *  `validateDataQuery` share one compiled ajv validator for `DataQuerySchema`
 *  instead of compiling a clone each. */
function jsonSchemaToInputSchema(schema: JsonSchemaObject): Tool["input_schema"] {
  const cached = jsonInputSchemaCache.get(schema);
  if (cached) return cached;
  let converted: Tool["input_schema"];
  if (!("$schema" in schema) && !hasDraft07TupleItems(schema)) {
    converted = schema;
  } else {
    const rest = { ...(schema as Record<string, unknown>) };
    delete rest.$schema;
    converted = draft07ToDraft2020(rest) as Tool["input_schema"];
  }
  jsonInputSchemaCache.set(schema, converted);
  return converted;
}

export function buildTools(
  ctx: ToolContext,
  defs: CustomToolDef[],
): { tools: Tool[]; executors: Record<string, ToolExecutor> } {
  const toolsArr: Tool[] = [];
  const executors: Record<string, ToolExecutor> = {};

  for (const def of defs) {
    if (executors[def.name]) {
      console.warn(`Tool "${def.name}" is already defined — skipping duplicate.`);
      continue;
    }
    let input_schema: Tool["input_schema"];
    let jsonSchemaForValidation: Tool["input_schema"] | undefined;
    if (isZodSchema(def.inputSchema)) {
      input_schema = zodToInputSchema(def.inputSchema);
    } else {
      input_schema = jsonSchemaToInputSchema(def.inputSchema);
      jsonSchemaForValidation = input_schema;
    }
    toolsArr.push({
      name: def.name,
      description: def.description,
      input_schema,
    });
    executors[def.name] = wrapExecutor(def, ctx, jsonSchemaForValidation);
  }

  return { tools: toolsArr, executors };
}

function getHandler(
  name: string,
): (input: Record<string, unknown>, ctx: ToolContext) => Promise<ToolOutcome> {
  switch (name) {
    case "wait":
      return runWait;
    case "list_data_sources":
      return runListDataSources;
    case "get_field_details":
      return runGetFieldDetails;
    case "sample_field_values":
      return runSampleFieldValues;
    case "query_data":
      return runQueryData;
    case "show_generative_ui":
      return runShowGenerativeUi;
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export async function executeToolByName(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  if (ctx.signal.aborted) {
    return { content: "Tool execution aborted.", isError: true };
  }
  const handler = getHandler(name);
  try {
    return await handler(input, ctx);
  } catch (err: unknown) {
    return {
      content: err instanceof Error ? err.message : String(err),
      isError: true,
    };
  }
}
