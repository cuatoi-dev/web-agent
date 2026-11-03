import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { WebAgentBubble } from "./web-agent-embed.js";
import type { AgentChatPanel } from "../chat-ui/chat-panel.js";

if (!customElements.get("web-agent-bubble")) {
  customElements.define("web-agent-bubble", WebAgentBubble);
}

describe("WebAgentBubble launcher", () => {
  let el: WebAgentBubble;
  beforeEach(() => { el = document.createElement("web-agent-bubble") as WebAgentBubble; el.model = "test-model"; document.body.appendChild(el); });
  afterEach(() => { el.remove(); });

  const iconHtml = () => el.shadowRoot!.querySelector("#launcher-icon")!.innerHTML;

  it("defaults to the chat glyph when no icon/avatar set", () => {
    expect(iconHtml()).toContain("<i>chat</i>");
  });

  it("renders launcherIcon as a Material Symbols glyph", () => {
    el.launcherIcon = "menu_book";
    expect(iconHtml()).toContain("<i>menu_book</i>");
    expect(iconHtml()).not.toContain("<img");
  });

  it("launcherIcon takes precedence over agentAvatar on the launcher", () => {
    el.agentAvatar = "data:image/svg+xml,cat";
    el.launcherIcon = "menu_book";
    expect(iconHtml()).toContain("<i>menu_book</i>");
    expect(iconHtml()).not.toContain("wa-launcher-avatar");
  });

  it("falls back to the avatar <img> when only agentAvatar is set", () => {
    el.agentAvatar = "data:image/svg+xml,cat";
    expect(iconHtml()).toContain('class="wa-launcher-avatar"');
    expect(iconHtml()).toContain('src="data:image/svg+xml,cat"');
  });

  it("no longer renders a launcher name pill for agentShortName", () => {
    el.agentShortName = "Guide";
    expect(el.shadowRoot!.querySelector("#launcher-label")).toBeNull();
  });

  it("open state defaults to the close ligature when closeIcon is unset", () => {
    el.toggle();
    expect(iconHtml()).toBe("<i>close</i>");
  });

  it("the launcher's accessible name follows the open state", () => {
    const launcher = el.shadowRoot!.querySelector("#launcher")!;
    const closed = launcher.getAttribute("aria-label");
    el.toggle();
    const open = launcher.getAttribute("aria-label");
    el.toggle();
    expect(closed).toBeTruthy();
    expect(open).toBeTruthy();
    expect(open).not.toBe(closed);
    expect(launcher.getAttribute("aria-label")).toBe(closed);
  });

  it("open state uses closeIcon verbatim when a host overrides it", () => {
    el.closeIcon = "✕";
    el.toggle();
    expect(iconHtml()).toBe("✕");
  });
});

