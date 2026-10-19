import { describe, it, expect, vi, afterEach } from "vitest";
import { AgentChatPanel } from "../../src/chat-ui/chat-panel.js";
import type { WaMenu } from "../../src/ui/wa-menu.js";
import { setMockScript } from "@cuatoi/web-agent-core";

if (!customElements.get("agent-chat-panel")) {
  customElements.define("agent-chat-panel", AgentChatPanel);
}

const ICON_LEO = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="6"/></svg>';
const ICON_MOCHI = '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16"/></svg>';
const ICON_THIRD = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l10 20H2z"/></svg>';
const ICON_ALTERED = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 12h16"/></svg>';

const MODELS = [
  { id: "m1", label: "Leo", icon: ICON_LEO },
  { id: "m2", label: "Mochi", icon: ICON_MOCHI },
  { id: "m3", label: "Third", icon: ICON_THIRD },
];

/** A connected panel on a REAL core session (mock endpoint). */
async function mountPanel(before?: (p: AgentChatPanel) => void): Promise<AgentChatPanel> {
  const panel = document.createElement("agent-chat-panel");
  panel.config = { persist: false };
  panel.type = "mock";
  panel.model = "m1";
  before?.(panel);
  document.body.appendChild(panel);
  await panel.session!.initPromise;
  await panel.updateComplete;
  return panel;
}

function menuEl(panel: AgentChatPanel): WaMenu {
  return panel.querySelector("wa-menu") as WaMenu;
}

async function openMenu(panel: AgentChatPanel): Promise<void> {
  if (!panel.menuOpen) (panel.querySelector("#menu-anchor button") as HTMLButtonElement).click();
  await panel.updateComplete;
}

