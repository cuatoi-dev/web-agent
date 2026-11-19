---
title: In-page tools
---

# In-page tools

The in-page bubble is the agent mounted on the visited page itself. It carries
the DOM and state tools from `@cuatoi/web-agent-dom`, the file tools from
`@cuatoi/web-agent-vfs`, and two tools of its own, `page_fetch` and
`page_eval`, wired at `src/content.ts:107-124`. It also
carries three built-in skill sets: the core skills, the DOM skills, and the
`page_fetch` reference skill (`src/content.ts:91-98`,
`src/lib/page-fetch-skill.ts:3-29`).

The side panel agent has its own `page_fetch` and `page_eval`, which take a tab
ID. See [Side panel tools](./side-panel-tools.md). The bubble also has a todo
list and saved skills. See [Using the extension](./using-the-extension.md).

## `page_fetch`

From `src/lib/page-fetch-tool.ts` and `src/core/run-fetch.ts`:

- **What it does**: an HTTP request to the visited page's own origin, issued
  from the page's realm (`src/core/run-fetch.ts:45-51`).
- **Arguments**: `url` (relative path or same-origin absolute URL), `method`
  (one of GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS, default GET), `headers`,
  `body` (`src/lib/page-fetch-tool.ts:23-40`).
- **Same-origin only.** A URL on another origin is refused before any request
  leaves, with "Cross-origin request blocked: requested origin … does not match
  page origin …" (`src/core/run-fetch.ts:37-43`,
  `src/lib/page-fetch-tool.ts:65-70`).
- **It carries the user's cookies and session**: the call passes
  `credentials: "same-origin"` (`src/core/run-fetch.ts:50`), so the site sees
  the request as coming from the signed-in user. Anything the user can reach on
  that site by being logged in, this tool can reach.
- **What comes back**: `Status: …`, `Content-Type: …`, then the body
  (`src/lib/page-fetch-tool.ts:79-80`). When the response has no content type,
  the line reads `Content-Type: (unknown)` (`src/core/run-fetch.ts:53`).
- **The 6000-character cap**: a longer body is cut and ends with
  `…(output truncated)`. The limit is `DEFAULT_PAGE_FETCH_MAX_CHARS = 6000` at
  `src/lib/constants.ts:49`, applied to the body at
  `src/core/run-fetch.ts:55-56`.
- **Errors**:
  - An empty `url` returns "No URL or path provided to page_fetch."
    (`src/core/run-fetch.ts:21-24`).
  - A URL that cannot be parsed returns `Invalid URL "<url>": <reason>`
    (`src/core/run-fetch.ts:26-35`).
  - A request that fails before a response arrives returns
    `Network error while fetching "<url>": <message>`
    (`src/lib/page-fetch-tool.ts:72-77`).

## `page_eval`

From `src/lib/page-eval-tool.ts` and `src/core/run-eval.ts`:

- **What it runs**: the model supplies JavaScript, which becomes the body of an
  async function built by the page realm's own `AsyncFunction` and called there
  (`src/core/run-eval.ts:15-21`, `:126`). Use `return` to send a value back and
  `await` for anything asynchronous.
- **It runs in the visited page's own realm**, so `window`, `document` and every
  global, object and function the site defines are in scope, exactly as the
  site's own scripts see them (`src/lib/page-fetch-skill.ts:24`).
- **What comes back**: `Result type: <kind>` and the serialized value; a value
  JSON cannot express is described instead (`src/core/run-eval.ts:23-68`,
  `src/lib/page-eval-tool.ts:55-56`). The same 6000-character cap and the same
  `…(output truncated)` marker apply (`DEFAULT_PAGE_EVAL_MAX_CHARS` at
  `src/lib/constants.ts:54`, applied by `truncate` at
  `src/core/run-eval.ts:103-105`).
- An error thrown by the code comes back as "The code threw <name>: <message>"
  (`src/lib/page-eval-tool.ts:49`); empty code comes back as
  "No code provided to page_eval." (`src/lib/page-eval-tool.ts:35`).
- The code runs on the page's own thread and cannot be interrupted once it
  starts (`src/lib/page-eval-tool.ts:19`). The in-page tool has no timeout
  argument. The side panel's `page_eval` has one.

## How a page Content Security Policy blocks `page_eval`

- A page whose policy does not allow `'unsafe-eval'` refuses the
  `AsyncFunction` construction, so nothing runs (`src/core/run-eval.ts:15-17`,
  `:96-99`).
- The tool reports it as:
  "Blocked by this page's Content Security Policy. The page does not allow 'unsafe-eval', so page_eval cannot run JavaScript here.",
  followed by a `Policy:` line with the page's policy text and a
  `Browser message:` line with the browser's own error
  (`src/lib/page-eval-tool.ts:42-44`). When the browser reports no policy text,
  the `Policy:` line reads "(the browser did not report the policy text)"
  (`src/core/run-eval.ts:154`).
- `page_fetch` is not affected by a page's script policy; it is an HTTP request,
  not code.

## What this means for a site you visit

- `page_eval` executes model-supplied JavaScript in the page's own realm, with
  access to everything the page can reach.
- `page_fetch` issues same-origin requests that carry the user's cookies, so it
  can act as the logged-in user on that site.
- Both are available to the in-page bubble on every page it is mounted on. It is
  mounted only on origins the user turned on (`src/bridge.ts:61-65`,
  `src/lib/settings.ts:74-86`; the side panel control is described in
  [Using the extension](./using-the-extension.md)), and it is never mounted on a
  page that already carries its own agent (`src/content.ts:58`, `:69`).
