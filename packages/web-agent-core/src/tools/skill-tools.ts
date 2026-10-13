import type { CustomToolDef, ToolContext } from "./types.js";
import type { SkillDef } from "./skill-def.types.js";
import type { JsonSchemaObject } from "../types.js";

/** search_skills, load_skill — read ctx.skills at execute time. No prompt snippet
 *  (the # Skills prompt section is rendered separately in system-prompt.ts).
 *  `create_skill` (idea 102 task 002) is appended only when `ctx.skillRegistry`
 *  exposes a `save` method, and `delete_skill` (idea 114 task 004) only when it
 *  exposes a `remove` method — the optional method IS the writable signal, there
 *  is no separate config flag. `create_skill` offers an optional `shared` input
 *  only when the registry sets `supportsOwner` (idea 120 task 004). */
export function skillTools(ctx?: ToolContext): CustomToolDef[] {
  const searchSkillsSchema: JsonSchemaObject = {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Search term to match against skill names and descriptions",
      },
    },
    required: ["query"],
    additionalProperties: false,
  };
  const loadSkillSchema: JsonSchemaObject = {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Exact skill name as listed in # Skills",
      },
    },
    required: ["name"],
    additionalProperties: false,
  };
  // 120/004 — `shared` exists only when the registry stores owners, so every
  // other host's create_skill schema is exactly what it was.
  const offersShared = ctx?.skillRegistry?.supportsOwner === true;
  const createSkillSchema: JsonSchemaObject = {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Unique name for the skill. Must match an existing skill name to overwrite, or a new name to create.",
      },
      description: {
        type: "string",
        description: "Short summary of what the skill does and when to use it.",
      },
      definition: {
        type: "string",
        description: "Full markdown instructions and procedure for the skill.",
      },
      ...(offersShared
        ? {
            shared: {
              type: "boolean",
              description: "true or missing: every agent can use the skill. false: only you can use it.",
            },
          }
        : {}),
    },
    required: ["name", "description", "definition"],
    additionalProperties: false,
  };
  const deleteSkillSchema: JsonSchemaObject = {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Exact name of the saved skill to delete.",
      },
    },
    required: ["name"],
    additionalProperties: false,
  };

  const tools: CustomToolDef[] = [
    {
      name: "search_skills",
      description:
        "Search the skill registry by name or description. Returns matching skill names and descriptions.",
      inputSchema: searchSkillsSchema,
      execute: async (input, ctx) => {
        // `require-await`: no internal await, but ctx.skills is host-supplied
        // and reading it can throw, so dropping `async` would turn that into a
        // synchronous throw instead of a rejection.
        await Promise.resolve();
        const rawQuery = input.query;
        if (typeof rawQuery !== "string" || rawQuery.trim() === "")
          return {
            content:
              'search_skills was called without a query. The "query" argument is required. ' +
              'Call search_skills again with {"query": "<search term>"}.',
            isError: true,
          };
        const q = rawQuery.toLowerCase();
        const matches = (ctx.skills ?? []).filter(
          (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
        );
        if (matches.length === 0) return { content: "No skills matched the query." };
        return { content: matches.map((s) => `${s.name} — ${s.description}`).join("\n") };
      },
    },
    {
      name: "load_skill",
      description: "Load the full definition of a skill by exact name.",
      inputSchema: loadSkillSchema,
      execute: async (input, ctx) => {
        // `require-await`: no internal await, but ctx.skills is host-supplied
        // and reading it can throw, so dropping `async` would turn that into a
        // synchronous throw instead of a rejection.
        await Promise.resolve();
        const requested = input.name;
        if (typeof requested !== "string" || requested.trim() === "")
          return {
            content:
              'load_skill was called without a skill name. The "name" argument is required. ' +
              'Call load_skill again with {"name": "<exact skill name>"}, or call search_skills first to list the names.',
            isError: true,
          };
        const skill = (ctx.skills ?? []).find((s) => s.name === requested);
        if (!skill)
          return {
            content: `Skill "${requested}" not found. Use search_skills to discover available skills.`,
            isError: true,
          };
        return { content: skill.definition };
      },
    },
  ];

  if (ctx?.skillRegistry && typeof ctx.skillRegistry.save === "function") {
    tools.push({
      name: "create_skill",
      description:
        "Save a new skill definition, or overwrite an existing one, in the skill registry. " +
        "Call it directly: the tool shows the user an Allow/Reject prompt and waits for the answer. " +
        "Do not ask for confirmation in chat first. The saved skill is available immediately " +
        "via load_skill and search_skills in this same turn.",
      inputSchema: createSkillSchema,
      execute: async (input, execCtx) => {
        const rawName = input.name;
        const rawDesc = input.description;
        const rawDef = input.definition;

        if (typeof rawName !== "string" || rawName.trim() === "")
          return { content: 'create_skill failed: "name" is required and cannot be empty.', isError: true };
        if (typeof rawDesc !== "string" || rawDesc.trim() === "")
          return { content: 'create_skill failed: "description" is required and cannot be empty.', isError: true };
        if (typeof rawDef !== "string" || rawDef.trim() === "")
          return { content: 'create_skill failed: "definition" is required and cannot be empty.', isError: true };

        const name = rawName.trim();
        const description = rawDesc.trim();
        const definition = rawDef.trim();
        const isOverwrite = (execCtx.skills ?? []).some((s) => s.name === name);

        // 120/004 — an owner-aware registry names who the new skill is for.
        // `shared` missing or true = every agent; only `false` is private.
        const registry = execCtx.skillRegistry;
        const ownerAware = registry?.supportsOwner === true;
        const shared = input.shared !== false;
        let summary = `Create skill "${name}"`;
        if (isOverwrite) summary = `Overwrite existing skill "${name}"`;
        else if (ownerAware && !shared) summary = `Create skill "${name}" for ${registry?.ownerLabel ?? ""} only`;
        else if (ownerAware) summary = `Create skill "${name}" for all agents`;

        if (execCtx.confirmInteraction) {
          const confirmed = await execCtx.confirmInteraction({
            action: isOverwrite ? "overwrite skill" : "create skill",
            name,
            reason: isOverwrite ? `Overwrite existing skill "${name}"` : undefined,
            summary,
          });
          if (!confirmed)
            return { content: `Creation of skill "${name}" was not confirmed by the user; not saved.`, isError: true };
        }

        if (!registry || typeof registry.save !== "function")
          return { content: `Cannot save skill "${name}": no writable skill registry is configured.`, isError: true };

        try {
          const newSkill: SkillDef = { name, description, definition };
          // A registry without owners gets exactly the one-argument call it
          // always got.
          if (ownerAware) await registry.save(newSkill, { shared });
          else await registry.save(newSkill);

          // Same-turn visibility: push into ctx.skills directly so load_skill
          // and search_skills see it without waiting for the next initAgent().
          if (execCtx.skills) {
            const idx = execCtx.skills.findIndex((s) => s.name === name);
            if (idx === -1) execCtx.skills.push(newSkill);
            else execCtx.skills[idx] = newSkill;
          } else {
            execCtx.skills = [newSkill];
          }

          return { content: `Skill "${name}" saved successfully. It is available immediately via load_skill and search_skills.` };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { content: `Failed to save skill "${name}": ${message}`, isError: true };
        }
      },
    });
  }

  if (ctx?.skillRegistry && typeof ctx.skillRegistry.remove === "function") {
    tools.push({
      name: "delete_skill",
      description:
        "Delete a saved skill from the skill registry. Call it directly: the tool shows the user " +
        "an Allow/Reject prompt and waits for the answer. Do not ask for confirmation in chat first. " +
        "The skill stops being available immediately.",
      inputSchema: deleteSkillSchema,
      execute: async (input, execCtx) => {
        const rawName = input.name;

        if (typeof rawName !== "string" || rawName.trim() === "")
          return { content: 'delete_skill failed: "name" is required and cannot be empty.', isError: true };

        const name = rawName.trim();
        const exists = (execCtx.skills ?? []).some((s) => s.name === name);
        if (!exists)
          return {
            content: `Skill "${name}" not found. Use search_skills to see available skills.`,
            isError: true,
          };

        if (execCtx.confirmInteraction) {
          const confirmed = await execCtx.confirmInteraction({
            action: "delete skill",
            name,
            summary: `Delete skill "${name}"`,
          });
          if (!confirmed)
            return {
              content: `Deletion of skill "${name}" was not confirmed by the user; nothing was deleted.`,
              isError: true,
            };
        }

        // Re-read the registry off execCtx, not off the closure — the exec
        // context is the live one, exactly as create_skill does above.
        const registry = execCtx.skillRegistry;
        if (!registry || typeof registry.remove !== "function")
          return { content: `Cannot delete skill "${name}": no removable skill registry is configured.`, isError: true };

        try {
          await registry.remove(name);

          // Same-turn effect: splice the entry out of ctx.skills IN PLACE, so
          // load_skill and search_skills stop finding it without waiting for
          // the next initAgent(). The mirror of create_skill's push above —
          // and it must be a splice, not a reassignment, because the array
          // identity is shared with the controller.
          if (execCtx.skills) {
            const at = execCtx.skills.findIndex((s) => s.name === name);
            if (at !== -1) execCtx.skills.splice(at, 1);
          }

          return { content: `Skill "${name}" deleted.` };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { content: `Failed to delete skill "${name}": ${message}`, isError: true };
        }
      },
    });
  }

  return tools;
}
