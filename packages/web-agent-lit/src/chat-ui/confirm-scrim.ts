import { defineUiElements } from "../ui/registry.js";
import type { ConfirmScrimDetail } from "./types.js";

export type { ConfirmScrimDetail };

defineUiElements();

// Keep the outlined button label on the theme text token. The default
// secondary-button rule uses the accent, which has insufficient text contrast
// on the dialog card. Match both classes to override that rule.
const SCRIM_BUTTON_STYLES = `
  .wa-confirm-card .wa-btn.wa-btn-secondary,
  .wa-confirm-card md-outlined-button {
    color: var(--wa-text-color, #202124);
    border-color: var(--wa-outline-color, #79747e);
    --md-outlined-button-label-text-color: var(--wa-text-color, #202124);
    --md-outlined-button-hover-label-text-color: var(--wa-text-color, #202124);
    --md-outlined-button-focus-label-text-color: var(--wa-text-color, #202124);
    --md-outlined-button-pressed-label-text-color: var(--wa-text-color, #202124);
    --md-outlined-button-outline-color: var(--wa-outline-color, #79747e);
    --md-outlined-button-hover-outline-color: var(--wa-outline-color, #79747e);
    --md-outlined-button-pressed-outline-color: var(--wa-outline-color, #79747e);
  }
`;

export function createConfirmScrim(panelEl: HTMLElement): (detail: ConfirmScrimDetail) => Promise<boolean> {
  let currentScrim: HTMLElement | null = null;
  let currentResolve: ((v: boolean) => void) | null = null;
  let currentKeyHandler: ((e: KeyboardEvent) => void) | null = null;

  return (detail) => {
    if (currentResolve) {
      const r = currentResolve;
      cleanup();
      r(false);
    }

    return new Promise<boolean>((resolve) => {
      currentResolve = resolve;

      const backdrop = document.createElement("div");
      backdrop.className = "wa-confirm-scrim";
      backdrop.style.cssText = [
        "position: absolute",
        "inset: 0",
        "background: var(--wa-black-color-50opc, rgba(0, 0, 0, 0.5))",
        "z-index: 10000",
        "display: flex",
        "align-items: center",
        "justify-content: center",
        "padding: 16px",
        "box-sizing: border-box",
      ].join(";");

      // The sheet lives inside the scrim, so it reaches the card in whatever
      // tree the panel is in, and `cleanup()` removes it with the dialog.
      const scrimStyle = document.createElement("style");
      scrimStyle.textContent = SCRIM_BUTTON_STYLES;
      backdrop.appendChild(scrimStyle);

      const card = document.createElement("div");
      card.className = "wa-confirm-card";
      card.setAttribute("role", "dialog");
      card.setAttribute("aria-modal", "true");
      card.setAttribute("aria-labelledby", "wa-confirm-title");
      card.style.cssText = [
        "background: var(--wa-dialog-background-color, white)",
        "border-radius: 12px",
        "padding: 20px",
        "box-shadow: var(--wa-dialog-box-shadow, 0 4px 24px rgba(0,0,0,0.2))",
        "max-width: 320px",
        "width: 100%",
        "display: flex",
        "flex-direction: column",
        "gap: 12px",
      ].join(";");

      const title = document.createElement("h3");
      title.id = "wa-confirm-title";
      title.style.cssText = "margin: 0; font-size: 1.1em; color: var(--wa-text-color, #333);";
      title.textContent = detail.title ?? "Confirm action";
      card.appendChild(title);

      const desc = document.createElement("p");
      desc.style.cssText = "margin: 0; font-size: 0.95em; color: var(--wa-text-color, #555);";
      // The summary, name and ref come from the model or the page (a skill
      // name, a tab title, an element's accessible name), so they are set as
      // text. Parsing them as HTML would let that text inject markup.
      const strong = (text: string) => {
        const el = document.createElement("strong");
        el.textContent = text;
        return el;
      };
      if (detail.message !== undefined) {
        // 120/002 — a host-written body, set as text like every other string here.
        desc.textContent = detail.message;
      } else if (detail.summary) {
        desc.append("Agent wants to: ", strong(detail.summary), ".");
      } else {
        desc.append(
          "Agent wants to perform ",
          strong(detail.action ?? ""),
          " on ",
          strong(detail.name || detail.ref || ""),
          ".",
        );
      }
      card.appendChild(desc);

      if (detail.reason) {
        const reasonEl = document.createElement("p");
        reasonEl.className = "wa-confirm-reason";
        reasonEl.style.cssText = "margin: 0; font-size: 0.85em; color: color-mix(in oklab, var(--wa-text-color, #202124) 40%, var(--wa-label-color, #666) 60%); background: var(--wa-background-color-300, #f5f5f5); padding: var(--wa-padding-m, 8px); border-radius: 6px;"; // eslint-disable-line wa/no-raw-spacing -- 6px is not on the theme border-radius ladder (between --wa-border-radius-m 4px and --wa-border-radius-l 8px); tokenizing would snap the rendered value and change the layout.
        reasonEl.textContent = `Reason: ${detail.reason}`;
        card.appendChild(reasonEl);
      }

      const btnRow = document.createElement("div");
      btnRow.style.cssText = "display: flex; justify-content: flex-end; gap: var(--wa-padding-m, 8px); margin-top: var(--wa-padding-m, 8px);";

      const rejectBtn = document.createElement("wa-button") as HTMLElement & {
        label: string; variant: string;
      };
      rejectBtn.label = detail.cancelLabel ?? "Reject";
      rejectBtn.variant = "secondary";
      rejectBtn.addEventListener("press", () => {
        cleanup();
        resolve(false);
      });

      const allowBtn = document.createElement("wa-button") as HTMLElement & {
        label: string; variant: string;
      };
      allowBtn.label = detail.confirmLabel ?? "Allow";
      allowBtn.variant = detail.danger ? "danger" : "primary";
      allowBtn.addEventListener("press", () => {
        cleanup();
        resolve(true);
      });

      btnRow.appendChild(rejectBtn);
      btnRow.appendChild(allowBtn);
      card.appendChild(btnRow);
      backdrop.appendChild(card);

      currentKeyHandler = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          e.preventDefault();
          cleanup();
          resolve(false);
        }
      };
      window.addEventListener("keydown", currentKeyHandler);

      panelEl.appendChild(backdrop);
      currentScrim = backdrop;
    });
  };

  function cleanup() {
    if (currentKeyHandler) {
      window.removeEventListener("keydown", currentKeyHandler);
      currentKeyHandler = null;
    }
    if (currentScrim && currentScrim.parentNode) {
      currentScrim.parentNode.removeChild(currentScrim);
    }
    currentScrim = null;
    currentResolve = null;
  }
}
