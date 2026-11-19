---
title: Troubleshooting
---

# Troubleshooting

Common issues when integrating or developing with `@cuatoi/web-agent-lit` and `@cuatoi/web-agent-core`.

## Send button disabled under a custom element set

**Symptom:** The send/stop icon button in the composer is greyed out,
unclickable, or shows the raw icon name as text after swapping the `<wa-*>`
element set.

**Cause:** The composer renders `<wa-icon-button icon="send">` or
`icon="stop"`. Under the default element set (`packages/web-agent-lit/src/ui/wa-elements.ts`), the
icon name is looked up in the `ICON_SVGS` map (`packages/web-agent-lit/src/ui/icon-svgs.ts`) and
drawn as inline SVG. If your custom `<wa-icon-button>` class does not draw SVG
for every icon name the chat UI uses (see section 5c of [Lit 3 support & the UI element
seam](../../../../packages/web-agent-lit/docs/lit3-registry.md)), the button still fires `press`, but shows the raw
name as text instead of a glyph.

**Fix:** Ensure your custom `<wa-icon-button>` class handles every icon name.
The cat-store element (`apps/cat-store/src/acme-elements.ts`, backed by
`apps/cat-store/src/acme-icon-svgs.ts`) defines each one as an inline SVG
string:

```ts
const ICON_SVGS: Record<string, string> = {
  more_vert: `<svg viewBox="0 0 24 24" ...>...</svg>`,
  send: `<svg viewBox="0 0 24 24" ...>...</svg>`,
  close: `<svg viewBox="0 0 24 24" ...>...</svg>`,
  stop: `<svg viewBox="0 0 24 24" ...>...</svg>`,
  // …and every other name the chat UI passes
};
```

The default `<wa-icon-button>` falls back to rendering the raw icon name
wrapped in an `<i>` element for Beer CSS icon fonts. If you do not load Beer
CSS, this fallback produces an empty or invisible button. Always provide SVG
for every icon the chat UI uses.

## CORS or 404 on the /api proxy path

**Symptom:** The agent panel shows "Network error" or the browser console has
CORS/404 errors when the agent tries to call the backend.

**Cause:** The default `baseURL` is `/api/anthropic` (`packages/web-agent-core/src/config.ts:53`).
This requires a proxy on your server at that path. If the proxy is misconfigured
or absent, the LLM API calls fail.

**Checks:**
1. Confirm the proxy is running. The dev server for cat-store proxies
   `/api/openai`, `/api/anthropic`, and `/api/gemini` to `http://localhost:30000`
   (see `apps/cat-store/webpack.config.js:122-146`):
   ```js
   proxy: [{ context: ["/api/openai"], target: "http://localhost:30000", changeOrigin: true }]
   ```
2. If the API is on a different origin, set `baseURL` to the absolute URL. The
   `getAbsoluteBaseURL()` function in `packages/web-agent-core/src/transport/provider.ts:1`
   resolves relative paths against `window.location.origin`.
3. Core's built-in providers send no API key header on their own. Inject
   upstream credentials in your reverse proxy or through a custom `AgentConfig.fetch`.

## Chart.js chart not rendering

**Symptom:** The agent calls `show_chart` but the panel shows nothing or a
broken element.

**Cause and checks:**

1. **Chart.js is bundled** — `chart.js` 2.7.3 is a direct dependency of
   `@cuatoi/web-agent-charting`, not a peer. No separate install is needed.
   If you see a module-not-found error, check that your bundler resolves
   `@cuatoi/web-agent-charting` correctly.

2. **Invalid config** — The `show_chart` tool validates the input against its
   JSON Schema (`ajv`) before rendering. If validation fails, the tool returns
   an error string to the model and no block is emitted.

3. **Sanitizer rejection** — `hasDataUrl()` and `checkRowCountExceeded()` run
   before rendering. If the config has a remote `data.url` or a dataset
   exceeding 2,000 rows, the tool returns a `config.data:` error.

4. **`chart-error` custom event** — `<agent-chart-block>` fires a
   `chart-error` CustomEvent when the Chart.js canvas fails to render. Listen
   for it on the panel element to surface renderer-side errors:
   ```ts
   panel.addEventListener("chart-error", (e) => console.error(e.detail));
   ```

