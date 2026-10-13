---
title: Permissions and confirmation
---

# Permissions and confirmation

`resolveAgentPermission(el)` (`src/adapters/permission-resolver.ts`) walks up
through light-DOM ancestors and open shadow-root hosts, matching the nearest
`data-agent-permission` attribute. It accepts only three values:
`allow`, `ask` and `block`. Any other value, or a missing attribute, falls
back to `allow`. An optional `data-agent-permission-reason` attribute
supplies a human-readable reason.

```html
<button data-agent-permission="ask"
        data-agent-permission-reason="This charges the card">Pay now</button>
```

## `block` — no wiring needed

`block` is enforced **inside `DomAdapter` itself**. `click`, `fill` and
`selectOption` each return, without calling out to the host:

```
Blocked by interaction policy ("block"): not allowed to operate [ref] "name" (reason); ask the user to do it themselves.
```

## `ask` — needs `confirmInteraction`

`confirmAskTier()` in `src/tool-provider.ts` enforces `ask`. It runs
**only if the host passes `confirmInteraction`**. Without it, `ask`-tier
elements execute like `allow`.

```ts
domTools({
  // …
  confirmInteraction: panel.confirmInteraction.bind(panel),
});
```

A refused confirmation returns:

```
Action "click" on [7] "Buy" was not confirmed by the user; not performed.
```

## Markers on custom-element hosts

A custom element that wraps its real control in an open shadow root (for
example a Material `md-icon-button` or `md-filled-button`) can carry the marker
on the host. The ref lands on the real shadow-inner control, and
`resolveAgentPermission()` walks from that control through the open shadow
boundary to the host to find the marker. Closed shadow roots are not crossed;
mark the host or a light-DOM ancestor instead.
