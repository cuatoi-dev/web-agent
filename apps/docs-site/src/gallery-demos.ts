import { getAgentCursor } from "@cuatoi/web-agent-lit/chat-ui/agent-cursor";

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
      .cues-demo-wrap p { margin: 0 0 var(--wa-padding-l, 12px) 0; font-size: 0.95rem; color: var(--wa-text-color, #1f1f1f); }
      .cues-demo-wrap .row { display: flex; gap: var(--wa-padding-l, 12px); margin-top: var(--wa-padding-l, 12px); flex-wrap: wrap; align-items: center; }
      .cues-demo-wrap .target {
        padding: var(--wa-padding-m, 8px) var(--wa-padding-l, 16px);
        font: inherit;
        font-size: 14px;
        border-radius: var(--wa-border-radius-m, 6px);
        border: 1px solid var(--wa-border-color, #888);
        background: var(--wa-input-background-color, #fff);
        color: var(--wa-input-text-color, var(--wa-text-color, #1f1f1f));
        cursor: pointer;
      }
      .cues-demo-wrap .target:focus {
        outline: 2px solid var(--wa-outline-color, #6750a4);
        outline-offset: 2px;
      }
      .cues-demo-wrap input.target {
        cursor: text;
      }
    </style>
    <div class="cues-demo-wrap">
      <h1>Action Cues Demo</h1>
      <p>Click the button below to fire a click + fill cue on it (DomAdapter, no LLM).</p>
      <div class="row">
        <button id="runCues" class="target">Run cues</button>
        <input id="fillMe" class="target" placeholder="Fill target" />
      </div>
    </div>
  `;

  const runBtn = host.querySelector("#runCues") as HTMLButtonElement;
  const input = host.querySelector("#fillMe") as HTMLInputElement;

  async function runCues(): Promise<void> {
    const cursor = getAgentCursor();
    runBtn.disabled = true;

    // 1. Move to button and pulse (click cue).
    const btnRect = runBtn.getBoundingClientRect();
    const btnCenter = { x: btnRect.left + btnRect.width / 2, y: btnRect.top + btnRect.height / 2 };
    cursor.show();
    await cursor.moveTo(btnCenter, "fast");
    cursor.clickPulse();

    // 2. Move to input and flash (fill/see cue).
    const inputRect = input.getBoundingClientRect();
    const inputCenter = { x: inputRect.left + inputRect.width / 2, y: inputRect.top + inputRect.height / 2 };
    await cursor.moveTo(inputCenter, "fast");
    cursor.flash(inputRect);

    // Let animations settle so the cue DOM is observable, then clear.
    await new Promise((r) => setTimeout(r, 1500));
    cursor.clear();
    runBtn.disabled = false;
  }

  runBtn.addEventListener("click", () => {
    runCues().catch((e) => console.error("cues-demo error:", (e as Error).message));
  });
}
