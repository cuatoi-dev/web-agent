// The page's MAIN world half. It registers NO custom element at import time.
// The elements load inside mount(), only once the bubble is wanted. The
// embed's define is guarded, so a host that already defined the tag cannot throw.
import { domTools, domSkills } from "@cuatoi/web-agent-dom";
import { SPEED_PRESETS } from "@cuatoi/web-agent-core";
import { vfsTools } from "@cuatoi/web-agent-vfs";

import {
  SETTLE_MS,
  LAUNCHER_ICON_SVG,
  CLOSE_ICON_SVG,
  IN_PAGE_SESSION_NAMESPACE,
  IN_PAGE_SYSTEM_PROMPT,
} from "./lib/constants";
import { type AgentSettings } from "./lib/settings";
import { applyAgentBrand, EMPTY_BRAND } from "./lib/brand";
import { defaultSettings } from "./lib/brand-models";
import { brandToolConfig, mergeBrandSkills } from "./lib/brand-capabilities";
import type { AgentBrand } from "./lib/types";
import { findForeignAgent } from "./lib/agent-detect";
import { createRelayFetch } from "./lib/relay-fetch";
import { applyTheme, registerBrandThemes, type ThemeBinding } from "./lib/theme";
import { pageFetchSkill } from "./lib/page-fetch-skill";
import { pageFetchTools } from "./lib/page-fetch-tool";
import { pageEvalTools } from "./lib/page-eval-tool";
import { readBridgeMessage } from "./lib/bridge-protocol";
import { reachedPageAgentSession } from "./lib/page-agent-delivery";
import { inPage } from "./lib/live-element";
import type { PageAgentDelivery } from "./lib/types";
import { forwardedSkillRegistry } from "./lib/skill-registry";
import type { WebAgentBubble } from "@cuatoi/web-agent-lit";

