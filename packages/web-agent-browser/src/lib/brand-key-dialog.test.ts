// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";
import {
  openBrandKeyDialog,
  KEY_DIALOG_ID,
  KEY_PLACEHOLDER,
  KEY_HINT,
} from "./brand-key-dialog";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
});

describe("brand-key-dialog", () => {
  it("KD1 opens with title Key for Gateway (anthropic), endpoint text, password input with current value, placeholder, hint, buttons and focus", () => {
    document.body.textContent = "";
    void openBrandKeyDialog({
      name: "Gateway",
      wireFormat: "anthropic",
      endpoint: "https://gw.test/api/anthropic",
      current: "initial-key",
    });

    const dialog = document.getElementById(KEY_DIALOG_ID) as HTMLDialogElement;
    expect(dialog).not.toBeNull();
    expect(dialog.open).toBe(true);

    const title = dialog.querySelector("h2");
    expect(title?.textContent).toBe("Key for Gateway (anthropic)");

    const endpoint = dialog.querySelector(".key-endpoint");
    expect(endpoint?.textContent).toBe("https://gw.test/api/anthropic");

    const inputs = dialog.querySelectorAll("input");
    expect(inputs.length).toBe(1);
    const input = inputs[0];
    expect(input.type).toBe("password");
    expect(input.value).toBe("initial-key");
    expect(input.placeholder).toBe(KEY_PLACEHOLDER);

    expect(dialog.textContent).toContain(KEY_HINT);

    const buttons = Array.from(dialog.querySelectorAll("button")).map((b) => b.textContent);
    expect(buttons).toEqual(["Cancel", "Save"]);

    expect(document.activeElement).toBe(input);
  });

  it("KD2 Save resolves the field value and removes the dialog", async () => {
    document.body.textContent = "";
    const pending = openBrandKeyDialog({
      name: "Gateway",
      wireFormat: "anthropic",
      endpoint: "https://gw.test/api/anthropic",
      current: "sk-1234",
    });

    const dialog = document.getElementById(KEY_DIALOG_ID) as HTMLDialogElement;
    const input = dialog.querySelector("input") as HTMLInputElement;
    input.value = "sk-new-key";
    dialog.querySelector<HTMLButtonElement>(".dialog-save-btn")!.click();

    const res = await pending;
    expect(res).toBe("sk-new-key");
    expect(document.getElementById(KEY_DIALOG_ID)).toBeNull();
  });

  it("KD3 Cancel resolves null and removes the dialog", async () => {
    document.body.textContent = "";
    const pending = openBrandKeyDialog({
      name: "Gateway",
      wireFormat: "anthropic",
      endpoint: "https://gw.test/api/anthropic",
      current: "sk-1234",
    });

    const dialog = document.getElementById(KEY_DIALOG_ID) as HTMLDialogElement;
    dialog.querySelector<HTMLButtonElement>(".dialog-cancel-btn")!.click();

    const res = await pending;
    expect(res).toBeNull();
    expect(document.getElementById(KEY_DIALOG_ID)).toBeNull();
  });

  it("KD4 a cancel event is prevented and resolves null", async () => {
    document.body.textContent = "";
    const pending = openBrandKeyDialog({
      name: "Gateway",
      wireFormat: "anthropic",
      endpoint: "https://gw.test/api/anthropic",
      current: "sk-1234",
    });

    const dialog = document.getElementById(KEY_DIALOG_ID) as HTMLDialogElement;
    const ev = new Event("cancel", { cancelable: true });
    dialog.dispatchEvent(ev);

    expect(ev.defaultPrevented).toBe(true);
    const res = await pending;
    expect(res).toBeNull();
    expect(document.getElementById(KEY_DIALOG_ID)).toBeNull();
  });

  it("KD5 a name with <b> is shown as text (no b element)", () => {
    document.body.textContent = "";
    void openBrandKeyDialog({
      name: "<b>Injected</b>",
      wireFormat: "anthropic",
      endpoint: "https://gw.test/api/anthropic",
      current: "",
    });

    const dialog = document.getElementById(KEY_DIALOG_ID) as HTMLDialogElement;
    expect(dialog.querySelector("b")).toBeNull();
    expect(dialog.querySelector("h2")?.textContent).toBe("Key for <b>Injected</b> (anthropic)");
  });
});
