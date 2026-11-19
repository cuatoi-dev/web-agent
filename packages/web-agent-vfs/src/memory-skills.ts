// The two memory skills. They carry rules only: the file tools do the
// reads and writes. `memorySkills` reads the resolved memory options from the
// provider, so the skill text names the real paths and limits.
import type { SkillDef } from "@cuatoi/web-agent-core";
import type { ResolvedMemory, VfsToolProvider } from "./types.js";

const USER_TEMPLATE = "# User\n\n## About\n\n## Preferences\n";
const MEMORY_TEMPLATE = "# Memory\n\n## Facts\n\n## Decisions\n";

/** The two skills for `SessionConfig.skills`, or `[]` when memory is off. */
export function memorySkills(provider: VfsToolProvider): SkillDef[] {
  const m = provider.memory;
  if (!m) return [];
  return [rememberSkill(m), onboardingSkill(m)];
}

function rememberSkill(m: ResolvedMemory): SkillDef {
  return {
    name: "remember",
    description:
      "Save, change or forget an entry in USER.md or MEMORY.md. Use only when the user asks you to remember, change or forget something, or agrees when you offer.",
    definition: `# remember

You keep two memory files. Change them only when the user asks you to remember,
change or forget something, or agrees when you offer.

## 1. Choose the file
A fact about the user goes in ${m.userPath}.
Anything else goes in ${m.memoryPath}.

## 2. Read it first
Call read_file on the file you chose. If it does not exist, it starts as:

${m.userPath}:
\`\`\`
${USER_TEMPLATE}\`\`\`

${m.memoryPath}:
\`\`\`
${MEMORY_TEMPLATE}\`\`\`

## 3. Save, change or forget
Save: if an entry already says the same thing, change that entry in place with
edit_file. Otherwise add a new line "- {entry} ({YYYY-MM-DD HH:mm})" under the
heading that fits. Use the local date and time.
Change: edit the matching entry, and update its date and time.
Forget: delete the matching entry. If more than one entry matches, ask which one.

## 4. Stay under the limit
${m.userPath} must stay under ${m.userMaxChars} characters.
${m.memoryPath} must stay under ${m.memoryMaxChars} characters.
Before you add an entry, if the file would go over the limit, merge similar
entries and remove stale ones. Say what you merged or removed.

## 5. Reply
Reply with the exact line you saved, changed or removed, and the file it is in.
`,
  };
}

function onboardingSkill(m: ResolvedMemory): SkillDef {
  return {
    name: "onboarding",
    description: "Create USER.md with the user, when it does not exist yet.",
    definition: `# onboarding

${m.userPath} does not exist yet. Create it with a short conversation.

## 1. Offer once
Say: "I can remember a few things about you so I can help better. Want to set
that up? It takes four short questions."
If the user declines, stop, and do not offer again in this chat.

## 2. Ask one question at a time, at most four
1. What should I call you?
2. What is your role?
3. How do you like answers (short, detailed, ...)?
4. Anything else I should always keep in mind?

## 3. Skip what the user does not answer
Skip any question the user does not answer. Never fill in a value the user did
not give.

## 4. Write the file
Write ${m.userPath} with this template, and the answers as entries stamped with
the local date and time (the format from the remember skill), under About and
Preferences:
\`\`\`
${USER_TEMPLATE}\`\`\`

## 5. Show the result
Show the file you wrote.
`,
  };
}
