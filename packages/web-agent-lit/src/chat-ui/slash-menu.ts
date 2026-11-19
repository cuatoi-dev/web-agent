import type { CommandEntry } from "@cuatoi/web-agent-core";
import type { SlashMenuModel } from "./types.js";

/** The two row glyphs, inlined as SVG.
 *
 *  They are deliberately NOT routed through `<wa-icon-button>`. Both element
 *  sets fall back to rendering the icon NAME as literal text for a name they
 *  do not know (`WaIconButton`/`AcmeIconButton` in
 *  `packages/web-agent-lit/src/ui/wa-elements.ts` and
 *  `apps/cat-store/src/acme-elements.ts`),
 *  which is exactly the "icon name rendered as text" defect the review gate
 *  rejects — and a row glyph is decoration inside an option, not a button.
 *  `fill="currentColor"` makes each glyph follow its row's own text colour, so
 *  no colour literal appears here.
 *
 *  The two shapes are told apart by SHAPE, not colour: an outline chevron
 *  versus a filled page with three lines. Both survive a greyscale conversion. */
export const SLASH_ICON_ACTION =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" focusable="false">' +
  '<path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"></path></svg>';

export const SLASH_ICON_SKILL =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" focusable="false">' +
  '<path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"></path></svg>';

/** P9 — filter and rank. An empty query returns registration order, unchanged.
 *
 *  Rank 1 tests `matchNames` rather than `aliases`: `aliases` is "as
 *  registered, before collision filtering" while `matchNames` is "every name
 *  that actually resolves to this entry" (`commands/types.ts:14-17`).
 *  Ranking on a name that no longer resolves would offer the user a name that
 *  does nothing. `displayName` is already rank 0, so rank 1 is in practice the
 *  working aliases. */
export function filterCommandEntries(
  entries: CommandEntry[],
  query: string,
): CommandEntry[] {
  if (query === "") return entries.slice();
  const q = query.toLowerCase();
  const matches: { entry: CommandEntry; rank: number; order: number }[] = [];
  entries.forEach((entry, order) => {
    const name = entry.displayName.toLowerCase();
    const description = (entry.description || "").toLowerCase();
    let rank: number;
    if (name.startsWith(q)) rank = 0;
    else if (entry.matchNames.some((n) => n.toLowerCase().startsWith(q))) rank = 1;
    else if (name.includes(q)) rank = 2;
    else if (description.includes(q)) rank = 3;
    else return;
    matches.push({ entry, rank, order });
  });
  if (matches.length === 0) return [];
  matches.sort((a, b) => a.rank - b.rank || a.order - b.order);
  const bestRank = matches[0].rank;
  return matches.filter((m) => m.rank === bestRank).map((m) => m.entry);
}

/** The `or /clear` hint: every name that resolves to this entry except the one
 *  the row already shows. Empty when the entry answers to one name only. */
export function aliasHintFor(entry: CommandEntry): string {
  const others = entry.matchNames.filter(
    (n) => n.toLowerCase() !== entry.displayName.toLowerCase(),
  );
  if (others.length === 0) return "";
  return `or ${others.map((n) => `/${n}`).join(", ")}`;
}

export type { SlashMenuModel };

/** Rebuild `container`'s children for the current model.
 *
 *  The menu owns its own DOM: the composer deliberately never re-renders the
 *  panel on input (`chat-panel-elements.ts:31-41`), because a redraw would replace
 *  every rendered block element and rebuild each chart. */
export function renderSlashMenu(container: HTMLElement, model: SlashMenuModel): void {
  container.replaceChildren();

  const list = document.createElement("div");
  list.className = "wa-slash-list";

  model.entries.forEach((entry, i) => {
    const row = document.createElement("div");
    row.className = "wa-slash-row";
    row.id = `${model.idPrefix}${i}`;
    row.setAttribute("role", "option");
    const selected = i === model.highlight;
    row.setAttribute("aria-selected", selected ? "true" : "false");
    if (selected) row.classList.add("is-highlighted");

    const icon = document.createElement("span");
    icon.className = "wa-slash-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = entry.kind === "action" ? SLASH_ICON_ACTION : SLASH_ICON_SKILL;

    const name = document.createElement("span");
    name.className = "wa-slash-name";
    name.textContent = `/${entry.displayName}`;

    row.append(icon, name);

    const alias = aliasHintFor(entry);
    if (alias) {
      const aliasEl = document.createElement("span");
      aliasEl.className = "wa-slash-alias";
      aliasEl.textContent = alias;
      row.appendChild(aliasEl);
    }

    if (entry.argumentHint) {
      const argEl = document.createElement("span");
      argEl.className = "wa-slash-arg";
      argEl.textContent = entry.argumentHint;
      row.appendChild(argEl);
    }

    const desc = document.createElement("span");
    desc.className = "wa-slash-desc";
    desc.textContent = entry.description;
    row.appendChild(desc);

    row.addEventListener("click", () => model.onPick(entry));
    list.appendChild(row);
  });

  const legend = document.createElement("div");
  legend.className = "wa-slash-legend";
  const legendItems: [string, string][] = [
    [SLASH_ICON_ACTION, "runs an action"],
    [SLASH_ICON_SKILL, "briefs the agent"],
  ];
  for (const [svg, words] of legendItems) {
    const item = document.createElement("span");
    item.className = "wa-slash-legend-item";
    const glyph = document.createElement("span");
    glyph.className = "wa-slash-icon";
    glyph.setAttribute("aria-hidden", "true");
    glyph.innerHTML = svg;
    const text = document.createElement("span");
    text.textContent = words;
    item.append(glyph, text);
    legend.appendChild(item);
  }
  const keys = document.createElement("span");
  keys.className = "wa-slash-keys";
  keys.textContent = "↑↓ · Tab · Esc";
  legend.appendChild(keys);

  container.append(list, legend);
}