// 007: a Stop control inside the bubble so the user can stop the agent
// even after collapsing the panel mid-run.
describe("WebAgentBubble stop control", () => {
  let el: WebAgentBubble;
  beforeEach(() => { el = document.createElement("web-agent-bubble") as WebAgentBubble; el.model = "test-model"; document.body.appendChild(el); });
  afterEach(() => { el.remove(); });

  const stopBtn = () => el.shadowRoot!.querySelector<HTMLElement>("#stop-run");

  it("is present in the shadow root and hidden by default", () => {
    expect(stopBtn()).not.toBeNull();
    expect(stopBtn()!.dataset.visible).toBe("false");
  });

  it("carries an accessible name that is not colour alone", () => {
    expect(stopBtn()!.getAttribute("aria-label")).toBe("Stop");
    expect(stopBtn()!.querySelector("svg")).not.toBeNull();
  });

  it("a running panel with the bubble closed shows it", () => {
    el.toggle(); // open (creates panel)
    el.toggle(); // close
    expect(stopBtn()!.dataset.visible).toBe("false");

    const panel = el.shadowRoot!.querySelector("agent-chat-panel")!;
    panel.dispatchEvent(new CustomEvent("agent-running-change", {
      detail: { running: true },
      bubbles: true,
      composed: true,
    }));
    expect(stopBtn()!.dataset.visible).toBe("true");
  });

  it("a running panel with the bubble OPEN hides it", () => {
    el.toggle(); // open
    const panel = el.shadowRoot!.querySelector("agent-chat-panel")!;
    panel.dispatchEvent(new CustomEvent("agent-running-change", {
      detail: { running: true },
      bubbles: true,
      composed: true,
    }));
    expect(stopBtn()!.dataset.visible).toBe("false");
  });

  it("it hides again when the run ends", () => {
    el.toggle();
    el.toggle(); // close
    const panel = el.shadowRoot!.querySelector("agent-chat-panel")!;
    panel.dispatchEvent(new CustomEvent("agent-running-change", {
      detail: { running: true }, bubbles: true, composed: true,
    }));
    expect(stopBtn()!.dataset.visible).toBe("true");

    panel.dispatchEvent(new CustomEvent("agent-running-change", {
      detail: { running: false }, bubbles: true, composed: true,
    }));
    expect(stopBtn()!.dataset.visible).toBe("false");
  });

  it("pressing it calls the panel's stop()", () => {
    el.toggle(); // open to create the panel
    el.toggle(); // close
    const panel = el.shadowRoot!.querySelector("agent-chat-panel")!;
    const stopSpy = vi.fn();
    panel.stop = stopSpy;

    stopBtn()!.click();
    expect(stopSpy).toHaveBeenCalledTimes(1);
  });

  it("toggling the panel open while running moves the control back into the panel", () => {
    el.toggle();
    el.toggle(); // close
    const panel = el.shadowRoot!.querySelector("agent-chat-panel")!;
    panel.dispatchEvent(new CustomEvent("agent-running-change", {
      detail: { running: true }, bubbles: true, composed: true,
    }));
    expect(stopBtn()!.dataset.visible).toBe("true");

    el.toggle(); // open the bubble
    expect(stopBtn()!.dataset.visible).toBe("false");
  });
});

