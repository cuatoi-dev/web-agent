// agent-page.view.ts — every template `<agent-page>` renders.
//
// The templates moved out of `agent-page.ts` unchanged. They read one plain
// object, `AgentPageView`, instead of the element, so this module never
// imports the component and the two files cannot form a cycle.

import { html } from "lit";
import type { SessionMeta } from "@cuatoi/web-agent-core";
import { PROVIDER_ENTRIES } from "../agent-panel-config";
import { PROMPT_PRESETS, type CustomPromptConfig } from "../agent-prompt-config";
import { buildFrameUrl } from "../genui/genui-frame";
import {
  CHEVRON_RIGHT_SVG,
  RENAME_ICON_SVG,
  DELETE_ICON_SVG,
  CONFIG_ICON_SVG,
  CARET_DOWN_SVG,
  CHECK_SVG,
} from "./agent-page-icons";
import {
  AGENT_SESSIONS_COLUMN_WIDTH_PX,
  AGENT_DIVIDER_WIDTH_PX,
} from "./agent-page-layout";
import type { AgentPageView } from "./agent-page.view.types";

function renderSessionRow(s: SessionMeta, v: AgentPageView) {
  const isActive = s.id === v.activeId;
  const isRenaming = s.id === v.renamingId;
  return html`
    <li
      class="session-row ${isActive ? "active" : ""}"
      data-session-id=${s.id}
      aria-current=${isActive ? "true" : "false"}
      tabindex="0"
      @click=${() => v.onSwitch(s.id)}
      @keydown=${(e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          v.onSwitch(s.id);
        }
      }}
    >
      ${isActive ? html`<span class="active-bar" aria-hidden="true"></span>` : ""}
      ${isRenaming
        ? html`<input
            class="rename-input"
            .value=${s.title ?? ""}
            aria-label="Session title"
            @click=${(e: Event) => e.stopPropagation()}
            @keydown=${(e: KeyboardEvent) => v.onRenameKey(e, s.id)}
            @blur=${() => {
              v.onRenameCancel();
            }}
          />`
        : html`<span class="session-title" title=${v.label(s)}
            >${v.label(s)}</span
          >
          <div class="row-actions">
            <button
              class="row-btn rename-btn"
              aria-label="Rename"
              title="Rename"
              @click=${(e: Event) => {
                e.stopPropagation();
                v.onRenameStart(s.id);
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                ${RENAME_ICON_SVG}
              </svg>
            </button>
            <button
              class="row-btn delete-btn"
              aria-label="Delete"
              title="Delete"
              @click=${(e: Event) => {
                e.stopPropagation();
                v.onDelete(s.id);
              }}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                ${DELETE_ICON_SVG}
              </svg>
            </button>
          </div>`}
    </li>
  `;
}

function renderConfigView(v: AgentPageView) {
  const fields: Array<{ key: keyof CustomPromptConfig; label: string; hasPresets: boolean }> = [
    { key: "role", label: "Role", hasPresets: true },
    { key: "tone", label: "Tone", hasPresets: true },
    { key: "length", label: "Length", hasPresets: true },
    { key: "language", label: "Language", hasPresets: true },
    { key: "extra", label: "Extra", hasPresets: false },
  ];

  return html`
    <div class="config-view" role="region" aria-label="Config">
      <div class="config-header">
        <h2 class="config-title">Custom instructions</h2>
        <button
          type="button"
          class="config-reset-btn"
          aria-label="Reset to default instructions"
          @click=${() => v.onResetConfig()}
        >
          Reset
        </button>
      </div>
      ${fields.map((f) => {
        const presets = f.hasPresets ? PROMPT_PRESETS[f.key as keyof typeof PROMPT_PRESETS] : [];
        return html`
          <div class="config-field" data-field=${f.key}>
            <label class="field-label" for="config-field-${f.key}">${f.label}</label>
            ${f.hasPresets
              ? html`
                  <div class="field-presets" role="group" aria-label="${f.label} presets">
                    ${presets.map(
                      (p) => html`
                        <button
                          type="button"
                          class="preset-btn"
                          data-preset=${p.label}
                          @click=${() => v.onPresetClick(f.key, p.sample)}
                        >
                          ${p.label}
                        </button>
                      `,
                    )}
                  </div>
                `
              : ""}
            <textarea
              id="config-field-${f.key}"
              class="field-textarea"
              rows="2"
              .value=${v.customConfig[f.key] ?? ""}
              placeholder="${f.hasPresets ? "Select a preset or enter custom instruction…" : "Enter additional standing instructions…"}"
              aria-label=${f.label}
              @input=${(e: Event) =>
                v.onFieldInput(f.key, (e.target as HTMLTextAreaElement).value)}
            ></textarea>
          </div>
        `;
      })}
      <p class="config-note">
        Changes take effect from the next message in the current conversation.
      </p>
    </div>
  `;
}

function renderProviderPicker(v: AgentPageView) {
  const current = PROVIDER_ENTRIES[v.entryIndex];
  return html`
    <div class="provider-combo">
      <button
        class="provider-trigger"
        aria-label="Provider, model and mode"
        title=${current.label}
        aria-haspopup="listbox"
        aria-expanded=${v.entryListOpen ? "true" : "false"}
        @click=${() => v.onToggleEntryList()}
      >
        <span class="provider-current">${current.label}</span>
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          ${CARET_DOWN_SVG}
        </svg>
      </button>
      ${v.entryListOpen
        ? html`
            <ul
              class="provider-list"
              role="listbox"
              aria-label="Provider, model and mode"
              @keydown=${(e: KeyboardEvent) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  v.onCloseEntryList();
                }
              }}
            >
              ${PROVIDER_ENTRIES.map((entry, i) => {
                const selected = i === v.entryIndex;
                return html`
                  <li
                    class="provider-option ${selected ? "selected" : ""}"
                    role="option"
                    data-entry-id=${entry.id}
                    aria-selected=${selected ? "true" : "false"}
                    tabindex="0"
                    @click=${() => v.onPickEntry(i)}
                    @keydown=${(e: KeyboardEvent) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        v.onPickEntry(i);
                      }
                    }}
                  >
                    ${selected
                      ? html`<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                          ${CHECK_SVG}
                        </svg>`
                      : html`<span class="option-check-spacer" aria-hidden="true"></span>`}
                    <span class="option-label">${entry.label}</span>
                  </li>
                `;
              })}
            </ul>
          `
        : ""}
    </div>
  `;
}