5. **`block.spec` is deprecated** — If you are constructing a `ChartBlock`
   programmatically and setting `spec` instead of `config`, switch to `config`.
   The `spec` field is deprecated and may not render.

See [Chart](../../../../packages/web-agent-charting/docs/chart.md) for the full config shape and sanitizer rules.

## White-box icons without Beer CSS

**Symptom:** Icons appear as white squares or invisible boxes when using the
default element set without Beer CSS loaded.

**Cause:** `iconNode()` (`packages/web-agent-lit/src/ui/icon-svgs.ts`) falls back to creating an
`<i>` element with `textContent = name` (e.g. `<i>send</i>`) for any name not
in its `ICON_SVGS` map. This relies on Beer CSS's icon font or Material Icons
to render. Without Beer CSS, the `<i>` element has no styling and is
invisible.

**Fix:** Either:
- Load Beer CSS (`beer.min.css` + `beer.min.js`)
- Or implement custom `<wa-icon-button>`/`<wa-icon>` classes that render
  inline SVG for every icon (see [Send button
  disabled](#send-button-disabled-under-a-custom-element-set) above)

## Panel height is wrong

**Symptom:** The chat panel is too short, too tall, or does not fill its
container.

**Cause:** The panel uses flex layout with `min-height: 0` and scroll regions.
If the parent container does not have a defined height, the panel collapses.

**Fix:** Ensure the parent has a height:

```css
#agent-container {
  height: 600px;
  /* or */
  height: 100%;
  /* or */
  display: flex;
  flex-direction: column;
  flex: 1;
}
```

The bubble embed sizes its own container with
`width: var(--web-agent-panel-width, 480px)`, `height: var(--web-agent-panel-height, 660px)`
and `max-height: 80vh` (`packages/web-agent-lit/src/embed/bubble-shadow-template.ts:16-18`). Set those two
properties on any ancestor element to change the size. A panel you mount
yourself fills whatever container you put it in, so give that container a size.

## Compaction not running

**Symptom:** The context grows unbounded and the agent eventually fails or
slows down.

**Cause:** Compaction is triggered when the context exceeds
`autoCompactPercent` of `contextLength` (default: 75% of 128k tokens). If the
conversation is short, compaction does not fire.

**Checks:**
1. Ensure `persist: false` is not interfering (persistence and compaction are
   independent)
2. Check the console for summarizer errors — compaction always uses the live
   chat model (`model`); there is no separate override. If that model is
   unavailable, the transcript shows an `Agent compacts its context · failed`
   row.

## "Unknown tool" error in console

**Symptom:** The agent reports `Unknown tool "xxx"` or the model attempts a
tool call that is not in the tool map.

**Cause:** `buildTools()` registers whatever flat `CustomToolDef[]` the host
sets on `panel.tools`, merged with `defaultTools(ctx)` (`wait`, `get_time`,
`list_data_sources`, `get_field_details`, `sample_field_values`, `query_data`,
`show_generative_ui`, skill, compaction, scheduler, and todo tools) plus any
`toolProviders` such as `domTools()` from `@cuatoi/web-agent-dom` or
`chartTools()` from `@cuatoi/web-agent-charting`. A name outside the composed
set will not be found.

**Fix:** Set `panel.tools = [myTool]` — the panel merges it with
`defaultTools(ctx)` automatically. If the name clashes with an existing
tool, a `console.warn` is emitted and the duplicate is skipped — check the
browser console.

See [Custom Tools](../../../../packages/web-agent-core/docs/custom-tool.md) for the full authoring guide.

## "Can't find variable: process" in browser

**Symptom:** The esbuild bundle throws a ReferenceError for `process`.

**Cause:** The code has `process.env.NODE_ENV` guards in development-mode
detection (e.g. `packages/web-agent-core/src/loop/context-helpers.ts:6-7`). When bundled with certain
build tools that do not polyfill `process`, this fails.

**Fix (Webpack):** Add `new webpack.DefinePlugin({ 'process.env.NODE_ENV': JSON.stringify('production') })`
or use the `DefinePlugin` that is already included in the Webpack configuration.
For esbuild, use the `define` option.
