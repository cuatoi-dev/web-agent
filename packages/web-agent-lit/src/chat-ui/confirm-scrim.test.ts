import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createConfirmScrim } from "./confirm-scrim.js";

describe("createConfirmScrim", () => {
  let container: HTMLElement;
  let hook: ReturnType<typeof createConfirmScrim>;

  beforeEach(() => {
    container = document.createElement("div");
    container.style.position = "relative";
    document.body.appendChild(container);
    hook = createConfirmScrim(container);
  });

  afterEach(() => {
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  function getScrimEl(): HTMLElement | null {
    return container.querySelector(".wa-confirm-scrim");
  }

  function getAllowBtn(): HTMLElement | null {
    const btns = container.querySelectorAll("button");
    return Array.from(btns).find((b) => b.textContent === "Allow") ?? null;
  }

  function getRejectBtn(): HTMLElement | null {
    const btns = container.querySelectorAll("button");
    return Array.from(btns).find((b) => b.textContent === "Reject") ?? null;
  }

  it("returns a pending Promise that does not resolve immediately", async () => {
    const promise = hook({
      ref: "#btn-1",
      name: "Submit Button",
      action: "click",
    });

    let resolved = false;
    void promise.then(() => { resolved = true; });

    await new Promise((r) => setTimeout(r, 50));
    expect(resolved).toBe(false);
  });

  it("Allow button resolves true and removes scrim from DOM", async () => {
    const promise = hook({
      ref: "#btn-1",
      name: "Submit Button",
      action: "click",
    });

    const allowBtn = getAllowBtn();
    expect(allowBtn).not.toBeNull();
    allowBtn!.click();

    const result = await promise;
    expect(result).toBe(true);
    expect(getScrimEl()).toBeNull();
  });

  it("Reject button resolves false and removes scrim from DOM", async () => {
    const promise = hook({
      ref: "#btn-1",
      name: "Submit Button",
      action: "click",
    });

    const rejectBtn = getRejectBtn();
    expect(rejectBtn).not.toBeNull();
    rejectBtn!.click();

    const result = await promise;
    expect(result).toBe(false);
    expect(getScrimEl()).toBeNull();
  });

  it("Escape keydown resolves false and removes scrim from DOM", async () => {
    const promise = hook({
      ref: "#btn-1",
      name: "Submit Button",
      action: "click",
    });

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    const result = await promise;
    expect(result).toBe(false);
    expect(getScrimEl()).toBeNull();
  });

  it("renders card with correct action, target, and reason (omitted when absent)", () => {
    void hook({
      ref: "#btn-1",
      name: "Submit Button",
      action: "click",
      reason: "User must confirm purchase",
    });

    const card = container.querySelector(".wa-confirm-card");
    expect(card).not.toBeNull();

    const title = card!.querySelector("h3");
    expect(title?.textContent).toBe("Confirm action");

    expect(card!.innerHTML).toContain("click");
    expect(card!.innerHTML).toContain("Submit Button");

    const reasonEl = card!.querySelector(".wa-confirm-reason");
    expect(reasonEl).not.toBeNull();
    expect(reasonEl?.textContent).toBe("Reason: User must confirm purchase");

    container.querySelector(".wa-confirm-scrim")?.remove();

    void hook({
      ref: "#sel-1",
      action: "selectOption",
    });

    const card2 = container.querySelector(".wa-confirm-card");
    const reasonEl2 = card2?.querySelector(".wa-confirm-reason");
    expect(reasonEl2).toBeNull();
    expect(card2?.innerHTML).toContain("#sel-1");
  });

  it("prefers `summary` over action/name wording when present", () => {
    void hook({
      ref: "#btn-1",
      name: "Remove item",
      action: "click",
      summary: 'Click "Remove item" button',
    });

    const card = container.querySelector(".wa-confirm-card");
    expect(card).not.toBeNull();
    expect(card!.innerHTML).toContain('Click "Remove item" button');
    expect(card!.innerHTML).not.toContain("Agent wants to perform");
  });

  it("renders summary and element name as text, never as markup", () => {
    void hook({
      action: "create_skill",
      summary: 'Create skill "<img src=x onerror=alert(1)>"',
    });
    const card = container.querySelector(".wa-confirm-card")!;
    expect(card.querySelector("img")).toBeNull();
    expect(card.querySelector("strong")!.textContent).toBe('Create skill "<img src=x onerror=alert(1)>"');

    container.querySelector(".wa-confirm-scrim")?.remove();

    void hook({ ref: "#b", action: "click", name: "<b>Pay</b>" });
    const card2 = container.querySelector(".wa-confirm-card")!;
    expect(card2.querySelector("b")).toBeNull();
    expect(Array.from(card2.querySelectorAll("strong")).map((el) => el.textContent)).toEqual(["click", "<b>Pay</b>"]);
  });

  it("themes the scrim and card from theme tokens", () => {
    void hook({
      ref: "#btn-1",
      name: "Submit Button",
      action: "click",
      reason: "User must confirm purchase",
    });

    const backdrop = getScrimEl();
    expect(backdrop).not.toBeNull();
    expect(backdrop!.style.background).toContain("--wa-black-color-50opc");

    const card = container.querySelector(".wa-confirm-card") as HTMLElement;
    expect(card).not.toBeNull();
    expect(card.style.background).toContain("--wa-dialog-background-color");
    expect(card.style.boxShadow).toContain("--wa-dialog-box-shadow");

    const reasonEl = card.querySelector(".wa-confirm-reason") as HTMLElement;
    expect(reasonEl).not.toBeNull();
    expect(reasonEl.style.color).toContain("--wa-label-color");
    expect(reasonEl.style.background).toContain("--wa-background-color-300");
  });

  it("mounts scrim inside the panel container (not document.body) and uses registry seam for buttons", () => {
    void hook({
      ref: "#btn-1",
      name: "Submit Button",
      action: "click",
    });

    const scrimEl = getScrimEl();
    expect(scrimEl).not.toBeNull();

    expect(container.contains(scrimEl)).toBe(true);
    expect(document.body.contains(scrimEl)).toBe(true);

    const bodyDirectChild = Array.from(document.body.children).includes(scrimEl!);
    expect(bodyDirectChild).toBe(false);

    const allowBtn = getAllowBtn();
    expect(allowBtn).not.toBeNull();
    expect(allowBtn!.classList.contains("wa-btn")).toBe(true);
    expect(allowBtn!.classList.contains("wa-btn-primary")).toBe(true);

    const rejectBtn = getRejectBtn();
    expect(rejectBtn).not.toBeNull();
    expect(rejectBtn!.classList.contains("wa-btn")).toBe(true);
    expect(rejectBtn!.classList.contains("wa-btn-secondary")).toBe(true);
  });

  it("puts its stylesheet inside the scrim and removes it on close", async () => {
    const confirm = createConfirmScrim(container);
    const pending = confirm({ action: "delete", name: "item" });

    const backdrop = container.querySelector(".wa-confirm-scrim")!;
    const sheet = backdrop.querySelector("style");
    expect(sheet).not.toBeNull();
    expect(sheet!.textContent).toContain(".wa-confirm-card");
    expect(document.getElementById("wa-confirm-scrim-styles")).toBeNull();

    (backdrop.querySelector("button.wa-btn-secondary") as HTMLButtonElement).click();
    await expect(pending).resolves.toBe(false);
    expect(container.querySelector("style")).toBeNull();
  });

  it("renders title, message and button labels when the caller passes them", async () => {
    const pending = hook({
      action: "switch_agent",
      title: "Switch to tesagent?",
      message: "Chromagent is still working. Stop it and switch to tesagent?",
      confirmLabel: "Stop and switch",
      cancelLabel: "Cancel",
    });

    const card = container.querySelector(".wa-confirm-card")!;
    expect(card.querySelector("h3")!.textContent).toBe("Switch to tesagent?");
    expect(card.querySelector("p")!.textContent).toBe(
      "Chromagent is still working. Stop it and switch to tesagent?",
    );
    expect(card.querySelector("strong")).toBeNull();
    expect(Array.from(card.querySelectorAll("button")).map((b) => b.textContent)).toEqual([
      "Cancel",
      "Stop and switch",
    ]);
    expect(getAllowBtn()).toBeNull();
    expect(getRejectBtn()).toBeNull();

    Array.from(card.querySelectorAll("button"))
      .find((b) => b.textContent === "Stop and switch")!
      .click();
    await expect(pending).resolves.toBe(true);
  });

  it("renders label text containing <b> as literal text", () => {
    void hook({
      action: "switch_agent",
      title: "<b>T</b>",
      message: "<b>M</b>",
      confirmLabel: "<b>OK</b>",
      cancelLabel: "<b>No</b>",
    });

    const card = container.querySelector(".wa-confirm-card")!;
    expect(card.querySelector("b")).toBeNull();
    expect(card.querySelector("h3")!.textContent).toBe("<b>T</b>");
    expect(card.querySelector("p")!.textContent).toBe("<b>M</b>");
    expect(Array.from(card.querySelectorAll("button")).map((b) => b.textContent)).toEqual([
      "<b>No</b>",
      "<b>OK</b>",
    ]);
  });

  it("an unlabelled call still renders today's title, body and buttons", () => {
    void hook({ action: "click", summary: "Click Pay" });

    const card = container.querySelector(".wa-confirm-card")!;
    expect(card.querySelector("h3")!.textContent).toBe("Confirm action");
    expect(card.querySelector("p")!.textContent).toBe("Agent wants to: Click Pay.");
    expect(Array.from(card.querySelectorAll("button")).map((b) => b.textContent)).toEqual([
      "Reject",
      "Allow",
    ]);
  });

  it("creates danger button variant when detail.danger is true", () => {
    void hook({
      title: "Delete /home/agent/notes.md?",
      message: "This cannot be undone.",
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
      danger: true,
    });

    const card = container.querySelector(".wa-confirm-card")!;
    const confirmBtn = Array.from(card.querySelectorAll("button")).find(
      (b) => b.textContent === "Delete",
    )!;
    expect(confirmBtn).toBeDefined();
    expect(confirmBtn.classList.contains("wa-btn-danger")).toBe(true);
  });

  it("supports custom title, message, and button labels without danger variant", () => {
    void hook({
      title: "Delete /home/agent/notes.md?",
      message: "This cannot be undone.",
      confirmLabel: "Delete",
      cancelLabel: "Cancel",
    });

    const card = container.querySelector(".wa-confirm-card")!;
    expect(card.querySelector("h3")!.textContent).toBe("Delete /home/agent/notes.md?");
    expect(card.querySelector("p")!.textContent).toBe("This cannot be undone.");
    const confirmBtn = Array.from(card.querySelectorAll("button")).find(
      (b) => b.textContent === "Delete",
    )!;
    expect(confirmBtn.classList.contains("wa-btn-danger")).toBe(false);
    expect(confirmBtn.classList.contains("wa-btn-primary")).toBe(true);
  });
});