describe("WebAgentBubble property forwarding", () => {
  let el: WebAgentBubble;
  beforeEach(() => { el = document.createElement("web-agent-bubble") as WebAgentBubble; el.model = "test-model"; document.body.appendChild(el); });
  afterEach(() => { el.remove(); });

  const SIX_PROPS = ["store", "appContext", "sources", "toolProviders", "config", "notify", "hooks"] as const;

  it("forwards all seven host properties onto a panel created after they are set", () => {
    const values: Record<string, unknown> = {
      store: { getState: () => ({}), subscribe: () => () => {}, dispatch: () => {} },
      appContext: { appName: "Cat Store" },
      sources: [{ id: "cats" }],
      toolProviders: [{ name: "demomcp", required: true, load: () => Promise.resolve([]) }],
      config: { persist: true, sessionNamespace: "cat-store" },
      notify: () => {},
      hooks: { onPreTool: () => Promise.resolve(undefined) },
    };
    for (const prop of SIX_PROPS) (el as unknown as Record<string, unknown>)[prop] = values[prop];
    el.toggle();

    const panel = el.shadowRoot!.querySelector("agent-chat-panel")!;
    for (const prop of SIX_PROPS) {
      expect(panel[prop]).toBe(values[prop]);
    }
  });

  // 014: pins the eslint fix's `panelEl: AgentChatPanel | null` typing —
  // proves a property set before the panel is ever created still reaches it
  // once toggle() lazily builds it.
  it("forwards a property set before the panel exists", () => {
    el.agentName = "Whiskers";
    el.toggle();
    const panel = el.shadowRoot!.querySelector("agent-chat-panel")!;
    expect(panel.agentName).toBe("Whiskers");
  });

  it("forwards a property set after the panel already exists", () => {
    el.toggle();
    const panel = el.shadowRoot!.querySelector("agent-chat-panel")!;

    const notify = () => {};
    el.notify = notify;
    expect(panel.notify).toBe(notify);

    const config = { persist: true, sessionNamespace: "cat-store" };
    el.config = config;
    expect(panel.config).toBe(config);
  });

  it("a host store overrides the built-in mock store", () => {
    const sentinelStore = {
      getState: () => ({ ui: { route: "/sentinel" } }),
      subscribe: () => () => {},
      dispatch: () => {},
    };
    el.store = sentinelStore;
    el.toggle();
    const panel = el.shadowRoot!.querySelector("agent-chat-panel")!;
    const state = panel.store!.getState!() as { ui: { route: string } };
    expect(state.ui.route).toBe("/sentinel");
  });

  it("toolProviders are assigned before the panel is appended", () => {
    const toolProviders = [{ name: "demomcp", required: true, load: () => Promise.resolve([]) }];
    el.toolProviders = toolProviders;

    const containerEl = el.shadowRoot!.querySelector("#panel-container") as HTMLDivElement;
    const appendSpy = vi.spyOn(containerEl, "appendChild");
    el.toggle();

    expect(appendSpy).toHaveBeenCalledTimes(1);
    const appendedPanel = appendSpy.mock.calls[0][0] as AgentChatPanel;
    expect(appendedPanel.toolProviders).toBe(toolProviders);
    appendSpy.mockRestore();
  });

  it("getters return what was set for all seven", () => {
    const values: Record<string, unknown> = {
      store: {}, appContext: {}, sources: [], toolProviders: [], config: {}, notify: () => {},
      hooks: { onPreTool: () => Promise.resolve(undefined) },
    };
    for (const prop of SIX_PROPS) (el as unknown as Record<string, unknown>)[prop] = values[prop];
    for (const prop of SIX_PROPS) {
      expect((el as unknown as Record<string, unknown>)[prop]).toBe(values[prop]);
    }
  });

  // 001: fetch passthrough — the web-agent-browser extension (task 002) will
  // need a way to inject the token-gate header into every outbound request.
  it("forwards custom fetch function to panel created after fetch is set", () => {
    const customFetch = (() => Promise.resolve(new Response("ok"))) as unknown as typeof fetch;
    el.fetch = customFetch;
    el.toggle();
    const panel = el.shadowRoot!.querySelector("agent-chat-panel")!;
    expect(panel.fetch).toBe(customFetch);
  });

  it("forwards custom fetch set after panel already exists", () => {
    el.toggle();
    const panel = el.shadowRoot!.querySelector("agent-chat-panel")!;

    const customFetch2 = (() => Promise.resolve(new Response("ok2"))) as unknown as typeof fetch;
    el.fetch = customFetch2;
    expect(panel.fetch).toBe(customFetch2);
  });

  it("forwards skillRegistry to the panel on mount", () => {
    const registry = {
      list: () => Promise.resolve([]),
      get: () => Promise.resolve(undefined),
    };
    el.skillRegistry = registry;
    el.toggle();
    const panel = el.shadowRoot!.querySelector("agent-chat-panel")!;
    expect(panel.skillRegistry).toBe(registry);
  });

  it("forwards skillRegistry set after mount", () => {
    el.toggle();
    const panel = el.shadowRoot!.querySelector("agent-chat-panel")!;
    const registry = {
      list: () => Promise.resolve([]),
      get: () => Promise.resolve(undefined),
    };
    el.skillRegistry = registry;
    expect(panel.skillRegistry).toBe(registry);
  });
});

