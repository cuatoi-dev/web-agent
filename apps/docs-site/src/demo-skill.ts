import type { SkillDef } from "@cuatoi/web-agent-core";

const definition = `# Web Agent Docs — Full Capability Demo

You are running a scripted product demo. Perform EACH step in order, narrate briefly before each tool call, and do not skip or reorder. Use the exact IDs/values given.

---

**Step 1 — Greet + generative buttons**
Welcome the user to the Web Agent Docs demo. Then call:
\`\`\`
show_generative_ui({
  type: "buttons",
  options: [
    { label: "Lit 3 setup", prompt: "how do I set up Lit 3?" },
    { label: "Embedding", prompt: "how do I embed the agent?" },
    { label: "Theming", prompt: "how do I theme it?" }
  ]
})
\`\`\`

**Step 2 — Discover skills**
Call \`search_skills({ query: "docs" })\` to demonstrate skill discovery. Then call \`load_skill("docs-guide")\` to load the documentation guide skill.

**Step 3 — Framework assumption**
State that for this demo the framework is assumed to be **Lit 3** — this keeps the demo deterministic without waiting for user input.

**Step 4 — Search docs (framework-scoped)**
Call \`search_docs({ query: "lit3 registry" })\`. Report the top result's title and path.

**Step 5 — Second search**
Call \`search_docs({ query: "embedding" })\` to demonstrate a framework-neutral search. Report the top result.

**Step 6 — Snapshot**
Call \`snapshot_page\` to observe the current docs page layout and capture interactive refs.

**Step 7 — DOM interaction (in-page)**
Using the snapshot from Step 6, attempt to \`click\` an in-page interactive ref (e.g. an anchor, tab, or toggle visible on the current page). Call \`wait_for({ condition: "dom_idle" })\`. Call \`snapshot_page\` to confirm. If no safe in-page interactive control is identifiable, instead call \`query_state({ path: "$", mode: "keys_only" })\` to show state introspection — choose deterministically (prefer query_state if uncertain about a safe click target).

**Step 8 — Form (fenced-UI confirm/block)**
Call \`load_skill("present_to_user")\` to load the present-to-user skill. Then call:
\`\`\`
show_generative_ui({
  type: "form",
  id: "feedback-demo",
  fields: [
    { kind: "text", name: "topic", label: "Topic" },
    { kind: "select", name: "framework", label: "Framework", options: ["lit3", "lit1", "vanilla"] },
    { kind: "checkbox", name: "helpful", label: "Was this helpful?" }
  ],
  submit_label: "Send feedback"
})
\`\`\`
Wait for the user's form submission before continuing.

**Step 9 — VISION STEP**
VISION STEP — only if this agent has image input enabled; if you cannot view images, SKIP this step and state "(vision skipped — text-only model)" then continue.
Call \`see\` to visually confirm the current docs page.

**Step 10 — Sessions note**
State that this conversation is persisted under session namespace \`web-agent-docs\` (\`persist: true\`), so it can be resumed across page navigations.

**Step 11 — Close**
Call:
\`\`\`
show_generative_ui({
  type: "buttons",
  options: [
    { label: "Restart demo", prompt: "/demo" },
    { label: "Done", prompt: "thanks" }
  ]
})
\`\`\`
Then state a one-line summary of every capability demonstrated: search_skills, load_skill (docs-guide), search_docs, snapshot_page, click/query_state, show_generative_ui (buttons + form), present_to_user, see (guarded), and sessions (web-agent-docs).
`;

export const docsDemoSkill: SkillDef = {
  name: "demo",
  description:
    "Scripted full-capability demo of the Docs agent: skill/doc search, snapshot, " +
    "generative UI form, and sessions. Trigger with /demo.",
  definition,
};
