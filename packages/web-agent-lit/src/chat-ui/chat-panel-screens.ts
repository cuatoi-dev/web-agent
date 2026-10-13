import { html } from "../ui/template.js";
import { defineUiElements } from "../ui/registry.js";
import type { WaCheckedChangeDetail } from "../ui/types.js";
import type { AvailableTool } from "@cuatoi/web-agent-core";
import { getAgentCursor } from "./agent-cursor.js";
import { ChatPanelHistory } from "./chat-panel-history.js";
import type { ToolPhraseDef } from "./types.js";

defineUiElements();

/** The two full-panel screens reached from the header kebab — Settings and
 *  Debug — and the inline title editor. Moved verbatim out of
 *  chat-panel.ts. */
export abstract class ChatPanelScreens extends ChatPanelHistory {
  // --- Config screen ---

  /** Current cue values with defaults for the config controls. */
  protected _currentCues(): { enabled: boolean; speed: "slow" | "fast" } {
    return {
      enabled: this._cues?.enabled ?? false,
      speed: this._cues?.speed === "fast" ? "fast" : "slow",
    };
  }

  protected _toggleConfig(): void {
    this._configOpen = !this._configOpen;
    if (this._configOpen) {
      this._debugOpen = false;
      this._openScreen = null;
      this._renderedScreenId = null;
      this._renderedScreenEl = null;
    }
    this.requestUpdate();
  }

  protected _toggleMenu(): void {
    this._menuOpen = !this._menuOpen;
    this.requestUpdate();
  }

  /** Mutates the live in-memory cues, re-derives the session config, and
   *  notifies the host. Clears the cursor when the cue is turned off. */
  protected _applyCues(next: { enabled: boolean; speed: "slow" | "fast" }): void {
    const wasEnabled = this._cues?.enabled ?? false;
    // Reuse the existing `cues` setter (updates session config + requests update).
    this.cues = { ...(this._cues ?? {}), enabled: next.enabled, speed: next.speed };
    if (wasEnabled && !next.enabled) {
      try { getAgentCursor().clear(); } catch { /* the cursor layer may already be gone; nothing to clean up */ }
    }
    this._onCuesChange?.({ speed: next.speed, enabled: next.enabled });
  }

  protected _setCueEnabled(enabled: boolean): void {
    this._applyCues({ ...this._currentCues(), enabled });
  }

  protected _setCueSpeed(speed: "slow" | "fast"): void {
    this._applyCues({ ...this._currentCues(), speed });
  }

