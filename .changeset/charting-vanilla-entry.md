---
"@cuatoi/web-agent-charting": minor
---

Make the `.` entry genuinely framework-agnostic.

- `CHART_PALETTE`, `resolveCssColour`, `applyChartDefaults` and `financePlugin`
  moved from `src/lit/` to `src/chart/` and are now exported from the package
  root, so a non-Lit binding can reuse them without importing `./lit`.
- `@cuatoi/web-agent-lit` moved from `dependencies` to an **optional**
  `peerDependency`. Hosts that only use `chartingTools()`/`chartingSkills()` no
  longer install it; hosts that use `@cuatoi/web-agent-charting/lit` must
  install it themselves.
- Removed the `lit-html ^3.0.0` peer dependency. Nothing in this package imports
  `lit-html`; the requirement comes from `@cuatoi/web-agent-lit`, whose own
  peer range (`^1 || ^2 || ^3`) is wider.
- The finance plugin's Chart.js registration moved to a separate
  side-effect module so the root entry stays tree-shakeable.

The `./lit` subpath is unchanged: `chartingRenderers` and `AgentChartBlock`
export exactly as before.
