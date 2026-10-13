import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { SessionMeta } from "@cuatoi/web-agent-core";

// Polyfill ElementInternals for jsdom before importing material components.
if (typeof window !== "undefined") {
  if (!window.ElementInternals) {
    window.ElementInternals = class {} as unknown as typeof ElementInternals;
  }
  const internalsProto = window.ElementInternals.prototype;
  if (!internalsProto.setFormValue) internalsProto.setFormValue = () => {};
  if (!internalsProto.setValidity) internalsProto.setValidity = () => {};
  if (!internalsProto.checkValidity) internalsProto.checkValidity = () => true;
  if (!internalsProto.reportValidity) internalsProto.reportValidity = () => true;
  if (typeof (window as unknown as { PointerEvent?: unknown }).PointerEvent === "undefined") {
    class PointerEventPolyfill extends MouseEvent {
      public pointerId: number;
      public pointerType: string;
      constructor(type: string, params: PointerEventInit = {}) {
        super(type, params);
        this.pointerId = params.pointerId ?? 0;
        this.pointerType = params.pointerType ?? "";
      }
    }
    (window as unknown as { PointerEvent: typeof PointerEventPolyfill }).PointerEvent = PointerEventPolyfill;
    (globalThis as unknown as { PointerEvent: typeof PointerEventPolyfill }).PointerEvent = PointerEventPolyfill;
  }
}

import {
  AgentPage,
  AGENT_SESSIONS_COLUMN_WIDTH_PX,
  AGENT_RIGHT_PANEL_WIDTH_PX,
  AGENT_RIGHT_PANEL_MIN_WIDTH_PX,
  AGENT_CHAT_MIN_WIDTH_PX,
  AGENT_DIVIDER_WIDTH_PX,
  clampSideWidth,
  sideWidthFromDrag,
} from "../../../src/web/components/agent-page";
import { PROVIDER_ENTRIES, DEFAULT_PROVIDER_ENTRY_INDEX, type PanelProps } from "../../../src/web/agent-panel-config";
import { buildCatStoreAppInstructions, PROMPT_PRESETS } from "../../../src/web/agent-prompt-config";
import type { AgentChatPanel } from "@cuatoi/web-agent-lit";

// IndexedDB is absent under jsdom. core catches it and logs [session] init failed.
// Do NOT add a stub for it; this is expected and tested 2026-08-12.

/** Names of the @state() fields (and the one private method) the tests drive
 *  directly. They are `private` on AgentPage by design; AgentPageInternals
 *  below is the single place the tests admit they reach past that. */
type AgentPagePrivateKeys =
  | "_sessions"
  | "_activeId"
  | "_renamingId"
  | "_configOpen"
  | "_entryIndex"
  | "_entryListOpen"
  | "_pendingIndex"
  | "_sideWidth"
  | "_sideCollapsed"
  | "_dragStartWidth"
  | "_layoutWidth"
  | "_props"
  | "_panel";

/** `Omit` first, so the private declarations for these names never sit next
 *  to the public redeclaration below — an `AgentPage & {...}` intersection
 *  collapses to `never` the moment a key is private on one side and public
 *  on the other. Every `document.createElement("agent-page")` in this file
 *  casts through this via `as unknown as AgentPageInternals` — `unknown`
 *  first because AgentPage's own privacy brand still rejects a direct cast
 *  from outside the class. */
type AgentPageInternals = Omit<AgentPage, AgentPagePrivateKeys> & {
  _sessions: SessionMeta[];
  _activeId: string;
  _renamingId: string;
  _configOpen: boolean;
  _entryIndex: number;
  _entryListOpen: boolean;
  _pendingIndex: number | null;
  _sideWidth: number;
  _sideCollapsed: boolean;
  _dragStartWidth: number | null;
  _layoutWidth: () => number;
  _props: PanelProps;
  _panel: AgentChatPanel;
};

function recordPanel(el: AgentPageInternals) {
  const panel = el._panel;
  const calls: Array<[string, ...unknown[]]> = [];
  panel.createSession = () => {
    calls.push(["createSession"]);
    return Promise.resolve("new-id");
  };
  panel.switchSession = (id: string) => {
    calls.push(["switchSession", id]);
    return Promise.resolve();
  };
  panel.deleteSession = (id: string) => {
    calls.push(["deleteSession", id]);
    return Promise.resolve();
  };
  panel.renameSession = (id: string, t: string) => {
    calls.push(["renameSession", id, t]);
    return Promise.resolve();
  };
  return calls;
}

const META = (id: string, title: string): SessionMeta => ({
  id,
  title,
  titleManual: false,
  createdAt: 1,
  updatedAt: 1,
  messageCount: 0,
});

