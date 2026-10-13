import { beforeAll, describe, expect, it } from "vitest";
import { openDeleteDialog } from "./agent-delete-dialog";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});

describe("openDeleteDialog", () => {
  it("DD1 opens a modal with the message as text and focus on Cancel", () => {
    void openDeleteDialog("Delete <b>x</b>? Its chat history and its 1 private skill are deleted too.");
    const dialog = document.getElementById("delete-agent-dialog") as HTMLDialogElement;
    expect(dialog).not.toBeNull();
    expect(dialog.open).toBe(true);
    const p = dialog.querySelector("p")!;
    expect(p.textContent).toBe("Delete <b>x</b>? Its chat history and its 1 private skill are deleted too.");
    expect(dialog.querySelector("b")).toBeNull();
    expect([...dialog.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Cancel", "Delete agent"]);
    expect(document.activeElement).toBe(dialog.querySelector(".dialog-cancel-btn"));
    expect(dialog.getAttribute("aria-labelledby")).toBe(p.id);
    document.body.textContent = "";
  });

  it("DD2 Cancel resolves confirmed false and removes the dialog", async () => {
    document.body.textContent = "";
    const pending = openDeleteDialog("m");
    document.querySelector<HTMLButtonElement>(".dialog-cancel-btn")!.click();
    const r = await pending;
    expect(r.confirmed).toBe(false);
    expect(document.getElementById("delete-agent-dialog")).toBeNull();
  });

  it("DD3 the cancel event (Escape) resolves false, is prevented, and removes the dialog", async () => {
    document.body.textContent = "";
    const pending = openDeleteDialog("m");
    const dialog = document.getElementById("delete-agent-dialog")!;
    const ev = new Event("cancel", { cancelable: true });
    dialog.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect((await pending).confirmed).toBe(false);
    expect(document.getElementById("delete-agent-dialog")).toBeNull();
  });

  it("DD4 Delete agent resolves true and leaves the dialog open until close()", async () => {
    document.body.textContent = "";
    const pending = openDeleteDialog("m");
    document.querySelector<HTMLButtonElement>(".dialog-delete-btn")!.click();
    const r = await pending;
    expect(r.confirmed).toBe(true);
    const dialog = document.getElementById("delete-agent-dialog") as HTMLDialogElement;
    expect(dialog.open).toBe(true);
    r.close();
    r.close();
    expect(document.getElementById("delete-agent-dialog")).toBeNull();
  });
});
