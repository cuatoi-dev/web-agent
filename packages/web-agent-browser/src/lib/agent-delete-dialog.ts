import type { DeleteDialogResult } from "./agent-editor.types";
import { DELETE_AGENT_LABEL } from "./agent-edit-form";

export const DELETE_DIALOG_ID = "delete-agent-dialog";

/** Opens a modal `<dialog>` with `message`, a Cancel button and a Delete agent
 *  button, focus on Cancel. Resolves when the user chooses. Cancel and Escape
 *  close the dialog before resolving; on Delete agent the caller closes it
 *  after its writes (the design's order). The message is set with
 *  `textContent`: it holds a display name the user typed. */
export function openDeleteDialog(message: string): Promise<DeleteDialogResult> {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.id = DELETE_DIALOG_ID;
    dialog.className = "confirm-dialog";
    dialog.setAttribute("aria-labelledby", `${DELETE_DIALOG_ID}-message`);

    const text = document.createElement("p");
    text.id = `${DELETE_DIALOG_ID}-message`;
    text.textContent = message;

    const row = document.createElement("div");
    row.className = "row dialog-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn dialog-cancel-btn";
    cancel.textContent = "Cancel";
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "btn danger dialog-delete-btn";
    confirm.textContent = DELETE_AGENT_LABEL;
    row.append(cancel, confirm);
    dialog.append(text, row);

    let closed = false;
    const close = (): void => {
      if (closed) return;
      closed = true;
      if (dialog.open) dialog.close();
      dialog.remove();
    };
    let settled = false;
    const settle = (confirmed: boolean): void => {
      if (settled) return;
      settled = true;
      if (!confirmed) close();
      resolve({ confirmed, close });
    };

    cancel.addEventListener("click", () => settle(false));
    confirm.addEventListener("click", () => settle(true));
    // Escape fires `cancel`. Prevent the native close so `close()` above is
    // the only path that removes the element.
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      settle(false);
    });

    document.body.append(dialog);
    dialog.showModal();
    cancel.focus();
  });
}
