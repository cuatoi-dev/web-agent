import { WaElement } from "./wa-element-base.js";
import { iconNode } from "./icon-svgs.js";
import { WaMenu } from "./wa-menu.js";
import { WaTextInput, WaTextArea } from "./wa-text-fields.js";
import type { WaButtonVariant, WaElementEntry } from "./types.js";

export class WaButton extends WaElement {
  static get observedAttributes() { return ["label", "variant"]; }
  private _label = "";
  private _variant: WaButtonVariant = "primary";
  private _disabled = false;
  get label() { return this._label; }
  set label(v: string) { if (v === this._label) return; this._label = v; if (this._inner) this.sync(); }
  get variant() { return this._variant; }
  set variant(v: WaButtonVariant) { if (v === this._variant) return; this._variant = v; if (this._inner) this.sync(); }
  get disabled() { return this._disabled; }
  set disabled(v: boolean) { if (v === this._disabled) return; this._disabled = v; if (this._inner) this.sync(); }
  protected build(): HTMLElement {
    const b = document.createElement("button");
    b.addEventListener("click", (e) => {
      if (this._disabled) { e.preventDefault(); e.stopPropagation(); return; }
      this.fire("press");
    });
    return b;
  }
  protected sync(): void {
    const b = this._inner as HTMLButtonElement;
    b.className = this._variant === "secondary" ? "border wa-btn wa-btn-secondary"
      : this._variant === "danger" ? "error wa-btn wa-btn-danger"
      : "primary wa-btn wa-btn-primary";
    if (b.textContent !== this._label) b.textContent = this._label;
    b.disabled = this._disabled;
    b.classList.toggle("disabled", this._disabled);
  }
}

export class WaIconButton extends WaElement {
  static get observedAttributes() { return ["icon", "label"]; }
  private _icon = "";
  private _label = "";
  private _disabled = false;
  private _drawnIcon: string | null = null;
  get icon() { return this._icon; }
  set icon(v: string) { if (v === this._icon) return; this._icon = v; if (this._inner) this.sync(); }
  get label() { return this._label; }
  set label(v: string) { if (v === this._label) return; this._label = v; if (this._inner) this.sync(); }
  get disabled() { return this._disabled; }
  set disabled(v: boolean) { if (v === this._disabled) return; this._disabled = v; if (this._inner) this.sync(); }
  protected build(): HTMLElement {
    const b = document.createElement("button");
    b.className = "circle transparent wa-icon-btn";
    b.addEventListener("click", () => { if (!this._disabled) this.fire("press"); });
    return b;
  }
  protected sync(): void {
    const b = this._inner as HTMLButtonElement;
    b.disabled = this._disabled;
    b.setAttribute("aria-label", this._label);
    if (this._drawnIcon !== this._icon) {
      b.replaceChildren(iconNode(this._icon));
      this._drawnIcon = this._icon;
    }
  }
}

export class WaIcon extends WaElement {
  static get observedAttributes() { return ["name", "label"]; }
  private _name = "";
  private _label = "";
  private _drawnName: string | null = null;
  get name() { return this._name; }
  set name(v: string) { if (v === this._name) return; this._name = v; if (this._inner) this.sync(); }
  get label() { return this._label; }
  set label(v: string) { if (v === this._label) return; this._label = v; if (this._inner) this.sync(); }
  protected build(): HTMLElement { const span = document.createElement("span"); span.className = "wa-icon"; return span; }
  protected sync(): void {
    const span = this._inner!;
    if (this._label) {
      span.setAttribute("aria-label", this._label);
      span.setAttribute("role", "img");
      span.removeAttribute("aria-hidden");
    } else {
      span.removeAttribute("aria-label");
      span.removeAttribute("role");
      span.setAttribute("aria-hidden", "true");
    }
    if (this._drawnName !== this._name) {
      span.replaceChildren(iconNode(this._name));
      this._drawnName = this._name;
    }
  }
}

export class WaCheckbox extends WaElement {
  static get observedAttributes() { return ["label"]; }
  private _checked = false;
  private _label = "";
  private _disabled = false;
  private _input: HTMLInputElement | null = null;
  private _text: HTMLSpanElement | null = null;
  get checked() { return this._checked; }
  set checked(v: boolean) { if (v === this._checked) return; this._checked = v; if (this._inner) this.sync(); }
  get label() { return this._label; }
  set label(v: string) { if (v === this._label) return; this._label = v; if (this._inner) this.sync(); }
  get disabled() { return this._disabled; }
  set disabled(v: boolean) { if (v === this._disabled) return; this._disabled = v; if (this._inner) this.sync(); }
  protected build(): HTMLElement {
    const wrapper = document.createElement("label");
    wrapper.className = "checkbox wa-checkbox-label";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "wa-checkbox";
    input.addEventListener("change", () => {
      this._checked = input.checked;
      this.fire("checked-change", { checked: input.checked });
    });
    const span = document.createElement("span");
    wrapper.append(input, span);
    this._input = input;
    this._text = span;
    return wrapper;
  }
  protected sync(): void {
    this._input!.checked = this._checked;
    this._input!.disabled = this._disabled;
    if (this._text!.textContent !== this._label) this._text!.textContent = this._label;
  }
}