describe("AgentPage", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it("layout has exactly four children in order: col-sessions, col-chat, col-side, col-divider", async () => {
    const el = document.createElement("agent-page") as unknown as AgentPageInternals;
    container.appendChild(el);
    await el.updateComplete;

    const layout = el.shadowRoot?.querySelector(".layout") as HTMLElement;
    expect(layout).not.toBeNull();

    const children = Array.from(layout.children);
    expect(children.length).toBe(4);
    expect(children[0].classList.contains("col-sessions")).toBe(true);
    expect(children[1].classList.contains("col-chat")).toBe(true);
    expect(children[2].classList.contains("col-side")).toBe(true);
    expect(children[3].classList.contains("col-divider")).toBe(true);
  });

  it("col-sessions flex-basis equals AGENT_SESSIONS_COLUMN_WIDTH_PX", async () => {
    const el = document.createElement("agent-page") as unknown as AgentPageInternals;
    container.appendChild(el);
    await el.updateComplete;

    const sessions = el.shadowRoot?.querySelector(".col-sessions") as HTMLElement;
    expect(sessions.style.flexBasis).toBe(`${AGENT_SESSIONS_COLUMN_WIDTH_PX}px`);
  });

  it("col-side flex-basis equals AGENT_RIGHT_PANEL_WIDTH_PX", async () => {
    const el = document.createElement("agent-page") as unknown as AgentPageInternals;
    container.appendChild(el);
    await el.updateComplete;

    const side = el.shadowRoot?.querySelector(".col-side") as HTMLElement;
    expect(side.style.flexBasis).toBe(`${AGENT_RIGHT_PANEL_WIDTH_PX}px`);
  });

  it("col-chat contains exactly one agent-chat-panel with hideHeader = true", async () => {
    const el = document.createElement("agent-page") as unknown as AgentPageInternals;
    container.appendChild(el);
    await el.updateComplete;

    const chat = el.shadowRoot?.querySelector(".col-chat");
    const panels = chat?.querySelectorAll("agent-chat-panel");
    expect(panels?.length).toBe(1);
    expect(panels![0].hideHeader).toBe(true);
  });

  it("registers and clears the four generative UI window globals", async () => {
    const el = document.createElement("agent-page") as unknown as AgentPageInternals;
    container.appendChild(el);
    await el.updateComplete;

    expect([
      window.__WA_GENUI_MOUNT__,
      window.__WA_GENUI_DRAIN__,
      window.__WA_GENUI_VALIDATE__,
      window.__WA_GENUI_DATA_SOURCE__,
    ].every((value) => typeof value === "function")).toBe(true);

    el.remove();

    expect([
      window.__WA_GENUI_MOUNT__,
      window.__WA_GENUI_DRAIN__,
      window.__WA_GENUI_VALIDATE__,
      window.__WA_GENUI_DATA_SOURCE__,
    ].every((value) => value === undefined)).toBe(true);
  });

  it("agent-chat-panel buildSessionConfig has no DOM provider or multi_step_ui skill", async () => {
    const el = document.createElement("agent-page") as unknown as AgentPageInternals;
    container.appendChild(el);
    await el.updateComplete;

    const panel = el.shadowRoot?.querySelector("agent-chat-panel");
    const cfg = panel!.buildSessionConfig();

    const providerNames = (cfg.toolProviders ?? []).map((p) => p.name);
    expect(providerNames).not.toContain("dom");

    const skillNames = (cfg.skills ?? []).map((s) => s.name);
    expect(skillNames).not.toContain("multi_step_ui");
  });

  it("the left column renders a new-chat button, a session list and a config button", async () => {
    const el = document.createElement("agent-page") as unknown as AgentPageInternals;
    container.appendChild(el);
    await el.updateComplete;

    const newChatBtn = el.shadowRoot?.querySelector(".col-sessions .new-chat");
    expect(newChatBtn?.textContent?.trim()).toBe("+ New chat");

    const sessionList = el.shadowRoot?.querySelector(".col-sessions .session-list");
    expect(sessionList).not.toBeNull();

    const configBtn = el.shadowRoot?.querySelector(".col-sessions .config-btn");
    expect(configBtn?.getAttribute("aria-label")).toBe("Config");
  });

  it("Rename and Delete buttons render inline SVGs and carry accessible aria-label attributes", async () => {
    const el = document.createElement("agent-page") as unknown as AgentPageInternals;
    container.appendChild(el);
    await el.updateComplete;

    el._sessions = [META("a", "Alpha")];
    await el.updateComplete;

    const renameBtn = el.shadowRoot?.querySelector(".rename-btn") as HTMLButtonElement;
    expect(renameBtn.getAttribute("aria-label")).toBe("Rename");
    expect(renameBtn.querySelector("svg")).not.toBeNull();
    expect(renameBtn.textContent?.trim()).toBe("");

    const deleteBtn = el.shadowRoot?.querySelector(".delete-btn") as HTMLButtonElement;
    expect(deleteBtn.getAttribute("aria-label")).toBe("Delete");
    expect(deleteBtn.querySelector("svg")).not.toBeNull();
    expect(deleteBtn.textContent?.trim()).toBe("");
  });

  it("session row actions are right-aligned alongside the title and omitted during rename", async () => {
    const el = document.createElement("agent-page") as unknown as AgentPageInternals;
    container.appendChild(el);
    await el.updateComplete;

    el._sessions = [META("a", "Alpha")];
    await el.updateComplete;

    const row = el.shadowRoot?.querySelector(".session-row") as HTMLElement;
    const title = row.querySelector(".session-title");
    const actions = row.querySelector(".row-actions");
    expect(title).not.toBeNull();
    expect(actions).not.toBeNull();

    // Start renaming
    el._renamingId = "a";
    await el.updateComplete;

    const input = el.shadowRoot?.querySelector(".rename-input");
    expect(input).not.toBeNull();
    expect(el.shadowRoot?.querySelector(".row-actions")).toBeNull();
  });

  it("Config button renders an inline SVG gear icon with aria-label=\"Config\" inside .sessions-footer", async () => {
    const el = document.createElement("agent-page") as unknown as AgentPageInternals;
    container.appendChild(el);
    await el.updateComplete;

    const configBtn = el.shadowRoot?.querySelector(
      ".sessions-footer .config-btn",
    ) as HTMLButtonElement;
    expect(configBtn).not.toBeNull();
    expect(configBtn.getAttribute("aria-label")).toBe("Config");
    expect(configBtn.querySelector("svg")).not.toBeNull();
  });

  it("one row per session, with the title", async () => {
    const el = document.createElement("agent-page") as unknown as AgentPageInternals;
    container.appendChild(el);
    await el.updateComplete;

    el._sessions = [META("a", "Alpha"), META("b", "Beta")];
    el._activeId = "a";
    await el.updateComplete;

    const rows = el.shadowRoot?.querySelectorAll(".session-row");
    expect(rows?.length).toBe(2);

    const titles = el.shadowRoot?.querySelectorAll(".session-title");
    expect(titles?.[0]?.textContent?.trim()).toBe("Alpha");
    expect(titles?.[1]?.textContent?.trim()).toBe("Beta");
  });

  it('an untitled session falls back to "New chat"', async () => {
    const el = document.createElement("agent-page") as unknown as AgentPageInternals;
    container.appendChild(el);
    await el.updateComplete;

    el._sessions = [META("c", "")];
    await el.updateComplete;

    const title = el.shadowRoot?.querySelector(".session-title");
    expect(title?.textContent?.trim()).toBe("New chat");
  });

  it("the active row is marked by aria-current and a bar, not colour alone", async () => {
    const el = document.createElement("agent-page") as unknown as AgentPageInternals;
    container.appendChild(el);
    await el.updateComplete;

    el._sessions = [META("a", "Alpha"), META("b", "Beta")];
    el._activeId = "b";
    await el.updateComplete;

    const rowA = el.shadowRoot?.querySelector('[data-session-id="a"]');
    const rowB = el.shadowRoot?.querySelector('[data-session-id="b"]');

    expect(rowB?.getAttribute("aria-current")).toBe("true");
    expect(rowB?.classList.contains("active")).toBe(true);
    expect(rowB?.querySelector(".active-bar")).not.toBeNull();

    expect(rowA?.getAttribute("aria-current")).toBe("false");
    expect(rowA?.querySelector(".active-bar")).toBeNull();
  });

  it("clicking a row switches to it", async () => {
    const el = document.createElement("agent-page") as unknown as AgentPageInternals;
    container.appendChild(el);
    await el.updateComplete;

    const calls = recordPanel(el);
    el._sessions = [META("a", "Alpha"), META("b", "Beta")];
    el._activeId = "a";
    await el.updateComplete;

    const rowB = el.shadowRoot?.querySelector('[data-session-id="b"]') as HTMLElement;
    rowB.click();

    expect(calls).toContainEqual(["switchSession", "b"]);
  });

  it("clicking the already-active row does not switch", async () => {
    const el = document.createElement("agent-page") as unknown as AgentPageInternals;
    container.appendChild(el);
    await el.updateComplete;

    const calls = recordPanel(el);
    el._sessions = [META("a", "Alpha"), META("b", "Beta")];
    el._activeId = "a";
    await el.updateComplete;

    const rowA = el.shadowRoot?.querySelector('[data-session-id="a"]') as HTMLElement;
    rowA.click();

    expect(calls.filter((c) => c[0] === "switchSession").length).toBe(0);
  });

  it("New chat creates a session and marks it active", async () => {
    const el = document.createElement("agent-page") as unknown as AgentPageInternals;
    container.appendChild(el);
    await el.updateComplete;

    const calls = recordPanel(el);
    const btn = el.shadowRoot?.querySelector(".new-chat") as HTMLButtonElement;
    btn.click();
    await new Promise((r) => setTimeout(r, 10));
    await el.updateComplete;

    expect(calls).toContainEqual(["createSession"]);
    expect(el._activeId).toBe("new-id");
  });

  it("Rename opens an inline input seeded with the current title", async () => {
    const el = document.createElement("agent-page") as unknown as AgentPageInternals;
    container.appendChild(el);
    await el.updateComplete;

    el._sessions = [META("a", "Alpha")];
    await el.updateComplete;

    const renameBtn = el.shadowRoot?.querySelector(".rename-btn") as HTMLButtonElement;
    renameBtn.click();
    await el.updateComplete;

    const input = el.shadowRoot?.querySelector(".rename-input") as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe("Alpha");
    expect(el.shadowRoot?.querySelector(".session-title")).toBeNull();
  });

  it("rename start focuses and selects the rename input", async () => {
    const el = document.createElement("agent-page") as unknown as AgentPageInternals;
    container.appendChild(el);
    await el.updateComplete;

    el._sessions = [META("a", "Alpha")];
    await el.updateComplete;
    (el.shadowRoot?.querySelector(".rename-btn") as HTMLButtonElement).click();
    await el.updateComplete;

    const input = el.shadowRoot?.querySelector(".rename-input") as HTMLInputElement;
    expect(el.shadowRoot?.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
  });

  it("Enter commits the rename through renameSession", async () => {
    const el = document.createElement("agent-page") as unknown as AgentPageInternals;
    container.appendChild(el);
    await el.updateComplete;

    const calls = recordPanel(el);
    el._sessions = [META("a", "Alpha")];
    await el.updateComplete;

    const renameBtn = el.shadowRoot?.querySelector(".rename-btn") as HTMLButtonElement;
    renameBtn.click();
    await el.updateComplete;

    const input = el.shadowRoot?.querySelector(".rename-input") as HTMLInputElement;
    input.value = "Alpha 2";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await el.updateComplete;

    expect(calls).toContainEqual(["renameSession", "a", "Alpha 2"]);
    expect(el._renamingId).toBe("");
  });

  it("Escape cancels without calling renameSession", async () => {
    const el = document.createElement("agent-page") as unknown as AgentPageInternals;
    container.appendChild(el);
    await el.updateComplete;

    const calls = recordPanel(el);
    el._sessions = [META("a", "Alpha")];
    await el.updateComplete;

    const renameBtn = el.shadowRoot?.querySelector(".rename-btn") as HTMLButtonElement;
    renameBtn.click();
    await el.updateComplete;

    const input = el.shadowRoot?.querySelector(".rename-input") as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await el.updateComplete;

    expect(el._renamingId).toBe("");
    expect(calls.filter((c) => c[0] === "renameSession").length).toBe(0);
  });

  it("an empty rename value is discarded", async () => {
    const el = document.createElement("agent-page") as unknown as AgentPageInternals;
    container.appendChild(el);
    await el.updateComplete;

    const calls = recordPanel(el);
    el._sessions = [META("a", "Alpha")];
    await el.updateComplete;

    const renameBtn = el.shadowRoot?.querySelector(".rename-btn") as HTMLButtonElement;
    renameBtn.click();
    await el.updateComplete;

    const input = el.shadowRoot?.querySelector(".rename-input") as HTMLInputElement;
    input.value = "   ";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await el.updateComplete;

    expect(calls.filter((c) => c[0] === "renameSession").length).toBe(0);
  });

  it("Delete calls deleteSession with that row's id", async () => {
    const el = document.createElement("agent-page") as unknown as AgentPageInternals;
    container.appendChild(el);
    await el.updateComplete;

    const calls = recordPanel(el);
    el._sessions = [META("a", "Alpha"), META("b", "Beta")];
    await el.updateComplete;

    const deleteBtn = el.shadowRoot?.querySelectorAll(".delete-btn")[1] as HTMLButtonElement;
    deleteBtn.click();
    await el.updateComplete;

    expect(calls).toContainEqual(["deleteSession", "b"]);
  });

  it("deleting the active session takes the id that was not there before", async () => {
    const el = document.createElement("agent-page") as unknown as AgentPageInternals;
    container.appendChild(el);
    await el.updateComplete;

    el._sessions = [META("a", "A"), META("b", "B")];
    el._activeId = "a";
    el._panel.listSessions = () => [META("b", "B"), META("z", "")];
    el._panel.deleteSession = async () => {};
    await el.updateComplete;

    const deleteBtn = el.shadowRoot?.querySelectorAll(".delete-btn")[0] as HTMLButtonElement;
    deleteBtn.click();
    await new Promise((r) => setTimeout(r, 10));
    await el.updateComplete;

    expect(el._activeId).toBe("z");
  });

  it("Config toggles the middle column", async () => {
    const el = document.createElement("agent-page") as unknown as AgentPageInternals;
    container.appendChild(el);
    await el.updateComplete;

    const configBtn = el.shadowRoot?.querySelector(".config-btn") as HTMLButtonElement;
    configBtn.click();
    await el.updateComplete;

    expect(el.shadowRoot?.querySelector(".config-view")).not.toBeNull();
    expect(el._panel.hasAttribute("hidden")).toBe(true);
    expect(configBtn.getAttribute("aria-pressed")).toBe("true");

    configBtn.click();
    await el.updateComplete;

    expect(el.shadowRoot?.querySelector(".config-view")).toBeNull();
    expect(el._panel.hasAttribute("hidden")).toBe(false);
    expect(configBtn.getAttribute("aria-pressed")).toBe("false");
  });

  describe("the guided config view", () => {
    it("renders five fields in order with preset buttons for the first four", async () => {
      const el = document.createElement("agent-page") as unknown as AgentPageInternals;
      container.appendChild(el);
      await el.updateComplete;

      el._configOpen = true;
      await el.updateComplete;

      const fields = el.shadowRoot?.querySelectorAll(".config-field") as NodeListOf<HTMLElement>;
      expect(fields.length).toBe(5);

      const fieldKeys = Array.from(fields).map((f) => f.getAttribute("data-field"));
      expect(fieldKeys).toEqual(["role", "tone", "length", "language", "extra"]);

      for (let i = 0; i < 4; i++) {
        const presets = fields[i].querySelectorAll(".preset-btn");
        const expectedCount = PROMPT_PRESETS[fieldKeys[i] as keyof typeof PROMPT_PRESETS].length;
        expect(presets.length).toBe(expectedCount);
      }

      const extraPresets = fields[4].querySelectorAll(".preset-btn");
      expect(extraPresets.length).toBe(0);
      expect(el.shadowRoot?.querySelector(".config-reset-btn")).not.toBeNull();
      expect(el.shadowRoot?.querySelector(".config-note")).not.toBeNull();
    });

    it("clicking a preset button populates textarea and updates panel appContext", async () => {
      const el = document.createElement("agent-page") as unknown as AgentPageInternals;
      container.appendChild(el);
      await el.updateComplete;

      el._configOpen = true;
      await el.updateComplete;

      const roleField = el.shadowRoot?.querySelector('[data-field="role"]') as HTMLElement;
      const firstPreset = roleField.querySelector(".preset-btn") as HTMLButtonElement;
      const expectedSample = PROMPT_PRESETS.role[0].sample;

      firstPreset.click();
      await el.updateComplete;

      const textarea = roleField.querySelector(".field-textarea") as HTMLTextAreaElement;
      expect(textarea.value).toBe(expectedSample);
      expect(el._panel.appContext!.appInstructions).toBe(
        buildCatStoreAppInstructions({ role: expectedSample }),
      );
    });

    it("clicking a second preset replaces the field value", async () => {
      const el = document.createElement("agent-page") as unknown as AgentPageInternals;
      container.appendChild(el);
      await el.updateComplete;

      el._configOpen = true;
      await el.updateComplete;

      const roleField = el.shadowRoot?.querySelector('[data-field="role"]') as HTMLElement;
      const presetButtons = roleField.querySelectorAll(".preset-btn");
      (presetButtons[0] as HTMLButtonElement).click();
      await el.updateComplete;

      (presetButtons[1] as HTMLButtonElement).click();
      await el.updateComplete;

      const expectedSecond = PROMPT_PRESETS.role[1].sample;
      const textarea = roleField.querySelector(".field-textarea") as HTMLTextAreaElement;
      expect(textarea.value).toBe(expectedSecond);
      expect(el._panel.appContext!.appInstructions).toBe(
        buildCatStoreAppInstructions({ role: expectedSecond }),
      );
    });

    it("typing in textarea updates custom config and panel appContext", async () => {
      const el = document.createElement("agent-page") as unknown as AgentPageInternals;
      container.appendChild(el);
      await el.updateComplete;

      el._configOpen = true;
      await el.updateComplete;

      const extraField = el.shadowRoot?.querySelector('[data-field="extra"]') as HTMLElement;
      const textarea = extraField.querySelector(".field-textarea") as HTMLTextAreaElement;
      textarea.value = "Always offer a cat treat";
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      await el.updateComplete;

      expect(el._panel.appContext!.appInstructions).toBe(
        buildCatStoreAppInstructions({ extra: "Always offer a cat treat" }),
      );
    });

    it("clicking reset button clears all fields and restores base instructions", async () => {
      const el = document.createElement("agent-page") as unknown as AgentPageInternals;
      container.appendChild(el);
      await el.updateComplete;

      el._configOpen = true;
      await el.updateComplete;

      const roleField = el.shadowRoot?.querySelector('[data-field="role"]') as HTMLElement;
      (roleField.querySelector(".preset-btn") as HTMLButtonElement).click();
      await el.updateComplete;

      const resetBtn = el.shadowRoot?.querySelector(".config-reset-btn") as HTMLButtonElement;
      resetBtn.click();
      await el.updateComplete;

      const textareas = el.shadowRoot?.querySelectorAll(".field-textarea") as NodeListOf<HTMLTextAreaElement>;
      for (const ta of textareas) {
        expect(ta.value).toBe("");
      }
      expect(el._panel.appContext!.appInstructions).toBe(buildCatStoreAppInstructions());
    });
  });

  describe("the provider/model/mode picker", () => {
    it("renders in the footer beside the config button", async () => {
      const el = document.createElement("agent-page") as unknown as AgentPageInternals;
      container.appendChild(el);
      await el.updateComplete;

      const trigger = el.shadowRoot?.querySelector(
        ".sessions-footer .provider-trigger",
      ) as HTMLElement;
      const configBtn = el.shadowRoot?.querySelector(".sessions-footer .config-btn");
      expect(trigger).not.toBeNull();
      expect(configBtn).not.toBeNull();
      expect(trigger.textContent?.trim()).toBe(
        PROVIDER_ENTRIES[DEFAULT_PROVIDER_ENTRY_INDEX].label,
      );
    });

    it("uses an inline SVG, not an icon font", async () => {
      const el = document.createElement("agent-page") as unknown as AgentPageInternals;
      container.appendChild(el);
      await el.updateComplete;

      const trigger = el.shadowRoot?.querySelector(".provider-trigger") as HTMLElement;
      expect(trigger.querySelector("svg")).not.toBeNull();
      for (const entry of PROVIDER_ENTRIES) {
        expect(trigger.textContent).not.toContain(entry.id);
      }
    });

    it("opening the list renders one option per entry", async () => {
      const el = document.createElement("agent-page") as unknown as AgentPageInternals;
      container.appendChild(el);
      await el.updateComplete;

      const trigger = el.shadowRoot?.querySelector(".provider-trigger") as HTMLButtonElement;
      trigger.click();
      await el.updateComplete;

      const options = el.shadowRoot?.querySelectorAll('[role="option"]');
      expect(options?.length).toBe(PROVIDER_ENTRIES.length);

      const labels = Array.from(el.shadowRoot?.querySelectorAll(".option-label") ?? []).map(
        (n) => n.textContent?.trim(),
      );
      expect(labels).toEqual(PROVIDER_ENTRIES.map((e) => e.label));
      expect(trigger.getAttribute("aria-expanded")).toBe("true");
    });

    it("marks the selected option by shape, not only colour", async () => {
      const el = document.createElement("agent-page") as unknown as AgentPageInternals;
      container.appendChild(el);
      await el.updateComplete;

      const trigger = el.shadowRoot?.querySelector(".provider-trigger") as HTMLButtonElement;
      trigger.click();
      await el.updateComplete;

      const options = Array.from(
        el.shadowRoot?.querySelectorAll('[role="option"]') ?? [],
      );
      const selected = options.filter((o) => o.getAttribute("aria-selected") === "true");
      expect(selected.length).toBe(1);
      expect(selected[0].querySelector("svg")).not.toBeNull();

      const unselected = options.filter((o) => o.getAttribute("aria-selected") !== "true");
      for (const o of unselected) {
        expect(o.querySelector("svg")).toBeNull();
      }
    });

    it("picking the active entry does nothing", async () => {
      const el = document.createElement("agent-page") as unknown as AgentPageInternals;
      container.appendChild(el);
      await el.updateComplete;

      const calls = recordPanel(el);
      const trigger = el.shadowRoot?.querySelector(".provider-trigger") as HTMLButtonElement;
      trigger.click();
      await el.updateComplete;

      const activeOption = el.shadowRoot?.querySelector(
        `[data-entry-id="${PROVIDER_ENTRIES[el._entryIndex].id}"]`,
      ) as HTMLElement;
      activeOption.click();
      await el.updateComplete;

      expect(el._pendingIndex).toBeNull();
      expect(el.shadowRoot?.querySelector(".confirm-scrim")).toBeNull();
      expect(el._entryListOpen).toBe(false);
      expect(calls).not.toContainEqual(["createSession"]);
    });

    it("picking a different entry opens the dialog and writes nothing yet", async () => {
      const el = document.createElement("agent-page") as unknown as AgentPageInternals;
      container.appendChild(el);
      await el.updateComplete;

      const calls = recordPanel(el);
      const targetIndex = (el._entryIndex + 1) % PROVIDER_ENTRIES.length;
      const typeBefore = el._panel.type;

      const trigger = el.shadowRoot?.querySelector(".provider-trigger") as HTMLButtonElement;
      trigger.click();
      await el.updateComplete;

      const option = el.shadowRoot?.querySelector(
        `[data-entry-id="${PROVIDER_ENTRIES[targetIndex].id}"]`,
      ) as HTMLElement;
      option.click();
      await el.updateComplete;

      const scrim = el.shadowRoot?.querySelector(".confirm-scrim");
      expect(scrim).not.toBeNull();
      const text = (scrim?.textContent ?? "").replace(/\s+/g, " ").trim();
      expect(text).toContain("replaces the current chat with a new one");
      expect(text).toContain(PROVIDER_ENTRIES[targetIndex].label);
      expect(text).not.toContain("lost");
      expect(el._entryIndex).not.toBe(targetIndex);
      expect(calls).not.toContainEqual(["createSession"]);
      expect(el._panel.type).toBe(typeBefore);
    });

    it("confirm open focuses OK and resize preserves focus on Cancel", async () => {
      const el = document.createElement("agent-page") as unknown as AgentPageInternals;
      container.appendChild(el);
      await el.updateComplete;

      const targetIndex = (el._entryIndex + 1) % PROVIDER_ENTRIES.length;
      const trigger = el.shadowRoot?.querySelector(".provider-trigger") as HTMLButtonElement;
      trigger.click();
      await el.updateComplete;
      (
        el.shadowRoot?.querySelector(
          `[data-entry-id="${PROVIDER_ENTRIES[targetIndex].id}"]`,
        ) as HTMLElement
      ).click();
      await el.updateComplete;

      const ok = el.shadowRoot?.querySelector(".confirm-ok") as HTMLButtonElement;
      expect(el.shadowRoot?.activeElement).toBe(ok);
      const cancel = el.shadowRoot?.querySelector(".confirm-cancel") as HTMLButtonElement;
      cancel.focus();
      expect(el.shadowRoot?.activeElement).toBe(cancel);

      el._layoutWidth = () => 900;
      el._sideWidth = 700;
      window.dispatchEvent(new Event("resize"));
      await el.updateComplete;

      expect(el._sideWidth).toBe(340);
      expect(el.shadowRoot?.activeElement).toBe(cancel);
    });

    it("cancel closes the dialog and leaves the selection alone", async () => {
      const el = document.createElement("agent-page") as unknown as AgentPageInternals;
      container.appendChild(el);
      await el.updateComplete;

      const calls = recordPanel(el);
      const startIndex = el._entryIndex;
      const targetIndex = (startIndex + 1) % PROVIDER_ENTRIES.length;

      const trigger = el.shadowRoot?.querySelector(".provider-trigger") as HTMLButtonElement;
      trigger.click();
      await el.updateComplete;
      (
        el.shadowRoot?.querySelector(
          `[data-entry-id="${PROVIDER_ENTRIES[targetIndex].id}"]`,
        ) as HTMLElement
      ).click();
      await el.updateComplete;

      const cancelBtn = el.shadowRoot?.querySelector(".confirm-cancel") as HTMLButtonElement;
      cancelBtn.click();
      await el.updateComplete;

      expect(el.shadowRoot?.querySelector(".confirm-scrim")).toBeNull();
      expect(el._entryIndex).toBe(startIndex);
      expect(el.shadowRoot?.querySelector(".provider-current")?.textContent?.trim()).toBe(
        PROVIDER_ENTRIES[startIndex].label,
      );
      expect(calls).not.toContainEqual(["createSession"]);
    });

    it("confirm applies the entry and starts a session", async () => {
      const el = document.createElement("agent-page") as unknown as AgentPageInternals;
      container.appendChild(el);
      await el.updateComplete;

      const calls = recordPanel(el);
      const targetIndex = (el._entryIndex + 1) % PROVIDER_ENTRIES.length;
      const target = PROVIDER_ENTRIES[targetIndex];

      const trigger = el.shadowRoot?.querySelector(".provider-trigger") as HTMLButtonElement;
      trigger.click();
      await el.updateComplete;
      (
        el.shadowRoot?.querySelector(
          `[data-entry-id="${target.id}"]`,
        ) as HTMLElement
      ).click();
      await el.updateComplete;

      const okBtn = el.shadowRoot?.querySelector(".confirm-ok") as HTMLButtonElement;
      okBtn.click();
      await el.updateComplete;

      expect(el._panel.type).toBe(target.endpointType);
      expect(el._panel.path).toBe(target.path);
      expect(el._panel.model).toBe(target.model);
      expect(el._panel.streaming).toBe(target.streaming);
      expect(el._entryIndex).toBe(targetIndex);
      expect(calls).toContainEqual(["createSession"]);
    });

    it("the dialog is a labelled modal", async () => {
      const el = document.createElement("agent-page") as unknown as AgentPageInternals;
      container.appendChild(el);
      await el.updateComplete;

      const targetIndex = (el._entryIndex + 1) % PROVIDER_ENTRIES.length;
      const trigger = el.shadowRoot?.querySelector(".provider-trigger") as HTMLButtonElement;
      trigger.click();
      await el.updateComplete;
      (
        el.shadowRoot?.querySelector(
          `[data-entry-id="${PROVIDER_ENTRIES[targetIndex].id}"]`,
        ) as HTMLElement
      ).click();
      await el.updateComplete;

      const card = el.shadowRoot?.querySelector(".confirm-card") as HTMLElement;
      expect(card.getAttribute("role")).toBe("dialog");
      expect(card.getAttribute("aria-modal")).toBe("true");
      const labelledBy = card.getAttribute("aria-labelledby");
      expect(labelledBy).toBeTruthy();
      expect(el.shadowRoot?.getElementById(labelledBy as string)).not.toBeNull();
    });
  });

  it("col-side contains an iframe.genui-frame", async () => {
    const el = document.createElement("agent-page") as unknown as AgentPageInternals;
    container.appendChild(el);
    await el.updateComplete;

    const side = el.shadowRoot?.querySelector(".col-side");
    const iframe = side?.querySelector("iframe.genui-frame") as HTMLIFrameElement | null;
    expect(iframe).not.toBeNull();
    expect(iframe!.getAttribute("title")).toBe("Generative UI Frame");
  });

  it("genui-frame has tabindex='0' for keyboard navigation", async () => {
    const el = document.createElement("agent-page") as unknown as AgentPageInternals;
    container.appendChild(el);
    await el.updateComplete;

    const iframe = el.shadowRoot?.querySelector(".col-side iframe.genui-frame") as HTMLIFrameElement | null;
    expect(iframe).not.toBeNull();
    expect(iframe!.getAttribute("tabindex")).toBe("0");
  });

  it("divider pointerdown sets _dragging true and adds dragging class to iframe", async () => {
    const el = document.createElement("agent-page") as unknown as AgentPageInternals;
    container.appendChild(el);
    await el.updateComplete;

    const divider = el.shadowRoot?.querySelector(".col-divider") as HTMLElement | null;
    const iframe = el.shadowRoot?.querySelector(".col-side iframe.genui-frame") as HTMLIFrameElement | null;
    expect(divider).not.toBeNull();
    expect(iframe).not.toBeNull();

    divider!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX: 500 }));
    await el.updateComplete;

    expect(iframe!.classList.contains("dragging")).toBe(true);

    document.dispatchEvent(new PointerEvent("pointerup"));
    await el.updateComplete;

    expect(iframe!.classList.contains("dragging")).toBe(false);
  });

  it("document pointercancel clears _dragging and removes dragging class", async () => {
    const el = document.createElement("agent-page") as unknown as AgentPageInternals;
    container.appendChild(el);
    await el.updateComplete;

    const divider = el.shadowRoot?.querySelector(".col-divider") as HTMLElement | null;
    const iframe = el.shadowRoot?.querySelector(".col-side iframe.genui-frame") as HTMLIFrameElement | null;

    divider!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX: 500 }));
    await el.updateComplete;
    expect(iframe!.classList.contains("dragging")).toBe(true);

    document.dispatchEvent(new PointerEvent("pointercancel"));
    await el.updateComplete;
    expect(iframe!.classList.contains("dragging")).toBe(false);
  });

  it("divider pointerdown does not set dragging when side is collapsed", async () => {
    const el = document.createElement("agent-page") as unknown as AgentPageInternals;
    container.appendChild(el);
    await el.updateComplete;

    // Collapse the side panel
    const toggleBtn = el.shadowRoot?.querySelector(".divider-toggle") as HTMLButtonElement | null;
    toggleBtn?.click();
    await el.updateComplete;

    const divider = el.shadowRoot?.querySelector(".col-divider") as HTMLElement | null;
    const iframe = el.shadowRoot?.querySelector(".col-side iframe.genui-frame") as HTMLIFrameElement | null;

    divider!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true, clientX: 500 }));
    await el.updateComplete;
    expect(iframe?.classList.contains("dragging") ?? false).toBe(false);
  });

  it("AgentPage.prototype.mount is a callable asynchronous method", () => {
    expect(typeof AgentPage.prototype.mount).toBe("function");
    // Via the property descriptor, not a direct `Foo.prototype.bar` read — this
    // test only introspects .constructor.name, it never calls fn() unbound, and
    // the descriptor route doesn't hand eslint a class-method-typed reference.
    const fn = Object.getOwnPropertyDescriptor(AgentPage.prototype, "mount")?.value as
      | { constructor: { name: string } }
      | undefined;
    expect(fn?.constructor.name).toBe("AsyncFunction");
  });

  it("clampSideWidth returns a value inside the bounds", () => {
    expect(clampSideWidth(400, 1280)).toBe(400);
    expect(clampSideWidth(50, 1280)).toBe(AGENT_RIGHT_PANEL_MIN_WIDTH_PX);
    expect(clampSideWidth(5000, 1280)).toBe(
      1280 - AGENT_SESSIONS_COLUMN_WIDTH_PX - AGENT_CHAT_MIN_WIDTH_PX,
    );
    expect(Number.isInteger(clampSideWidth(5000, 1280))).toBe(true);
  });

  it("clampSideWidth: the minimum wins on a layout too narrow for it", () => {
    expect(clampSideWidth(300, 500)).toBe(AGENT_RIGHT_PANEL_MIN_WIDTH_PX);
  });

  it("sideWidthFromDrag grows on a leftward drag", () => {
    expect(sideWidthFromDrag(320, -200, 1280)).toBe(520);
    expect(sideWidthFromDrag(320, 100, 1280)).toBe(220);
  });

  it("sideWidthFromDrag clamps at both ends", () => {
    expect(sideWidthFromDrag(320, 1000, 1280)).toBe(200);
    expect(sideWidthFromDrag(320, -1000, 1280)).toBe(720);
  });

  it("the divider's markup: role, orientation, no tabindex, three dots, one toggle button", async () => {
    const el = document.createElement("agent-page") as unknown as AgentPageInternals;
    container.appendChild(el);
    await el.updateComplete;

    const divider = el.shadowRoot?.querySelector(".col-divider") as HTMLElement;
    expect(divider.getAttribute("role")).toBe("separator");
    expect(divider.getAttribute("aria-orientation")).toBe("vertical");
    expect(divider.hasAttribute("tabindex")).toBe(false);
    expect(divider.querySelectorAll(".divider-grip .dot").length).toBe(3);
    expect(divider.querySelectorAll("button.divider-toggle").length).toBe(1);
  });

  it("the toggle stays a direct child of .col-divider in both states", async () => {
    const el = document.createElement("agent-page") as unknown as AgentPageInternals;
    container.appendChild(el);
    await el.updateComplete;

    const button = () =>
      el.shadowRoot?.querySelector("button.divider-toggle") as HTMLButtonElement;
    const divider = () =>
      el.shadowRoot?.querySelector(".col-divider") as HTMLElement;

    expect(button().parentElement).toBe(divider());

    button().click();
    await el.updateComplete;

    expect(divider().classList.contains("collapsed")).toBe(true);
    expect(button().parentElement).toBe(divider());
    expect(el.shadowRoot?.querySelector(".col-chat button.divider-toggle")).toBeNull();
    expect(el.shadowRoot?.querySelector(".col-side button.divider-toggle")).toBeNull();
  });

  it("the toggle's accessible name and state track the collapse", async () => {
    const el = document.createElement("agent-page") as unknown as AgentPageInternals;
    container.appendChild(el);
    await el.updateComplete;

    const button = () =>
      el.shadowRoot?.querySelector("button.divider-toggle") as HTMLButtonElement;
    const side = () => el.shadowRoot?.querySelector(".col-side") as HTMLElement;
    const divider = () => el.shadowRoot?.querySelector(".col-divider") as HTMLElement;

    expect(button().getAttribute("aria-label")).toBe("Collapse side panel");
    expect(button().getAttribute("aria-expanded")).toBe("true");

    button().click();
    await el.updateComplete;

    expect(button().getAttribute("aria-label")).toBe("Expand side panel");
    expect(button().getAttribute("aria-expanded")).toBe("false");
    expect(side().classList.contains("collapsed")).toBe(true);
    expect(side().hasAttribute("hidden")).toBe(true);
    expect(divider().getAttribute("aria-disabled")).toBe("true");

    button().click();
    await el.updateComplete;

    expect(button().getAttribute("aria-label")).toBe("Collapse side panel");
    expect(button().getAttribute("aria-expanded")).toBe("true");
    expect(side().classList.contains("collapsed")).toBe(false);
    expect(side().hasAttribute("hidden")).toBe(false);
    expect(divider().getAttribute("aria-disabled")).toBe("false");
  });

  it("the toggle is a real button, activated by Enter/Space with no extra key handling", async () => {
    const el = document.createElement("agent-page") as unknown as AgentPageInternals;
    container.appendChild(el);
    await el.updateComplete;

    const button = el.shadowRoot?.querySelector("button.divider-toggle") as HTMLButtonElement;
    expect(button.tagName).toBe("BUTTON");
    // No enclosing <form>, so the native default type ("submit") never submits
    // anything — the element is a plain, keyboard-operable button.
    expect(button.closest("form")).toBeNull();
  });

  it("the right panel's inline width follows _sideWidth", async () => {
    const el = document.createElement("agent-page") as unknown as AgentPageInternals;
    container.appendChild(el);
    await el.updateComplete;

    const side = () => el.shadowRoot?.querySelector(".col-side") as HTMLElement;
    expect(side().style.flexBasis).toBe(`${AGENT_RIGHT_PANEL_WIDTH_PX}px`);

    el._sideWidth = 500;
    await el.updateComplete;
    expect(side().style.flexBasis).toBe("500px");
  });

  it("the divider's inline right follows the width", async () => {
    const el = document.createElement("agent-page") as unknown as AgentPageInternals;
    container.appendChild(el);
    await el.updateComplete;

    const divider = () => el.shadowRoot?.querySelector(".col-divider") as HTMLElement;

    el._sideWidth = 500;
    await el.updateComplete;
    expect(divider().style.right).toBe(`${500 - AGENT_DIVIDER_WIDTH_PX / 2}px`);

    el._sideCollapsed = true;
    await el.updateComplete;
    expect(divider().style.right).toBe("0px");
  });

  it("collapse keeps the dragged width", async () => {
    const el = document.createElement("agent-page") as unknown as AgentPageInternals;
    container.appendChild(el);
    await el.updateComplete;

    const side = () => el.shadowRoot?.querySelector(".col-side") as HTMLElement;
    const button = () =>
      el.shadowRoot?.querySelector("button.divider-toggle") as HTMLButtonElement;

    el._sideWidth = 500;
    await el.updateComplete;

    button().click();
    await el.updateComplete;
    button().click();
    await el.updateComplete;

    expect(side().style.flexBasis).toBe("500px");
  });

  it("a pointer drag moves the width, and stops once pointerup has fired", async () => {
    const el = document.createElement("agent-page") as unknown as AgentPageInternals;
    container.appendChild(el);
    await el.updateComplete;
    el._layoutWidth = () => 1280;

    const divider = el.shadowRoot?.querySelector(".col-divider") as HTMLElement;
    divider.dispatchEvent(new MouseEvent("pointerdown", { clientX: 900, bubbles: true }));
    document.dispatchEvent(new MouseEvent("pointermove", { clientX: 800, bubbles: true }));

    expect(el._sideWidth).toBe(420);

    document.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
    document.dispatchEvent(new MouseEvent("pointermove", { clientX: 700, bubbles: true }));

    expect(el._sideWidth).toBe(420);
  });

  it("pressing the toggle never starts a drag", async () => {
    const el = document.createElement("agent-page") as unknown as AgentPageInternals;
    container.appendChild(el);
    await el.updateComplete;
    el._layoutWidth = () => 1280;

    const button = el.shadowRoot?.querySelector("button.divider-toggle") as HTMLElement;
    const before = el._sideWidth;
    button.dispatchEvent(new MouseEvent("pointerdown", { clientX: 900, bubbles: true }));

    expect(el._dragStartWidth).toBeNull();

    document.dispatchEvent(new MouseEvent("pointermove", { clientX: 800, bubbles: true }));
    expect(el._sideWidth).toBe(before);
  });

  it("a collapsed divider does not drag", async () => {
    const el = document.createElement("agent-page") as unknown as AgentPageInternals;
    container.appendChild(el);
    await el.updateComplete;
    el._layoutWidth = () => 1280;
    el._sideCollapsed = true;
    await el.updateComplete;

    const before = el._sideWidth;
    const divider = el.shadowRoot?.querySelector(".col-divider") as HTMLElement;
    divider.dispatchEvent(new MouseEvent("pointerdown", { clientX: 900, bubbles: true }));
    document.dispatchEvent(new MouseEvent("pointermove", { clientX: 800, bubbles: true }));

    expect(el._sideWidth).toBe(before);
  });

  it("the window-resize clamp re-clamps a dragged width, but not while collapsed", async () => {
    const el = document.createElement("agent-page") as unknown as AgentPageInternals;
    container.appendChild(el);
    await el.updateComplete;

    el._sideWidth = 700;
    el._layoutWidth = () => 900;
    window.dispatchEvent(new Event("resize"));
    await el.updateComplete;
    expect(el._sideWidth).toBe(340);

    el._sideCollapsed = true;
    el._sideWidth = 700;
    await el.updateComplete;
    window.dispatchEvent(new Event("resize"));
    await el.updateComplete;
    expect(el._sideWidth).toBe(700);
  });

  it("the hook is offered when the host allows images", async () => {
    const el = document.createElement("agent-page") as unknown as AgentPageInternals;
    container.appendChild(el);
    await el.updateComplete;
    expect(typeof window.__WA_GENUI_SCREENSHOT__).toBe("function");
  });

  it("the hook is withdrawn when the host disables image input", async () => {
    const el = document.createElement("agent-page") as unknown as AgentPageInternals;
    container.appendChild(el);
    await el.updateComplete;
    el._props.imageInput = false;
    el.requestUpdate();
    await el.updateComplete;
    expect(window.__WA_GENUI_SCREENSHOT__).toBeUndefined();
  });

  it("the hook comes back when image input is re-enabled", async () => {
    const el = document.createElement("agent-page") as unknown as AgentPageInternals;
    container.appendChild(el);
    await el.updateComplete;
    el._props.imageInput = false;
    el.requestUpdate();
    await el.updateComplete;
    expect(window.__WA_GENUI_SCREENSHOT__).toBeUndefined();
    el._props.imageInput = true;
    el.requestUpdate();
    await el.updateComplete;
    expect(typeof window.__WA_GENUI_SCREENSHOT__).toBe("function");
  });

  it("screenshotAvailable follows the selected provider entry", async () => {
    const el = document.createElement("agent-page") as unknown as AgentPageInternals;
    container.appendChild(el);
    await el.updateComplete;
    // Default entry is anthropic/sonnet, which carries the 'sonnet' marker
    el._props.imageInput = undefined;
    expect(el.screenshotAvailable).toBe(true);
    // The fallback chain's endpoint type is unknown to the vision table
    el._entryIndex = PROVIDER_ENTRIES.findIndex((e) => e.id === "any-model");
    expect(el.screenshotAvailable).toBe(false);
    // Switch to gemini-flash-lite-latest which carries 'gemini'
    const geminiIdx = PROVIDER_ENTRIES.findIndex((e) => e.model === "gemini-flash-lite-latest");
    if (geminiIdx >= 0) {
      el._entryIndex = geminiIdx;
      expect(el.screenshotAvailable).toBe(true);
    }
  });

  it("AgentPage.prototype.screenshot is a callable asynchronous method", () => {
    expect(typeof AgentPage.prototype.screenshot).toBe("function");
    // Same reasoning as the mount test above: read via the descriptor.
    const fn = Object.getOwnPropertyDescriptor(AgentPage.prototype, "screenshot")?.value as
      | { constructor: { name: string } }
      | undefined;
    expect(fn?.constructor.name).toBe("AsyncFunction");
  });

  it("the page registers render_agent_ui on its own panel", async () => {
    const el = document.createElement("agent-page") as unknown as AgentPageInternals;
    container.appendChild(el);
    await el.updateComplete;
    const toolNames = el._panel.tools!.map((t) => t.name);
    expect(toolNames).toContain("render_agent_ui");
  });

  it("validateSource uses the frame window as the rule context", async () => {
    const el = document.createElement("agent-page") as unknown as AgentPageInternals;
    container.appendChild(el);
    await el.updateComplete;
    const result = await el.validateSource("<md-nope></md-nope>");
    expect(result).toHaveProperty("valid");
    expect(result).toHaveProperty("violations");
  });
});
