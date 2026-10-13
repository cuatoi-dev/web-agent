// Type declarations that apply to every file in this package's TypeScript
// programs: `src/**` (without the tests) in tsconfig.json, and `src/**` +
// `e2e/**` in tsconfig.lint.json.
//
// `web-agent-bubble` and `agent-chat-panel` are custom elements this extension
// creates and queries by tag name. Neither is in the DOM lib's
// HTMLElementTagNameMap, so `document.createElement` / `querySelector` for them
// are generic calls that infer `any` from an `as any` assertion, and every
// property read after that is unsafe. Declaring them here keeps the
// declaration inside the package that owns the usage — web-agent-lit is a
// separate unit and is not edited by this task.
import type { WebAgentBubble, AgentChatPanel } from "@cuatoi/web-agent-lit";
import type { MockScript } from "@cuatoi/web-agent-core";
import type { VfsBackend, VfsToolProvider } from "@cuatoi/web-agent-vfs";

declare global {
  interface HTMLElementTagNameMap {
    "web-agent-bubble": WebAgentBubble;
    "agent-chat-panel": AgentChatPanel;
  }

  interface Window {
    /** Test/e2e seam: a deterministic mock LLM script injected before load.
     *  Read by `src/content.ts` and `src/sidepanel.ts`; set by Playwright via
     *  `addInitScript`. Absent in normal use. */
    __WA_MOCK_SCRIPT__?: MockScript;
    /** Test/e2e seam: set before load to expose `__WA_VFS_PROOF__`. Absent in
     *  normal use. Read by `src/sidepanel.ts`. */
    __WA_ENABLE_VFS_PROOF__?: boolean;
    /** Test/e2e seam: per agent id, the provider the tools and the Files
     *  screen use, the chat panel and the folder backend factory. Created only
     *  when `__WA_ENABLE_VFS_PROOF__` is true. */
    __WA_VFS_PROOF__?: Record<string, {
      provider: VfsToolProvider;
      panel: AgentChatPanel;
      directoryBackend(root: FileSystemDirectoryHandle, options: { writable: boolean }): VfsBackend;
    }>;
  }
}
