# cat-store — agent instructions

Rules for `apps/cat-store`. The `AGENTS.md` files in the folders above still
apply; this file adds what is specific to this app.

## Finding elements in the page from a browser test

**`document.querySelector` does not cross a shadow root.** Most of what you want
to assert on in cat-store lives inside one: the Material text field wraps a real
`<textarea>` in its shadow root, and the agent panel's own components nest
further shadow roots inside each other. A query like
`document.querySelector('agent-chart-block canvas')` returns `null` **even when
the chart is on screen and working**.

Use a recursive search that walks into every shadow root:

```js
function deepQueryAll(root, selector) {
  let results = [...root.querySelectorAll(selector)];
  for (const el of root.querySelectorAll('*')) {
    if (el.shadowRoot) {
      results = results.concat(deepQueryAll(el.shadowRoot, selector));
    }
  }
  return results;
}

// Then, for example:
const blocks = deepQueryAll(document, 'agent-chart-block');
const canvases = deepQueryAll(document, 'canvas');
```

**Cost of not doing this (2026-08-29).** An agent verifying a chart change polled
`document.querySelector('agent-chart-block canvas')` for more than twelve
minutes, got `no-canvas` every time, and was close to reporting that charts had
stopped rendering. The chart had rendered on the first try. The defect was in the
test's selector, not in the product.

The same trap applies to Playwright locators when you reach for the DOM directly
with `page.evaluate`. Playwright's own locators do pierce shadow roots, so prefer
`page.getByRole(...)` and friends; only hand-written `querySelector` calls need
the helper above.

## Do not use an element's presence to decide a turn has finished

A tool result is applied to the page **after** the model's turn produces it, so
an element you are waiting for is missing for two completely different reasons:
the turn is still running, or the turn finished and the element never came. A
poll that only looks for the element cannot tell those apart, and you will read a
slow turn as a broken feature.

Wait on the console hook log instead. The app logs its lifecycle there, so poll
for the event you actually mean:

```
[cat-store hooks] onPreTool  name=show_live_chart input={...}
[cat-store hooks] onPostTool name=show_live_chart isError=false content=...
[cat-store hooks] onTurnEnd  stopReason=end_turn textLength=...
```

Poll for `onTurnEnd`, or for the `onPostTool` line of the specific tool you are
testing. Only then look for the element — and if it is missing at that point, you
have found a real defect.

## Getting a chart on screen reliably

Asking the agent for a chart in free-form text is not reliable: the model decides
which tool to call, and it may pick `show_chart` (a fixed snapshot) instead of
`show_live_chart` (bound to a data source), or draw nothing at all.

Two more reliable routes:

- **The demo skill** — `src/web/store/demo-skill.ts` has a step that calls
  `load_skill("chart")` and then `show_live_chart` with an exact argument object,
  and it tells the model not to substitute `show_chart`. Its own suggested
  prompts are "show best sellers" and "show inventory chart".
- **`gallery.html`** — served by the cat-store server, it renders states directly
  from `src/web/dev/gallery-states.ts` with no model in the loop at all. Use it
  when you need a deterministic render.

**Pick the route that matches what you are proving.** The demo skill charts the
`orders` source. A test that specifically needs the Elasticsearch-backed
`es-orders` source has to ask for that source, because the demo skill will not
query it.

## Counting network requests in a live check

When you measure how many requests an action causes, remember a live chart
re-queries **on its own timer** as well. A raw before-and-after count around your
action therefore mixes two sources and proves nothing on its own.

Measure a **control window** first: the same duration, doing nothing, counted the
same way. Then run the action window. Only the difference between the two is
caused by your action.

Current values, so you can predict what the timer contributes:

- `packages/web-agent-charting/src/lit/chart-block.ts` sets
  `MIN_INTERVAL_MS = 5000`.
- `src/web/store/demo-skill.ts` configures its live charts with
  `refresh: { mode: "auto", intervalMs: 30000 }`.
