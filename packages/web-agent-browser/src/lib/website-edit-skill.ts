import type { SkillDef } from "@cuatoi/web-agent-core";

export const websiteEditSkill: SkillDef = {
  name: "website_edit",
  description:
    "How to restyle and restructure a live page with page_eval, verify it with page_screenshot and page_console, and handle shadow DOM.",
  definition: `# website_edit

Restyle or restructure the page in a browser tab with \`page_eval\`, then prove
the result. Call \`read_tabs\` first and pass the tab ID it reports to every
tool.

## The loop

1. **Survey** — \`page_eval\`: count the open shadow roots, list the top-level
   sections, and check which custom properties the page already reads.
2. **Edit** — \`page_eval\`: one idempotent script. See "Write one idempotent
   script".
3. **Look** — check your tool list first. If \`page_screenshot\` is in it, call
   \`page_screenshot\`, then \`page_console({level:"error"})\`. If it is not, you
   cannot see the page — skip the screenshot and call only
   \`page_console({level:"error"})\`. Either way this step is required.
4. **Fix** — most defects appear only at step 3. Expect two or three rounds.

**A returned value is not evidence.** A result of \`{ok:true}\` says the code
ran. Only the screenshot says the user can see the result. Never report success
from a return value.

**When \`page_screenshot\` is not in your tool list**, you cannot see the page: it
is offered only when the model accepts images. Call
\`page_console({level:"error"})\` to check the edit did not throw, tell the user
you cannot confirm the visual result, and ask them what they see. Do not call
\`page_screenshot\` in this case — the call would be rejected as an unknown tool.

## Survey the page first

Page CSS does not cross a shadow boundary, and
\`document.querySelector('product-card')\` returns \`null\` when the element
lives inside another component's shadow root. Find the roots first.

\`\`\`js
function deepRoots(root = document, out = []) {
  out.push(root);
  for (const el of root.querySelectorAll('*')) {
    if (el.shadowRoot) deepRoots(el.shadowRoot, out);   // open roots only
  }
  return out;
}
const deepQuery = (sel) => deepRoots().flatMap(r => [...r.querySelectorAll(sel)]);
return { roots: deepRoots().length, cards: deepQuery('product-card').length };
\`\`\`

A closed shadow root has no \`shadowRoot\` property and cannot be reached. Say
so instead of retrying.

## Choose a route through the shadow boundary

| What you must change | Route |
|---|---|
| a value the component reads with \`var()\` | set the custom property on \`:root\` or on the host. Custom properties are inherited, so they do cross the boundary. |
| an element the component marks with a \`part\` attribute | \`host-tag::part(name)\` in page CSS |
| layout, or anything else inside the component | adopt a stylesheet into that shadow root |

\`::part\` is visible only to the parent DOM: the parts of a nested component
are not reachable from the page, and \`::part(a)::part(b)\` never matches.

\`\`\`js
function adoptInto(hostSelector, css) {
  const sheet = new CSSStyleSheet();     // build it here: a root adopts only a
  sheet.replaceSync(css);                // sheet from its own document
  for (const host of deepQuery(hostSelector)) {
    const r = host.shadowRoot;
    if (r && !r.adoptedStyleSheets.includes(sheet)) {
      r.adoptedStyleSheets = [...r.adoptedStyleSheets, sheet];   // append
    }
  }
  return sheet;
}
\`\`\`

- **Append; never replace.** Assigning a fresh array discards the component's
  own styles.
- One \`CSSStyleSheet\` object serves every root that adopts it, and editing it
  changes all of them at once.
- \`:host{display:grid}\` lays out a root's top-level children with no DOM
  change, so every event handler keeps working.
- Build the sheet inside the same \`page_eval\` call that adopts it. A later
  call cannot reach that object unless you keep it on \`window\`.

## Write one idempotent script

\`\`\`js
document.getElementById('nx-style')?.remove();
document.querySelectorAll('.nx-added').forEach(n => n.remove());
window.__nxObserver?.disconnect();
\`\`\`

Start every edit script by removing its own previous run. Tag everything you
create with the \`nx-\` prefix. That prefix is also the teardown list when the
user asks you to undo the change.

## Survive a re-render

A framework re-render builds new elements with new shadow roots, and they carry
none of your sheets. Without this the layout reverts the first time the user
filters or sorts.

\`\`\`js
window.__nxObserver?.disconnect();
const observer = new MutationObserver(() => reapplyAllSheets());
for (const r of deepRoots()) {
  observer.observe(r === document ? document.documentElement : r,
                   { childList: true, subtree: true });
}
window.__nxObserver = observer;
\`\`\`

## Keep the content while you restructure

\`\`\`js
container.append(existingNode);      // a move: markup, links and entities survive
container.innerHTML = '<p>text</p>'; // a rewrite: you will drop or invent content
\`\`\`

Move nodes. Write new text only for furniture the user asked you to add. Check
yourself: the set of text nodes in a moved subtree must be the same before and
after.

## Defects and their fixes

| Symptom | Cause | Fix |
|---|---|---|
| Content is missing below a point | an ancestor has a fixed height and \`overflow:hidden\` | set \`height:auto\` on that container and let a parent scroll |
| Image boxes are blank | \`loading="lazy"\` never triggered | set \`loading='eager'\`, scroll the page, then look again |
| An image is blurry | a thumbnail was stretched | ask the site for a larger render of the same image |
| A box collapses to about 18 pixels wide | a parent was forced to \`display:block\` over a \`display:table-caption\` child | set that child to \`display:block\` too |
| A pale frame sits around an element on a dark page | the element itself carries a border or a background | read \`getComputedStyle\` on each node and reset the one that paints it |
| The layout reverts after the user interacts | a framework re-render | re-apply with the MutationObserver above |
| The page looks unchanged after a dark restyle | most sites paint over \`document.body\`, so setting the body alone changes nothing | walk the ancestors and the shadow roots, find every element that paints a background, and set each one |
| A figure shrinks back to a thumbnail | \`width:auto\` is not full width | give it an explicit width, for example \`width:100%\` |
| Real content disappeared along with the furniture | a blanket selector such as \`sup{display:none}\` | scope the selector to the container you are editing |

## When a tool refuses

- **"Debugging is not started on tab #<id> …"** — call \`start_debugging\` on
  that tab first, then try again.
- **"Debugging stopped on tab #<id> …"** — the user pressed Cancel on Chrome's
  debugging bar. Call \`start_debugging\` again.
- **"page_eval stopped the script after <n> ms …"** — the code was still
  running and was stopped. The tab is usable again. Send a smaller script.
- **"Tab #<id> is not the active tab in its window …"** — only the visible tab
  can be photographed. Ask the user to switch to it.
- **"Screenshots are limited to 2 per second."** — wait, then call again.
`,
};
