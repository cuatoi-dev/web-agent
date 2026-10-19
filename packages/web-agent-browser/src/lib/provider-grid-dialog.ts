import { BUILT_IN, CUSTOM_TILE, providerIconNode } from "./provider-builtins";

import type { ProviderGridChoice } from "./provider-grid-dialog.types";

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** Same fallback as provider-dialog.ts: not every DOM implements `showModal`,
 *  and a plain `open` attribute still shows the dialog. */
function showDialog(dialog: HTMLDialogElement): void {
  if (typeof dialog.showModal === "function") {
    dialog.showModal();
  } else {
    dialog.setAttribute("open", "");
  }
}

/** Opens the "Add model" grid: the seven built-in providers
 *  in order, then Custom. Resolves with the choice, or `null` when cancelled.
 *  One tile is selected at a time and Next stays disabled until one is. */
export function openProviderGrid(): Promise<ProviderGridChoice | null> {
  return new Promise<ProviderGridChoice | null>((resolve) => {
    const dialog = el("dialog", "confirm-dialog provider-grid-dialog");
    const heading = el("h2", "", "Add model");
    const actions = el("div", "actions dialog-actions");
    const cancelBtn = el("button", "btn cancel-btn", "Cancel");
    cancelBtn.type = "button";
    const nextBtn = el("button", "btn primary next-btn", "Next");
    nextBtn.type = "button";
    nextBtn.disabled = true;
    actions.append(cancelBtn, nextBtn);

    const grid = el("div", "provider-grid");
    const tiles: HTMLButtonElement[] = [];
    let selected: string | null = null;
    const definitions = [...BUILT_IN.map((p) => ({ id: p.id, name: p.name })), CUSTOM_TILE];
    for (const definition of definitions) {
      const tile = el("button", "provider-tile");
      tile.type = "button";
      tile.dataset.builtIn = definition.id;
      tile.setAttribute("aria-pressed", "false");
      tile.append(
        providerIconNode(definition.id === CUSTOM_TILE.id ? undefined : definition.id),
        el("span", "tile-label", definition.name),
      );
      tile.addEventListener("click", () => {
        selected = definition.id;
        for (const other of tiles) other.setAttribute("aria-pressed", String(other === tile));
        nextBtn.disabled = false;
      });
      tiles.push(tile);
      grid.append(tile);
    }

    dialog.append(heading, grid, actions);
    document.body.append(dialog);

    let settled = false;
    const finish = (result: ProviderGridChoice | null): void => {
      if (settled) return;
      settled = true;
      if (typeof dialog.close === "function" && dialog.open) dialog.close();
      dialog.remove();
      resolve(result);
    };

    nextBtn.addEventListener("click", () => {
      if (selected === null) return;
      finish(selected === CUSTOM_TILE.id ? "custom" : { builtIn: selected });
    });
    cancelBtn.addEventListener("click", () => finish(null));
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      finish(null);
    });
    dialog.addEventListener("close", () => finish(null));

    showDialog(dialog);
  });
}
