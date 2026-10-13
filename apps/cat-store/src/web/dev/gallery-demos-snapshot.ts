// gallery-demos-snapshot.ts — the DomAdapter snapshot demo extracted from gallery-demos.ts.

import { DomAdapter } from "@cuatoi/web-agent-dom";
import { navigate } from "../router";

// ============================================================================
// 3e. SNAPSHOT DEMO
// ============================================================================

const SNAPSHOT_MAX_CHARS = 2_500;

export async function mountSnapshotDemo(host: HTMLElement): Promise<void> {
  host.innerHTML = `
    <style>
      .snapshot-demo-container {
        font-family: monospace;
        margin: 0;
        background: var(--wa-background-color-300, #1e1e2e);
        color: var(--wa-text-color, #cdd6f4);
        display: flex;
        flex-direction: column;
        min-height: 100vh;
        box-sizing: border-box;
      }
      .snapshot-demo-container * { box-sizing: border-box; }
      .snapshot-demo-container .top {
        background: var(--wa-background-color-700, #313244);
        padding: var(--wa-padding-m, 0.75rem) var(--wa-padding-xl, 1.25rem);
        display: flex;
        align-items: center;
        gap: var(--wa-padding-xl, 1rem);
        border-bottom: 2px solid var(--wa-border-color, #45475a);
      }
      .snapshot-demo-container .top h1 {
        margin: 0;
        font-size: 1.1rem;
        color: var(--wa-header-text-color, #cba6f7);
      }
      .snapshot-demo-container .top button {
        background: var(--wa-action-color-info, #a6e3a1);
        color: var(--wa-background-color-300, #1e1e2e);
        border: none;
        border-radius: var(--wa-border-radius-s, 4px);
        padding: var(--wa-padding-s, 6px) var(--wa-padding-xl, 16px);
        font-weight: 600;
        cursor: pointer;
        font-family: inherit;
        font-size: var(--wa-font-size-s, 0.9rem);
      }
      .snapshot-demo-container .split { display: flex; flex: 1; min-height: 0; }
      .snapshot-demo-container .panel { flex: 1; overflow: auto; padding: var(--wa-padding-m, 0.75rem); }
      .snapshot-demo-container .panel h2 {
        margin: 0 0 var(--wa-padding-m, 0.5rem) 0;
        font-size: var(--wa-font-size-s, 0.9rem);
        color: var(--wa-label-color, #a6adc8);
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
      .snapshot-demo-container #live-view {
        background: var(--wa-background-color-700, #181825);
        border-radius: var(--wa-border-radius-m, 6px);
        padding: var(--wa-padding-xl, 1rem);
        min-height: 200px;
      }
      .snapshot-demo-container #snapshot-out {
        background: var(--wa-background-color-700, #11111b);
        border-radius: var(--wa-border-radius-m, 6px);
        padding: var(--wa-padding-xl, 1rem);
        white-space: pre-wrap;
        font-size: var(--wa-font-size-s, 0.85rem);
        line-height: 1.5;
        tab-size: 2;
        min-height: 200px;
      }
      .snapshot-demo-container .divider { width: 2px; background: var(--wa-border-color, #45475a); }
    </style>
    <div class="snapshot-demo-container">
      <div class="top">
        <h1>🖼️ DomAdapter snapshot demo</h1>
        <button id="snapBtn">📸 Snapshot</button>
      </div>
      <div class="split">
        <div class="panel">
          <h2>🌐 Live page (cat store + agent-ui)</h2>
          <div id="live-view"><div id="app"></div></div>
        </div>
        <div class="divider"></div>
        <div class="panel">
          <h2>📄 Snapshot output</h2>
          <div id="snapshot-out">Click "Snapshot" to capture the page outline.</div>
        </div>
      </div>
    </div>
  `;

  const app = host.querySelector("#app");
  if (app) {
    app.innerHTML = `<app-root></app-root>`;
    navigate("/store");
  }

  await new Promise((r) => setTimeout(r, 300));

  const adapter = new DomAdapter({
    snapshotMaxChars: SNAPSHOT_MAX_CHARS,
  });

  const snapBtn = host.querySelector("#snapBtn")!;
  const outEl = host.querySelector("#snapshot-out")!;

  async function doSnapshot(interactiveOnly: boolean = false) {
    outEl.textContent = "⏳ Snapshotting…";
    try {
      const text = await adapter.snapshot({ interactive_only: interactiveOnly });
      outEl.textContent = text;
    } catch (err: unknown) {
      outEl.textContent = `❌ Error:\n${err instanceof Error ? err.message : String(err)}`;
    }
  }

  snapBtn.addEventListener("click", () => { void doSnapshot(false); });

  document.addEventListener("keydown", (e) => {
    if (e.key === "i" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void doSnapshot(true);
    }
  });
}