/** True when `value` is a plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const ORIGIN = location.origin;
const CUE_SPEED: "slow" | "fast" = "slow";
let bubble: WebAgentBubble | null = null;
let mountPromise: Promise<void> | null = null;
let mountCancelled = false;
let observer: MutationObserver | null = null;
let settleTimer: number | undefined;
let themeBinding: ThemeBinding | null = null;

function mount(settings: AgentSettings, brand: AgentBrand): Promise<void> {
  if (bubble) return Promise.resolve();
  // Every caller shares the one in-flight mount, so a second message never
  // starts a second load and never reports "not mounted" while the first runs.
  if (mountPromise) return mountPromise;
  // The rule: a page that already has an agent gets nothing. This check runs
  // BEFORE the dynamic imports, so such a page registers nothing at all.
  if (findForeignAgent(document, null)) return Promise.resolve();
  mountCancelled = false;
  mountPromise = (async () => {
    try {
      const [, lit, vfsLit] = await Promise.all([
        import("@cuatoi/web-agent-lit/embed/web-agent-embed"),
        import("@cuatoi/web-agent-lit"),
        import("@cuatoi/web-agent-vfs/lit"),
      ]);
      // The world may have changed during the await.
      if (mountCancelled || bubble || findForeignAgent(document, null)) return;
      const { coreSkills, createActionCue, getAgentCursor, setMockScript } = lit;
      const { filesScreen } = vfsLit;
      const el = document.createElement("web-agent-bubble");
      el.setAttribute("data-agent-ui", "true");
      // Set before the element is appended, so the first session uses them.
      el.path = settings.endpoint;
      el.type = settings.wireFormat;
      el.model = settings.model;
      el.streaming = settings.streaming;
      el.launcherIcon = LAUNCHER_ICON_SVG;
      el.closeIcon = CLOSE_ICON_SVG;
      el.fetch = createRelayFetch();

      const mockScript = window.__WA_MOCK_SCRIPT__;
      if (mockScript) {
        setMockScript(mockScript);
        // WebAgentBubble.type's declared setter (web-agent-embed.ts) is narrower
        // than what it actually forwards to — AgentChatPanel.type accepts "mock"
        // too (chat-panel-props.ts:83). That gap is in web-agent-lit, out of scope for
        // this package; the assignment itself is sound.
        (el as unknown as { type: string }).type = "mock";
        el.streaming = false;
      }

      // 116/003 — the same three built-in groups, each droppable from
      // brand/plugin.yml's `skills` block, with the brand's own skills merged over
      // them. The group keys are the ones the compiler accepts.
      el.skills = mergeBrandSkills(
        {
          core: coreSkills(),
          dom: domSkills(),
          pageFetch: [pageFetchSkill],
        },
        brand,
      );
      // The shared store, reached through bridge.js. Set BEFORE the element is
      // appended below — the panel builds its session on connect and
      // reads the registry once, so a registry assigned later is never read.
      el.skillRegistry = forwardedSkillRegistry();
      el.cues = { enabled: true, speed: CUE_SPEED };
      const vfs = vfsTools();
      el.toolProviders = [
        ...domTools({
          actionCue: createActionCue({ getCursor: () => getAgentCursor(), speed: () => CUE_SPEED }),
          typingPaceMs: SPEED_PRESETS[CUE_SPEED].msPerWord,
          confirmInteraction: el.confirmInteraction.bind(el),
          agentUiSelector: "web-agent-bubble, [data-agent-ui]",
        }),
        ...pageFetchTools(),
        ...pageEvalTools(),
        // 069/003 — the agent file system on the WEBSITE's own storage, with the
        // default layout: /tmp is this page's sessionStorage, /home/agent and
        // /home/shared its localStorage, under the web-agent-vfs: key prefix
        // (web-agent-vfs/src/mounts.ts:23-25). Each website therefore has its own
        // files, separate from every other website's and from the side panel's
        // chrome.storage mounts. NOT spread: vfsTools returns ONE ToolProvider.
        vfs,
      ];
      el.screens = [filesScreen(vfs.vfs)];
      el.appContext = {
        appName: document.title || "Visited page",
        appDescription: "The current webpage in the browser.",
      };
      // 116/001 — the brand's own prompt for this agent. Runs AFTER appContext is
      // set, because it spreads what is already there. appName and appDescription
      // keep their current values; the identity move is task 004.
      applyAgentBrand(el, brand, "inPage");

      // 115/006 — todo tracking is opt-in per host
      // (packages/web-agent-core/src/controller.types.ts:119-121).
      //
      // TRAP: `WebAgentBubble` applies its own fallback config ONLY when the host
      // leaves `config` unset — `this.panelEl.config = this._config ?? { … }` at
      // packages/web-agent-lit/src/embed/web-agent-embed.ts:396-400. It is `??`,
      // not a merge, so setting `config` here REPLACES that fallback. That
      // fallback describes the Web Agent documentation site, so this bubble sets
      // its own namespace and prompt instead. Dropping `persist` would be a real
      // regression, not a no-op: `persist` defaults to FALSE
      // (packages/web-agent-core/src/config.ts:58, read at controller-config.ts:98),
      // so the bubble would silently stop saving sessions.
      el.config = {
        persist: true,
        sessionNamespace: IN_PAGE_SESSION_NAMESPACE,
        appendSystemPrompt: IN_PAGE_SYSTEM_PROMPT,
        // 155400-001 — the extension allows up to 1000 tool steps per turn;
        // the core default is 200.
        maxIterations: 1000,
        todo: { enabled: true },
        // 116/003 — LAST, so brand/plugin.yml's `tools` block overrides the host
        // opt-ins above. Adds nothing when the brand declares no flags.
        ...brandToolConfig(brand),
      };

      // Register brand themes without link injection (the manifest content_scripts
      // already injected their CSS into this page).
      registerBrandThemes(brand.themes, { linkCss: false });

      // The do-not-theme rule lives in applyTheme: a site that already supplies the
      // --wa-* tokens gets no attribute, and the bubble inherits its theme.
      themeBinding = applyTheme(el, settings.theme);

      document.body.appendChild(el);
      bubble = el;
      startObserver();
    } catch (err) {
      // No retry. The promise still resolves, so `void mount(...)` can never
      // leave an unhandled rejection.
      console.error("[web-agent] The in-page agent could not load:", err);
    } finally {
      mountPromise = null;
    }
  })();
  return mountPromise;
}

function unmount(): void {
  // An unmount during an in-flight mount cancels it, so the pending mount does
  // not append a bubble after this ran.
  if (mountPromise) mountCancelled = true;
  stopObserver();
  themeBinding?.dispose();
  themeBinding = null;
  bubble?.remove();
  bubble = null;
}

function startObserver(): void {
  // A host mounts its own agent from its startup code, which may run after
  // document_idle. If one appears, ours goes away, leaving exactly one.
  observer = new MutationObserver(() => {
    if (findForeignAgent(document, bubble)) unmount();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  settleTimer = window.setTimeout(stopObserver, SETTLE_MS);
}

function stopObserver(): void {
  observer?.disconnect();
  observer = null;
  if (settleTimer !== undefined) { clearTimeout(settleTimer); settleTimer = undefined; }
}

/** Our bubble while it is still in the page, and null once the page has
 *  removed it. Clearing the reference here is what makes `mounted` honest:
 *  it also repairs the toggle, whose `turningOn = !bubble` used to compute
 *  `false` against a detached node, so the user had to press the control
 *  twice to get the bubble back. */
