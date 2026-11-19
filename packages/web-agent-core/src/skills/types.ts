// The skill-registry seam.

import type { SkillDef } from "../tools/skill-def.types.js";

/**
 * An async source of skills, read **once** at session start.
 *
 * `config.skills` is a synchronous array, so skills held in browser storage or
 * on a host's own server cannot go through it. A registry is the async seam
 * next to it: the host constructs it (e.g. `new LocalStorageSkillRegistry()`)
 * and passes it in `SessionConfig.skillRegistry`.
 *
 * `list` and `get` are required. `save` and `remove` are optional — a registry
 * that omits `save` is read-only, and that is how a later task detects whether
 * the registry accepts writes. There is no separate writable flag.
 *
 * `supportsOwner` and `ownerLabel` are optional too. A registry that sets
 * `supportsOwner: true` stores an owner per skill, and `create_skill` then
 * offers the optional `shared` input. Every other
 * registry is unchanged.
 *
 * Reading happens at session start, and again when `updateConfig()` passes a
 * different `skillRegistry` object.
 */
export interface SkillRegistry {
  /** Every skill this registry holds. Returns `[]` when it holds none. */
  list(): Promise<SkillDef[]>;
  /** One skill by exact name, or `undefined` when absent. */
  get(name: string): Promise<SkillDef | undefined>;
  /** Optional. Present only on a registry that accepts writes. `options` is
   *  passed only to a registry with `supportsOwner`; `shared: false` saves
   *  the skill for the registry's owner only. */
  save?(skill: SkillDef, options?: { shared?: boolean }): Promise<void>;
  /** Optional. Present only on a registry that accepts writes. */
  remove?(name: string): Promise<void>;
  /** True when the registry stores an owner per skill. Absent = no owners. */
  supportsOwner?: boolean;
  /** The owner's display name, used in the `create_skill` confirm summary
   *  (`Create skill "<name>" for <ownerLabel> only`). */
  ownerLabel?: string;
}
