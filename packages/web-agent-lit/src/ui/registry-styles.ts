/** Rules for the primitives the default registry builds (`ui/registry.ts`).
 *
 *  They live here, and not in `ui/registry.ts`, for two reasons:
 *  - CSS rules are tree-scoped, so the panel renders them as a `<style>` inside
 *    itself and they reach the panel wherever a host mounts it, shadow root
 *    included. Nothing is written to `document.head`.
 *  - `apps/cat-store/webpack.config.js` replaces any request ending in
 *    `ui/registry.js`. A constant exported from that module would be `undefined`
 *    in the cat-store bundle; this file's request does not match that pattern.
 */
export const REGISTRY_STYLES = `
.wa-btn {
  font-family: inherit;
  font-size: 1rem;
  padding: var(--wa-padding-m, 8px) var(--wa-padding-xl, 16px);
  border-radius: var(--wa-border-radius-l, 8px);
  border: 1px solid var(--wa-border-color, #c4c7c5);
  background-color: var(--wa-action-color-info, #1a73e8);
  color: var(--wa-action-text-color-info, #ffffff);
  cursor: pointer;
  box-sizing: border-box;
}
.wa-btn:hover:not(:disabled) {
  background-color: color-mix(in srgb, var(--wa-action-color-info, #1a73e8) 85%, var(--wa-black-color, #000000));
}
.wa-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.wa-btn.wa-btn-secondary {
  background-color: transparent;
  color: var(--wa-action-color-info, #1a73e8);
  border: 1px solid var(--wa-action-color-info, #1a73e8);
}
.wa-btn.wa-btn-secondary:hover:not(:disabled) {
  background-color: var(--wa-action-color-info-10opc, rgba(26, 115, 232, 0.1));
}
.wa-btn.wa-btn-danger {
  background-color: var(--wa-action-color-error, #d93025);
  color: var(--wa-action-text-color-error, #ffffff);
  border-color: var(--wa-action-color-error, #d93025);
}
.wa-btn.wa-btn-danger:hover:not(:disabled) {
  background-color: color-mix(in srgb, var(--wa-action-color-error, #d93025) 85%, var(--wa-black-color, #000000));
}

.wa-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  padding: 0;
  box-sizing: border-box;
  outline: none;
}
.wa-icon-btn:hover {
  background-color: var(--wa-action-color-info-10opc, rgba(0, 0, 0, 0.05));
}
.wa-icon-btn:focus-visible {
  outline: 2px solid var(--wa-text-color, #c4c7c5);
  outline-offset: 2px;
}
.wa-icon-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.wa-menu-item {
  background: none;
}
.wa-menu-item:hover:not(:disabled),
.wa-menu-item:focus-visible:not(:disabled) {
  background-color: var(--wa-dropdown-item-hover-background-color, rgba(26, 115, 232, 0.1));
}

.wa-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  vertical-align: middle;
  line-height: 1;
  color: inherit;
}
.wa-icon svg {
  width: 1em;
  height: 1em;
  fill: currentColor;
}
.wa-menu-icon {
  font-size: var(--wa-icon-size-m);
  margin-inline-end: var(--wa-padding-m);
}
.wa-icon-btn svg {
  display: block;
}

.wa-input-container {
  display: flex;
  align-items: center;
  border: 1px solid var(--wa-border-color, #c4c7c5);
  border-radius: var(--wa-border-radius-l, 8px);
  padding: var(--wa-padding-s, 4px) var(--wa-padding-m, 8px);
  background-color: var(--wa-input-background-color, #ffffff);
  box-sizing: border-box;
}
.wa-input-container.disabled {
  background-color: var(--wa-background-color-500, #f1f3f4);
  opacity: 0.7;
}
.wa-input {
  flex: 1;
  border: none;
  background: transparent;
  outline: none;
  font-family: inherit;
  font-size: 1rem;
  padding: 6px var(--wa-padding-s, 4px);${/* eslint-disable-line wa/no-raw-spacing -- 6px is not on the theme spacing ladder (between --wa-padding-s 4px and --wa-padding-m 8px); tokenizing would snap the rendered value and change the layout. */ ""}
  color: inherit;
}
.wa-input:disabled {
  cursor: not-allowed;
}
.wa-textarea {
  flex: 1;
  border: none;
  background: transparent;
  outline: none;
  font-family: inherit;
  font-size: 1rem;
  padding: 6px var(--wa-padding-s, 4px);${/* eslint-disable-line wa/no-raw-spacing -- 6px is not on the theme spacing ladder (between --wa-padding-s 4px and --wa-padding-m 8px); tokenizing would snap the rendered value and change the layout. */ ""}
  color: inherit;
  resize: none;
  box-sizing: border-box;
  overflow-y: hidden;
  line-height: 1.4;
  height: auto;
}
.wa-textarea::placeholder {
  color: var(--wa-input-placeholder-color);
}
.wa-textarea:disabled {
  cursor: not-allowed;
}

.wa-checkbox-label {
  display: inline-flex;
  align-items: center;
  gap: var(--wa-padding-m, 8px);
  cursor: pointer;
  user-select: none;
  font-family: inherit;
  font-size: 1rem;
}
.wa-checkbox {
  cursor: pointer;
  width: 18px;
  height: 18px;
}

.wa-progress {
  width: 100%;
  height: 4px;
}

.wa-working-dots {
  display: flex;
  gap: var(--wa-padding-s, 4px);
  padding: var(--wa-padding-l, 12px) var(--wa-padding-xl, 16px);
  align-items: center;
  animation: wa-fade-in 0.2s 400ms both;
}
.wa-working-dots span {
  /* Foreground token, not the border token: --wa-border-color is a line
     colour and sits within 1.25:1-1.82:1 of --wa-background-color in every
     shipped theme, which made the dots invisible (task 017). */
  width: 6px; height: 6px; border-radius: 50%; background: var(--wa-text-color, #c4c7c5);
  animation: wa-bounce 1.4s infinite ease-in-out both;
}
.wa-working-dots span:nth-child(1) { animation-delay: -0.32s; }
.wa-working-dots span:nth-child(2) { animation-delay: -0.16s; }
@keyframes wa-bounce { 0%, 80%, 100% { transform: scale(0); } 40% { transform: scale(1); } }
@keyframes wa-fade-in { from { opacity: 0; } to { opacity: 1; } }
`;
