import type { ThemePreference, TokenSet, WireFormat } from "./types";

export type { ThemePreference, TokenSet, WireFormat };

export const RELAY_PORT = "wa-llm-relay";
export const SETTLE_MS = 10_000;
export const TOGGLE_MESSAGE = "wa-toggle";

/** Panel -> tab: report the tab's origin and whether the bubble is really
 *  mounted there. Needs no permission, unlike reading `tab.url`, which the
 *  Chrome tabs API grants only with the "tabs" permission or a host
 *  permission for that page. An extension page runs no content script, so this
 *  message rejects there and the panel can never target itself. */
export const STATE_MESSAGE = "wa-state";

/** Panel -> tab: put a message into the in-page bubble's conversation. Carries a
 *  `text` field. The tab replies with the `origin`/`mounted`/`foreign` fields
 *  {@link STATE_MESSAGE} returns, plus `delivered`, `ranCommand` and `command`. */
export const SEND_MESSAGE = "wa-send";

/** Panel -> tab: read the in-page bubble's conversation messages and running
 *  state. */
export const READ_MESSAGE = "wa-read";

/** How long `toggle_page_agent` waits for {@link STATE_MESSAGE} to confirm
 *  a mount before it reports the mount failed, and how long
 *  `send_to_page_agent` waits before it repeats its refusal. A mount the toggle
 *  already acknowledged can still be settling when the next tool call arrives;
 *  the live run of 2026-09-20 had a toggle report ON and the very next send
 *  refuse on the same tab. 3 s also keeps the detached-send refusal well inside
 *  the 15 s budget of e2e/page-agent.mock.spec.ts:738. */
export const MOUNT_READY_TIMEOUT_MS = 3_000;

/** The gap between two mounted probes inside that wait. */
export const MOUNT_PROBE_INTERVAL_MS = 100;

/** Extension page or bridge -> worker: ask for the compiled brand. The worker
 *  answers with the parsed `brand.json`, or with an empty brand when that file
 *  is missing or unreadable. Content scripts never receive it — a
 *  `chrome.runtime.sendMessage` reaches extension contexts only. */
export const BRAND_MESSAGE = "brand:get";

/** Maximum character length for conversation text returned by
 *  `read_page_agent` before truncation. */
export const DEFAULT_READ_RESULT_MAX_CHARS = 6000;

/** Maximum character length for response body returned by
 *  `page_fetch` before truncation. */
export const DEFAULT_PAGE_FETCH_MAX_CHARS = 6000;

/** Maximum character length for the serialized result returned by
 *  `page_eval` before truncation. Same ceiling as `page_fetch`, so both
 *  page tools cost the model the same at worst. */
export const DEFAULT_PAGE_EVAL_MAX_CHARS = 6000;

/** Maximum character length for console tool output before truncation. */
export const DEFAULT_PAGE_CONSOLE_MAX_CHARS = 6000;

/** Maximum number of entries retained by the page console buffer. */
export const PAGE_CONSOLE_CAPACITY = 200;

/** Maximum character length per console entry. */
export const PAGE_CONSOLE_ENTRY_CHARS = 2000;

/** How long `page_fetch` waits when forwarding to a tab. */
export const DEFAULT_PAGE_FETCH_TIMEOUT_MS = 10_000;

/** How long `page_eval` waits when the agent names no `timeoutMs`. */
export const DEFAULT_PAGE_EVAL_TIMEOUT_MS = 10_000;

/** The smallest `timeoutMs` `page_eval` accepts. Below it the tool returns a
 *  named error and sends nothing to the page. */
export const MIN_PAGE_EVAL_TIMEOUT_MS = 1_000;

/** The largest `timeoutMs` `page_eval` accepts. Above it the tool returns a
 *  named error and sends nothing to the page. */
export const MAX_PAGE_EVAL_TIMEOUT_MS = 300_000;

/** The side panel's own session namespace, distinct from every host app's
 *  ("cat-store" in apps/cat-store/src/web/agent-panel-config.ts:268,
 *  "web-agent-docs" in packages/web-agent-lit/src/embed/web-agent-embed.ts:398),
 *  so panel conversations never appear in a host app's session list. */
export const PANEL_SESSION_NAMESPACE = "web-agent-extension-panel";