function renderSwitchConfirm(v: AgentPageView) {
  if (v.pendingIndex === null) return "";
  const target = PROVIDER_ENTRIES[v.pendingIndex];
  return html`
    <div
      class="confirm-scrim"
      @click=${() => v.onCancelSwitch()}
      @keydown=${(e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.preventDefault();
          v.onCancelSwitch();
        }
      }}
    >
      <div
        class="confirm-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="switch-confirm-title"
        @click=${(e: Event) => e.stopPropagation()}
      >
        <h3 class="confirm-title" id="switch-confirm-title">Start a new chat?</h3>
        <p class="confirm-body">
          Switching to ${target.label} replaces the current chat with a new
          one. The current chat is kept and stays in the session list.
        </p>
        <div class="confirm-actions">
          <button class="confirm-cancel" @click=${() => v.onCancelSwitch()}>
            Cancel
          </button>
          <button class="confirm-ok" @click=${() => v.onConfirmSwitch()}>
            Start new chat
          </button>
        </div>
      </div>
    </div>
  `;
}

export function renderAgentPage(v: AgentPageView) {
  return html`
    <div class="layout">
      <aside
        class="col-sessions"
        style="flex: 0 0 ${AGENT_SESSIONS_COLUMN_WIDTH_PX}px"
        aria-label="Sessions"
      >
        <div class="sessions-inner">
          <button class="new-chat" @click=${() => v.onNewChat()}>
            + New chat
          </button>
          <ul class="session-list">
            ${v.sessions.map((s) => renderSessionRow(s, v))}
          </ul>
          <div class="sessions-footer">
            ${renderProviderPicker(v)}
            <button
              class="config-btn"
              aria-label="Config"
              title="Config"
              aria-pressed=${v.configOpen ? "true" : "false"}
              @click=${() => v.onToggleConfig()}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                ${CONFIG_ICON_SVG}
              </svg>
            </button>
          </div>
        </div>
      </aside>
      <section class="col-chat">
        <agent-chat-panel
          .type=${v.props.type}
          .path=${v.props.path}
          .model=${v.props.model}
          .streaming=${v.props.streaming}
          .fetch=${v.props.fetch}
          .store=${v.props.store}
          .config=${v.props.config}
          .agentName=${v.props.agentName}
          .agentShortName=${v.props.agentShortName}
          .agentAvatar=${v.props.agentAvatar}
          .models=${v.props.models}
          .imageInput=${v.props.imageInput}
          .renderers=${v.props.renderers}
          .sources=${v.props.sources}
          .tools=${v.props.tools}
          .skills=${v.props.skills}
          .skillRegistry=${v.props.skillRegistry}
          .cues=${v.props.cues}
          .toolProviders=${v.props.toolProviders}
          .screens=${v.props.screens}
          .notify=${v.props.notify}
          .hideHeader=${true}
          .hooks=${v.hooks}
          .appContext=${v.appContext}
          ?hidden=${v.configOpen}
        ></agent-chat-panel>
        ${v.configOpen ? renderConfigView(v) : ""}
      </section>
      <aside
        class="col-side ${v.sideCollapsed ? "collapsed" : ""}"
        style="flex: 0 0 ${v.sideWidth}px"
        aria-label="Side panel"
        ?hidden=${v.sideCollapsed}
      >
        <iframe
          class="genui-frame ${v.dragging ? "dragging" : ""}"
          tabindex="0"
          src="${buildFrameUrl("genui/frame", v.genuiConfig.resources.some(r => r.url.includes("material")) ? "material" : "plain")}"
          title="Generative UI Frame"
          aria-label="Generative UI Frame"
          @load=${v.onFrameLoad}
        ></iframe>
      </aside>
      <div
        class="col-divider ${v.sideCollapsed ? "collapsed" : ""}"
        role="separator"
        aria-orientation="vertical"
        aria-disabled=${v.sideCollapsed ? "true" : "false"}
        style="right: ${v.sideCollapsed
          ? 0
          : v.sideWidth - AGENT_DIVIDER_WIDTH_PX / 2}px"
        @pointerdown=${(e: PointerEvent) => v.onDividerPointerDown(e)}
      >
        <button
          class="divider-toggle"
          aria-label=${v.sideCollapsed ? "Expand side panel" : "Collapse side panel"}
          aria-expanded=${v.sideCollapsed ? "false" : "true"}
          @pointerdown=${(e: PointerEvent) => e.stopPropagation()}
          @click=${() => v.onToggleSide()}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            ${CHEVRON_RIGHT_SVG}
          </svg>
        </button>
        <span class="divider-grip" aria-hidden="true">
          <span class="dot"></span>
          <span class="dot"></span>
          <span class="dot"></span>
        </span>
      </div>
      ${renderSwitchConfirm(v)}
    </div>
  `;
}
