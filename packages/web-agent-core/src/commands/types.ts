// The resolved slash-command list and its rows.

/** One row of the resolved command list. Both a host skill marked
 *  `command: true` and one of core's own actions resolve into this shape. */
export interface CommandEntry {
  /** Canonical name, as registered. */
  name: string;
  /** The name the menu shows and `pick` inserts. For a skill this is `name`;
   *  for a core action it is the first name a host did not take, so the row
   *  always shows a name that actually works. */
  displayName: string;
  description: string;
  argumentHint?: string;
  /** Aliases as registered, before collision filtering. */
  aliases: string[];
  /** Every name that actually resolves to this entry. */
  matchNames: string[];
  /** "skill" briefs the agent; "action" runs code. */
  kind: "skill" | "action";
  /** kind "skill" only — the prompt sent when the command runs. */
  definition?: string;
  /** kind "action" only — resolves true when it acted, false when it could
   *  not (for example nothing to compact). */
  action?: () => Promise<boolean>;
  /** kind "action" only — what to show the user when `action` resolves false. */
  unavailableMessage?: string;
}

/** A core command before collision resolution. Internal to core: there is
 *  no registration path for a host handler. */
export interface CoreCommandDef {
  name: string;
  aliases: string[];
  description: string;
  action: () => Promise<boolean>;
  unavailableMessage: string;
}

/** The resolved list plus the lookup P3 describes. */
export interface CommandList {
  entries: CommandEntry[];
  /** Case-insensitive. Canonical names and aliases live in one map, so
   *  `/clear` and `/new` reach the same entry with no second lookup. */
  resolve(typedName: string): CommandEntry | undefined;
}