/** The in-page bubble's session namespace. The bubble saves sessions in the
 *  visited site's own storage, so a name of its own keeps them apart from a
 *  host app on that site that uses the lit bubble's "web-agent-docs" default. */
export const IN_PAGE_SESSION_NAMESPACE = "web-agent-extension-page";

/** The in-page bubble's own system prompt. It runs on any website, so it names
 *  no site. A brand adds its identity through `prompts.inPage` in plugin.yml. */
export const IN_PAGE_SYSTEM_PROMPT =
  "You are an assistant inside the current web page. You operate the current page only and cannot change pages; if the user needs a different page, ask them to switch to it. Keep replies precise, concise, and helpful.";

/** The base of the team gateway, used to build the ready-made entries. */
export const GATEWAY_BASE = "http://localhost:30000";

/** A fresh install follows the operating system. User decision, 2026-08-18. */
export const DEFAULT_THEME: ThemePreference = "auto";

/** The two blocks of packages/web-agent-lit/src/themes/wa-tokens.css this
 *  extension uses, at lines 457 and 894. `wa1-dark` (line 17) is the older
 *  line and is not offered. */
export const DARK_TOKEN_SET = "wa2-dark" as const satisfies TokenSet;
export const LIGHT_TOKEN_SET = "wa2-light" as const satisfies TokenSet;

export const LAUNCHER_ICON_SVG = `<svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" style="display:block;margin:auto;"><path d="M20 2H4c-1.1 0-1.99.9-1.99 2L2 22l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 9h12v2H6V9zm8 5H6v-2h8v2zm4-6H6V6h12v2z"/></svg>`;
export const CLOSE_ICON_SVG = `<svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" style="display:block;margin:auto;"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;

/** Mirrors the refusal in `page-agent-tools.ts` on purpose, so the agent reads one phrasing
 *  across every tool that needs the extension turned on for a tab. Lives here,
 *  not in `panel-page-tools.ts`, so `page-screenshot-tool.ts` can use the same
 *  wording without importing its sibling and forming a cycle. */
export const NOT_ACTIVATED = (tabId: number, origin: string) =>
  `The web agent is not on in tab #${tabId} (${origin}). Ask the user to activate the extension on that page, then try again.`;

/** page_snapshot's character budget, the same 12,000 the DomAdapter
 *  snapshot uses (packages/web-agent-dom/src/adapters/dom-adapter.ts:53). */
export const SNAPSHOT_MAX_CHARS = 12_000;

/** The attribute content.ts sets on the extension's OWN bubble. A site may ship
 *  its own <web-agent-bubble> (cat-store does), so the tag name cannot tell the
 *  two apart; the recorder ignores only an element carrying this attribute. */
export const EXTENSION_UI_ATTR = "data-web-agent-extension";
export const EXTENSION_UI_SELECTOR = `[${EXTENSION_UI_ATTR}]`;

/** The selector page_verify's helper-world checks use to skip the
 *  agent's own UI (panel-page-tools-verify-locator.ts:85-86). A site's own
 *  <web-agent-bubble> IS the page, so only the extension's own bubble is
 *  skipped, the same rule the recorder follows (page-recorder.ts:17). */
export const AGENT_UI_SELECTOR = EXTENSION_UI_SELECTOR;

/** The most requests one tab's debugger network log keeps; the oldest is
 *  dropped. */
export const DEFAULT_NETWORK_BUFFER_CAPACITY = 200;
/** `page_network` with `index`: the cap on the request body shown. */
export const DEFAULT_NETWORK_REQ_BODY_CHARS = 4000;
/** `page_network` with `index`: the cap on the response body shown. */
export const DEFAULT_NETWORK_RES_BODY_CHARS = 8000;
/** `page_upload_file`: the limit on the total bytes of one call (10 MB). */
export const MAX_UPLOAD_BYTES = 10_485_760;

/** How long the pointer must rest on one interactive element before the
 *  recorder records a hover. */
export const REC_HOVER_REST_MS = 500;

/** How long wheel events must stop before the recorder labels the scroll step. */
export const REC_SCROLL_QUIET_MS = 300;

/** How long the panel waits after a tool's last debugger input command before
 *  it resumes the recorder, so the page's own late listeners have run. */
export const REC_RESUME_DELAY_MS = 150;

