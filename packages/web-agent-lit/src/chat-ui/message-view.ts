import { Component } from "../ui/component.js";
import { html, nothing, unsafeHTML } from "../ui/template.js";
import { AuditEntry, RenderableBlock, DataSourceProvider, ToolRenderer, AttachmentChip, readAttachmentChips, parseSavedOutput } from "@cuatoi/web-agent-core";
import { renderBlocks } from "../ui-blocks/renderer/block-renderer.js";
import { BlockRendererRegistry } from "../ui-blocks/renderer/types.js";
import type { MessagePart, ToolPhraseDef } from "./types.js";
import { toolStepPhrase, compactionPhrase } from "./tool-phrases.js";
import { sanitize, sanitizeToolHtml } from "./message-view-sanitize.js";
import { messageViewStyles } from "./message-view-styles.js";

export { sanitizeToolHtml } from "./message-view-sanitize.js";

export class AgentMessageView extends Component {
  private _role: "user" | "assistant" | "system" = "user";
  private _html = "";
  private _images: { dataUrl: string; mediaType: string }[] = [];
  private _trace?: AuditEntry[];
  private _blocks: RenderableBlock[] = [];
  private _parts: MessagePart[] = [];
  private _disabled = false;
  private _dataSource?: DataSourceProvider;
  private _registry?: BlockRendererRegistry;
  private _blockCache = new WeakMap<
    RenderableBlock,
    { node: Node; registry: BlockRendererRegistry | undefined; dataSource: DataSourceProvider | undefined; disabled: boolean }
  >();
  get images() { return this._images; }
  set images(val: { dataUrl: string; mediaType: string }[]) {
    const next = val ?? [];
    if (next === this._images || (next.length === 0 && this._images.length === 0)) return;
    this._images = next;
    this.requestUpdate();
  }

  get role() { return this._role; }
  set role(val: "user" | "assistant" | "system") {
    if (this._role !== val) {
      this._role = val;
      this.requestUpdate();
    }
  }

  private _userAvatar?: string;
  private _agentAvatar?: string;
  private _userName?: string;
  private _agentShortName?: string;

  /** Every setter below returns early when the value is unchanged.
   *  The panel re-binds all of these on every render, including renders caused
   *  by something else entirely (a session title arriving from `autoTitle()`,
   *  a menu opening), so an unguarded write made every visible row re-render. */
  get userAvatar() { return this._userAvatar; }
  set userAvatar(val: string | undefined) { if (this._userAvatar === val) return; this._userAvatar = val; this.requestUpdate(); }
  get agentAvatar() { return this._agentAvatar; }
  set agentAvatar(val: string | undefined) { if (this._agentAvatar === val) return; this._agentAvatar = val; this.requestUpdate(); }
  get userName() { return this._userName; }
  set userName(val: string | undefined) { if (this._userName === val) return; this._userName = val; this.requestUpdate(); }

  get agentShortName() { return this._agentShortName; }
  set agentShortName(val: string | undefined) { if (this._agentShortName === val) return; this._agentShortName = val; this.requestUpdate(); }

  private _toolRenderers?: Map<string, ToolRenderer>;
  get toolRenderers() { return this._toolRenderers; }
  set toolRenderers(val: Map<string, ToolRenderer> | undefined) {
    if (this._toolRenderers === val) return;
    this._toolRenderers = val;
    this.requestUpdate();
  }

  private _toolPhrases?: Map<string, ToolPhraseDef>;
  get toolPhrases() { return this._toolPhrases; }
  set toolPhrases(val: Map<string, ToolPhraseDef> | undefined) {
    if (this._toolPhrases === val) return;
    this._toolPhrases = val;
    this.requestUpdate();
  }

  private _text = "";

  /** Lazy on purpose: `template()` sanitizes the text part with `sanitize()`,
   *  which is cached, so parsing here only duplicated that work for a value the
   *  following `.parts` write was about to replace anyway. */
  get text() { return this._text; }
  set text(val: string) {
    if (this._text !== val) {
      this._text = val;
      this._html = "";
      const keep = this._parts.filter((p) => p.kind !== "text");
      this._parts = val ? [{ kind: "text", text: val }, ...keep] : [...keep];
      this.requestUpdate();
    }
  }

  get html() {
    // Lazily derive the combined sanitized HTML from the current text parts
    // when no cached value is set, so a parts write does not need an eager
    // markdown pass here on top of the render pass in template().
    if (this._html) return this._html;
    return this._parts
      .filter((x): x is { kind: "text"; text: string; html?: string } => x.kind === "text")
      .map((x) => x.html ?? sanitize(x.text))
      .join("");
  }
  set html(val: string) {
    if (this._html !== val) {
      this._html = val;
      const keep = this._parts.filter((p) => p.kind !== "text");
      this._parts = val ? [{ kind: "text", text: "", html: val }, ...keep] : [...keep];
      this.requestUpdate();
    }
  }

