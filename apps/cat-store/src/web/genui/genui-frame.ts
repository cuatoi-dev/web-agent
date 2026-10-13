import { GENUI_SCRIPT_SOURCE_URL } from "../../shared/genui-diagnostics";
import { EXECUTABLE_SCRIPT_TYPES } from "./genui-syntax";
import { GENUI_CHART_READY_TIMEOUT_MS } from "../../shared/genui-chart";

export function buildFrameUrl(basePath: string = "genui/frame", profile?: "material" | "plain"): string {
  return profile ? `${basePath}?profile=${profile}` : basePath;
}

/**
 * Reloads the frame document in place, then resolves once it has finished
 * loading. This is how `mountIntoFrame` gets a clean global scope for every
 * render: a navigation destroys every `setInterval`/`setTimeout`/rAF loop and
 * window listener the previous render's scripts registered, and clears every
 * top-level `let`/`const` declaration, without replacing the iframe element
 * itself (which would drop its size/position and any pending browser state).
 *
 * Re-assigning `srcdoc` or `src` to its own current value still triggers a
 * real navigation in every browser tested — there is no cheaper "soft reset"
 * that clears globals without one.
 */
export async function reloadFrame(iframe: HTMLIFrameElement): Promise<void> {
  if (!iframe.isConnected) {
    throw new Error("Cannot access frame document. Ensure the iframe is connected and same-origin.");
  }
  return new Promise<void>((resolve, reject) => {
    const onLoad = () => {
      iframe.removeEventListener("load", onLoad);
      iframe.removeEventListener("error", onError);
      resolve();
    };
    const onError = () => {
      iframe.removeEventListener("load", onLoad);
      iframe.removeEventListener("error", onError);
      reject(new Error("Failed to reload frame"));
    };
    iframe.addEventListener("load", onLoad, { once: true });
    iframe.addEventListener("error", onError, { once: true });

    // Re-assigning to the same value still forces a reload in every
    // browser: the setter does not short-circuit on an unchanged value.
    // Holding the value in a local keeps the assignment from being a
    // self-reference (no-self-assign) while the setter still runs.
    if (iframe.srcdoc) {
      const srcdoc = iframe.srcdoc;
      iframe.srcdoc = srcdoc;
    } else if (iframe.src) {
      const src = iframe.src;
      iframe.src = src;
    } else {
      iframe.src = "about:blank";
    }
  });
}

export async function mountIntoFrame(iframe: HTMLIFrameElement, source: string): Promise<void> {
  await reloadFrame(iframe);
  const doc = iframe.contentDocument;
  if (!doc) {
    throw new Error("Cannot access frame document. Ensure the iframe is connected and same-origin.");
  }

  let root = doc.getElementById("genui-root");
  if (!root) {
    root = doc.createElement("div");
    root.id = "genui-root";
    doc.body.appendChild(root);
  }

  // Extract <script> tags before injecting via innerHTML, because innerHTML
  // does not execute scripts.
  const parser = new DOMParser();
  const parsed = parser.parseFromString(source, "text/html");
  const scripts: HTMLScriptElement[] = [];
  // Only executable scripts are lifted out and re-created. A data block —
  // `<script type="application/json">`, the child an <agent-chart-block>
  // carries its JSON in — must stay exactly where the model put it: the
  // browser never runs it, and moving it out of its parent element would
  // break the chart wiring and corrupt the JSON with the sourceURL comment
  // buildInjectedScript appends.
  Array.from(parsed.querySelectorAll("script")).forEach((el) => {
    if (!EXECUTABLE_SCRIPT_TYPES.has(el.type.trim().toLowerCase())) return;
    scripts.push(el);
    el.remove();
  });
  const htmlContent = parsed.body.innerHTML;

  // Use innerHTML so the iframe's own parser creates elements — this
  // triggers custom element upgrade (DOMParser importNode does not).
  root.innerHTML = htmlContent;

  // Synchronous, in the same task as the insertion. Component schedules its
  // first render in a microtask (web-agent-lit ui/component.ts:28-30) and that
  // render replaces the element's light DOM, so a chart's JSON child only
  // exists until then. The frame installs this hook in genui-chart-bundle.ts;
  // a frame without it (the plain profile, or jsdom's about:blank) is a no-op.
  const frameWindow = iframe.contentWindow as (Window & typeof globalThis) | null;
  try {
    frameWindow?.__WA_GENUI_FRAME_ON_MOUNT__?.(root);
  } catch (err: unknown) {
    console.error("genui frame mount hook failed", err);
  }

  // Re-create scripts so the browser executes them in the frame window context
  let cursor = 0;
  for (const s of scripts) {
    const scriptEl = doc.createElement("script");
    if (s.type) scriptEl.type = s.type;
    if (s.src) scriptEl.src = s.src;
    if (s.textContent) {
      const built = buildInjectedScript(source, s.textContent, cursor);
      cursor = built.nextIndex;
      scriptEl.textContent = built.text;
    }
    root.appendChild(scriptEl);
  }

  // Wait for custom element upgrades and Lit rendering
  await new Promise((resolve) => setTimeout(resolve, 0));

  // Then wait for every chart in this source to draw or fail. Without this the
  // tool's fixed GENUI_DRAIN_SETTLE_MS wait can screenshot "Loading chart
  // data…" and hand that to the model as its own rendered work
  // (genui-tool.ts:165). The frame's own function is bounded and never
  // rejects; a frame that installs no hook resolves immediately.
  try {
    await frameWindow?.__WA_GENUI_FRAME_READY__?.(GENUI_CHART_READY_TIMEOUT_MS);
  } catch (err: unknown) {
    console.error("genui frame ready signal failed", err);
  }
}

/**
 * Builds the text injected for one inline script.
 *
 * **The line offset, and why it is what it is.** A stack frame from an injected
 * script is anonymous, so `//# sourceURL=agent-ui.js` is appended to name it.
 * The browser then numbers lines from the start of the injected text. To make
 * `agent-ui.js:12` mean line 12 of the source the agent sent, the text is
 * padded with exactly as many blank lines as there are line breaks in the
 * mounted source before this script's content begins. The pad is the whole
 * prelude: nothing else is added above the agent's code, and the sourceURL
 * comment is appended below it.
 *
 * The mapping is therefore 1:1 with the mounted source, for every script block
 * in it. If the pad were dropped, a second script block would restart at line 1
 * and every reported line would point the agent at the wrong place.
 *
 * `fromIndex` makes the search order-safe when a source repeats identical
 * script text: pass the previous call's `nextIndex`.
 *
 * The content of an inline script is raw text in HTML, so `textContent` is
 * byte-identical to the source and `indexOf` finds it exactly. When it is not
 * found (a `<script src>` with no body, or text the parser normalised), the pad
 * is 0 and the sourceURL is still appended.
 */
export function buildInjectedScript(
  source: string,
  scriptText: string,
  fromIndex = 0,
): { text: string; padLines: number; nextIndex: number } {
  const at = scriptText ? source.indexOf(scriptText, fromIndex) : -1;
  const padLines = at < 0 ? 0 : source.slice(0, at).split("\n").length - 1;
  const text =
    "\n".repeat(padLines) + scriptText + `\n//# sourceURL=${GENUI_SCRIPT_SOURCE_URL}`;
  return {
    text,
    padLines,
    nextIndex: at < 0 ? fromIndex : at + scriptText.length,
  };
}
