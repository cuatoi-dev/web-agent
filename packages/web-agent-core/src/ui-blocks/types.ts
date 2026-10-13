// Renderable-block shapes. The runtime validators for them live in
// `schema.ts`, which re-exports these so its import path is unchanged.

export type UIBlock = FormBlock | ButtonsBlock;

export interface FormBlock {
  type: "form";
  id: string;
  title?: string;
  fields: FormField[];
  submit_label?: string;
}

export type FormField =
  | { kind: "text"; name: string; label: string; placeholder?: string; required?: boolean }
  | { kind: "number"; name: string; label: string; min?: number; max?: number; required?: boolean }
  | { kind: "select"; name: string; label: string; options: string[]; default?: string }
  | { kind: "checkbox"; name: string; label: string; default?: boolean }
  | { kind: "date"; name: string; label: string; required?: boolean };

export interface ButtonsBlock {
  type: "buttons";
  options: { label: string; prompt: string }[];
}

export interface ErrorCardBlock {
  type: "error_card";
  raw: string;
  error: string;
}

// TS shape of a package/host-contributed block core doesn't own. The index
// signature is required: it keeps existing `block.type === "error_card"`
// narrowing in lit's BlockRendererRegistry compiling (block.error / block.raw
// resolve to `unknown` rather than a "property does not exist" error) and lets
// package blocks carry arbitrary fields. Runtime validation is PluginBlockSchema.
export interface PluginBlock {
  type: string;
  [key: string]: unknown;
}

export type RenderableBlock = UIBlock | ErrorCardBlock | PluginBlock;
