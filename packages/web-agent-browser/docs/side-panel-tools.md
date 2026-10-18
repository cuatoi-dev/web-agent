---
title: Side panel tools
---

# Side panel tools

The side panel agent carries three tool groups, wired at
`src/sidepanel.ts:97-110`: the five tab tools, the three page-agent tools, and
the page tools that act on any tab you turned the extension on for.

## Manage browser tabs from the side panel

The agent in the side panel can inspect and control browser tabs using five built-in tab tools:

- `read_tabs`: Lists all open tabs across all normal browser windows with their ID, window ID, title, URL, and active status.
- `open_tab`: Opens a new tab at a given URL. The optional `active` argument decides whether the new tab becomes the active tab. It defaults to `true`.
- `navigate_tab`: Navigates an existing tab to a new URL. The tool waits until the tab finishes loading, for at most 10 seconds, then reports the tab's final URL.
- `refresh_tab`: Reloads an existing tab. The optional `bypassCache` argument skips the browser cache. It defaults to `false`.
- `close_tab`: Closes a tab after asking for your confirmation in the panel.

The tool names come from `src/lib/tab-tools.ts:58` (`read_tabs`), `:84`
(`open_tab`), `:106` (`navigate_tab`), `:145` (`refresh_tab`), `:170`
(`close_tab`). The `navigate_tab` wait is at `src/lib/tab-tools.ts:24-50` and
`:124-139`.

The side panel agents also include six reference skills:

- `tab_management` guides it to read tabs before acting, use the returned tab
  IDs, and handle restricted browser URLs such as `chrome://`.
- `page_agent` teaches the 5-step send, wait, read loop for in-page tasks. See
  [Page agent tools](./page-agent-tools.md).
- `website_edit` teaches it to restyle a page and check the result. See
  [Website edit skill](./website-edit.md).
- `explore_app` teaches it to explore an app, record its site map and
  `pages/<page>.md` locator tables, propose suites and cases, and write one
  `TC-<nn>-<slug>.md` file per approved case.
- `test_plan` teaches it to run and maintain saved `TC-<nn>-<slug>.md` cases
  with the page tools and `page_verify`, and report each case with evidence.
- `test_report` teaches it to build the run's HTML report with every screenshot
  inlined, and where the user downloads it.

What the `tab_management` skill actually says, from `src/lib/tab-skill.ts:3-22`:

- Read tabs before acting, and never guess a tab ID.
- Act on one tab at a time.
- `navigate_tab` is blocked by Chrome on `chrome://`, `edge://` and
  `chrome-extension://` URLs, and that is an expected limit, not a crash.
- `close_tab` needs the user's confirmation before it runs.

## Before a page tool runs

Every page tool now runs through Chrome's debugger (`chrome.debugger`), not the
page script, so they need `start_debugging` on the tab first, not the
extension turned on for that origin:

1. Call `start_debugging` with the tab ID. Chrome shows its own debugging bar;
   this is the consent, and it works on any tab Chrome allows, whether or not
   the extension is turned on there.
2. Until you do, `page_eval`, `page_fetch` and `page_console` return
   `Debugging is not started on tab #<id>. Call start_debugging first.`
3. If the user presses Cancel on Chrome's debugging bar, the tools return
   `Debugging stopped on tab #<id>: the user pressed Cancel on Chrome's bar.
   Call start_debugging to continue.` until `start_debugging` runs again.

The ref tools (`page_snapshot`, `page_click`, `page_fill_form`,
`page_select_option`, `page_hover`, `page_verify`, `page_generate_locator`,
`page_upload_file`, and `page_screenshot` with a `ref`) run through Chrome's
debugger as well, so they need `start_debugging` and not the extension turned
on for the origin. `page_snapshot` reads Chrome's accessibility tree, and each
`[ref=<number>]` it prints is that element's Chrome node id: the ref keeps
working for as long as the element is on the page, across snapshots. A ref
whose element has gone returns `Ref <n> is no longer on the page. Take a new
snapshot.`

### Iframes

`page_snapshot` reaches into every iframe, same-site and cross-site. Each one
prints as `- iframe "<name>" · <origin> [ref=<ref>]`, and its content follows
one level deeper.

- An element inside a **cross-site** iframe gets a prefixed ref, `f1:12`. The
  number after `f` is that frame's number in the tab, in attach order. Pass the
  ref exactly as printed.
- An element inside a **same-site** iframe gets a plain ref, like any element
  in the top page.
- Every ref tool takes both forms, and clicks, fills and screenshots land in
  the right frame.
- When a cross-site iframe leaves the page, its `f<n>:` refs return `Ref
  f<n>:<id> is no longer on the page. Take a new snapshot.`
