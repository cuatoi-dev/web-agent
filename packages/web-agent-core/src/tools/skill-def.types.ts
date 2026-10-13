// `SkillDef` on its own, with no imports at all. `skills/types.ts` needs it
// to describe `SkillRegistry`, and `tools/types.ts` needs `SkillRegistry`;
// keeping this shape here is what stops those two files importing each other.

export interface SkillDef {
  name: string;
  description: string;
  definition: string;

  /** Invocable as `/name`. Absent or false = today's behaviour exactly:
   *  a skill the model reaches with load_skill, invisible to the user. */
  command?: boolean;

  /** Shown after the name in the menu, e.g. "[month]". Purely visual —
   *  there is no substitution and no template language. */
  argumentHint?: string;

  /** Extra names that resolve to this entry. Matched by the filter and by
   *  collision detection; never listed as its own menu row. */
  aliases?: string[];

  /** Hide this entry from the model: it drops out of search_skills,
   *  load_skill and the "# Skills" prompt section. It stays visible to the
   *  user. Absent = the model can reach it, as today. */
  disableModelInvocation?: boolean;

  /** The id of the agent that owns this skill. Absent = shared: every agent
   *  that reads the registry sees it. Only a registry with `supportsOwner`
   *  sets it (idea 120 task 004). */
  owner?: string;
}
