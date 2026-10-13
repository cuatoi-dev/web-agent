import type {
  MultiSelect,
  MultiSelectOptions,
  MultiSelectRow,
  MultiSelectSection,
  MultiSelectValue,
} from "./multi-select.types";

export const ALL = "*";
export const NO_MATCH_TEXT = "No matching names";
export const FILTER_PLACEHOLDER = "Filter tools…";

/** The design's pick(option). */
export function pickValue(value: MultiSelectValue, option: string): MultiSelectValue {
  if (option === ALL) return value === ALL ? [] : ALL;
  if (value === ALL) return [option];
  if (value.includes(option)) return value.filter((n) => n !== option);
  return [...value, option];
}

/** A chip's × button. The All chip clears the value. */
export function removeName(value: MultiSelectValue, name: string): MultiSelectValue {
  if (name === ALL) return [];
  if (value === ALL) return value;
  return value.filter((n) => n !== name);
}

/** The design's filter(text) test for one row. */
export function matchesFilter(name: string, text: string): boolean {
  const t = text.trim().toLowerCase();
  return t === "" || name.toLowerCase().includes(t);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== "") node.className = className;
  return node;
}

export function mountMultiSelect(o: MultiSelectOptions): MultiSelect {
  let value: MultiSelectValue = o.value;
  let disabled = false;
  let isOpen = false;
  let active = -1;
  let seq = 0;

  const root = el("div", "field ms");
  const label = el("div", "lbl");
  label.id = `${o.id}-label`;
  label.textContent = o.label;

  const box = el("div", "ms-box");
  box.id = `${o.id}-box`;
  box.setAttribute("role", "combobox");
  box.setAttribute("aria-haspopup", "listbox");
  box.setAttribute("aria-labelledby", label.id);
  box.setAttribute("aria-controls", `${o.id}-list`);
  box.setAttribute("aria-expanded", "false");

  const pop = el("div", "ms-pop");
  pop.hidden = true;

  let filterInput: HTMLInputElement | null = null;
  if (o.filter) {
    filterInput = el("input", "ms-search");
    filterInput.id = `${o.id}-filter`;
    filterInput.type = "text";
    filterInput.placeholder = FILTER_PLACEHOLDER;
    filterInput.autocomplete = "off";
    filterInput.spellcheck = false;
    filterInput.setAttribute("aria-label", `Filter ${o.label}`);
    filterInput.setAttribute("aria-controls", `${o.id}-list`);
    pop.append(filterInput);
  }

  const list = el("div", "ms-list");
  list.id = `${o.id}-list`;
  list.tabIndex = -1;
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-multiselectable", "true");
  list.setAttribute("aria-labelledby", label.id);
  pop.append(list);

  /** The element that holds focus while the list is open. */
  const focusHolder = (): HTMLElement => filterInput ?? list;

  const rows: MultiSelectRow[] = [];
  const sections: MultiSelectSection[] = [];
  let allRow: MultiSelectRow | null = null;

  const makeRow = (name: string, text: string, hint?: string): MultiSelectRow => {
    const rowEl = el("div", name === ALL ? "ms-opt all" : "ms-opt");
    rowEl.id = `${o.id}-opt-${seq++}`;
    rowEl.setAttribute("role", "option");
    rowEl.setAttribute("aria-selected", "false");
    rowEl.dataset.name = name;
    const tick = el("span", "tick");
    tick.setAttribute("aria-hidden", "true");
    const textEl = el("span");
    textEl.textContent = text;
    if (hint !== undefined) {
      const small = el("small");
      small.textContent = ` — ${hint}`;
      textEl.append(small);
    }
    rowEl.append(tick, textEl);
    const row: MultiSelectRow = { name, el: rowEl, tick };
    // mousedown would move focus to the row; keep it in the filter or list.
    rowEl.addEventListener("mousedown", (e) => e.preventDefault());
    rowEl.addEventListener("click", () => {
      if (disabled) return;
      const index = visible().indexOf(row);
      pick(name);
      setActive(index);
    });
    return row;
  };

  if (o.allOption !== null) {
    allRow = makeRow(ALL, o.allOption.label, o.allOption.hint);
    list.append(allRow.el);
  }
  for (const g of o.groups) {
    let heading: HTMLElement | null = null;
    if (g.heading !== null) {
      heading = el("div", "ms-group");
      heading.setAttribute("role", "presentation");
      heading.textContent = g.heading;
      list.append(heading);
    }
    const section: MultiSelectSection = { heading, rows: [] };
    for (const name of g.names) {
      const row = makeRow(name, name);
      section.rows.push(row);
      rows.push(row);
      list.append(row.el);
    }
    sections.push(section);
  }
  const empty = el("div", "ms-empty");
  empty.setAttribute("role", "presentation");
  empty.textContent = NO_MATCH_TEXT;
  empty.hidden = true;
  list.append(empty);

  /** The ALL row (always shown) followed by every name row not hidden. */
  function visible(): MultiSelectRow[] {
    return [...(allRow ? [allRow] : []), ...rows.filter((r) => !r.el.hidden)];
  }

  function paint(): void {
    box.textContent = "";
    const names = value === ALL ? [ALL] : value;
    for (const name of names) {
      const text = name === ALL ? (o.allOption?.label ?? ALL) : name;
      const chip = el("span", name === ALL ? "chip all" : "chip");
      chip.dataset.name = name;
      const t = el("span");
      t.textContent = text;
      const x = el("button", "x");
      x.type = "button";
      x.textContent = "×";
      x.setAttribute("aria-label", `Remove ${text}`);
      x.disabled = disabled;
      x.addEventListener("click", (e) => {
        e.stopPropagation(); // the box's own click would toggle the list
        if (disabled) return;
        value = removeName(value, name);
        o.onChange(value);
        paint();
      });
      chip.append(t, x);
      box.append(chip);
    }
    const setSelected = (r: MultiSelectRow, on: boolean): void => {
      r.el.setAttribute("aria-selected", String(on));
      r.tick.classList.toggle("on", on);
    };
    if (allRow) setSelected(allRow, value === ALL);
    for (const r of rows) setSelected(r, value !== ALL && value.includes(r.name));
  }

  function pick(name: string): void {
    value = pickValue(value, name);
    o.onChange(value);
    paint();
  }

  function applyFilter(): void {
    const text = filterInput?.value ?? "";
    let shown = 0;
    for (const s of sections) {
      let any = false;
      for (const r of s.rows) {
        const ok = matchesFilter(r.name, text);
        r.el.hidden = !ok;
        if (ok) {
          any = true;
          shown++;
        }
      }
      if (s.heading) s.heading.hidden = !any;
    }
    empty.hidden = shown > 0;
  }

  function setActive(index: number): void {
    const vis = visible();
    if (allRow) allRow.el.classList.remove("active");
    for (const r of rows) r.el.classList.remove("active");
    if (vis.length === 0) {
      active = -1;
      focusHolder().removeAttribute("aria-activedescendant");
      return;
    }
    active = Math.max(0, Math.min(index, vis.length - 1)); // stops at the ends
    const rowEl = vis[active].el;
    rowEl.classList.add("active");
    focusHolder().setAttribute("aria-activedescendant", rowEl.id);
    if (typeof rowEl.scrollIntoView === "function") rowEl.scrollIntoView({ block: "nearest" });
  }

  const onOutside = (e: MouseEvent): void => {
    if (!root.contains(e.target as Node)) closeList(false);
  };

  function openList(): void {
    if (disabled || isOpen) return;
    isOpen = true;
    pop.hidden = false;
    box.setAttribute("aria-expanded", "true");
    box.classList.add("open");
    applyFilter();
    setActive(0);
    focusHolder().focus();
    document.addEventListener("mousedown", onOutside, true);
  }

  function closeList(returnFocus: boolean): void {
    if (!isOpen) return;
    isOpen = false;
    pop.hidden = true;
    box.setAttribute("aria-expanded", "false");
    box.classList.remove("open");
    focusHolder().removeAttribute("aria-activedescendant");
    document.removeEventListener("mousedown", onOutside, true);
    if (returnFocus) box.focus();
  }

  function setDisabled(d: boolean): void {
    disabled = d;
    box.setAttribute("aria-disabled", String(d));
    box.tabIndex = d ? -1 : 0;
    if (d) closeList(false);
    paint();
  }

  box.addEventListener("click", () => {
    if (disabled) return;
    if (isOpen) closeList(false);
    else openList();
  });
  box.addEventListener("keydown", (e) => {
    if (disabled || e.target !== box) return; // a chip's × button handles its own keys
    if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
      e.preventDefault();
      openList();
    }
  });
  label.addEventListener("click", () => {
    if (!disabled) box.focus();
  });
  pop.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(active + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(active - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      const row = visible()[active];
      if (row === undefined) return;
      e.preventDefault(); // Space must not type into the filter
      pick(row.name);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeList(true);
    }
  });
  filterInput?.addEventListener("input", () => {
    applyFilter();
    setActive(0);
  });

  root.append(label, box, pop);
  setDisabled(o.disabled); // also paints

  return {
    root,
    box,
    getValue: () => value,
    setValue: (v) => {
      value = v;
      paint();
    },
    setDisabled,
    isOpen: () => isOpen,
    open: openList,
    close: () => closeList(false),
  };
}