describe("101: send, messages and running passthroughs", () => {
  let el: WebAgentBubble;
  let sendSpy: ReturnType<typeof vi.spyOn> | undefined;

  beforeEach(() => {
    const PanelCls = customElements.get("agent-chat-panel");
    if (PanelCls) {
      sendSpy = vi.spyOn(PanelCls.prototype, "send").mockResolvedValue({ ran: "message" });
    }
    el = document.createElement("web-agent-bubble") as WebAgentBubble;
    el.model = "test-model";
    document.body.appendChild(el);
  });

  afterEach(() => {
    sendSpy?.mockRestore?.();
    el.remove();
  });

  const display = () => (el.shadowRoot!.querySelector("#panel-container") as HTMLElement).style.display;

  it("messages is empty and running is false before the bubble is ever opened", () => {
    expect(el.messages).toEqual([]);
    expect(el.running).toBe(false);
    expect(el.shadowRoot!.querySelector("agent-chat-panel")).toBeNull();
  });

  it("send opens a bubble that has never been opened, then forwards to the panel", async () => {
    await el.send("hello");
    const panel = el.shadowRoot!.querySelector("agent-chat-panel")!;
    expect(panel).not.toBeNull();
    expect((el.shadowRoot!.querySelector("#panel-container") as HTMLElement).style.display).toBe("flex");
    expect(sendSpy).toHaveBeenCalledWith("hello", undefined);
  });

  it("send reuses an already-open panel and does not toggle it closed", async () => {
    el.toggle();
    sendSpy!.mockClear();
    await el.send("hi");
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect((el.shadowRoot!.querySelector("#panel-container") as HTMLElement).style.display).toBe("flex");

    await el.send("hi again");
    expect(display()).toBe("flex");
    expect(sendSpy).toHaveBeenCalledTimes(2);
  });

  it("send re-opens a bubble that was opened and then closed", async () => {
    el.toggle();                      // open — builds the panel
    el.toggle();                      // close
    expect(display()).toBe("none");
    sendSpy!.mockClear();

    await el.send("after close");

    expect(display()).toBe("flex");
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy).toHaveBeenCalledWith("after close", undefined);
  });

  it("a re-opened send reuses the existing panel rather than building a second", async () => {
    el.toggle();
    const first = el.shadowRoot!.querySelector("agent-chat-panel");
    el.toggle();
    await el.send("one");
    el.toggle();                      // close again
    await el.send("two");

    expect(display()).toBe("flex");
    expect(el.shadowRoot!.querySelectorAll("agent-chat-panel").length).toBe(1);
    expect(el.shadowRoot!.querySelector("agent-chat-panel")).toBe(first);
  });

  it("send forwards the opts argument", async () => {
    await el.send({ text: "t" }, { userDisplayText: "shown" });
    expect(sendSpy).toHaveBeenCalledWith({ text: "t" }, { userDisplayText: "shown" });
  });

  it("send on a bubble that was never connected resolves { ran: 'none' }", async () => {
    const lone = document.createElement("web-agent-bubble") as WebAgentBubble;
    await expect(lone.send("x")).resolves.toEqual({ ran: "none" });
  });

  it("001/113 — send on a connected bubble returns { ran: 'none' } when panel.send is never reached", async () => {
    const lone = document.createElement("web-agent-bubble") as WebAgentBubble;
    // Not appended — containerEl is undefined, toggle() never runs, panelEl stays null
    const result = await lone.send("/new");
    expect(result).toEqual({ ran: "none" });
  });

  it("001/113 — send forwards the panel's SendOutcome to the caller", async () => {
    sendSpy!.mockResolvedValue({ ran: "command", command: "new" });
    const result = await el.send("/new");
    expect(result).toEqual({ ran: "command", command: "new" });
  });

  it("messages forwards the panel's array", () => {
    el.toggle();
    const panel = el.shadowRoot!.querySelector("agent-chat-panel")!;
    const arr = [{ role: "user", content: "hi" }];
    Object.defineProperty(panel, "messages", { get: () => arr, configurable: true });
    expect(el.messages).toBe(arr);
  });

  it("running forwards the panel's running flag, not the private stop-button state", () => {
    el.toggle();
    const panel = el.shadowRoot!.querySelector("agent-chat-panel")!;
    Object.defineProperty(panel, "running", { get: () => true, configurable: true });
    expect(el.running).toBe(true);
    Object.defineProperty(panel, "running", { get: () => false, configurable: true });
    expect(el.running).toBe(false);
  });
});

describe("gemini union widening (002)", () => {
  let el: WebAgentBubble;
  beforeEach(() => { el = document.createElement("web-agent-bubble") as WebAgentBubble; el.model = "test-model"; document.body.appendChild(el); });
  afterEach(() => { el.remove(); });

  it("accepts 'gemini' as type and forwards it to the panel", () => {
    el.type = "gemini";
    expect(el.type).toBe("gemini");
    el.toggle();
    const panel = el.shadowRoot!.querySelector("agent-chat-panel")!;
    expect(panel.type).toBe("gemini");
  });
});

describe("model is required", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("reports a missing-model error when toggled open with no model", () => {
    const el = document.createElement("web-agent-bubble") as WebAgentBubble;
    document.body.appendChild(el);
    // Exceptions in custom-element reactions (connectedCallback) are reported
    // to the global, not re-thrown to appendChild's caller — capture the
    // window error event instead of expecting a synchronous throw.
    const errors: ErrorEvent[] = [];
    const onError = (e: ErrorEvent) => errors.push(e);
    window.addEventListener("error", onError);
    el.toggle();
    window.removeEventListener("error", onError);
    expect(errors.some((e) => /model/.test(e.message))).toBe(true);
  });

  it("passes the host model through to the panel", () => {
    const el = document.createElement("web-agent-bubble") as WebAgentBubble;
    el.model = "test-model";
    document.body.appendChild(el);
    el.toggle();
    const panel = el.shadowRoot!.querySelector("agent-chat-panel")!;
    expect(panel).not.toBeNull();
    expect(panel.model).toBe("test-model");
  });
});