export class WaProgress extends WaElement {
  private _indeterminate = false;
  get indeterminate() { return this._indeterminate; }
  set indeterminate(v: boolean) { if (v === this._indeterminate) return; this._indeterminate = v; if (this._inner) this.sync(); }
  protected build(): HTMLElement { const p = document.createElement("progress"); p.className = "primary wa-progress"; return p; }
  protected sync(): void {
    const p = this._inner as HTMLProgressElement;
    if (this._indeterminate) p.removeAttribute("value"); else p.value = 0;
  }
}

/** The three dot transforms one pulse step shows, in source order. Cycled by
 *  `WaWorkingDots` and `AcmeWorkingDots` on a timer instead of a CSS
 *  `@keyframes` animation, which would keep the compositor-synchronised
 *  `DocumentAnimations` step running on the main thread for the whole turn.
 *  Prebuilt strings, so a frame writes no template literal. */
const DOT_REST_FRAMES: readonly [string, string, string] = ["scale(1)", "scale(1)", "scale(1)"];
const DOT_FRAMES: readonly (readonly [string, string, string])[] = [
  ["scale(1)", "scale(0.35)", "scale(0.2)"],
  ["scale(0.35)", "scale(1)", "scale(0.35)"],
  ["scale(0.2)", "scale(0.35)", "scale(1)"],
  ["scale(0.2)", "scale(0.2)", "scale(0.2)"],
];

/** One pulse step every 350 ms: four steps make the original 1.4 s cycle. */
const DOT_PULSE_MS = 350;

export class WaWorkingDots extends WaElement {
  private _fadeTimer: ReturnType<typeof setTimeout> | null = null;
  private _pulseTimer: ReturnType<typeof setInterval> | null = null;
  private _dots: HTMLSpanElement[] = [];
  private _step = 0;

  protected build(): HTMLElement {
    const el = document.createElement("div");
    el.className = "wa-working-dots";
    const d0 = document.createElement("span");
    const d1 = document.createElement("span");
    const d2 = document.createElement("span");
    this._dots = [d0, d1, d2];
    el.append(d0, d1, d2);
    return el;
  }

  connectedCallback(): void {
    super.connectedCallback();
    this._stopTimers();
    const wrap = this._inner;
    if (!wrap) return;
    wrap.style.opacity = "0";
    this._fadeTimer = setTimeout(() => {
      this._fadeTimer = null;
      wrap.style.opacity = "1";
    }, 400);
    const reduced =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      this._applyFrame(DOT_REST_FRAMES);
      return;
    }
    this._step = 0;
    this._applyFrame(DOT_FRAMES[0]);
    this._pulseTimer = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      this._step = (this._step + 1) % DOT_FRAMES.length;
      this._applyFrame(DOT_FRAMES[this._step]);
    }, DOT_PULSE_MS);
  }

  disconnectedCallback(): void {
    this._stopTimers();
  }

  /** `_freezeOlderDots()` (chat-ui/chat-panel-state.ts) parks a dot by setting
   *  its inline `animation` to `none`; a frozen dot keeps its parked scale.
   *  The cached spans and prebuilt transform strings keep a tick off both the
   *  DOM query and the string allocation, and a dot whose scale did not change
   *  gets no style write at all. */
  private _applyFrame(transforms: readonly [string, string, string]): void {
    const dots = this._dots;
    for (let i = 0; i < dots.length; i++) {
      const dot = dots[i];
      if (dot.style.animation === "none") continue;
      const next = transforms[i];
      if (dot.style.transform !== next) dot.style.transform = next;
    }
  }

  private _stopTimers(): void {
    if (this._fadeTimer !== null) {
      clearTimeout(this._fadeTimer);
      this._fadeTimer = null;
    }
    if (this._pulseTimer !== null) {
      clearInterval(this._pulseTimer);
      this._pulseTimer = null;
    }
  }

  protected sync(): void {}
}

/** Every tag of the default registry. */
export const DEFAULT_ELEMENTS: readonly WaElementEntry[] = [
  ["wa-button", WaButton],
  ["wa-icon-button", WaIconButton],
  ["wa-icon", WaIcon],
  ["wa-checkbox", WaCheckbox],
  ["wa-menu", WaMenu],
  ["wa-text-input", WaTextInput],
  ["wa-text-area", WaTextArea],
  ["wa-progress", WaProgress],
  ["wa-working-dots", WaWorkingDots],
];
