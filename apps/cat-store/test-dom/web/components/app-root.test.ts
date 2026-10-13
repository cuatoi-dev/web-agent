import { describe, it, expect, beforeEach, afterEach } from "vitest";

// Polyfill ElementInternals for jsdom before importing material components
if (typeof window !== "undefined") {
  if (!window.ElementInternals) {
    window.ElementInternals = class {} as unknown as typeof ElementInternals;
  }
  const internalsProto = window.ElementInternals.prototype;
  if (!internalsProto.setFormValue) internalsProto.setFormValue = () => {};
  if (!internalsProto.setValidity) internalsProto.setValidity = () => {};
  if (!internalsProto.checkValidity) internalsProto.checkValidity = () => true;
  if (!internalsProto.reportValidity) internalsProto.reportValidity = () => true;
}

import "../../../src/web/components/app-root";
import { AppRoot } from "../../../src/web/components/app-root";
import { setThemeTool } from "../../../src/web/store/theme-tool";
import { setStoredTheme } from "../../../src/web/theme";
import { store } from "../../../src/web/store";
import { setRoute } from "../../../src/web/store/ui-slice";
import type { ToolContext } from "@cuatoi/web-agent-core";

const noCtx = {} as unknown as ToolContext;

describe("AppRoot theme tracking", () => {
  let container: HTMLDivElement;
  const items = (el: AppRoot) => Array.from(el.shadowRoot!.querySelectorAll<HTMLButtonElement>(".theme-menu-item"));

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it("the menu is closed at first and the button says Theme", async () => {
    const el = document.createElement("app-root") as AppRoot;
    container.appendChild(el);
    await el.updateComplete;

    const btn = el.shadowRoot?.querySelector<HTMLButtonElement>(".theme-menu-button");
    expect(btn?.textContent?.trim()).toBe("Theme");
    expect(btn?.getAttribute("aria-expanded")).toBe("false");
    expect(el.shadowRoot?.querySelector(".theme-menu")).toBeNull();
  });

  it("opening the menu lists every theme with a check on the active one", async () => {
    const el = document.createElement("app-root") as AppRoot;
    container.appendChild(el);
    await el.updateComplete;

    const btn = el.shadowRoot?.querySelector<HTMLButtonElement>(".theme-menu-button");
    btn?.click();
    await el.updateComplete;

    expect(btn?.getAttribute("aria-expanded")).toBe("true");
    const menuItems = items(el);
    expect(menuItems.map((b) => b.dataset.themeId)).toEqual(["wa1-dark", "wa2-dark", "wa2-light"]);
    expect(menuItems[0].textContent).toContain("WA v1 (Dark)");
    expect(menuItems[1].textContent).toContain("WA v2 (Dark)");
    expect(menuItems[2].textContent).toContain("WA v2 (Light)");

    expect(menuItems[1].getAttribute("aria-checked")).toBe("true");
    expect(menuItems[1].querySelector(".theme-menu-check")?.textContent).toBe("✓");

    expect(menuItems[0].getAttribute("aria-checked")).toBe("false");
    expect(menuItems[0].querySelector(".theme-menu-check")?.textContent).toBe("");
    expect(menuItems[2].getAttribute("aria-checked")).toBe("false");
    expect(menuItems[2].querySelector(".theme-menu-check")?.textContent).toBe("");
  });

  it("choosing an item applies and stores it and closes the menu", async () => {
    const el = document.createElement("app-root") as AppRoot;
    container.appendChild(el);
    await el.updateComplete;

    const btn = el.shadowRoot?.querySelector<HTMLButtonElement>(".theme-menu-button");
    btn?.click();
    await el.updateComplete;

    const wa1Btn = el.shadowRoot?.querySelector<HTMLButtonElement>('.theme-menu-item[data-theme-id="wa1-dark"]');
    wa1Btn?.click();
    await el.updateComplete;

    expect(document.documentElement.getAttribute("data-theme")).toBe("wa1-dark");
    expect(localStorage.getItem("cat-store:theme")).toBe("wa1-dark");
    expect(el.shadowRoot?.querySelector(".theme-menu")).toBeNull();

    btn?.click();
    await el.updateComplete;
    const activeItem = el.shadowRoot?.querySelector<HTMLButtonElement>('.theme-menu-item[aria-checked="true"]');
    expect(activeItem?.dataset.themeId).toBe("wa1-dark");
  });

  it("a tool-driven switch moves the check mark", async () => {
    const el = document.createElement("app-root") as AppRoot;
    container.appendChild(el);
    await el.updateComplete;

    await setThemeTool.execute({ theme: "light" }, noCtx);
    await el.updateComplete;

    const btn = el.shadowRoot?.querySelector<HTMLButtonElement>(".theme-menu-button");
    btn?.click();
    await el.updateComplete;

    const activeItem = el.shadowRoot?.querySelector<HTMLButtonElement>('.theme-menu-item[aria-checked="true"]');
    expect(activeItem?.dataset.themeId).toBe("wa2-light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("wa2-light");
  });

  it("Escape closes the menu", async () => {
    const el = document.createElement("app-root") as AppRoot;
    container.appendChild(el);
    await el.updateComplete;

    const btn = el.shadowRoot?.querySelector<HTMLButtonElement>(".theme-menu-button");
    btn?.click();
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector(".theme-menu")).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector(".theme-menu")).toBeNull();
  });

  it("a pointer press outside closes the menu", async () => {
    const el = document.createElement("app-root") as AppRoot;
    container.appendChild(el);
    await el.updateComplete;

    const btn = el.shadowRoot?.querySelector<HTMLButtonElement>(".theme-menu-button");
    btn?.click();
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector(".theme-menu")).not.toBeNull();

    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true, composed: true }));
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector(".theme-menu")).toBeNull();
  });

  it("cleans up event listener when disconnected", async () => {
    const el = document.createElement("app-root") as AppRoot;
    container.appendChild(el);
    await el.updateComplete;

    // Disconnect element
    el.remove();

    // Change theme externally
    setStoredTheme("wa2-light");
    await el.updateComplete;

    // Internal _theme state on removed element should not update via window listener
    expect((el as unknown as { _theme: string })._theme).toBe("wa2-dark");
  });
});

