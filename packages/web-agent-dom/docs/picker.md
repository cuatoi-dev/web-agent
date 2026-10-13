---
title: Point at elements
---

# Point at elements

`domTools()` registers `pickerAttachmentProvider`
(`src/picker-provider.ts`) automatically, on `attachmentProviders`, and
independently of the `images` option. You can also use it on its own, via
`SessionConfig.attachmentProviders`.

- Provider id `"picker"`, label `"Point at elements"`, icon `"ads_click"`.
- `maxItems` defaults to `8` (`DEFAULT_MAX_ITEMS`).
- Clicking an already-pinned element again unpins it.
- Pinning resolves to the nearest ancestor matching
  `button, a[href], input, select, textarea, [role], [contenteditable="true"], [onclick]`.
- Excludes anything inside `agentUiSelector` (default `"[data-agent-ui]"`),
  piercing shadow roots (`closestAcrossShadow`).
- While picking, the page's own `click`, `mousedown` and `pointerdown` are
  suppressed.

## On send

Sending pinned elements calls `DomAdapter.snapshotFocused()` for the whole
batch in a **single ref-table generation**. It then appends a text part
built by `buildPointedElementsBlock()` (`src/utils/pointed-elements.ts`).
That part's first line is:

```
# Pointed elements (the user clicked these)
```

It also adds an attachment chip labeled `1 element pointed` or
`N elements pointed`.

Constructing options (`PickerProviderOptions`, `src/picker-provider.ts`):

| Option | Default | Purpose |
|---|---|---|
| `agentUiSelector` | `"[data-agent-ui]"` | CSS selector for UI excluded from picking |
| `maxItems` | `8` | Max pins allowed |
| `getDomAdapter` | none | Adapter used to build the focused snapshot at send time; `domTools()` supplies its own instance |
