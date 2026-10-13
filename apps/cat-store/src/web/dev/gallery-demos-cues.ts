// gallery-demos-cues.ts — the cues demo extracted from gallery-demos.ts.

import { getAgentCursor } from "@cuatoi/web-agent-lit";
import { DomAdapter } from "@cuatoi/web-agent-dom";

// ============================================================================
// 3a. CUES DEMO
// ============================================================================

export function mountCuesDemo(host: HTMLElement): void {
  host.innerHTML = `
    <style>
      .cues-demo-wrap {
        box-sizing: border-box;
        font-family: var(--wa-font-family, system-ui, -apple-system, sans-serif);
        margin: 0;
        background: var(--wa-background-color, #fafafa);
        color: var(--wa-text-color, #1f1f1f);
        padding: var(--wa-padding-xl, 16px);
        min-height: 100vh;
      }
      .cues-demo-wrap * { box-sizing: border-box; }
      .cues-demo-wrap h1 { margin: 0 0 var(--wa-padding-l, 12px) 0; font-size: 1.1rem; }
      .cues-demo-wrap .row { display: flex; gap: var(--wa-padding-l, 12px); margin-top: var(--wa-padding-l, 12px); flex-wrap: wrap; }
      .cues-demo-wrap .target {
        min-width: 220px; min-height: 44px;
        padding: var(--wa-padding-l, 10px) var(--wa-padding-xl, 14px);
        font: inherit;
        border-radius: var(--wa-border-radius-m, 6px);
        border: 1px solid var(--wa-border-color, #888);
        background: var(--wa-input-background-color, #fff);
        color: var(--wa-input-text-color, var(--wa-text-color, #1f1f1f));
        cursor: pointer;
      }
      .cues-demo-wrap .target:focus {
        outline: 2px solid var(--wa-outline-color, #6750A4);
        outline-offset: 2px;
      }
      .cues-demo-wrap .log {
        margin-top: var(--wa-padding-xl, 16px);
        padding: var(--wa-padding-m, 8px) var(--wa-padding-l, 12px);
        background: var(--wa-background-color-700, #111);
        color: var(--wa-text-color, #cdd6f4);
        border-radius: var(--wa-border-radius-m, 6px);
        font: 12px/1.5 ui-monospace, monospace; /* eslint-disable-line wa/no-untokenized-font -- the log is a fixed-width diagnostic readout; a themed body font would misalign the snapshot text */
        max-height: 200px;
        overflow: auto;
      }
    </style>
    <div class="cues-demo-wrap">
      <h1>🎬 Cues demo — deterministic cue lifecycle (no LLM)</h1>
      <div class="row">
        <button id="runCues" class="target">▶ Run click + fill cues</button>
        <button id="btn" class="target">Clickable Button</button>
        <input id="input" class="target" type="text" placeholder="Type here" />
      </div>
      <div class="log" id="log">Ready.</div>
    </div>
  `;

  const runBtn = host.querySelector("#runCues") as HTMLButtonElement;
  const btn = host.querySelector("#btn") as HTMLButtonElement;
  const input = host.querySelector("#input") as HTMLInputElement;
  const log = host.querySelector("#log") as HTMLDivElement;

  function log2(msg: string) {
    log.textContent += msg + "\n";
    log.scrollTop = log.scrollHeight;
  }

  async function runCues() {
    runBtn.disabled = true;
    log.textContent = "▶ Running cues…\n";
    const cursor = getAgentCursor();

    // 1. Move to button and pulse (click cue).
    const btnRect = btn.getBoundingClientRect();
    const btnCenter = { x: btnRect.left + btnRect.width / 2, y: btnRect.top + btnRect.height / 2 };
    cursor.show();
    await cursor.moveTo(btnCenter, "fast");
    cursor.clickPulse();
    log2("✓ click cue fired (cursor moved + pulse)");

    // 2. Move to input and flash (fill/see cue).
    const inputRect = input.getBoundingClientRect();
    const inputCenter = { x: inputRect.left + inputRect.width / 2, y: inputRect.top + inputRect.height / 2 };
    await cursor.moveTo(inputCenter, "fast");
    cursor.flash(inputRect);
    log2("✓ fill cue fired (cursor moved + flash)");

    // 3. Real DomAdapter word-by-word fill (exercises the adapter typing path, not just cursor.flash).
    const adapter = new DomAdapter({ root: document, typingPaceMs: () => 90 });
    await adapter.snapshot({});
    // Find ref for the #input element by iterating the ref table.
    let inputRef = "";
    for (let i = 1; i <= 20; i++) {
      const r = adapter.refTable.resolve(i);
      if (r.status === "ok" && r.el === input) { inputRef = String(i); break; }
      if (r.status === "unknown") break;
    }
    if (inputRef) {
      // Log each intermediate input event so e2e can assert word-by-word growth.
      input.addEventListener("input", () => {
        log2(`→ ${input.value}`);
      }, { once: false });
      await adapter.fill(inputRef, "hello agent world");
      log2(`✓ fill typed: ${input.value}`);
    }

    log2("✓ Done. Cursor will clear shortly.");
    // Let animations settle before clearing, so the cue DOM is observable.
    await new Promise((r) => setTimeout(r, 1500));
    cursor.clear();
    runBtn.disabled = false;
  }

  runBtn.addEventListener("click", () => {
    runCues().catch((e) => log2(`❌ ${(e as Error).message}`));
  });
}
