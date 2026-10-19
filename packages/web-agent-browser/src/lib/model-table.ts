import { iconNode } from "@cuatoi/web-agent-lit/ui/icon-svgs";
import { providerIconNode } from "./provider-builtins";
import { resolveDefault } from "./model-store";
import type { ModelEntry, ModelRef, ModelStore, ModelTableHandlers, ResolvedProvider } from "./types";

export const PROVIDED_LABEL = "Provided";
export const BRAND_CHECKBOX_TITLE = "Brand models cannot be deleted";
export const PROVIDED_KEY_TEXT = "provided key";
export const NO_KEY_TEXT = "no key";

/** "N of M models enabled". */
export function modelCountText(entries: ModelEntry[]): string {
  const on = entries.filter((e) => e.enabled).length;
  return `${on} of ${entries.length} models enabled`;
}

/** "Delete selected" when N == 0, else "Delete selected (N)". */
export function deleteButtonText(count: number): string {
  return count > 0 ? `Delete selected (${count})` : "Delete selected";
}

/** A brand row's key text (137/001): the Key-button key's last four
 *  characters, "provided key" for the brand's default key, else "no key". */
function brandKeyText(p: ResolvedProvider): string {
  if (p.keySource === "user") return `key ••••${p.apiKey.trim().slice(-4)}`;
  return p.keySource === "brand" ? PROVIDED_KEY_TEXT : NO_KEY_TEXT;
}

/** Subtitle under a provider row:
 *  - Brand:  `<endpoint> · key ••••xxxx`, `<endpoint> · provided key` or
 *            `<endpoint> · no key`
 *  - Custom: `<endpoint>[ · key ••••xxxx][ · N custom header(s)]` */
export function providerSubText(p: ResolvedProvider): string {
  if (p.kind === "brand") {
    return `${p.endpoint} · ${brandKeyText(p)}`;
  }
  const parts = [p.endpoint];
  const key = p.apiKey.trim();
  if (key) parts.push(`key ••••${key.slice(-4)}`);
  const n = p.headers.length;
  if (n === 1) parts.push("1 custom header");
  else if (n > 1) parts.push(`${n} custom headers`);
  return parts.join(" · ");
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

/** Paints the Models tab table (mockup states 1 and 2; state 8 under lockModel):
 *  one provider row per provider, its models as rows under it. */
export function renderModelTable(
  table: HTMLTableElement,
  entries: ModelEntry[],
  store: ModelStore,
  h: ModelTableHandlers,
): void {
  table.textContent = "";
  const showCheck = !h.lockModel;
  const selected = new Set<ModelRef>(h.selected ?? []);
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
    let provBox: HTMLInputElement | null = null;
    const modelBoxes: { ref: ModelRef; box: HTMLInputElement; row: HTMLTableRowElement }[] = [];

    if (showCheck) {
      const box = el("input", "prov-select");
      box.type = "checkbox";
      box.disabled = p.kind === "brand";
      if (p.kind === "brand") {
        box.title = BRAND_CHECKBOX_TITLE;
      } else {
        box.checked = group.length > 0 && group.every((e) => selected.has(e.ref));
      }
      box.setAttribute("aria-label", `Select ${p.name}`);
      prov.insertCell().append(box);
      provBox = box;
    }
    const nameCell = prov.insertCell();
    const name = el("div", "prov-name");
    name.append(providerIconNode(p.builtIn), el("span", "prov-label", p.name));
    if (p.kind === "brand") name.append(el("span", "pill brand", PROVIDED_LABEL));
    nameCell.append(name, el("div", "prov-sub", providerSubText(p)));
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
    } else if (!h.lockModel) {
      const editBtn = el("button", "btn edit-btn");
      editBtn.type = "button";
      editBtn.dataset.providerId = p.id;
      editBtn.setAttribute("aria-label", `Edit ${p.name}`);
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", () => h.onEdit?.(p.id));
      actions.append(editBtn);
    }

    for (const e of group) {
      const row = body.insertRow();
      const isSelected = e.kind === "custom" && selected.has(e.ref);
      row.className = isSelected ? "model-row sel-row" : "model-row";
      row.dataset.ref = e.ref;
      if (showCheck) {
        const cell = row.insertCell();
        if (e.kind === "custom") {
          const mbox = el("input", "model-select");
          mbox.type = "checkbox";
          mbox.checked = isSelected;
          mbox.setAttribute("aria-label", `Select ${e.label}`);
          mbox.addEventListener("change", () => {
            if (mbox.checked) selected.add(e.ref);
            else selected.delete(e.ref);
            row.classList.toggle("sel-row", mbox.checked);
            if (provBox) provBox.checked = modelBoxes.every((m) => m.box.checked);
            h.onSelectionChange?.(new Set(selected));
          });
          cell.append(mbox);
          modelBoxes.push({ ref: e.ref, box: mbox, row });
        }
      }
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

    if (provBox && p.kind === "custom") {
      const box = provBox;
      box.addEventListener("change", () => {
        for (const m of modelBoxes) {
          m.box.checked = box.checked;
          m.row.classList.toggle("sel-row", box.checked);
          if (box.checked) selected.add(m.ref);
          else selected.delete(m.ref);
        }
        h.onSelectionChange?.(new Set(selected));
      });
    }
  }
}
