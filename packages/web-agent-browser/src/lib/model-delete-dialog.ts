function showDialog(dialog: HTMLDialogElement): void {
  if (typeof dialog.showModal === "function") {
    dialog.showModal();
  } else {
    dialog.setAttribute("open", "");
  }
}

/** Opens the multi-select model delete confirmation dialog (mockup state 2)
 *  and resolves `true` when the user clicks "Delete", or `false` on "Cancel",
 *  Escape, or backdrop close. */
export function openModelDeleteDialog(titleText: string, messageText: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "confirm-dialog model-delete-dialog";

    const heading = document.createElement("h2");
    heading.textContent = titleText;

    const message = document.createElement("p");
    message.className = "model-delete-message";
    message.textContent = messageText;

    const actions = document.createElement("div");
    actions.className = "actions dialog-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn cancel-btn";
    cancelBtn.textContent = "Cancel";

    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "btn danger confirm-delete-btn";
    confirmBtn.textContent = "Delete";

    actions.append(cancelBtn, confirmBtn);
    dialog.append(heading, message, actions);
    document.body.append(dialog);

    let settled = false;
    const finish = (confirmed: boolean): void => {
      if (settled) return;
      settled = true;
      if (typeof dialog.close === "function" && dialog.open) {
        dialog.close();
      }
      dialog.remove();
      resolve(confirmed);
    };

    cancelBtn.addEventListener("click", () => finish(false));
    confirmBtn.addEventListener("click", () => finish(true));
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      finish(false);
    });
    dialog.addEventListener("close", () => finish(false));

    showDialog(dialog);
    cancelBtn.focus();
  });
}
