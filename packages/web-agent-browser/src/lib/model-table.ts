import { iconNode } from "@cuatoi/web-agent-lit/ui/icon-svgs";
import { resolveDefault } from "./model-store";
import type { ModelEntry, ModelStore, ModelTableHandlers } from "./types";

export const FROM_BRAND = "From brand";
export const BRAND_CHECKBOX_TITLE = "Brand models cannot be deleted";
export const SHARED_TOKEN_TEXT = "shared Token";

/** "N of M models enabled". */
export function modelCountText(entries: ModelEntry[]): string {
  const on = entries.filter((e) => e.enabled).length;
  return `${on} of ${entries.length} models enabled`;
}

/** "key ••••3f9a" when a key is stored, else "shared Token". */
export function keyHint(apiKey: string): string {
  const key = apiKey.trim();
  return key ? `key ••••${key.slice(-4)}` : SHARED_TOKEN_TEXT;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "", text = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** A decorative icon from the lit registry. */
function icon(name: string): Element {
  const svg = iconNode(name);
  svg.classList.add("logo");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  return svg;
}

/** Paints the Models tab table (mockup state 1; state 8 under lockModel):
 *  one provider row per provider, its models as rows under it. */
export function renderModelTable(
  table: HTMLTableElement,
  entries: ModelEntry[],
  store: ModelStore,
  h: ModelTableHandlers,
): void {
  table.textContent = "";
  const showCheck = !h.lockModel;
  const headRow = table.createTHead().insertRow();
  const headings = [...(showCheck ? [""] : []), "Provider / model", "Format", "Vision", "Enabled", "Default", ""];
  for (const text of headings) headRow.append(el("th", "", text));

  const body = table.createTBody();
  const defaultRef = resolveDefault(entries, store)?.ref ?? null;
  const groups = new Map<string, ModelEntry[]>();
  for (const e of entries) {
    if (h.lockModel && e.kind !== "brand") continue;
    const group = groups.get(e.provider.id);
    if (group) group.push(e);
    else groups.set(e.provider.id, [e]);
  }

  for (const group of groups.values()) {
    const p = group[0].provider;
    const prov = body.insertRow();
    prov.className = "prov";
    prov.dataset.providerId = p.id;
    if (showCheck) {
      const box = el("input");
      box.type = "checkbox";
      box.disabled = p.kind === "brand";
      if (p.kind === "brand") box.title = BRAND_CHECKBOX_TITLE;
      box.setAttribute("aria-label", `Select ${p.name}`);
      prov.insertCell().append(box);
    }
    const nameCell = prov.insertCell();
    const name = el("div", "prov-name");
    name.append(icon("dns"), el("span", "prov-label", p.name));
    if (p.kind === "brand") name.append(el("span", "pill brand", FROM_BRAND));
    nameCell.append(name, el("div", "prov-sub", `${p.endpoint} · ${keyHint(p.apiKey)}`));
    prov.insertCell().textContent = p.wireFormat;
    prov.insertCell();
    const count = prov.insertCell();
    count.className = "count";
    count.textContent = `${group.filter((e) => e.enabled).length} / ${group.length}`;
    prov.insertCell();
    const actions = prov.insertCell();
    if (p.kind === "brand") {
      const keyBtn = el("button", "btn key-btn");
      keyBtn.type = "button";
      keyBtn.dataset.providerId = p.id;
      keyBtn.setAttribute("aria-label", `Key for ${p.name}`);
      keyBtn.append(icon("key"), document.createTextNode("Key"));
      keyBtn.addEventListener("click", () => h.onKey(p));
      actions.append(keyBtn);
    }

    for (const e of group) {
      const row = body.insertRow();
      row.className = "model-row";
      row.dataset.ref = e.ref;
      if (showCheck) row.insertCell();
      const label = row.insertCell();
      label.className = "model";
      label.append(el("span", "model-label", e.label), document.createTextNode(" "), el("span", "mid", e.model));
      row.insertCell();
      const vision = row.insertCell();
      if (e.vision) vision.append(el("span", "pill vision", "Vision"));
      else vision.textContent = "—";

      const sw = el("label", "sw");
      const toggle = el("input", "model-enabled");
      toggle.type = "checkbox";
      toggle.setAttribute("role", "switch");
      toggle.checked = e.enabled;
      toggle.setAttribute("aria-label", `Enabled: ${e.label}`);
      toggle.addEventListener("change", () => h.onToggle(e.ref, toggle.checked));
      const track = el("span", "track");
      track.setAttribute("aria-hidden", "true");
      sw.append(toggle, track);
      row.insertCell().append(sw);

      const radio = el("input", "model-default");
      radio.type = "radio";
      radio.name = "default-model";
      radio.checked = e.ref === defaultRef;
      radio.disabled = !e.enabled;
      radio.setAttribute("aria-label", `Default: ${e.label}`);
      radio.addEventListener("change", () => {
        if (radio.checked) h.onDefault(e.ref);
      });
      row.insertCell().append(radio);
      row.insertCell();
    }
  }
}