function menuButtons(panel: AgentChatPanel): HTMLButtonElement[] {
  return Array.from(panel.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
}

function labels(panel: AgentChatPanel): string[] {
  return menuButtons(panel).map((b) => b.textContent?.trim() ?? "");
}

function pick(panel: AgentChatPanel, label: string): Promise<void> {
  const button = menuButtons(panel).find((b) => b.textContent?.trim().endsWith(label));
  if (!button) throw new Error(`menu item not found: ${label}`);
  button.click();
  return panel.updateComplete;
}

const checkedLabels = (panel: AgentChatPanel): string[] =>
  labels(panel).filter((l) => l.startsWith("✓"));

describe("AgentChatPanel — model switcher host hook", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("D1 lists every model with its icon, one check and a disabled heading", async () => {
    const panel = await mountPanel((p) => {
      p.models = MODELS;
      p.selectedModel = "m2";
    });
    await openMenu(panel);

    const all = labels(panel);
    expect(all).toContain("Choose model");
    expect(all.filter((l) => l.endsWith("Leo"))).toHaveLength(1);
    expect(all.filter((l) => l.endsWith("Mochi"))).toHaveLength(1);
    expect(all.filter((l) => l.endsWith("Third"))).toHaveLength(1);
    expect(checkedLabels(panel)).toEqual(["✓ Mochi"]);

    const heading = menuButtons(panel).find((b) => b.textContent?.trim() === "Choose model")!;
    expect(heading.disabled).toBe(true);

    const icons = Array.from(panel.querySelectorAll(".wa-menu-icon"));
    expect(icons).toHaveLength(3);
    expect(icons[0].querySelector("svg")).not.toBeNull();
    expect(icons[0].getAttribute("aria-hidden")).toBe("true");

    const items = menuEl(panel).items;
    expect(items.find((i) => i.id === "model:m2")).toMatchObject({
      label: "✓ Mochi",
      icon: ICON_MOCHI,
      checked: true,
    });
    expect(items.find((i) => i.id === "model:m1")).toMatchObject({ icon: ICON_LEO, checked: false });
  });

  it("D1 falls back to the option id when a label is omitted", async () => {
    const panel = await mountPanel((p) => {
      p.models = [{ id: "m1" }, { id: "m2", label: "Mochi" }];
    });
    await openMenu(panel);
    expect(labels(panel).some((l) => l.endsWith("m1"))).toBe(true);
    expect(labels(panel).some((l) => l.endsWith("Mochi"))).toBe(true);
  });

  it("D2 dispatches a cancelable composed event and switches the real session", async () => {
    const panel = await mountPanel((p) => {
      p.models = MODELS;
    });
    const seen: {
      id: string;
      bubbles: boolean;
      composed: boolean;
      cancelable: boolean;
      modelDuringDispatch: string;
    }[] = [];
    const listener = (e: Event) => {
      const ev = e as CustomEvent<{ id: string }>;
      seen.push({
        id: ev.detail.id,
        bubbles: ev.bubbles,
        composed: ev.composed,
        cancelable: ev.cancelable,
        modelDuringDispatch: panel.session!.getState().model,
      });
    };
    panel.addEventListener("agent-model-select", listener);

    await openMenu(panel);
    await pick(panel, "Mochi");

    expect(seen).toEqual([
      { id: "m2", bubbles: true, composed: true, cancelable: true, modelDuringDispatch: "m1" },
    ]);
    expect(panel.session!.getState().model).toBe("m2");
    expect(panel.model).toBe("m2");
    expect(panel.menuOpen).toBe(false);

    await openMenu(panel);
    expect(checkedLabels(panel)).toEqual(["✓ Mochi"]);
    panel.removeEventListener("agent-model-select", listener);
  });

  it("D3 a canceled event keeps the session and selectedModel moves the check", async () => {
    const panel = await mountPanel((p) => {
      p.models = MODELS;
    });
    const ids: string[] = [];
    panel.addEventListener("agent-model-select", (e) => {
      ids.push((e as CustomEvent<{ id: string }>).detail.id);
      e.preventDefault();
    });

    await openMenu(panel);
    await pick(panel, "Mochi");

    expect(ids).toEqual(["m2"]);
    expect(panel.session!.getState().model).toBe("m1");
    expect(panel.model).toBe("m1");
    expect(panel.menuOpen).toBe(false);

    const spy = vi.spyOn(panel.session!, "updateConfig");
    panel.selectedModel = "m2";
    await panel.updateComplete;
    expect(spy).toHaveBeenCalledTimes(0);
    expect(panel.session!.getState().model).toBe("m1");
    await openMenu(panel);
    expect(checkedLabels(panel)).toEqual(["✓ Mochi"]);
  });

  it("D4 a later path write keeps the model picked from the menu", async () => {
    const panel = await mountPanel((p) => {
      p.models = MODELS;
    });
    await openMenu(panel);
    await pick(panel, "Mochi");
    expect(panel.session!.getState().model).toBe("m2");

    const spy = vi.spyOn(panel.session!, "updateConfig");
    panel.path = "/changed-for-model-test";
    await Promise.resolve();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatchObject({ baseURL: "/changed-for-model-test", model: "m2" });
    expect(panel.session!.getState().model).toBe("m2");
  });

  it("D4 a new fetch function keeps the model picked from the menu", async () => {
    const panel = await mountPanel((p) => {
      p.models = MODELS;
    });
    await openMenu(panel);
    await pick(panel, "Mochi");

    const spy = vi.spyOn(panel.session!, "updateConfig");
    const original = panel.fetch;
    panel.fetch = (input, init) => fetch(input, init);
    expect(panel.fetch).not.toBe(original);
    await Promise.resolve();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatchObject({ model: "m2" });
    expect(panel.session!.getState().model).toBe("m2");
  });

  it("D5 selectedModel is display-only and moves across values", async () => {
    const panel = await mountPanel((p) => {
      p.models = MODELS;
    });
    const spy = vi.spyOn(panel.session!, "updateConfig");

    panel.selectedModel = "m3";
    await panel.updateComplete;
    await openMenu(panel);
    expect(checkedLabels(panel)).toEqual(["✓ Third"]);

    panel.selectedModel = "zz-unknown";
    await panel.updateComplete;
    await openMenu(panel);
    expect(checkedLabels(panel)).toEqual([]);

    panel.selectedModel = undefined;
    await panel.updateComplete;
    await openMenu(panel);
    expect(checkedLabels(panel)).toEqual(["✓ Leo"]);

    const ru = vi.spyOn(panel, "requestUpdate");
    panel.selectedModel = "m1";
    await panel.updateComplete;
    panel.selectedModel = "m1";
    await panel.updateComplete;
    expect(ru).toHaveBeenCalledTimes(1);

    expect(spy).toHaveBeenCalledTimes(0);
    expect(panel.session!.getState().model).toBe("m1");
    expect(panel.model).toBe("m1");
  });

  it("D6 a changed icon redraws and unchanged metadata keeps the item array", async () => {
    const panel = await mountPanel((p) => {
      p.models = MODELS;
    });
    await openMenu(panel);
    const beforeSvg = panel.querySelector(".wa-menu-icon svg");
    expect(beforeSvg?.querySelector("circle")).not.toBeNull();

    panel.models = [{ ...MODELS[0], icon: ICON_ALTERED }, MODELS[1], MODELS[2]];
    await panel.updateComplete;
    const afterSvg = panel.querySelector(".wa-menu-icon svg");
    expect(afterSvg).not.toBe(beforeSvg);
    expect(afterSvg?.querySelector("path")).not.toBeNull();
    expect(afterSvg?.querySelector("circle")).toBeNull();

    const itemsBefore = menuEl(panel).items;
    expect(itemsBefore.find((i) => i.id === "model:m1")?.checked).toBe(true);
    panel.selectedModel = "m2";
    await panel.updateComplete;
    await openMenu(panel);
    const itemsAfter = menuEl(panel).items;
    expect(itemsAfter.find((i) => i.id === "model:m1")?.checked).toBe(false);
    expect(itemsAfter.find((i) => i.id === "model:m2")?.checked).toBe(true);

    const stable = menuEl(panel).items;
    panel.requestUpdate();
    await panel.updateComplete;
    expect(menuEl(panel).items).toBe(stable);
  });

  it("D7 no model group below two options and the conversation survives", async () => {
    const single = await mountPanel((p) => {
      p.models = [{ id: "m1", label: "Leo" }];
    });
    await openMenu(single);
    expect(labels(single)).not.toContain("Choose model");
    expect(labels(single)).toContain("Configuration");

    document.body.innerHTML = "";
    const empty = await mountPanel();
    await openMenu(empty);
    expect(labels(empty)).not.toContain("Choose model");
    expect(labels(empty)).toContain("Configuration");

    document.body.innerHTML = "";
    setMockScript([{ text: "first reply" }, { text: "second reply" }]);
    const panel = await mountPanel((p) => {
      p.models = MODELS;
    });
    await panel.send("first question");
    const before = panel.session!.getState().messages.map((m) => ({
      role: m.role,
      text: m.text ?? (m.parts ?? []).map((x) => x.text ?? "").join(""),
    }));
    expect(before).toHaveLength(2);

    await openMenu(panel);
    await pick(panel, "Mochi");
    panel.path = "/changed-for-model-test";
    await Promise.resolve();

    const after = panel.session!.getState().messages.map((m) => ({
      role: m.role,
      text: m.text ?? (m.parts ?? []).map((x) => x.text ?? "").join(""),
    }));
    expect(after).toEqual(before);

    await panel.send("second question");
    const messages = panel.session!.getState().messages;
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
    expect(before.map((m) => m.text)).toEqual([messages[0].text ?? "", messages[1].text ?? ""]);
  });
});
