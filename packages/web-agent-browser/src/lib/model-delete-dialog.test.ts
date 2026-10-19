// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { openModelDeleteDialog } from "./model-delete-dialog";

describe("openModelDeleteDialog", () => {
  it("shows the title, message and a danger Delete button", async () => {
    const p = openModelDeleteDialog("Delete 2 models?", "This removes A and B.");
    const dialog = document.querySelector("dialog.model-delete-dialog")!;
    expect(dialog.querySelector("h2")?.textContent).toBe("Delete 2 models?");
    expect(dialog.querySelector(".model-delete-message")?.textContent).toBe("This removes A and B.");
    expect(dialog.querySelector(".btn.danger")?.textContent).toBe("Delete");
    dialog.querySelector<HTMLButtonElement>(".cancel-btn")!.click();
    expect(await p).toBe(false);
    expect(document.querySelector("dialog")).toBeNull();
  });

  it("resolves true on Delete", async () => {
    const p = openModelDeleteDialog("t", "m");
    document.querySelector<HTMLButtonElement>(".confirm-delete-btn")!.click();
    expect(await p).toBe(true);
  });

  it("resolves false on the cancel event", async () => {
    const p = openModelDeleteDialog("t", "m");
    document.querySelector("dialog")!.dispatchEvent(new Event("cancel", { cancelable: true }));
    expect(await p).toBe(false);
  });
});