function livingBubble(): WebAgentBubble | null {
  if (bubble && !inPage(bubble)) {
    stopObserver();
    themeBinding?.dispose();
    themeBinding = null;
    bubble = null;
  }
  return bubble;
}

/** Waits for an in-flight mount to finish, so a read, a send or a state answer
 *  never describes a half-finished mount. Resolves immediately when no mount is
 *  running. */
async function settled(): Promise<void> {
  if (mountPromise) await mountPromise;
}

/** What the panel's control needs to show an honest label: whether our bubble
 *  is really in this page, and whether the do-not-inject rule is what stopped
 *  it. `mount()` returns without mounting when the page already has an agent
 *  (see the findForeignAgent guard in mount), so "the user asked for it" and
 *  "it is there" are not the same thing. */
function reportState(type: string, extra: Record<string, unknown> = {}): void {
  const el = livingBubble();
  window.postMessage(
    { type, mounted: !!el, foreign: !!findForeignAgent(document, el), ...extra },
    "*",
  );
}

// 116/002 — the defensive fallback for a message that carries no settings. The
// MAIN world cannot call getSettings(), so it uses the compiled presets: the
// same degrade path an unreadable brand.json takes.
const FALLBACK_SETTINGS: AgentSettings = defaultSettings(EMPTY_BRAND);

