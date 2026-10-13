import type { SkillDef } from "@cuatoi/web-agent-core";

export const tabManagementSkill: SkillDef = {
  name: "tab_management",
  description: "How to inspect and manage browser tabs: read tabs before acting, use returned tab IDs, and handle navigation limits.",
  definition: `# tab_management

## The read → act → verify cycle
1. Always call \`read_tabs\` before performing actions on tabs. Never guess a tab ID.
2. Use the exact tab IDs returned by \`read_tabs\`.
3. Act on one tab at a time (open, navigate, refresh, close).
4. Report clearly what changed after the tool executes.

## Navigation and limits
- \`navigate_tab\` will be blocked by Chrome if targeting restricted URLs such as \`chrome://\`, \`edge://\`, \`chrome-extension://\`, or other browser-internal URLs.
- If navigation is blocked or returns an error from Chrome, treat this as an expected browser security limit and explain it clearly to the user rather than treating it as an unexpected crash.

## Closing tabs
- \`close_tab\` shows the user an Allow/Reject prompt itself. Call it directly; do
  not ask for confirmation in chat first.
- If the user declines confirmation, acknowledge the refusal and do not attempt to force close.
`,
};

export const pageAgentSkill: SkillDef = {
  name: "page_agent",
  description: "How to drive the in-page web agent on visited browser tabs using the 5-step send → wait → read → report loop.",
  definition: `# page_agent

How to drive the in-page web agent on visited browser tabs.

## The 5-step loop for in-page tasks
When delegating a task to the in-page web agent:
1. **Turn the bubble on**: Call \`toggle_page_agent\` with \`state: "on"\` for the
   target tab. If it is already on, nothing changes.
2. **Send the request**: Call \`send_to_page_agent\` with the task text. This delivers the message and returns immediately without waiting for the answer.
3. **First read (30s wait)**: Call \`read_page_agent\` with \`wait: 30\`. The tool pauses for 30 seconds before reading the bubble's conversation and running state.
4. **Check and report progress**:
   - If the bubble agent is still running (\`running: true\`), report current progress to the user so they know the agent is actively working.
   - Then call \`read_page_agent\` again with \`wait: 120\`.
5. **Repeat until finished**: Continue step 4 until \`running: false\`, then report the bubble agent's final answer to the user.

## Waiting discipline
- **Always use the fixed wait**: Pass \`wait: 30\` for the first look after sending, and \`wait: 120\` for subsequent looks.
- **Never re-read without the wait**: Do not poll rapidly or call \`read_page_agent\` with any other wait value.
- **Report on every look**: Keep the user informed after each read while the in-page agent is working.

## Two commands the in-page agent understands
\`send_to_page_agent\` also carries two commands. Send the command on its own, as the whole message text.
- **\`/compact\`**: the in-page agent summarises its older turns and frees up its context. It answers with a compaction row instead of a model turn. When there is nothing to compact yet, it says so and nothing changes.
- **\`/new\`**: the in-page agent starts a fresh session. Its transcript is cleared and the old conversation moves into its session history. \`/clear\` does the same thing.
- **Everything else is an ordinary message**, including text that starts with a slash but is not one of these two commands. It reaches the in-page agent as a user message.
`,
};

/** tab skills (tab_management and page_agent) — spread into a host's skills array. */
export function tabSkills(): SkillDef[] {
  return [tabManagementSkill, pageAgentSkill];
}
