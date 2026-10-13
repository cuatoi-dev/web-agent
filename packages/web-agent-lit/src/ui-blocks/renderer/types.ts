import { html, render } from "../../ui/template.js";
import { RenderableBlock, DataSourceProvider } from "@cuatoi/web-agent-core";
import { createBlockContainer } from "./element-factory.js";

export interface RenderCtx {
  disabled?: boolean;
  dataSource?: DataSourceProvider;
}

export interface BlockRenderer {
  types: string[];
  render(block: RenderableBlock, ctx: RenderCtx): Node;
  promptSnippet?: string;
}

export class BlockRendererRegistry {
  private renderers = new Map<string, BlockRenderer>();

  constructor(renderers: BlockRenderer[] = []) {
    for (const r of renderers) {
      this.register(r);
    }
  }

  register(renderer: BlockRenderer) {
    for (const type of renderer.types) {
      this.renderers.set(type, renderer);
    }
  }

  render(block: RenderableBlock, ctx: RenderCtx): Node {
    const renderer = this.renderers.get(block.type);
    if (renderer) {
      return renderer.render(block, ctx);
    }

    const container = createBlockContainer();

    if (block.type === "error_card") {
      render(html`
        <style>
          .error-card-renderer {
            background-color: var(--wa-action-color-error-10opc, #fde8e8);
            border: 1px solid var(--wa-action-color-error-40opc, #f98080);
            border-radius: 12px;${/* eslint-disable-line wa/no-raw-spacing -- 12px is not on the theme border-radius ladder (the xl step, --wa-border-radius-xl, is 16px in two themes and 10px in wa2-dark; neither matches 12px); tokenizing would snap the rendered value and change the layout. */ ""}
            padding: var(--wa-padding-xl, 16px);
            color: var(--wa-text-color, #9b1c1c);
            margin: var(--wa-padding-l, 12px) 0;
            font-family: var(--wa-font-family, "Public Sans", system-ui, -apple-system, sans-serif);
          }
          .error-card-renderer details {
            margin-top: var(--wa-padding-m, 8px);
            font-size: 0.85em;
            cursor: pointer;
          }
          .error-card-renderer summary {
            color: var(--wa-label-color, #771d1d);
            font-weight: 500;
          }
          .error-card-renderer pre {
            background: var(--wa-background-color-300, #fdf2f2);
            padding: var(--wa-padding-m, 8px);
            border-radius: 6px;${/* eslint-disable-line wa/no-raw-spacing -- 6px is not on the theme border-radius ladder (between --wa-border-radius-m 4px and --wa-border-radius-l 8px); tokenizing would snap the rendered value and change the layout. */ ""}
            overflow-x: auto;
            margin-top: var(--wa-padding-s, 4px);
            font-family: monospace;
            font-size: 0.9em;
          }
        </style>
        <div class="error-card-renderer">
          <div style="font-weight: bold; margin-bottom: var(--wa-padding-m, 8px);">⚠️ Error Block</div>
          <div>${block.error}</div>
          <details>
            <summary>View Raw JSON</summary>
            <pre>${block.raw}</pre>
          </details>
        </div>
      `, container);
      return container;
    }

    // Default unknown fallback
    render(html`
      <style>
        .error-card-renderer {
          background-color: var(--wa-action-color-error-10opc, #fde8e8);
          border: 1px solid var(--wa-action-color-error-40opc, #f98080);
          border-radius: 12px;${/* eslint-disable-line wa/no-raw-spacing -- 12px is not on the theme border-radius ladder (the xl step, --wa-border-radius-xl, is 16px in two themes and 10px in wa2-dark; neither matches 12px); tokenizing would snap the rendered value and change the layout. */ ""}
          padding: var(--wa-padding-xl, 16px);
          color: var(--wa-text-color, #9b1c1c);
          margin: var(--wa-padding-l, 12px) 0;
          font-family: var(--wa-font-family, "Public Sans", system-ui, -apple-system, sans-serif);
        }
        .error-card-renderer details {
          margin-top: var(--wa-padding-m, 8px);
          font-size: 0.85em;
          cursor: pointer;
        }
        .error-card-renderer summary {
          color: var(--wa-label-color, #771d1d);
          font-weight: 500;
        }
        .error-card-renderer pre {
          background: var(--wa-background-color-300, #fdf2f2);
          padding: var(--wa-padding-m, 8px);
          border-radius: 6px;${/* eslint-disable-line wa/no-raw-spacing -- 6px is not on the theme border-radius ladder (between --wa-border-radius-m 4px and --wa-border-radius-l 8px); tokenizing would snap the rendered value and change the layout. */ ""}
          overflow-x: auto;
          margin-top: var(--wa-padding-s, 4px);
          font-family: monospace;
          font-size: 0.9em;
        }
      </style>
      <div class="error-card-renderer">
        <div style="font-weight: bold; margin-bottom: var(--wa-padding-m, 8px);">⚠️ Unknown Block Type</div>
        <div>Unsupported block type: ${block.type}</div>
        <details>
          <summary>View Raw JSON</summary>
          <pre>${JSON.stringify(block, null, 2)}</pre>
        </details>
      </div>
    `, container);
    return container;
  }

  collectPromptSnippets(): string {
    const snippets = new Set<string>();
    const uniqueRenderers = Array.from(new Set(this.renderers.values()));
    for (const r of uniqueRenderers) {
      if (r.promptSnippet) {
        snippets.add(r.promptSnippet);
      }
    }
    return Array.from(snippets).join("\n\n");
  }
}