window.addEventListener("message", (event) => {
  const msg = readBridgeMessage(event);
  if (!msg) return;

  // A message from the bridge always carries settings. The fallback keeps the
  // page working if a stale bridge bundle ever sends the old, payload-free
  // message.
  const settings: AgentSettings =
    (msg.type === "wa-bridge-enable" || msg.type === "wa-bridge-toggle")
      ? (msg.settings ?? FALLBACK_SETTINGS)
      : FALLBACK_SETTINGS;
  // 116/001 — the brand rides the same two messages, with the same fallback.
  // e2e/skills.mock.spec.ts:484 posts wa-bridge-enable with neither field, so
  // this path is exercised in a real browser.
  const brand: AgentBrand =
    (msg.type === "wa-bridge-enable" || msg.type === "wa-bridge-toggle")
      ? (msg.brand ?? EMPTY_BRAND)
      : EMPTY_BRAND;

  if (msg.type === "wa-bridge-enable") {
    void mount(settings, brand);
    return;
  }

  if (msg.type === "wa-bridge-toggle") {
    void (async () => {
      let requested: "on" | "off";
      if (mountPromise) {
        // The panel showed "off" while the load ran, so this press asks for ON
        // again. Wait for the one mount instead of starting a second one.
        await mountPromise;
        requested = "on";
      } else {
        const turningOn = !livingBubble();
        requested = turningOn ? "on" : "off";
        if (turningOn) await mount(settings, brand); else unmount();
      }
      // The outcome, not the request. On a page that already has its own agent
      // mount() declines, and writing `turningOn` would record a bubble that is
      // not there — the panel's control would then show the wrong state.
      window.postMessage({ type: "wa-bridge-set-origin-enabled", origin: ORIGIN, enabled: !!livingBubble() }, "*");
      // 002 — the direction travels with the outcome. Without it a decline
      // reads as a deliberate turn-off, which is what made the panel say "the
      // page agent was on and I just turned it off" for a press that had asked
      // for ON and got nothing.
      reportState("wa-bridge-toggle-result", { requested });
    })();
    return;
  }

  if (msg.type === "wa-bridge-send") {
    const text = msg.text;
    // Never mounts. The user's per-origin choice decides whether the bubble is
    // here; a send that quietly injected one would take that decision away.
    // The tool turns the "not mounted" answer into an error naming the toggle
    // tool. `send()` opens the bubble whenever it is closed
    // (web-agent-embed.ts), so the user sees it open and the message arrive.
    void (async () => {
      await settled();
      // 002 — one lookup, used for the send and for every field reported
      // about it. `!!bubble` was true for an element the page had already
      // removed, so the panel was told a detached, invisible bubble had the
      // message.
      const el = livingBubble();
      // `delivered` reports that the message reached the panel's session, not
      // that the page agent has answered — reachedPageAgentSession explains why
      // the send promise itself cannot be awaited here. 001/113: the same helper
      // now also reports whether the panel RAN a slash command, which is the one
      // fact `send_to_page_agent` used to guess at.
      let outcome: PageAgentDelivery = { delivered: false, ranCommand: false };
      if (el && text) {
        outcome = await reachedPageAgentSession(el.send(text));
      }
      window.postMessage(
        {
          type: "wa-bridge-send-result",
          mounted: !!el,
          foreign: !!findForeignAgent(document, el),
          delivered: outcome.delivered,
          ranCommand: outcome.ranCommand,
          ...(outcome.command === undefined ? {} : { command: outcome.command }),
        },
        "*",
      );
    })();
    return;
  }

  if (msg.type === "wa-bridge-read") {
    void (async () => {
      await settled();
      let messages: { role: string; text: string }[] = [];
      let running = false;
      const el = livingBubble();
      if (el) {
        // `WebAgentBubble.messages` is declared `get messages(): SessionMessage[]`
        // (web-agent-embed.ts). The value is widened to `unknown[]` and each
        // field is narrowed here before it is read.
        const rawMsgs: unknown[] = el.messages;
        messages = rawMsgs.map((m) => {
          const rec = isRecord(m) ? m : {};
          const role = typeof rec.role === "string" && rec.role ? rec.role : "user";
          let text = "";
          if (typeof rec.text === "string") {
            text = rec.text;
          } else if (typeof rec.content === "string") {
            text = rec.content;
          } else if (Array.isArray(rec.parts)) {
            text = (rec.parts as unknown[])
              .filter((p): p is Record<string, unknown> => isRecord(p) && (p.kind === "text" || p.type === "text"))
              .map((p) => (typeof p.text === "string" ? p.text : ""))
              .join(" ");
          } else if (Array.isArray(rec.content)) {
            text = (rec.content as unknown[])
              .filter((p): p is Record<string, unknown> => isRecord(p) && (p.kind === "text" || p.type === "text"))
              .map((p) => (typeof p.text === "string" ? p.text : ""))
              .join(" ");
          }
          return { role, text };
        });
        running = el.running;
      }
      window.postMessage(
        {
          type: "wa-bridge-read-result",
          mounted: !!el,
          foreign: !!findForeignAgent(document, el),
          messages,
          running,
        },
        "*",
      );
    })();
    return;
  }

  if (msg.type === "wa-bridge-state-request") {
    void (async () => {
      await settled();
      reportState("wa-bridge-state");
    })();
    return;
  }

});
