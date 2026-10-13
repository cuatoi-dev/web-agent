import type { CustomToolDef, ToolOutcome } from "./types.js";
import type { JsonSchemaObject } from "../types.js";
import type { RenderableBlock } from "../ui-blocks/types.js";

/**
 * REFERENCE / COPY-ME sample tools for host authors.
 *
 * These are NOT registered by `defaultTools()` and are NOT active in any
 * host — they exist so a host author can copy one file to learn the shape of
 * a `CustomToolDef`. To ship your own tool: copy a def below, rename it, and
 * add it to `panel.tools` (lit) / your host's `tools:` array. See
 * docs/custom-tool.md.
 *
 * A `CustomToolDef` has five authoring surfaces, all demonstrated here:
 *   - `inputSchema`  : a zod schema (converted to JSON Schema for the model), or a
 *                      raw JSON Schema object — arguments are validated against
 *                      either one before `execute` runs.
 *   - `promptSnippet`: optional extra guidance appended to the system prompt.
 *   - `execute`      : async (input, ctx) => ToolOutcome; cast `input` as needed.
 *   - `renderer`     : optional friendly tool-call HTML (inline tags only).
 *   - `outcome.block`: optionally attach a RenderableBlock to render UI inline.
 */

/** Sample 1 — plain text outcome. The minimal shape of a tool. */
export const sampleGreetingTool: CustomToolDef = {
  name: "sample_greeting",
  description:
    "SAMPLE reference tool — greet a person by name. Copy this def to author your own tool.",
  // JSON Schema — one required string field.
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "The name of the person to greet.",
      },
    },
    required: ["name"],
    additionalProperties: false,
  } satisfies JsonSchemaObject,
  // promptSnippet is appended to the system prompt when this tool is active.
  promptSnippet:
    "Use sample_greeting({name}) as a reference for calling a simple text-returning tool.",
  // renderer: optional friendly tool-call HTML (sanitized to inline tags only).
  renderer: (input) => {
    const { name } = input as { name?: string };
    return `Greeted <b>${name ?? "someone"}</b>`;
  },
  // execute receives model-provided input + the ToolContext; return a ToolOutcome.
  execute: (input: Record<string, unknown>): Promise<ToolOutcome> => {
    const { name } = input as { name: string };
    return Promise.resolve({ content: `Hello, ${name}! (from the sample_greeting reference tool)` });
  },
};

/** Sample 2 — emits a UI block via `outcome.block` (renders inline). */
export const sampleQuickReplyTool: CustomToolDef = {
  name: "sample_quick_reply",
  description:
    "SAMPLE reference tool — ask a question and render quick-reply buttons. " +
    "Demonstrates attaching a RenderableBlock via outcome.block.",
  inputSchema: {
    type: "object",
    properties: {
      question: {
        type: "string",
        description: "The question to show above the buttons.",
      },
      choices: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        maxItems: 6,
        description: "Up to 6 quick-reply choices; each becomes a button.",
      },
    },
    required: ["question", "choices"],
    additionalProperties: false,
  } satisfies JsonSchemaObject,
  promptSnippet:
    "Use sample_quick_reply({question, choices}) as a reference for a tool that renders a UI block.",
  execute: (input: Record<string, unknown>): Promise<ToolOutcome> => {
    const { question, choices } = input as { question: string; choices: string[] };
    // Build a core `buttons` block. Attaching it to outcome.block makes the
    // host renderer (generativeUiRenderer by default) render it inline.
    const block: RenderableBlock = {
      type: "buttons",
      options: choices.map((c) => ({ label: c, prompt: c })),
    };
    return Promise.resolve({ content: `Asked: "${question}" with ${choices.length} choice(s).`, block });
  },
};
