import type { SkillDef } from "../tools/skill-def.types.js";
import type { CommandEntry, CommandList, CoreCommandDef } from "./types.js";
export type { CommandEntry, CommandList, CoreCommandDef } from "./types.js";


const NAME_RE = /^[A-Za-z0-9_-]+$/;

/** P1 — split what the user typed into a command name and its argument.
 *  Returns null for anything that is not a command, so the caller sends it as
 *  ordinary text. */
export function parseSlashInput(
  text: string,
): { name: string; argument: string } | null {
  if (!text.startsWith("/")) return null;
  const body = text.slice(1);
  if (body.length === 0) return null;
  const m = /\s/.exec(body);
  const name = m ? body.slice(0, m.index) : body;
  const argument = m ? body.slice(m.index).trim() : "";
  if (!NAME_RE.test(name)) return null;
  return { name, argument };
}

/** P2 — build the list and resolve collisions. Host skills claim first, so a
 *  host wins the exact name it registered; core then fills only what is still
 *  free, and warns when a host left it holding half a command.
 *
 *  001/113 — core's OWN names are reserved and cannot be claimed by a skill.
 *  A skill shadowing /new makes the session unresettable and the user cannot
 *  see why. Every other name keeps the host-first rule. */
export function buildCommandList(
  coreCommands: CoreCommandDef[],
  skills: SkillDef[],
): CommandList {
  const entries: CommandEntry[] = [];
  const taken = new Map<string, CommandEntry>();
  const reserved = new Set<string>(
    coreCommands.flatMap((c) => [c.name, ...c.aliases]).map((n) => n.toLowerCase()),
  );

  const claim = (name: string, e: CommandEntry): void => {
    const key = name.toLowerCase();
    if (taken.has(key)) return;            // first claim wins
    taken.set(key, e);
  };

  for (const skill of skills) {
    if (skill.command !== true) continue;
    const aliases = skill.aliases ?? [];
    const e: CommandEntry = {
      name: skill.name,
      displayName: skill.name,
      description: skill.description,
      argumentHint: skill.argumentHint,
      aliases,
      matchNames: [skill.name, ...aliases],
      kind: "skill",
      definition: skill.definition,
    };
    for (const n of e.matchNames) {
      if (reserved.has(n.toLowerCase())) {
        console.warn(
          `[web-agent] skill '${skill.name}' cannot claim reserved command` +
            ` '${n}'; core keeps it`,
        );
        continue;                          // not claimed — core wins this name
      }
      claim(n, e);
    }
    entries.push(e);                       // the skill still appears in the list
  }

  for (const cmd of coreCommands) {
    const all = [cmd.name, ...cmd.aliases];
    const free = all.filter((n) => !taken.has(n.toLowerCase()));
    if (free.length === 0) {
      console.warn(
        `[web-agent] /${cmd.name} and every alias are taken by a host entry;` +
          ` core's action is unreachable`,
      );
      continue;
    }
    if (free.length < all.length) {
      const stolen = all.filter((n) => !free.includes(n));
      console.warn(
        `[web-agent] a host entry took /${stolen.join(", /")}; core's action` +
          ` still answers to /${free.join(", /")}`,
      );
    }
    const e: CommandEntry = {
      name: cmd.name,
      displayName: free[0],                // the row shows a name that works
      description: cmd.description,
      argumentHint: "[then…]",
      aliases: cmd.aliases,
      matchNames: free,
      kind: "action",
      action: cmd.action,
      unavailableMessage: cmd.unavailableMessage,
    };
    for (const n of free) claim(n, e);
    entries.push(e);
  }

  return {
    entries,
    resolve: (typedName: string) => taken.get(typedName.toLowerCase()),
  };
}
