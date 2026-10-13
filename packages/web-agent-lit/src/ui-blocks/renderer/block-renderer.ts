import { RenderableBlock, DataSourceProvider } from "@cuatoi/web-agent-core";
import { BlockRendererRegistry } from "./types.js";
import { generativeUiRenderer } from "./generative-ui-renderer.js";

let defaultRegistry: BlockRendererRegistry | null = null;

function getDefaultRegistry(): BlockRendererRegistry {
  if (!defaultRegistry) {
    defaultRegistry = new BlockRendererRegistry([
      generativeUiRenderer,
    ]);
  }
  return defaultRegistry;
}

export function renderBlocks(
  blocks: RenderableBlock[],
  opts: {
    registry?: BlockRendererRegistry;
    disabled?: boolean;
    dataSource?: DataSourceProvider;
  } = {}
): Node[] {
  if (!blocks || !Array.isArray(blocks)) return [];

  const registry = opts.registry || getDefaultRegistry();
  const disabled = !!opts.disabled;
  const dataSource = opts.dataSource;

  return blocks.map((block) => {
    return registry.render(block, { disabled, dataSource });
  });
}

export function renderBlocksToElement(
  container: HTMLElement,
  blocks: RenderableBlock[],
  opts: {
    registry?: BlockRendererRegistry;
    disabled?: boolean;
    dataSource?: DataSourceProvider;
  } = {}
) {
  const nodes = renderBlocks(blocks, opts);
  container.replaceChildren(...nodes);
}

