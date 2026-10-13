import { createDataSourceProvider } from "@cuatoi/web-agent-lit";
import type { AgentChatPanel } from "@cuatoi/web-agent-lit";
import type { GenuiConfig } from "../genui/genui-config";
import type { AgentPageGenuiHost } from "../types";
import {
  buildCatStoreAppInstructions,
  type CustomPromptConfig,
} from "../agent-prompt-config";
import { getCatSources } from "../orders-backend/datasource-sources";
import { store } from "../store";

export function composeAppContext(
  base: NonNullable<AgentChatPanel["appContext"]>,
  custom?: CustomPromptConfig | null,
): NonNullable<AgentChatPanel["appContext"]> {
  const nextInstructions = buildCatStoreAppInstructions(custom);
  if (base.appInstructions === nextInstructions) return base;
  return {
    ...base,
    appInstructions: nextInstructions,
  };
}

export function installAgentPageGenuiGlobals(host: AgentPageGenuiHost): Record<string, unknown> {
  const dataSource = createDataSourceProvider({
    getState: () => store.getState(), sources: getCatSources(() => store.getState()),
  });
  // The frame reads this through `window.parent`. Built here, once, rather
  // than per mount: createDataSourceProvider describes every source on
  // construction and the panel's own provider is private
  // (chat-panel-fields.ts:89), so this is the only handle the frame can
  // get. Same two arguments demo-chart-datasource in gallery-demos.ts uses.
  const dataSourceGlobal = Object.assign(() => dataSource, dataSource);
  const globals = {
    __WA_GENUI_MOUNT__: (source: string) => host.mount(source),
    __WA_GENUI_DRAIN__: () => host.drainDiagnostics(),
    __WA_GENUI_VALIDATE__: (source: string, configOverride?: GenuiConfig) =>
      host.validateSource(source, configOverride),
    __WA_GENUI_DATA_SOURCE__: dataSourceGlobal,
  };
  Object.assign(window, globals);
  return globals;
}

export function removeAgentPageGenuiGlobals(globals: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(globals)) {
    if ((window as unknown as Record<string, unknown>)[key] === value) {
      delete (window as unknown as Record<string, unknown>)[key];
    }
  }
  delete window.__WA_GENUI_SCREENSHOT__;
}
