import type { store } from "./store";
import type { GenuiConfig } from "./genui/genui-config";
import type { GenuiDiagnostic } from "../shared/genui-diagnostics";
import type { ValidationResult } from "./genui/genui-validator";
import type { GenuiScreenshotResult } from "../shared/genui-screenshot";
import type { McpServerConfig } from "@cuatoi/web-agent-mcp";
import type { MockScript } from "@cuatoi/web-agent-lit";
import type { DataSourceProvider } from "@cuatoi/web-agent-core";
import type { GenuiChartsReadyResult } from "../shared/genui-chart";

declare global {
  interface Window {
    __APP_STORE__: typeof store;
    /** Set by the e2e mock tier; read by configureAgentPanel(). */
    __WA_MOCK_SCRIPT__?: MockScript;
    /** Extra MCP servers injected by a spec before the panel loads. */
    __WA_EXTRA_MCP_SERVERS__?: McpServerConfig[];
    /** Generative-UI test channel, installed by agent-page.ts. */
    __WA_GENUI_MOUNT__?: (source: string) => Promise<void>;
    __WA_GENUI_DRAIN__?: () => GenuiDiagnostic[];
    __WA_GENUI_VALIDATE__?: (source: string, configOverride?: GenuiConfig) => Promise<ValidationResult>;
    __WA_GENUI_SCREENSHOT__?: (opts?: { timeoutMs?: number }) => Promise<GenuiScreenshotResult>;
    /** The host's data source provider, published by agent-page.ts and read by
     *  the frame through `window.parent`. Same-origin, no postMessage. */
    __WA_GENUI_DATA_SOURCE__?: DataSourceProvider & (() => DataSourceProvider);
    /** Installed by genui-chart-bundle.ts INSIDE the frame. Called
     *  synchronously by mountIntoFrame right after the source is inserted. */
    __WA_GENUI_FRAME_ON_MOUNT__?: (root: HTMLElement) => void;
    /** Installed by genui-chart-bundle.ts INSIDE the frame. Awaited by
     *  mountIntoFrame before it returns. */
    __WA_GENUI_FRAME_READY__?: (timeoutMs?: number) => Promise<GenuiChartsReadyResult>;
  }
}
