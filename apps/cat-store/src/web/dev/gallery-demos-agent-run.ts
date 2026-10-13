// gallery-demos-agent-run.ts — the agent run demo extracted from gallery-demos.ts.

import {
  ContextManager,
  createPageAgent,
  runTurn,
  DEFAULT_CONFIG,
  defaultTools,
  coreSkills,
  type ToolContext,
} from "@cuatoi/web-agent-lit";
import { domTools, domSkills } from "@cuatoi/web-agent-dom";
import { store } from "../store";

// ============================================================================
// 3f. AGENT RUN DEMO
// ============================================================================

export async function mountAgentRunDemo(host: HTMLElement): Promise<void> {
  host.innerHTML = `
    <style>
      .agent-run-demo-container {
        font-family: var(--wa-font-family, system-ui, -apple-system, sans-serif);
        margin: 0;
        background: var(--wa-background-color-300, #1e1e2e);
        color: var(--wa-text-color, #cdd6f4);
        display: flex;
        flex-direction: column;
        min-height: 100vh;
        box-sizing: border-box;
      }
      .agent-run-demo-container * { box-sizing: border-box; }
      .agent-run-demo-container .top {
        background: var(--wa-background-color-700, rgba(49, 50, 68, 0.7));
        padding: var(--wa-padding-xl, 1rem) var(--wa-padding-xl, 1.5rem);
        display: flex;
        align-items: center;
        justify-content: space-between;
        border-bottom: 1px solid var(--wa-border-color, rgba(255, 255, 255, 0.1));
      }
      .agent-run-demo-container .top h1 {
        margin: 0;
        font-size: 1.25rem;
        color: var(--wa-header-text-color, #cba6f7);
        display: flex;
        align-items: center;
        gap: var(--wa-padding-m, 0.5rem);
      }
      .agent-run-demo-container .top-controls {
        display: flex;
        align-items: center;
        gap: var(--wa-padding-xl, 1rem);
      }
      .agent-run-demo-container .top button {
        background: var(--wa-action-color-info, #89b4fa);
        color: var(--wa-background-color-700, #11111b);
        border: none;
        border-radius: var(--wa-border-radius-m, 6px);
        padding: var(--wa-padding-m, 8px) var(--wa-padding-xl, 18px);
        font-weight: 600;
        cursor: pointer;
        font-family: inherit;
        font-size: var(--wa-font-size-s, 0.9rem);
        box-shadow: 0 4px 12px var(--wa-black-color-20opc, rgba(0, 0, 0, 0.2));
      }
      .agent-run-demo-container .top button:disabled {
        background: var(--wa-background-color-500, #45475a);
        color: var(--wa-label-color, #a6adc8);
        cursor: not-allowed;
        box-shadow: none;
      }
      .agent-run-demo-container .split {
        display: flex;
        flex: 1;
        min-height: 0;
      }
      .agent-run-demo-container .panel {
        flex: 12;
        overflow: auto;
        padding: var(--wa-padding-xl, 1.25rem);
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .agent-run-demo-container .panel.sidebar {
        flex: 10;
        border-left: 1px solid var(--wa-border-color, rgba(255, 255, 255, 0.1));
        background: var(--wa-background-color-700, rgba(17, 17, 27, 0.5));
      }
      .agent-run-demo-container .panel h2 {
        margin: 0 0 var(--wa-padding-m, 0.75rem) 0;
        font-size: var(--wa-font-size-m, 0.95rem);
        color: var(--wa-header-text-color, #bac2de);
        text-transform: uppercase;
        letter-spacing: 0.06em;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .agent-run-demo-container #live-view {
        background: var(--wa-background-color-700, #181825);
        border-radius: var(--wa-border-radius-l, 12px);
        padding: var(--wa-padding-xl, 1.25rem);
        flex: 1;
        min-height: 400px;
        border: 1px solid var(--wa-border-color, rgba(255, 255, 255, 0.05));
        box-shadow: 0 8px 24px var(--wa-black-color-20opc, rgba(0, 0, 0, 0.2));
        overflow-y: auto;
      }
      .agent-run-demo-container .status-box {
        background: var(--wa-background-color-700, #11111b);
        border: 1px solid var(--wa-border-color, rgba(255, 255, 255, 0.05));
        border-radius: var(--wa-border-radius-l, 8px);
        padding: var(--wa-padding-xl, 1rem);
        margin-bottom: var(--wa-padding-xl, 1rem);
      }
      .agent-run-demo-container .console-pre {
        margin: 0;
        white-space: pre-wrap;
        font-family: monospace;
        font-size: var(--wa-font-size-s, 0.82rem);
        line-height: 1.5;
        background: var(--wa-background-color-700, #11111b);
        padding: var(--wa-padding-m, 0.75rem);
        border-radius: var(--wa-border-radius-m, 6px);
        border: 1px solid var(--wa-border-color, rgba(255, 255, 255, 0.02));
        color: var(--wa-text-color, #cdd6f4);
        flex: 1;
        overflow-y: auto;
      }
      .agent-run-demo-container .badge {
        font-size: var(--wa-font-size-s, 0.8rem);
        font-weight: bold;
        text-transform: uppercase;
        padding: var(--wa-padding-xs, 2px) var(--wa-padding-m, 8px);
        border-radius: var(--wa-border-radius-xl, 9999px);
        background: var(--wa-action-color-info-10opc, rgba(137, 180, 250, 0.2));
        color: var(--wa-action-color-info, #89b4fa);
      }
      .agent-run-demo-container .badge.warning {
        background: var(--wa-action-color-warn-10opc, rgba(249, 226, 175, 0.2));
        color: var(--wa-action-color-warn, #f9e2af);
      }
    </style>
    <div class="agent-run-demo-container">
      <div class="top">
        <h1>🤖 Agent Loop & Persistence (Keystone)</h1>
        <div class="top-controls">
          <button id="runBtn">🚀 Run Agent Turn</button>
          <button id="clearDbBtn">🗑️ Clear DB</button>
        </div>
      </div>
      <div class="split">
        <div class="panel">
          <h2>🌐 Live App (cat-store)</h2>
          <div id="live-view">
            <div id="app"></div>
          </div>
        </div>
        <div class="panel sidebar">
          <h2>
            <span>📋 Agent Control & Logs</span>
            <span id="persist-status" class="badge warning">No Persistence DB</span>
          </h2>
          <div class="status-box">
            <strong>Task:</strong> Add Salmon Pâté to the cart and verify the total.<br/>
            <strong>Instruction to Agent:</strong> <span style="color: var(--wa-action-color-info, #f5c2e7);">"Add Salmon Pâté to the cart and tell me the new cart total"</span>
          </div>
          <pre class="console-pre" id="console-log">Waiting to start...</pre>
        </div>
      </div>
    </div>
  `;

  const app = host.querySelector("#app");
  if (app) {
    app.innerHTML = `<app-root></app-root>`;
  }

  const consoleLog = host.querySelector("#console-log")!;
  const runBtn = host.querySelector("#runBtn") as HTMLButtonElement;
  const clearDbBtn = host.querySelector("#clearDbBtn") as HTMLButtonElement;

  const [domProvider] = domTools({ getState: () => store.getState() });
  const loadedDomTools = await domProvider.load();

  const defaultFetch = window.fetch.bind(window);
  const authFetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    if (!headers.has("X-Web-Agent-Token")) {
      headers.set("X-Web-Agent-Token", process.env.WEB_AGENT_TOKEN as string);
    }
    return defaultFetch(input, { ...init, headers });
  };

  const cfg = {
    ...DEFAULT_CONFIG,
    fetch: authFetch,
    maxIterations: 6,
    model: "sonnet",
    cues: { enabled: true, speed: "slow" as const },
    tools: (c: ToolContext) => [...defaultTools(c), ...loadedDomTools],
    skills: [...coreSkills(), ...domSkills()],
  };

  const cm = new ContextManager(cfg.context);

  const ctx = {
    app: {
      appName: "Cat Store",
      appDescription: "A pet store selling organic cat food products.",
    },
    signal: new AbortController().signal,
  };

  function log(msg: string) {
    consoleLog.textContent += msg + "\n";
    consoleLog.scrollTop = consoleLog.scrollHeight;
  }

  const originalRecordStep = cm.recordStep.bind(cm);
  cm.recordStep = (messages, audit) => {
    originalRecordStep(messages, audit);
    log("\n--- Step Completed ---");
    if (audit && audit.length > 0) {
      for (const entry of audit) {
        log(`[Tool Call] Name: ${entry.name}`);
        log(`[Tool Call] Input: ${JSON.stringify(entry.input)}`);
        log(`[Tool Call] Outcome Summary: ${entry.outcomeSummary}`);
      }
    }
  };

  async function startAgentRun() {
    runBtn.disabled = true;
    clearDbBtn.disabled = true;
    log("\n🚀 Starting agent run turn...");

    const controller = new AbortController();
    const userText = "Add Salmon Pâté to the cart and tell me the new cart total";

    try {
      const result = await runTurn(
        createPageAgent(cfg, ctx, cm),
        cm,
        ctx,
        userText,
        controller.signal,
        cfg
      );

      log("\n🎉 Turn finished!");
      log(`[Stop Reason] ${result.stopReason}`);
      log(`[Assistant Answer] ${result.assistantText}`);

      const state = store.getState();
      log(`[Redux Store Cart Items] ${JSON.stringify(state.cart.items, null, 2)}`);
      log(`[Redux Store Cart Total] $${state.cart.total}`);
    } catch (err) {
      log(`\n❌ Error occurred: ${String((err as { message?: unknown } | null)?.message)}`);
    } finally {
      runBtn.disabled = false;
      clearDbBtn.disabled = false;
    }
  }

  runBtn.addEventListener("click", () => { void startAgentRun(); });

  clearDbBtn.addEventListener("click", () => {
    cm.rehydrateState([], []);
    log("ContextManager reset.");
  });
}
