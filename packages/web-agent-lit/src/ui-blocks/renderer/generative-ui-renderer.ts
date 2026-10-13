import { RenderableBlock, type FormBlock, type ButtonsBlock } from "@cuatoi/web-agent-core";
import { BlockRenderer, RenderCtx } from "./types.js";
import { createButtonsBlock, createFormBlock } from "./element-factory.js";
import "./form-block.js";
import "./buttons-block.js";

export const generativeUiRenderer: BlockRenderer = {
  types: ["form", "buttons"],
  render(block: RenderableBlock, ctx: RenderCtx): Node {
    const disabled = !!ctx.disabled;
    // This renderer is only ever routed "form" and "buttons" blocks (`types`
    // above), so a named cast per branch replaces the four `any` casts
    // without widening what the registry seam declares.
    if (block.type === "form") {
      return createFormBlock(block as FormBlock, disabled);
    } else {
      return createButtonsBlock(block as ButtonsBlock, disabled);
    }
  },
  promptSnippet: `
- Form: { "type": "form", "id": string, "title": string (optional), "submit_label": string (optional), "fields": Field[] }
  where Field is one of:
    - { "kind": "text", "name": string, "label": string, "placeholder": string (optional), "required": boolean (optional) }
    - { "kind": "number", "name": string, "label": string, "min": number (optional), "max": number (optional), "required": boolean (optional) }
    - { "kind": "select", "name": string, "label": string, "options": string[], "default": string (optional) }
    - { "kind": "checkbox", "name": string, "label": string, "default": boolean (optional) }
    - { "kind": "date", "name": string, "label": string, "required": boolean (optional) }
- Buttons: { "type": "buttons", "options": { "label": string, "prompt": string }[] (max 6 options, prompt max 500 chars) }
- Use buttons to offer at most 4 likely next steps. Use forms when you need several values from the user at once.
`.trim(),
};
