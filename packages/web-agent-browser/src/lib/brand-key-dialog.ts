import type { BrandKeyDialogOptions } from "./types";

export const KEY_DIALOG_ID = "brand-key-dialog";
export const KEY_FIELD_LABEL = "API key (optional)";
export const KEY_PLACEHOLDER_PROVIDED = "Leave empty to use the provided key";
export const KEY_PLACEHOLDER_NONE = "Leave empty to send no key";
export const KEY_HINT_PROVIDED = "This key replaces the provided key for this endpoint only.";
export const KEY_HINT_NONE = "This key is sent to this endpoint only.";

export function keyDialogTitle(name: string, wireFormat: string): string {
  return `Key for ${name} (${wireFormat})`;
}

/** Opens a modal with one password field. Resolves the field's value on
 *  Save and null on Cancel or Escape; the dialog is removed either way. The
 *  caller trims and stores the value (mockup state 7). */
export function openBrandKeyDialog(opts: BrandKeyDialogOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.id = KEY_DIALOG_ID;
    dialog.className = "confirm-dialog key-dialog";
    dialog.setAttribute("aria-labelledby", `${KEY_DIALOG_ID}-title`);

    const title = document.createElement("h2");
    title.id = `${KEY_DIALOG_ID}-title`;
    title.textContent = keyDialogTitle(opts.name, opts.wireFormat);
    const endpoint = document.createElement("p");
    endpoint.className = "hint key-endpoint";
    endpoint.textContent = opts.endpoint;
    const label = document.createElement("label");
    label.htmlFor = `${KEY_DIALOG_ID}-input`;
    label.textContent = KEY_FIELD_LABEL;
    const input = document.createElement("input");
    input.id = `${KEY_DIALOG_ID}-input`;
    input.type = "password";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.placeholder = opts.hasBrandKey ? KEY_PLACEHOLDER_PROVIDED : KEY_PLACEHOLDER_NONE;
    input.value = opts.current;
    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = opts.hasBrandKey ? KEY_HINT_PROVIDED : KEY_HINT_NONE;

    const row = document.createElement("div");
    row.className = "row dialog-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn dialog-cancel-btn";
    cancel.textContent = "Cancel";
    const save = document.createElement("button");
    save.type = "button";
    save.className = "btn primary dialog-save-btn";
    save.textContent = "Save";
    row.append(cancel, save);
    dialog.append(title, endpoint, label, input, hint, row);

    let done = false;
    const finish = (value: string | null): void => {
      if (done) return;
      done = true;
      if (dialog.open) dialog.close();
      dialog.remove();
      resolve(value);
    };
    cancel.addEventListener("click", () => finish(null));
    save.addEventListener("click", () => finish(input.value));
    // Escape fires `cancel`; the native close is prevented so finish() is
    // the only path that removes the element.
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      finish(null);
    });

    document.body.append(dialog);
    dialog.showModal();
    input.focus();
  });
}
