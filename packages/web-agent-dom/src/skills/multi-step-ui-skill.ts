import type { SkillDef } from "@cuatoi/web-agent-core";

export const multiStepUiSkill: SkillDef = {
  name: "multi_step_ui",
  description: "How to handle multi-step UI interactions and recover from stale snapshot refs.",
  definition: `# multi_step_ui

## The snapshot → act → verify cycle
1. Always call \`snapshot_page\` before any click/fill/select_option.
2. Refs (e.g. [12]) are only valid from the **most recent** snapshot (check the generation number).
3. After an action that changes the page, call \`wait_for\` then \`snapshot_page\` again before claiming success.

## Stale ref recovery
If a tool returns "ref not found" or "stale snapshot":
1. Re-run \`snapshot_page\` to get fresh refs.
2. Locate the target element in the new snapshot.
3. Retry the action with the new ref.

## Multi-step form flows
- Snapshot the initial state.
- Fill fields one by one; each fill does not need a re-snapshot unless the page re-renders.
- After the final submit/click, always wait_for + snapshot to confirm the outcome.
- Never claim a form was submitted without verifying the success state.
`,
};
