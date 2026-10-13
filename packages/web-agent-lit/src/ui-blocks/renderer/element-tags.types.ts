// element-tags.types.ts — the `HTMLElementTagNameMap` entries for the block
// custom elements defined in this directory.
//
// Kept out of `types.ts` because the augmentation names each element class,
// so this file imports the modules that own them, and those modules already
// reach `types.ts` through the renderer registry — declaring the map there
// would close an import cycle.
//
// `src/index.ts` imports this file for its side effect so the augmentation
// reaches every consumer of the package.
import type { AgentButtonsBlock } from "./buttons-block.js";
import type { AgentFormBlock } from "./form-block.js";

declare global {
  interface HTMLElementTagNameMap {
    "agent-buttons-block": AgentButtonsBlock;
    "agent-form-block": AgentFormBlock;
  }
}