describe("002: the host owns the panel box", () => {
  let el: WebAgentBubble;
  beforeEach(() => {
    el = document.createElement("web-agent-bubble") as WebAgentBubble;
    el.model = "test-model";
    document.body.appendChild(el);
  });
  afterEach(() => { el.remove(); });

  it("writes no position, width or height inline style onto the panel", () => {
    el.toggle();
    const panel = el.shadowRoot!.querySelector("agent-chat-panel") as HTMLElement;
    expect(panel).not.toBeNull();
    expect(panel.getAttribute("style") ?? "").not.toMatch(/position|width|height/);
    expect(panel.style.position).toBe("");
  });

  it("sizes its own container from --web-agent-panel-width/--web-agent-panel-height", () => {
    const css = el.shadowRoot!.querySelector("style")!.textContent;
    // The seam ideas 083/085 and task 003 build on: two inherited properties,
    // today's values as fallbacks, and the 80vh cap left in place.
    expect(css).toMatch(/width:\s*var\(--web-agent-panel-width,\s*480px\)/);
    expect(css).toMatch(/height:\s*var\(--web-agent-panel-height,\s*660px\)/);
    expect(css).toMatch(/max-height:\s*80vh/);
  });
});

describe("003: the bubble is a shadow element", () => {
  let el: WebAgentBubble;
  beforeEach(() => {
    el = document.createElement("web-agent-bubble") as WebAgentBubble;
    el.model = "test-model";
    document.body.appendChild(el);
  });
  afterEach(() => { el.remove(); });

  it("renders the launcher, the container and the panel inside an OPEN shadow root", () => {
    expect(el.shadowRoot).not.toBeNull();
    expect(el.shadowRoot!.mode).toBe("open");
    expect(el.shadowRoot!.querySelector("button#launcher")).not.toBeNull();
    expect(el.shadowRoot!.querySelector("#panel-container")).not.toBeNull();
    // Light DOM stays empty — that is the encapsulation this task buys.
    expect(el.querySelector("#launcher")).toBeNull();
    expect(el.querySelector("#panel-container")).toBeNull();

    el.toggle();
    expect(el.shadowRoot!.querySelector("agent-chat-panel")).not.toBeNull();
    expect(el.querySelector("agent-chat-panel")).toBeNull();
  });

  it("exposes launcher, launcher-icon and panel-container as parts, and ships no Beer CSS class names", () => {
    const root = el.shadowRoot!;
    expect(root.querySelector("#launcher")!.getAttribute("part")).toBe("launcher");
    expect(root.querySelector("#launcher-icon")!.getAttribute("part")).toBe("launcher-icon");
    expect(root.querySelector("#panel-container")!.getAttribute("part")).toBe("panel-container");
    // The Beer CSS classes resolve to nothing inside a shadow root, so the
    // bubble must not ship them any more.
    expect((root.querySelector("#launcher") as HTMLElement).className).toBe("");
    expect((root.querySelector("#panel-container") as HTMLElement).className).toBe("");
  });

  it("carries its sheet inside the root, tagged and id-less, and paints from --wa-* tokens", () => {
    const sheet = el.shadowRoot!.querySelector("style") as HTMLStyleElement;
    expect(sheet.getAttribute("data-wa-styles")).toBe("bubble");
    expect(sheet.id).toBe("");
    expect(document.head.querySelector("style[data-wa-styles]")).toBeNull();
    const css = sheet.textContent;
    // Selectors are shadow-scoped now: no 'web-agent-bubble ' prefix survives.
    expect(css).not.toMatch(/web-agent-bubble\s/);
    expect(css).toMatch(/background:\s*var\(--wa-action-color-info/);
    expect(css).toMatch(/color:\s*var\(--wa-action-text-color-info/);
    // The dead --elevate-3 declaration is gone.
    expect(css).not.toContain("--elevate-3");
  });
});