- An iframe whose content could not be read prints `(content not available)`
  instead of its subtree.

## Run JavaScript in a tab

`page_eval` runs JavaScript in any tab you have activated the extension on. Call
`read_tabs` first and pass the tab ID it reports.

- **What it runs**: the code you supply becomes the body of an async function,
  run in the tab through `Runtime.evaluate` over Chrome's debugger
  (`src/lib/panel-page-tools-script.ts`). Use `return` to send a value back and
  `await` for anything asynchronous.
- **What it sees**: everything the page's own scripts see — `window`,
  `document`, and every global the site defines.
- **What comes back**: `Result type: <kind>` and the serialized value. A value
  JSON cannot express comes back described. The 6000-character cap and the
  `…(output truncated)` marker are the same ones `page_fetch` uses.
- **`timeoutMs`**: how long to wait, in milliseconds. It defaults to 10000 and
  must be between 1000 and 300000. A value outside that range returns
  `Invalid timeoutMs: <value>. Must be between 1000 and 300000.` and runs
  nothing.
- **`frame`**: the ref of an iframe from `page_snapshot`. The code then runs in
  that frame's own realm instead of the top page's, and the wait applies to that
  frame. A ref that is not an iframe returns `frame must be the ref of an iframe
  from page_snapshot.`
- **When the wait runs out**, `page_eval` stops the script with
  `Runtime.terminateExecution` and returns `page_eval stopped the script after
  <n> ms: it was still running. The tab is responsive again.` The tab is usable
  again right after.
- **Before `start_debugging`**, the tool returns `Debugging is not started on
  tab #<id>. Call start_debugging first.` See "Before a page tool runs" above.
- **A page's Content Security Policy does not stop it.** `page_eval` runs
  through Chrome's debugger, which a page CSP has no authority over, so code
  runs even on a page whose policy forbids `'unsafe-eval'`.

## Call an API from a tab

`page_fetch` performs an HTTP request to the page origin of any tab you have activated the extension on. Call `read_tabs` first and pass the tab ID it reports.

- **What it does**: an HTTP request to that tab's own origin, issued from the tab's realm through Chrome's debugger (`src/lib/panel-page-tools-script.ts`, the `fetch` call runs via `Runtime.evaluate`).
- **Arguments**: `tabId` (number), `url` (relative path or same-origin absolute URL), `method` (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS, default GET), `headers`, and `body`.
- **Same-origin only**: requests to a different origin are blocked before any request leaves the browser.
- **Carries session credentials**: uses `credentials: "same-origin"`, so the request carries that site's cookies and authentication.
- **What comes back**: `Status: …`, `Content-Type: …`, and the body.
- **The 6000-character cap**: the whole result, status and content-type lines included, is capped at 6000 characters. A longer result ends with `\n…(output truncated)` (`src/lib/panel-page-tools-script.ts`).
- **When the tab does not answer within 10 seconds**, the tool returns `page_fetch timed out after 10000 ms waiting for tab #<id>.`
- **When the request fails before a response arrives**, the tool returns `The request failed: <name>: <message>`.
- **Before `start_debugging`**, the tool returns `Debugging is not started on tab #<id>. Call start_debugging first.`

## Read console output from a tab

`page_console` reads the console log and error buffer from any tab you have activated the extension on. Call `read_tabs` first and pass the tab ID it reports.

- **What it captures**: `console.log`, `console.info`, `console.warn`, `console.error`, uncaught runtime exceptions, and unhandled promise rejections, through Chrome's debugger (`Runtime.consoleAPICalled` and `Runtime.exceptionThrown`).
- **Buffer starts at `start_debugging`**: Chrome replays everything logged before `Runtime.enable`, so the buffer holds the whole document from load, not just what happened after `start_debugging`, and retains the most recent 200 entries. Entries falling out of the window increment a dropped counter.
- **Arguments**: `tabId` (number), optional `level` ("log", "info", "warn", or "error"), and optional `limit` (1 to 200, defaults to 50).
- **Invalid arguments**: an unknown level returns `Invalid level: <level>. Use log, info, warn or error, or omit it for all.`, and a limit outside 1 to 200 returns `Invalid limit: <limit>. Must be between 1 and 200.`
- **Output format**: `Console (<n> matching):`, then one `[<level>] <text>` line per entry, oldest first.
- **Reload detection**: the tool remembers the document ID per tab. If the tab has reloaded since the previous read, the output is prefixed with: `The page reloaded since the last read; entries below start from that load.`
- **Dropped entries header**: if entries were dropped from the 200-entry buffer, the output includes: `<dropped> earlier entries fell out of the 200-entry buffer.`
- **Empty buffer**: when no matching logs exist, returns `No console output captured for this document.` (or with the level named).
- **Character limits**: individual entries longer than 2,000 characters are capped to 2,000. Total output exceeding 6,000 characters is truncated with `\n…(output truncated)`.
- **A line logged inside an iframe is prefixed `(frame <origin>) `.** Only the top page's own navigation clears the buffer; an iframe navigating does not.
- **Before `start_debugging`**, the tool returns `Debugging is not started on tab #<id>. Call start_debugging first.` It cannot time out waiting for the tab any more — it reads the session's own buffer.

