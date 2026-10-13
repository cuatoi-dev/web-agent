import type { SkillDef } from "@cuatoi/web-agent-core";

export const pageFetchSkill: SkillDef = {
  name: "page_fetch",
  description: "When and how to reach the visited site directly — page_fetch for its own HTTP API, page_eval for running JavaScript in the page — instead of clicking through UI elements.",
  definition: `# page_fetch

## When to use page_fetch
- Use \`page_fetch\` when the visited page exposes an HTTP API (e.g. REST/JSON endpoints like \`/api/...\`) that can answer a question or perform an action in a single request.
- Prefer \`page_fetch\` over clicking through multi-step UI forms or paginated lists when a direct API call is faster and less prone to UI rendering delays.

## Rules and constraints
1. **Same-origin only**: Only fetch relative paths (e.g. \`/api/items\`) or absolute URLs matching the current page's origin. Cross-origin requests are blocked before leaving the page.
2. **Session cookies included**: Requests execute directly from the page's execution realm with the user's active session and cookies.
3. **Inspect status and errors**: Inspect the returned status code and response body. If the server returns a 4xx or 5xx, inspect the error message in the response before retrying or falling back to UI interaction.

## When to use page_eval
- Use \`page_eval\` when the page already exposes a function or a value that does the job. Reading a global or calling the page's own function is faster and more reliable than clicking to reach the same result.
- Use it to read a framework's state, call a function the page already defines, or make a change that has no button.
- Prefer \`page_fetch\` when the answer is behind an HTTP endpoint, and \`page_eval\` when it is already in the page's own JavaScript.

## Rules and constraints for page_eval
1. **The code is an async function body**: use \`return\` to send a value back, and \`await\` for anything asynchronous. Code with no \`return\` gives back \`undefined\`.
2. **It runs in the page's realm**: the page's globals, objects and functions are all in scope, exactly as the site's own scripts see them.
3. **The page's Content Security Policy applies**: if the page does not allow \`'unsafe-eval'\`, the tool returns an error naming that policy. Use another tool on that page instead of retrying the same code.
4. **The code runs on the page's own thread** and cannot be interrupted once it starts.
5. **Results are capped**: a long result is truncated with a visible marker. Return only what you need — a count or a field, not a whole object graph.
`,
};
