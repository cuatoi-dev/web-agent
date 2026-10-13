import type { SkillDef } from "../tools/skill-def.types.js";
import type { SkillRegistry } from "./types.js";
export type { SkillRegistry } from "./types.js";

const SKILLS_KEY = "web-agent-skills";

/**
 * Default `localStorage`-backed registry core ships, so a browser host gets
 * persistent skills without writing storage code.
 *
 * An optional namespace scopes the storage key, exactly as `IdbSessionStore`
 * scopes its IndexedDB database name — two registries built with different
 * namespaces never see each other's skills.
 */
export class LocalStorageSkillRegistry implements SkillRegistry {
  private readonly _key: string;

  constructor(namespace?: string) {
    this._key = namespace ? `${SKILLS_KEY}-${namespace}` : SKILLS_KEY;
  }

  async list(): Promise<SkillDef[]> {
    // `require-await`: no internal await, but localStorage.getItem/JSON.parse
    // can throw synchronously, so dropping `async` would turn that into a
    // synchronous throw instead of a rejection (moot here since the try/catch
    // below already swallows it, but keeping `async` costs nothing).
    await Promise.resolve();
    // Corrupt or absent JSON yields an empty list, never a throw: a broken
    // storage key must not stop the session from starting.
    try {
      const raw = localStorage.getItem(this._key);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? (parsed as SkillDef[]) : [];
    } catch {
      return [];
    }
  }

  async get(name: string): Promise<SkillDef | undefined> {
    return (await this.list()).find((s) => s.name === name);
  }

  async save(skill: SkillDef): Promise<void> {
    const all = await this.list();
    const i = all.findIndex((s) => s.name === skill.name);
    if (i === -1) all.push(skill);
    else all[i] = skill;
    localStorage.setItem(this._key, JSON.stringify(all));
  }

  async remove(name: string): Promise<void> {
    const all = await this.list();
    localStorage.setItem(
      this._key,
      JSON.stringify(all.filter((s) => s.name !== name)),
    );
  }
}

/**
 * Merge registry skills over a base list. **The registry wins a name clash** —
 * its entry replaces the base entry in place, so the merged list has exactly one
 * entry per name and the base list's order is preserved. A registry skill whose
 * name is not in the base list is appended, in registry order.
 */
export function mergeSkills(base: SkillDef[], registry: SkillDef[]): SkillDef[] {
  const out = [...base];
  for (const skill of registry) {
    const i = out.findIndex((s) => s.name === skill.name);
    if (i === -1) out.push(skill);
    else out[i] = skill;
  }
  return out;
}

/**
 * P8 — the model-facing view of a skill list. A skill with
 * `disableModelInvocation: true` is hidden from `search_skills`, `load_skill`
 * and the `# Skills` prompt section. It stays in the **user**-facing command
 * list, which uses the full list.
 */
export function modelVisibleSkills(skills: SkillDef[]): SkillDef[] {
  return skills.filter((s) => s.disableModelInvocation !== true);
}

/**
 * Read a configured registry once, degrading the way an optional tool provider
 * does: a rejecting `list()` is `console.warn`-logged and contributes no skills,
 * and never fails the session.
 */
export async function loadRegistrySkills(
  registry: SkillRegistry | undefined,
): Promise<SkillDef[]> {
  if (!registry) return [];
  try {
    return (await registry.list()) ?? [];
  } catch (err) {
    console.warn(
      "[skills] skill registry failed to load — its skills are unavailable " +
        `this session: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
    return [];
  }
}