  get trace() { return this._trace; }
  set trace(val: AuditEntry[] | undefined) {
    const next = val ?? [];
    const current = this._trace ?? [];
    if (next === current || (next.length === 0 && current.length === 0)) return;
    this._trace = val;
    this.requestUpdate();
  }

  get blocks() { return this._blocks; }
  set blocks(val: RenderableBlock[]) {
    const next = val ?? [];
    if (next === this._blocks || (next.length === 0 && this._blocks.length === 0)) return;
    this._blocks = next;
    // Rebuild parts: keep existing text parts, replace the trailing block parts.
    const textParts = this._parts.filter((p) => p.kind === "text");
    this._parts = [
      ...textParts,
      ...(this._blocks).map((b) => ({ kind: "block" as const, block: b })),
    ];
    this.requestUpdate();
  }

  get parts() { return this._parts; }
  set parts(val: MessagePart[] | undefined) {
    // Treat undefined as "leave derived _parts alone" so that the html setter
    // (called earlier in the same property-set batch for a plain-text-only
    // user message) is not clobbered.
    if (val === undefined) return;
    const p = val ?? [];
    if (p === this._parts || (p.length === 0 && this._parts.length === 0)) return;
    this._parts = p;
    // Invalidate the cached _html so get html() recomputes lazily; the only
    // markdown parse + sanitize pass runs in template() while rendering.
    this._html = "";
    this._text = p
      .filter((x): x is { kind: "text"; text: string; html?: string } => x.kind === "text")
      .map((x) => x.text)
      .join("");
    this._blocks = p
      .filter((x): x is { kind: "block"; block: RenderableBlock } => x.kind === "block")
      .map((x) => x.block);
    this.requestUpdate();
  }

  private _promptMeta?: Record<string, unknown>;
  private _attachmentChips: AttachmentChip[] = [];

  get promptMeta() { return this._promptMeta; }
  set promptMeta(val: Record<string, unknown> | undefined) {
    if (this._promptMeta === val) return;
    this._promptMeta = val;
    this._attachmentChips = readAttachmentChips(val);
    this.requestUpdate();
  }

  get disabled() { return this._disabled; }
  set disabled(val: boolean) {
    if (this._disabled !== val) {
      this._disabled = val;
      this.requestUpdate();
    }
  }

  get dataSource() { return this._dataSource; }
  set dataSource(val: DataSourceProvider | undefined) {
    if (this._dataSource === val) return;
    this._dataSource = val;
    this.requestUpdate();
  }

  get registry() { return this._registry; }
  set registry(val: BlockRendererRegistry | undefined) {
    if (this._registry === val) return;
    this._registry = val;
    this.requestUpdate();
  }

  static get observedAttributes() {
    return ["role", "html", "disabled"];
  }

  attributeChangedCallback(name: string, oldVal: string | null, newVal: string | null) {
    if (name === "role") {
      this.role = (newVal as "user" | "assistant" | "system" | null) || "user";
    } else if (name === "html") {
      this.html = newVal || "";
    } else if (name === "disabled") {
      this.disabled = newVal !== null;
    }
  }

  private _blockNode(block: RenderableBlock): Node {
    const cached = this._blockCache.get(block);
    if (cached && cached.registry === this.registry && cached.dataSource === this.dataSource) {
      if (cached.disabled === this.disabled) return cached.node;
      if ("disabled" in cached.node) {
        (cached.node as Node & { disabled: boolean }).disabled = this.disabled;
        cached.disabled = this.disabled;
        return cached.node;
      }
    }
    const node = renderBlocks([block], {
      registry: this.registry, disabled: this.disabled, dataSource: this.dataSource,
    })[0];
    this._blockCache.set(block, {
      node, registry: this.registry, dataSource: this.dataSource, disabled: this.disabled,
    });
    return node;
  }

  private _openImage(src: string, opener: HTMLElement) {
    opener.dispatchEvent(
      new CustomEvent("wa-image-open", {
        detail: { src },
        bubbles: true,
        composed: true,
      }),
    );
  }

