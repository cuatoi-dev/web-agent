// Registers <web-agent-bubble> (which in turn imports chat-panel, registering <agent-chat-panel>)
import "@cuatoi/web-agent-lit/themes/wa-tokens.css";
import "@cuatoi/web-agent-lit/embed/web-agent-embed";
import {
  setMockScript,
  coreSkills,
  genuiRenderers,
  getAgentCursor,
  createActionCue,
} from "@cuatoi/web-agent-lit";
import { SPEED_PRESETS } from "@cuatoi/web-agent-core";
import type { MessagePart } from "@cuatoi/web-agent-core";
import { domTools, domSkills } from "@cuatoi/web-agent-dom";

import { searchDocsTool } from "./search-docs-tool";
import { docsGuideSkill } from "./docs-guide-skill";
import { docsDemoSkill } from "./demo-skill";
import { DEMO_AGENT_AVATAR } from "./gallery-states";
import { enablePanelResize } from "./panel-resize";
// 005: the shadow wrapper that hosts the bubble.
import { DocsAgentWidget } from "./docs-agent-widget";

function wireAgent() {
  // 005: the bubble is hosted inside <docs-agent-widget>'s shadow root, not
  // appended to the light DOM directly. Fall back to replacing a bare
  // <web-agent-bubble> (e.g. a page that has not been converted) so this
  // keeps working either way.
  let widget: DocsAgentWidget | null = document.querySelector("docs-agent-widget");
  if (!widget) {
    const existingBubble = document.querySelector("web-agent-bubble");
    if (existingBubble) {
      widget = new DocsAgentWidget();
      existingBubble.replaceWith(widget);
    }
  }
  const bubble = widget?.bubble ?? document.querySelector("web-agent-bubble");
  if (bubble) {
    // Token gate (task 001): every /api/openai call from the browser must
    // carry X-Web-Agent-Token, or the reverse proxy rejects it with 401.
    // `process.env.WEB_AGENT_TOKEN` is a build-time constant, injected by
    // webpack.config.cjs's DefinePlugin from the WEB_AGENT_TOKEN env var (same
    // fallback the devServer proxy uses) — not a source literal, so rotating
    // the token is a redeploy with a new env value, not a code change.
    const defaultFetch = window.fetch.bind(window);
    bubble.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (!headers.has("X-Web-Agent-Token")) {
        headers.set("X-Web-Agent-Token", process.env.WEB_AGENT_TOKEN as string);
      }
      return defaultFetch(input, { ...init, headers });
    };
    // OpenAI transport: /api/openai/v1 → the model gateway → model alias `sonnet`.
    // NOTE: baseURL must include /v1 — the OpenAI provider appends /chat/completions directly;
    // Anthropic is different (/api/anthropic → the provider appends /v1/messages).
    bubble.path = "/api/openai/v1";
    bubble.model = "sonnet";
    // 067-ui runtime model switcher — friendly labels for the kebab "Choose model" group.
    bubble.models = [{ id: "sonnet", label: "Leo" }, { id: "haiku", label: "Mochi" }];
    bubble.imageInput = false;
    bubble.cues = { enabled: true, speed: "slow" };
    bubble.tools = [searchDocsTool];
    // docs-site has no Redux store, so getState is omitted — query_state
    // returns {}, same as before 007. 007: the host wires the cursor and
    // confirm-scrim, the only layer that knows both web-agent-lit and
    // web-agent-dom.
    const CUE_SPEED: "slow" | "fast" = "slow";
    bubble.toolProviders = domTools({
      images: false, // matches imageInput: false — no `see`
      actionCue: createActionCue({ getCursor: () => getAgentCursor(), speed: () => CUE_SPEED }),
      typingPaceMs: SPEED_PRESETS[CUE_SPEED].msPerWord,
      confirmInteraction: bubble.confirmInteraction.bind(bubble),
    });
    bubble.skills = [...coreSkills(), ...domSkills(), docsGuideSkill, docsDemoSkill];
    bubble.renderers = [...genuiRenderers];
    bubble.appContext = {
      appName: "Web Agent Docs",
      appDescription: "Documentation assistant for the Web Agent project.",
      appInstructions:
        "If the user's message is exactly `/demo` or asks to \"run the demo\", immediately " +
        "call load_skill(\"demo\") and then execute every step in the loaded skill in order."
    };
    bubble.agentName = "Web Agent Guide";
    bubble.agentShortName = "Guide";
    bubble.agentAvatar = DEMO_AGENT_AVATAR;
    bubble.launcherIcon = "menu_book";

    // 004: inject the current page into every user prompt so the agent knows
    // which doc the reader is on. 011: every one of the seven lifecycle hooks
    // also prints one line, so the whole turn can be traced in the browser
    // console — parity with cat-store's agent-panel-config.ts. Plain
    // console.log, always on, no dev-only gating.
    //
    // EVERY handler except onUserPrompt MUST use a braced body and return
    // nothing — run-hooks.ts treats a truthy return as an opinion (onPreTool
    // would change the allow/deny/ask decision, onPostTool would rewrite the
    // tool outcome, onPreCompact would veto compaction). Logging there must
    // stay observe-only. onUserPrompt already returns an opinion (the page
    // context part it injects), so it keeps composing that return value.
    const HOOK_LOG = "[docs-site hooks]";
    bubble.hooks = {
      onSessionStart: (p) => {
        console.log(`${HOOK_LOG} onSessionStart sessionId=${p.sessionId}`);
      },
      onUserPrompt: ({ parts }) => {
        console.log(
          `${HOOK_LOG} onUserPrompt parts=${parts.length} types=${parts.map((x) => x.type).join(",")}`
        );
        const currentPath = window.location.hash || "#/guides/index";
        const contextPart: MessagePart = { type: "text", text: `[Current Page Context: ${currentPath}]\n\n` };
        // The visible bubble must show only what the reader typed — the
        // injected context header is for the model, not the transcript (B-8).
        const rawUserText = parts
          .filter((p): p is Extract<MessagePart, { type: "text" }> => p.type === "text")
          .map((p) => p.text)
          .join("\n");
        return {
          parts: [contextPart, ...parts],
          userDisplayText: rawUserText || undefined,
        };
      },
      onPreTool: (p) => {
        console.log(
          `${HOOK_LOG} onPreTool name=${p.name} input=${JSON.stringify(p.input)} summary=${p.summary ?? "-"}`
        );
      },
      onPostTool: (p) => {
        const content = String(p.outcome?.content ?? "");
        console.log(
          `${HOOK_LOG} onPostTool name=${p.name} isError=${p.outcome?.isError === true} content=${content.slice(0, 80)}`
        );
      },
      onTurnEnd: (p) => {
        console.log(
          `${HOOK_LOG} onTurnEnd stopReason=${p.stopReason} textLength=${p.result?.assistantText?.length ?? 0}`
        );
      },
      onPreCompact: (p) => {
        console.log(
          `${HOOK_LOG} onPreCompact tokens=${p.tokens} percent=${Math.round((p.percent ?? 0) * 100)}%`
        );
      },
      onPostCompact: (p) => {
        console.log(
          `${HOOK_LOG} onPostCompact tokensBefore=${p.tokensBefore} tokensAfter=${p.tokensAfter}`
        );
      },
    };

    // Test/e2e seam: deterministic mock LLM (no network). Mirrors cat-store startup seam.
    const mockScript = window.__WA_MOCK_SCRIPT__;
    if (mockScript) {
      setMockScript(mockScript);
      // WebAgentBubble.type's declared setter type ("openai" | "anthropic" |
      // "gemini") is narrower than what the underlying panel actually accepts
      // (chat-panel-props.ts's own `type` setter includes "mock") — a web-agent-lit
      // package limitation, out of scope for this docs-site task.
      (bubble as unknown as { type: string }).type = "mock";
      bubble.streaming = false;
    } else {
      bubble.type = "openai";
      bubble.streaming = true;
    }

    // 003: host opt-in for the drag-to-resize grip. The gallery builds its own
    // bubbles from a separate entry and does not call this.
    enablePanelResize(bubble);
  }
}

// Module scripts run after HTML parsing — bubble should already be in the DOM
wireAgent();
