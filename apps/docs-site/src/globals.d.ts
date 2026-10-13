// Type declarations that apply to every file in the docs-site TypeScript
// program (src/** and e2e/**, per tsconfig.json's `include`).
//
// `web-agent-bubble` and `docs-agent-widget` are custom elements this app
// creates and queries by tag name. Neither is in the DOM lib's
// HTMLElementTagNameMap, so without these entries every querySelector and
// createElement for them returns a bare Element/HTMLElement and each call site
// has to cast. Declaring them here keeps the declaration inside the app that
// owns the usage — web-agent-lit is a separate unit and is not edited here.
import type { WebAgentBubble } from "@cuatoi/web-agent-lit";
import type { MockScript } from "@cuatoi/web-agent-core";
import type { DocsAgentWidget } from "./docs-agent-widget";

declare global {
  interface HTMLElementTagNameMap {
    "web-agent-bubble": WebAgentBubble;
    "docs-agent-widget": DocsAgentWidget;
  }

  interface Window {
    /** Test/e2e seam: a deterministic mock LLM script injected before load.
     *  Read by `src/docs-embed.ts`; set by Playwright via `addInitScript`. */
    __WA_MOCK_SCRIPT__?: MockScript;
  }
}