  template() {
    const isUser = this.role === "user";
    const isAssistant = this.role === "assistant";
    const isSystem = this.role === "system";

    let containerClass = "message-container";
    if (isUser) containerClass += " user";
    if (isAssistant) containerClass += " assistant";
    if (isSystem) containerClass += " system";

    let rowClass = "message-row";
    if (isUser) rowClass += " user";
    if (isAssistant) rowClass += " assistant";
    if (isSystem) rowClass += " system";

    return html`
      ${this.closest("agent-chat-panel") ? "" : messageViewStyles}
      <div class=${rowClass}>
        <div class=${containerClass}>
        ${isUser && this._attachmentChips.length > 0
          ? html`<div class="pointed-chips attachment-chips" role="list" aria-label="Attachments">
              ${this._attachmentChips.map(
                (c) => html`<span class="pointed-chip" role="listitem" data-attachment-provider="${c.providerId}">${c.label}</span>`
              )}
            </div>`
          : ""}
        ${this._images && this._images.length > 0
          ? html`<div class="image-strip">
              ${this._images.map(
                (img) =>
                  html`<img
                    class="msg-thumbnail"
                    src="${img.dataUrl}"
                    alt="Attached image"
                    loading="lazy"
                    @click=${(e: Event) => this._openImage(img.dataUrl, e.currentTarget as HTMLElement)}
                  />`
              )}
            </div>`
          : ""}
        ${this._parts.length > 0
          ? this._parts.map((part, i) => {
              if (part.kind === "text")
                return html`<div class="content" data-part-idx=${i}>${unsafeHTML(part.html ?? sanitize(part.text))}</div>`;
              if (part.kind === "block")
                return html`<div class="blocks-container" data-part-idx=${i}>${this._blockNode(part.block)}</div>`;
              if (part.kind === "compaction") {
                const status = part.compaction.status;
                const stats = part.compaction.stats;
                if (status !== "done" || !stats) {
                  // Same agent-name resolution as a tool row (host's
                  // agentShortName, or "Agent"). Only "done" is bare; the
                  // other three carry a one-word suffix so the state is
                  // readable in greyscale, with no colour and no glyph
                  // carrying the meaning. "done" without stats is the reload
                  // fallback: compactionRows is in-memory, so a rehydrated
                  // session has the tombstone but no stats to show.
                  const phrase = compactionPhrase(this._agentShortName, status);
                  return html`<div
                    class="tool-step compaction-step"
                    data-compaction-status=${status}
                    title="Context compaction"
                  >
                    <span class="tool-step-icon" aria-hidden="true">⚙</span>
                    <span class="tool-step-phrase">${phrase}</span>
                  </div>`;
                }

                const durationStr = Math.round(stats.durationMs).toLocaleString("en-US");
                const messagesBeforeStr = `${stats.messagesBefore.toLocaleString("en-US")} ${stats.messagesBefore === 1 ? "message" : "messages"}`;
                const messagesAfterStr = `${stats.messagesAfter.toLocaleString("en-US")} ${stats.messagesAfter === 1 ? "message" : "messages"}`;
                const tokensBeforeStr = Math.round(stats.tokensBefore).toLocaleString("en-US");
                const tokensAfterStr = Math.round(stats.tokensAfter).toLocaleString("en-US");
                const toolCallsStr = `${stats.toolCallsRedacted.toLocaleString("en-US")} ${stats.toolCallsRedacted === 1 ? "tool call" : "tool calls"} redacted`;

                return html`<div
                  class="compaction-step compaction-card"
                  data-compaction-status="done"
                  title="Context compaction"
                >
                  <div class="compaction-card-line1">Compaction done in ${durationStr} ms</div>
                  <div class="compaction-card-line2">
                    ${messagesBeforeStr} → ${messagesAfterStr}, ${tokensBeforeStr} tokens → ${tokensAfterStr} tokens, ${toolCallsStr}
                  </div>
                </div>`;
              }
              // kind === "tool" — compact inline step row (self-contained, no data-part-idx)
              const a = part.audit;
              // Precedence: custom renderer HTML (defined, call completed, non-empty
              // after sanitize) > 062a friendly phrase > default. In-progress steps
              // (empty outcomeSummary) skip the renderer and use the phrase.
              let customHtml = "";
              if (a && a.outcomeSummary) {
                const renderer = this._toolRenderers?.get(a.name);
                if (renderer) {
                  const rawInput =
                    a.input && typeof a.input === "object"
                      ? (a.input as Record<string, unknown>)
                      : {};
                  try {
                    customHtml = sanitizeToolHtml(renderer(rawInput, a.outcomeSummary));
                  } catch (err) {
                    console.error("Tool renderer error", err);
                    customHtml = "";
                  }
                }
              }
              const phrase = a ? toolStepPhrase(a, this._agentShortName, this._toolPhrases) : "";
              const saved = a ? parseSavedOutput(a.outcomeSummary) : null;
              const wrapSavedPhrase = !customHtml && saved?.saved === true && !!saved.path;
              const imgs = a?.images ?? [];
              return html`
                <div class="tool-step" title="${a?.name ?? ""}">
                  <span class="tool-step-icon" aria-hidden="true">⚙</span>
                  <span class=${wrapSavedPhrase ? "tool-step-phrase saved-output-phrase" : "tool-step-phrase"}
                    >${customHtml ? unsafeHTML(customHtml) : phrase}</span
                  >
                </div>
                ${imgs.length > 0
                  ? html`<div class="tool-image-strip">
                      ${imgs.map(
                        (img, idx) =>
                          html`<button
                            type="button"
                            class="tool-thumb"
                            aria-label=${`Open image ${idx + 1} from ${phrase}`}
                            @click=${(e: Event) => this._openImage(img.dataUrl, e.currentTarget as HTMLElement)}
                          >
                            <img src=${img.dataUrl} alt="" loading="lazy" />
                          </button>`,
                      )}
                    </div>`
                  : ""}
              `;
            })
          : nothing}
        </div>
      </div>
    `;
  }
}

if (!customElements.get("agent-message-view")) {
  customElements.define("agent-message-view", AgentMessageView);
}