## Take a screenshot of a tab

`page_screenshot` takes a picture of what is visible in a browser tab, or of
the whole page or of one element. Call `read_tabs` first and pass the tab ID it
reports, and call `start_debugging` on that tab first.

- **What it does**: captures the real rendered pixels of the tab
  (`src/lib/page-screenshot-tool.ts`, through the Chrome DevTools Protocol).
  Canvas, video and cross-origin images appear exactly as the user sees them.
- **Arguments**: `tabId` (number), optional `save_to` (string), optional
  `highlight` (array of snapshot refs), and at most one capture target:
  - `ref` (string) captures only the element a `page_snapshot` call reported,
    for example `"3"`.
  - `css` (string) captures the first element the CSS selector matches. The
    tool queries the top document first. If nothing matches there, it searches
    open shadow roots, each root's own tree before the roots nested in it.
  - `xpath` (string) captures the first element the XPath matches in the top
    document. XPath does not enter shadow roots.
  - `fullPage: true` captures the whole scrollable page rather than the
    viewport.
  - Passing more than one target returns `Use only one of ref, css, xpath or
    fullPage.` and captures nothing. `fullPage: false` is not a target.
  - When a selector matches more than one element, the tool captures the first
    and adds the line `<N> elements match; captured the first.` before `Saved`.
    A selector that matches nothing, is invalid, or (for XPath) selects
    something that is not an element returns an error and captures nothing.
  - `highlight` draws a temporary `3px solid red` outline, with a `2px` offset,
    around each ref while the picture is taken, then puts back the previous
    inline outline. A viewport capture first scrolls the first highlighted ref
    into view. Element and full-page captures do not scroll. A highlighted
    element outside the captured area adds the line `Highlighted element <ref>
    is outside the screenshot.` The outline is removed even when the capture
    fails. A stale ref in `highlight` returns the stale-ref error and captures
    nothing.
  - `save_to` (string) chooses where the PNG is stored. Without it the file
    goes to `/tmp/screenshots/<local timestamp>-tab<tabId>.png`, for example
    `/tmp/screenshots/2026-01-02-030405-tab7.png`. The timestamp is the local
    date and time to the second, so two captures in the same second overwrite
    the same file.
- **Every capture is saved**, whether or not `save_to` is given. The result is
  the caption, then the path:

  ```text
  Viewport screenshot, 1280 × 720.
  Saved /tmp/screenshots/2026-01-02-030405-tab7.png
  ```

  A selector capture that matched several elements:

  ```text
  Screenshot of CSS .card, 240 × 320.
  3 elements match; captured the first.
  Saved /tmp/screenshots/2026-01-02-030405-tab7.png
  ```

  The user opens Files in the side panel to see the new file, and downloads it
  from there.
- **A failed save fails the call.** A path on a read-only mount, a path no
  mount covers, and storage that rejects all return an error result and send no
  image, so the agent never reports a file that is not there.
- **Offered only when the model accepts images.** The tool is left out of the
  tool list entirely when the configured model cannot receive an image, so the
  agent never sees a tool it cannot use (`src/lib/panel-page-tools.ts:59`).
- **Empty capture**: a capture with no image data, for example during a
  navigation, is discarded, nothing is saved and no image is sent. The tool asks
  the agent to try again.

### Which models get `page_screenshot`

The side panel decides from the wire format and the model name on the options
page (`src/lib/page-screenshot-tool.ts:49-54`, `modelSupportsVision` in
`packages/web-agent-core/src/transport/vision.ts`):

| Wire format | The model name must contain |
|---|---|
| `anthropic` or `openai` | one of `claude-3`, `gemma-4`, `gemma4`, `gpt-4o`, `gpt-4-turbo`, `vision`, `sonnet` |
| `gemini` | `gemini` |

The match ignores letter case. Every default entry gets the tool, because each
model name is `sonnet` or contains `gemini`.

The side panel reads the wire format and the model once, when it opens
(`src/sidepanel.ts:104-109`). After you change the model on the options page,
close the side panel and open it again.