  protected _renderConfigView() {
    const cur = this._currentCues();
    return html`
      <div class="wa-config-view" role="region" aria-label="Settings">
        <div class="wa-config-header">
          <wa-icon-button icon="arrow_back" label="Back to chat"
            @press=${() => this._toggleConfig()}></wa-icon-button>
          <span class="wa-config-title">Settings</span>
        </div>
        <div class="wa-config-section">
          <div class="wa-config-section-title">Visual cue</div>
          <div class="wa-config-row">
            <wa-checkbox label="Show the agent cursor while it works"
              .checked=${cur.enabled}
              @checked-change=${(e: CustomEvent<WaCheckedChangeDetail>) => this._setCueEnabled(e.detail.checked)}
            ></wa-checkbox>
          </div>
          <div class="wa-config-row">
            <span class="wa-config-label">Speed</span>
            <div class="wa-config-seg">
              <wa-button label="Slow"
                .variant=${cur.speed === "slow" ? "primary" : "secondary"}
                .disabled=${!cur.enabled}
                @press=${() => this._setCueSpeed("slow")}></wa-button>
              <wa-button label="Fast"
                .variant=${cur.speed === "fast" ? "primary" : "secondary"}
                .disabled=${!cur.enabled}
                @press=${() => this._setCueSpeed("fast")}></wa-button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  protected _toggleDebug(): void {
    this._debugOpen = !this._debugOpen;
    if (this._debugOpen) {
      this._configOpen = false;
      this._openScreen = null;
      this._renderedScreenId = null;
      this._renderedScreenEl = null;
    }
    this.requestUpdate();
  }

  protected _closeScreen(): void {
    this._openScreen = null;
    this._renderedScreenId = null;
    this._renderedScreenEl = null;
    this.requestUpdate();
  }

  protected _renderScreenFrame(screen: import("./types.js").PanelScreen) {

    if (this._renderedScreenId !== screen.id || !this._renderedScreenEl) {
      this._renderedScreenId = screen.id;
      this._renderedScreenEl = screen.render({
        close: () => this._closeScreen(),
        confirm: (detail) => this.confirmInteraction(detail),
      });
    }

    return html`
      <div class="wa-screen-view" role="region" aria-label=${screen.label}>
        <div class="wa-screen-header">
          <wa-icon-button icon="arrow_back" label="Back to chat"
            @press=${() => this._closeScreen()}></wa-icon-button>
          <span class="wa-screen-title">${screen.label}</span>
        </div>
        <div class="wa-screen-body">
          ${this._renderedScreenEl}
        </div>
      </div>
    `;
  }

  /** The tools the session resolved for its most recent turn, read straight
   *  from the session. `[]` before the first turn, and `[]` when the panel has
   *  no session yet.
   *
   *  The panel builds no `ToolContext` of its own. Only core sees every seam
   *  the builders read (`_scheduler`, `skillRegistry`, `dataSource`), and a
   *  context assembled out here would report a different list from the one
   *  the model was given — which is what this drawer used to do.
   *
   *  No `try`/`catch`: nothing in this path is host code any more, so there is
   *  no failure left worth swallowing, and a silent "No tools." would hide a
   *  core defect behind a plausible answer. */
  protected _availableTools(): AvailableTool[] {
    return this._session?.availableTools() ?? [];
  }

  /** 124/007 — the phrase map the thread renders step lines from. Built from
   *  `availableTools()`, NOT from `panel.tools`: a tool loaded through
   *  `toolProviders` never appears in `tools`, and the extension's page tools
   *  all arrive that way. Only tools that carry at least one of the two
   *  functions are listed, so an empty map means "nothing overrides the
   *  built-in list" and the thread renders exactly as before.
   *
   *  069/001: `resolvedTools` is seeded by `initAgent()` at session
   *  construction/restore (controller-config.ts) and re-snapshotted at turn
   *  start (controller-turn.ts), so this is populated before the first turn
   *  too — a restored (page-reload) history line resolves its tool's own
   *  phrase without waiting for a new turn. */
  protected _toolPhrases(): Map<string, ToolPhraseDef> | undefined {
    const map = new Map<string, ToolPhraseDef>();
    for (const t of this._availableTools()) {
      if (t.phrase || t.inProgressPhrase) {
        map.set(t.name, { phrase: t.phrase, inProgressPhrase: t.inProgressPhrase });
      }
    }
    return map.size > 0 ? map : undefined;
  }

  /** The host/agent config header the debug log starts with. One source for
   *  both the built-in debug view and the public getDebugLog(). */
  protected _debugConfigSnapshot(): Record<string, unknown> {
    return {
      appName: this.appContext?.appName,
      appDescription: this.appContext?.appDescription,
      userName: this.appContext?.userName,
      userInfo: this.appContext?.userInfo,
      agentName: this._agentName,
      agentShortName: this._agentShortName,
      userAvatar: this._userAvatar ? "(set)" : "(none)",
      agentAvatar: this._agentAvatar ? "(set)" : "(none)",
      debug: this._debug === true,
      persist: this.config?.persist !== false,
      model: this._model,
      type: this._type,
      path: this._path,
    };
  }

  /** Full raw debug log: config JSON header + every message/turn + tool calls. */
  protected _serializeDebugLog(cfg: Record<string, unknown>): string {
    const lines: string[] = [];
    lines.push("=== Host / agent config ===");
    lines.push(JSON.stringify(cfg, null, 2));
    lines.push("");
    lines.push("=== Provider fallback ===");
    lines.push(...(this._fallbackLog.length ? this._fallbackLog : ["(none)"]));
    lines.push("");
    lines.push("=== Conversation ===");
    const msgs = this.messages;
    if (msgs.length === 0) {
      lines.push("(no conversation yet)");
    } else {
      for (const m of msgs) {
        const text =
          m.text ??
          (m.parts ?? [])
            .filter((p) => p.kind === "text")
            .map((p) => p.text)
            .join(" ");
        lines.push(`[${m.role}] ${text ?? ""}`.trimEnd());
        for (const entry of m.trace ?? []) {
          lines.push(`  → ${entry.name}`);
          lines.push(`    input: ${JSON.stringify(entry.input)}`);
          lines.push(`    outcome: ${entry.outcomeSummary}`);
        }
      }
    }
    return lines.join("\n");
  }

  /** Available tools as plain copyable text: name then indented description. */
  protected _serializeToolsList(tools: AvailableTool[]): string {
    if (tools.length === 0) return "No tools.";
    return tools.map((t) => `${t.name}\n  ${t.description}`).join("\n\n");
  }

  protected _copyDebug(which: "log" | "tools", value: string): void {
    const done = () => {
      this._debugCopied = which;
      this.requestUpdate();
      setTimeout(() => {
        if (this._debugCopied === which) {
          this._debugCopied = null;
          this.requestUpdate();
        }
      }, 1200);
    };
    try {
      const p = navigator.clipboard?.writeText(value);
      if (p !== undefined && typeof p.then === "function") {
        p.then(done).catch((err: unknown) =>
          console.warn("[debug] clipboard write failed:", err),
        );
      } else {
        // No clipboard API (insecure context / test env) — still give feedback.
        done();
      }
    } catch (err) {
      console.warn("[debug] clipboard write failed:", err);
    }
  }

  protected _renderDebugView() {
    const tools = this._availableTools();
    const logText = this.getDebugLog();

    const toolsText = this._serializeToolsList(tools);

    return html`
      <div class="wa-debug-view" role="region" aria-label="Debug">
        <div class="wa-config-header">
          <wa-icon-button icon="arrow_back" label="Back to chat"
            @press=${() => this._toggleDebug()}></wa-icon-button>
          <span class="wa-config-title">Debug</span>
        </div>
        <div class="wa-config-section wa-debug-section">
          <div class="wa-config-section-title">Raw conversation &amp; tool calls</div>
          <textarea
            class="wa-debug-ta"
            readonly
            aria-label="Raw conversation and tool calls"
            .value=${logText}
          ></textarea>
          <div class="wa-debug-copy-row"><wa-button variant="secondary"
            .label=${this._debugCopied === "log" ? "Copied!" : "Copy"}
            @press=${() => this._copyDebug("log", logText)}></wa-button></div>
        </div>
        <div class="wa-config-section wa-debug-section">
          <div class="wa-config-section-title">Available tools (${tools.length})</div>
          <textarea
            class="wa-debug-ta"
            readonly
            aria-label="Available tools"
            .value=${toolsText}
          ></textarea>
          <div class="wa-debug-copy-row"><wa-button variant="secondary"
            .label=${this._debugCopied === "tools" ? "Copied!" : "Copy"}
            @press=${() => this._copyDebug("tools", toolsText)}></wa-button></div>
        </div>
      </div>
    `;
  }

  // --- Inline title edit ---

  protected _handleTitleEditOpen(): void {
    this._titleEditActive = true;
    const currentMeta = this._state?.sessions.find(s => s.id === this._state?.activeSessionId);
    this._titleEditValue = currentMeta?.title || "";
    this.requestUpdate();
    // The input is not in the DOM until this update renders, so focus after
    // it settles.
    void this.updateComplete.then(async () => {
      const host = this.querySelector(".wa-title-edit-row wa-text-input");
      // The default registry's field keeps a light-DOM <input>; the Acme
      // registry's <md-outlined-text-field> keeps its <input> in shadow DOM,
      // so querySelector("input") finds nothing there and the focusable node
      // is the field element itself (its focus() delegates internally).
      const native = (host?.querySelector("input, textarea") as HTMLElement | null)
        ?? (host?.firstElementChild as HTMLElement | null)
        ?? host;
      const withUpdate = native as (HTMLElement & { updateComplete?: Promise<unknown> }) | null;
      if (withUpdate?.updateComplete) await withUpdate.updateComplete;
      (native as HTMLElement)?.focus();
    });
  }

  protected _handleTitleEditKeydown(e: KeyboardEvent): void {
    if (e.key === "Enter" || e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  protected _handleTitleEditKeyup(e: KeyboardEvent): void {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      this._handleTitleEditConfirm();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      this._handleTitleEditCancel();
    }
  }

  /** Double-click the title text to rename. Gated exactly like the pencil:
   *  with persistence off there is no rename affordance at all. */
  protected _handleTitleDblClick(e: MouseEvent): void {
    if (this.config?.persist === false) return;
    if (this._titleEditActive) return;
    // The browser has already selected the double-clicked word by the time
    // this runs. preventDefault() does not undo that, so clear the range as
    // well, or the highlight stays painted behind the new input.
    e.preventDefault();
    window.getSelection()?.removeAllRanges();
    this._handleTitleEditOpen();
  }

  protected _handleTitleEditConfirm(): void {
    const val = (this._titleEditValue || "").trim();
    this._titleEditActive = false;
    if (!val) {
      this.requestUpdate();
      return;
    }
    if (this._session && this._state?.activeSessionId) {
      this._session.setTitle(this._state.activeSessionId, val)
        .catch(err => console.error("[title] setTitle failed:", err));
      this._manualTitle = true;
    }
    this.requestUpdate();
  }

  protected _handleTitleEditCancel(): void {
    this._titleEditActive = false;
    this.requestUpdate();
  }

}