describe("AppRoot routing", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it("renders agent-page and no .view-container on /agent route", async () => {
    const el = document.createElement("app-root") as AppRoot;
    container.appendChild(el);
    store.dispatch(setRoute("/agent"));
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector("agent-page")).not.toBeNull();
    expect(el.shadowRoot?.querySelector(".view-container")).toBeNull();
  });

  it("renders .view-container with store-view and no agent-page on /store route", async () => {
    const el = document.createElement("app-root") as AppRoot;
    container.appendChild(el);
    store.dispatch(setRoute("/store"));
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector(".view-container store-view")).not.toBeNull();
    expect(el.shadowRoot?.querySelector("agent-page")).toBeNull();
  });

  it("nav has an a[href='#/agent'] with text Agent", async () => {
    const el = document.createElement("app-root") as AppRoot;
    container.appendChild(el);
    await el.updateComplete;
    const link = el.shadowRoot?.querySelector("a[href='#/agent']") as HTMLAnchorElement | null;
    expect(link).not.toBeNull();
    expect(link?.textContent?.trim()).toBe("Agent");
  });

  it("Agent link has active class only on /agent route", async () => {
    const el = document.createElement("app-root") as AppRoot;
    container.appendChild(el);
    store.dispatch(setRoute("/agent"));
    await el.updateComplete;
    const link = el.shadowRoot?.querySelector("a[href='#/agent']") as HTMLAnchorElement | null;
    expect(link?.classList.contains("active")).toBe(true);

    store.dispatch(setRoute("/store"));
    await el.updateComplete;
    expect(link?.classList.contains("active")).toBe(false);
  });

  it("toast-host is present in both agent and non-agent routes, exactly once", async () => {
    const el = document.createElement("app-root") as AppRoot;
    container.appendChild(el);

    store.dispatch(setRoute("/agent"));
    await el.updateComplete;
    expect(el.shadowRoot?.querySelectorAll("toast-host").length).toBe(1);

    store.dispatch(setRoute("/store"));
    await el.updateComplete;
    expect(el.shadowRoot?.querySelectorAll("toast-host").length).toBe(1);
  });
});

describe("AppRoot styles", () => {
  it("declares width: 100%, max-width: 960px, and margin: 0 auto on .view-container", () => {
    const css = (AppRoot.styles as { cssText: string }).cssText;
    expect(css).toMatch(/\.view-container\s*\{[^}]*width:\s*100%/);
    expect(css).toMatch(/\.view-container\s*\{[^}]*max-width:\s*960px/);
    expect(css).toMatch(/\.view-container\s*\{[^}]*margin:\s*0\s+auto/);
  });

  it("declares flex-wrap: wrap and row-gap on .top-bar and .nav", () => {
    const css = (AppRoot.styles as { cssText: string }).cssText;
    expect(css).toMatch(/\.top-bar\s*\{[^}]*flex-wrap:\s*wrap/);
    expect(css).toMatch(/\.top-bar\s*\{[^}]*row-gap:\s*var\(--wa-padding-m,\s*8px\)/);
    expect(css).toMatch(/\.nav\s*\{[^}]*flex-wrap:\s*wrap/);
    expect(css).toMatch(/\.nav\s*\{[^}]*row-gap:\s*var\(--wa-padding-m,\s*8px\)/);
  });

  it("declares box-sizing: border-box on .view-container", () => {
    const css = (AppRoot.styles as { cssText: string }).cssText;
    expect(css).toMatch(/\.view-container\s*\{[^}]*box-sizing:\s*border-box/);
  });
});
