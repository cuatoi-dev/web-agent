import type { SkillDef } from "@cuatoi/web-agent-core";
import { SKILLS_KEY } from "./skill-registry";
import type { AgentOwnerRef, SkillStorage } from "./types";

/** The skill array stored under {@link SKILLS_KEY}, or `[]` when the key is
 *  absent or holds something that is not an array. Same tolerance
 *  `skill-registry.ts:38-42` applies: a corrupt key must never blank the page. */
async function readAll(storage: SkillStorage): Promise<SkillDef[]> {
  const got = await storage.get(SKILLS_KEY);
  const stored: unknown = got[SKILLS_KEY];
  return Array.isArray(stored) ? (stored as SkillDef[]) : [];
}

/**
 * Returns the display label for a skill's owner:
 * - undefined owner -> "Shared"
 * - matching agent -> agent.displayName
 * - unknown owner id -> raw id
 */
export function ownerLabel(skill: SkillDef, agents: AgentOwnerRef[]): string {
  if (skill.owner === undefined) return "Shared";
  const a = agents.find((x) => x.id === skill.owner);
  return a ? a.displayName : skill.owner;
}

/** One row: the name, the description, and a Delete button carrying the name.
 *  Built with `createElement` and `textContent`, never `innerHTML` — a skill
 *  name and description are written by a model, so they are untrusted text and
 *  must not be parsed as markup. The definition body is deliberately not
 *  rendered; the plan's Data shapes section says why. */
function buildRow(
  skill: SkillDef,
  agents: AgentOwnerRef[],
  onDelete: (name: string) => void,
): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "skill-row";

  const text = document.createElement("div");
  text.className = "skill-text";
  const name = document.createElement("div");
  name.className = "skill-name";
  name.textContent = skill.name;
  const description = document.createElement("div");
  description.className = "skill-desc";
  description.textContent = skill.description;
  text.append(name, description);

  const owner = document.createElement("span");
  owner.className = skill.owner ? "owner private" : "owner";
  owner.textContent = ownerLabel(skill, agents);

  // A real <button>, not the mockup's <span>: it must be reachable by keyboard
  // and announced as a control. The label says "Delete" in text, so nothing in
  // the row is carried by colour alone.
  const del = document.createElement("button");
  del.type = "button";
  del.className = "skill-del";
  del.textContent = "Delete";
  // Every row's button reads "Delete", so the accessible name says which one.
  del.setAttribute("aria-label", `Delete skill ${skill.name}`);
  del.addEventListener("click", () => onDelete(skill.name));

  row.append(text, owner, del);
  return row;
}

/**
 * Repaints `container` from storage.
 *
 * Storage is re-read on every repaint rather than held in a local array, so a
 * skill an agent created or removed while this page is open cannot leave the
 * page showing a list storage no longer has.
 */
export async function renderSkills(
  container: HTMLElement,
  storage: SkillStorage,
  agents: AgentOwnerRef[] = [],
): Promise<void> {
  const skills = await readAll(storage);
  container.replaceChildren();
  if (skills.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-note";
    empty.textContent = "No skills saved yet. Ask the agent to create one and it appears here.";
    container.append(empty);
    return;
  }
  const onDelete = (name: string) => void onDeletePressed(container, storage, name, agents);
  for (const skill of skills) container.append(buildRow(skill, agents, onDelete));
}

/**
 * Removes `name` from storage, then repaints.
 *
 * A name that is already gone is not an error: another context deleted it
 * between the paint and the click. Nothing is written in that case, and the
 * repaint shows whatever storage actually holds.
 */
export async function onDeletePressed(
  container: HTMLElement,
  storage: SkillStorage,
  name: string,
  agents: AgentOwnerRef[] = [],
): Promise<void> {
  const skills = await readAll(storage);
  const without = skills.filter((s) => s.name !== name);
  if (without.length !== skills.length) {
    await storage.set({ [SKILLS_KEY]: without });
  }
  await renderSkills(container, storage, agents);
}
