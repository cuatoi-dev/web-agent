# Theme tokens

`themes/wa-tokens.css` defines three themes, selected by `data-theme` on
any element — the root element, or any subtree container for scoped theming:
`wa1-dark`, `wa2-dark`, `wa2-light`.

All three blocks declare the identical set of `--wa-*` tokens, so
switching themes never leaves a token undefined.

## Host-provided token set via `data-theme="provided"`

Setting `data-theme="provided"` on an element signals that the host application
is supplying its own `--wa-*` token values:

1. **The package ships no values for `provided`.** `wa-tokens.css` defines
   no CSS rules for `data-theme="provided"`.
2. **Unset tokens inherit from an ancestor base theme.** CSS custom properties
   inherit down the DOM tree. If an ancestor element specifies a base theme
   (`wa1-dark`, `wa2-dark`, or `wa2-light`), unprovided tokens automatically
   inherit those base values.
3. **Component fallback backstop.** If no ancestor specifies a base theme,
   unprovided tokens fall back to the component-level defaults declared in
   `var(--wa-*, <fallback>)`.
4. **Vendor component surfaces are separate tokens.** The `provided`/override
   mechanism recolors everything the UI styles through `--wa-*`. Hosts that
   swap the UI registry for a vendor component system (e.g. Material Web in
   cat-store) have primitives that paint from their OWN tokens — a Material
   filled (primary) button fills from `--md-filled-button-container-color`, not
   `--wa-action-color-info`. Such hosts must also declare those `--md-*`
   tokens on the same `data-theme="provided"` element (or any ancestor) to
   recolor those primitives; the theme tokens alone will not reach them.
   See the Cat Store gallery demo (`gallery.html?frame=demo-theme-showcase`) `provided` card for a worked example.

## Add a theme

You can add a named theme to the three built-in themes. A theme is one CSS
file and one `registerTheme` call. The file can be partial: every token it
does not declare takes the value of its base theme.

1. **Write the CSS file.** Use one block, with your theme id as the
   `data-theme` value.

   ```css
   /* acme-dense.css */
   [data-theme="acme-dense"] {
     --wa-font-size-m: 12px;
     --wa-padding-m: 4px;
     --wa-action-color-info: hsl(190deg 90% 45%);
   }
   ```

2. **Check the file.** This package ships a checker. It needs Node.js and
   nothing else.

   ```bash
   node node_modules/@cuatoi/web-agent-lit/bin/web-agent-theme-check.mjs acme-dense.css --base wa2-dark
   ```

   A `--wa-*` name that is not a web-agent token, for example a misspelling,
   is an error, and the checker exits with code 1. A token the file does not
   declare is a warning: it inherits from the base theme. A file with no
   `[data-theme="…"]` block is an error.

3. **Register the theme.**

   ```ts
   import { registerTheme } from "@cuatoi/web-agent-lit/themes";

   registerTheme({
     id: "acme-dense",
     label: "Acme Dense",
     scheme: "dark",
     base: "wa2-dark",
     css: new URL("./acme-dense.css", import.meta.url),
   });
   ```

   - `id` is the `data-theme` value. It uses lowercase letters, digits and
     hyphens, and it starts with a letter.
   - `label` is the name a theme picker shows.
   - `scheme` is `"dark"` or `"light"`.
   - `base` is optional. It is `wa1-dark`, `wa2-dark` or `wa2-light`, and it
     fills every token the file does not declare.
   - `css` is optional. A `URL` adds a `<link>` element. A string is CSS text
     and adds a `<style>` element. Each document gets the element once.

   `registerTheme` throws an error for an invalid id, an id that is already
   registered, an invalid scheme, and a base that is not a built-in theme.

4. **Apply the theme.**

   ```ts
   import { applyTheme } from "@cuatoi/web-agent-lit/themes";

   applyTheme(document.documentElement, "acme-dense");
   ```

   `applyTheme` sets `data-theme`. When the theme has a base, it also sets
   `data-theme-base`. For an id that is not registered, it logs a warning,
   returns `false`, and does not change `data-theme`.

`listThemes()` returns every registered theme in registration order, starting
with the three built-in themes. `getTheme(id)` returns one theme, or
`undefined`. `defaultTheme("dark")` returns `wa2-dark`, and
`defaultTheme("light")` returns `wa2-light`.

### How the base theme fills tokens

Each built-in block in `wa-tokens.css` also matches `data-theme-base`:

```css
[data-theme="wa2-dark"], :where([data-theme-base="wa2-dark"]) { … }
```

`[data-theme="acme-dense"]` has specificity 0,1,0. `:where(…)` always has
specificity 0. So a token your file declares always takes your value, and
every other token takes the base value. The order in which the stylesheets
load does not matter.

## Token list

### Action colours (72)

| Token | wa1-dark | wa2-dark | wa2-light |
|-------|-----------|-----------|------------|
| `--wa-action-text-color-error` | hsl(221deg 36% 7%) | hsl(221deg 36% 7%) | hsl(0deg 0% 100%) |
| `--wa-action-text-color-info` | hsl(0deg 0% 100%) | hsl(0deg 0% 100%) | hsl(0deg 0% 100%) |
| `--wa-action-text-color-success` | hsl(0deg 0% 100%) | hsl(0deg 0% 100%) | hsl(0deg 0% 100%) |
| `--wa-action-text-color-warn` | hsl(0deg 0% 100%) | hsl(0deg 0% 100%) | hsl(0deg 0% 100%) |
| `--wa-action-color-error` | hsl(352deg 70% 68%) | hsl(352deg 60% 68%) | hsl(352deg 80% 45%) |
| `--wa-action-color-error-50` | hsl(352deg 70% 88%) | color-mix(…95%) | hsl(352deg 80% 88%) |
| `--wa-action-color-error-100` | hsl(352deg 70% 68%) | color-mix(…90%) | hsl(352deg 80% 68%) |
| `--wa-action-color-error-300` | hsl(352deg 70% 58%) | color-mix(…70%) | hsl(352deg 80% 58%) |
| `--wa-action-color-error-500` | hsl(352deg 70% 68%) | color-mix(…50%) | hsl(352deg 80% 45%) |
| `--wa-action-color-error-700` | hsl(352deg 60% 35%) | color-mix(…30%) | hsl(352deg 70% 35%) |
| `--wa-action-color-error-900` | hsl(352deg 60% 25%) | color-mix(…10%) | hsl(352deg 70% 25%) |
| `--wa-action-color-error-{0…90}opc` | hsl(352deg 70% 68% / N%) | hsl(352deg 60% 68% / N%) | hsl(352deg 80% 45% / N%) |
| `--wa-action-color-info` | hsl(216deg 100% 52%) | hsl(257deg 100% 66%) | hsl(257deg 100% 66%) |
| `--wa-action-color-info-50` | hsl(257deg 100% 87%) | color-mix(…95%) | hsl(257deg 100% 87%) |
| `--wa-action-color-info-100` | hsl(257deg 100% 77%) | color-mix(…90%) | hsl(257deg 100% 77%) |
| `--wa-action-color-info-300` | hsl(257deg 100% 72%) | color-mix(…70%) | hsl(257deg 100% 72%) |
| `--wa-action-color-info-500` | hsl(257deg 100% 67%) | color-mix(…50%) | hsl(257deg 100% 67%) |
| `--wa-action-color-info-700` | hsl(257deg 100% 62%) | color-mix(…30%) | hsl(257deg 100% 62%) |
| `--wa-action-color-info-900` | hsl(257deg 100% 57%) | color-mix(…10%) | hsl(257deg 100% 57%) |
| `--wa-action-color-info-{0…90}opc` | hsl(216deg 100% 52% / N%) | hsl(257deg 100% 67% / N%) | hsl(257deg 100% 67% / N%) |
| `--wa-action-color-success` | hsl(151deg 74% 43%) | hsl(151deg 74% 43%) | hsl(154deg 100% 24%) |
| `--wa-action-color-success-{50…900}` | (see CSS) | color-mix(in oklab, …) | (see CSS) |
| `--wa-action-color-success-{0…90}opc` | hsl(151deg 74% 43% / N%) | hsl(151deg 74% 43% / N%) | hsl(154deg 100% 24% / N%) |
| `--wa-action-color-warn` | hsl(29deg 100% 59%) | hsl(30deg 70% 60%) | hsl(28deg 100% 30%) |
| `--wa-action-color-warn-{50…900}` | (see CSS) | color-mix(in oklab, …) | (see CSS) |
| `--wa-action-color-warn-{0…90}opc` | hsl(29deg 100% 59% / N%) | hsl(30deg 70% 60% / N%) | hsl(28deg 100% 30% / N%) |

### Backgrounds (57)

| Token | wa1-dark | wa2-dark | wa2-light |
|-------|-----------|-----------|------------|
| `--wa-accordion-background-color` | var(--wa-background-color-500) | var(--wa-background-color-500) | var(--wa-background-color-50) |
| `--wa-accordion-header-hover-background-color` | var(--wa-background-color-700) | var(--wa-background-color-700) | var(--wa-background-color-500) |
| `--wa-background-color` | hsl(221deg 29% 19%) | hsl(221deg 29% 19%) | hsl(206deg 26% 95%) |
| `--wa-background-color-{0…90}opc` | hsl(221deg 29% 19% / N%) | hsl(221deg 29% 19% / N%) | hsl(206deg 26% 95% / N%) |
| `--wa-background-color-50` | hsl(221deg 25% 40%) | hsl(221deg 25% 5%) | hsl(0deg 0% 100%) |
| `--wa-background-color-100` | hsl(221deg 25% 30%) | hsl(222deg 27% 11%) | hsl(0deg 0% 98%) |
| `--wa-background-color-300` | hsl(221deg 25% 25%) | hsl(221deg 30% 15%) | hsl(210deg 25% 97%) |
| `--wa-background-color-500` | hsl(221deg 29% 19%) | hsl(221deg 29% 19%) | hsl(206deg 26% 95%) |
| `--wa-background-color-700` | hsl(221deg 30% 15%) | hsl(221deg 25% 25%) | hsl(204deg 17% 89%) |
| `--wa-background-color-900` | hsl(222deg 27% 11%) | hsl(221deg 25% 30%) | hsl(206deg 14% 81%) |
| `--wa-button-background-color` | var(--wa-background-color-300) | var(--wa-background-color-300) | hsl(0deg 0% 100%) |
| `--wa-button-background-color-disabled` | var(--wa-background-color-500) | hsl(221deg 30% 20%) | var(--wa-background-color-300) |
| `--wa-button-background-color-hover` | var(--wa-background-color-100) | var(--wa-background-color-300) | var(--wa-background-color-300) |
| `--wa-calendar-weekdays-background-color` | var(--wa-background-color-300) | var(--wa-background-color-300) | var(--wa-action-color-info-50opc) |
| `--wa-circular-progress-bar-background-color` | transparent | transparent | transparent |
| `--wa-countdown-timer-background-color` | var(--wa-background-color) | var(--wa-background-color) | var(--wa-background-color) |
| `--wa-dialog-background-color` | var(--wa-background-color-500) | var(--wa-background-color-500) | var(--wa-background-color-500) |
| `--wa-dialog-overlay-background-color` | var(--wa-background-color-50opc) | var(--wa-background-color-50opc) | var(--wa-background-color-50opc) |
| `--wa-dropdown-background-color` | hsl(221deg 36% 7%) | hsl(221deg 36% 7%) | hsl(0deg 0% 100%) |
| `--wa-dropdown-item-background-color` | transparent | transparent | transparent |
| `--wa-dropdown-item-background-color-active` | var(--wa-action-color-info-10opc) | var(--wa-action-color-info-10opc) | var(--wa-action-color-info-10opc) |
| `--wa-dropdown-item-background-color-disabled` | var(--wa-background-color-500) | var(--wa-background-color-500) | var(--wa-background-color-300) |
| `--wa-dropdown-item-background-color-hover` | var(--wa-action-color-info-10opc) | var(--wa-action-color-info-10opc) | var(--wa-action-color-info-10opc) |
| `--wa-dropdown-item-background-color-selected` | var(--wa-action-color-info) | var(--wa-action-color-info) | var(--wa-action-color-info) |
| `--wa-input-background-color` | hsl(221deg 36% 7%) | hsl(221deg 36% 7%) | hsl(0deg 0% 100%) |
| `--wa-input-background-color-disabled` | hsl(221deg 30% 19%) | hsl(224deg 26% 17%) | var(--wa-background-color-300) |
| `--wa-input-background-color-hover` | hsl(221deg 36% 7%) | hsl(221deg 36% 7%) | hsl(0deg 0% 100%) |
| `--wa-radio-button-background-color` | hsl(0deg 0% 100%) | transparent | transparent |
| `--wa-radio-button-background-color-checked` | hsl(0deg 0% 100%) | transparent | transparent |
| `--wa-radio-button-background-color-disabled` | var(--wa-text-color-disabled) | transparent | transparent |
| `--wa-radio-button-background-color-hover` | hsl(0deg 0% 90%) | transparent | transparent |
| `--wa-scrollbar-corner-background-color` | transparent | transparent | transparent |
| `--wa-scrollbar-thumb-background-color` | hsl(0deg 0% 66%) | var(--wa-background-color-900) | hsl(0deg 0% 80%) |
| `--wa-scrollbar-thumb-background-color-hover` | hsl(0deg 0% 66%) | hsl(221deg 25% 50%) | hsl(0deg 0% 65%) |
| `--wa-scrollbar-track-background-color` | hsl(221deg 25% 30%) | var(--wa-background-color-100) | var(--wa-background-color-100) |
| `--wa-smart-list-background-color` | hsl(221deg 36% 7%) | hsl(221deg 36% 7%) | hsl(0deg 0% 100%) |
| `--wa-smart-list-background-color-disabled` | hsl(221deg 30% 19%) | hsl(221deg 30% 19%) | hsl(0deg 0% 92%) |
| `--wa-tabs-background-color` | hsl(221deg 30% 28%) | hsl(221deg 30% 28%) | var(--wa-background-color-900) |
| `--wa-tabs-background-color-disabled` | hsl(221deg 24% 34%) | hsl(221deg 24% 34%) | var(--wa-background-color-900) |
| `--wa-tabs-background-color-hover` | hsl(221deg 30% 33%) | hsl(221deg 30% 33%) | var(--wa-background-color-700) |
| `--wa-tabs-background-color-selected` | hsl(221deg 29% 19%) | hsl(221deg 29% 19%) | var(--wa-background-color-500) |
| `--wa-tabs-close-button-background-color` | transparent | transparent | transparent |
| `--wa-tabs-close-button-background-color-hover` | var(--wa-background-color-900) | var(--wa-background-color-900) | var(--wa-background-color-900) |
| `--wa-tabs-input-background-color` | var(--wa-input-background-color) | var(--wa-input-background-color) | var(--wa-input-background-color) |
| `--wa-tabs-placeholder-background-color` | var(--wa-action-color-info-50opc) | var(--wa-action-color-info-50opc) | var(--wa-action-color-info-50opc) |
| `--wa-toast-background-color` | hsl(209deg 26% 20%) | hsl(209deg 26% 20%) | hsl(209deg 26% 20%) |
| `--wa-toast-button-background-color` | transparent | transparent | transparent |
| `--wa-toast-button-background-color-hover` | var(--wa-white-color-10opc) | var(--wa-white-color-10opc) | var(--wa-white-color-10opc) |

### Black & white (22)

| Token | All themes |
|-------|------------|
| `--wa-black-color` | hsl(0deg 0% 0%) |
| `--wa-black-color-{0…90}opc` | hsl(0deg 0% 0% / N%) |
| `--wa-white-color` | hsl(0deg 0% 100%) |
| `--wa-white-color-{0…90}opc` | hsl(0deg 0% 100% / N%) |

### Calendar / flag / gauge / pagination (11)

| Token | wa1-dark | wa2-dark | wa2-light |
|-------|-----------|-----------|------------|
| `--wa-calendar-row-size` | 40px | 40px | 40px |
| `--wa-flag-height` | 22.5px | 22.5px | 22.5px |
| `--wa-flag-width` | 30px | 30px | 30px |
| `--wa-gauge-arrow-color` | hsl(0deg 0% 100%) | hsl(0deg 0% 100%) | hsl(0deg 0% 0%) |
| `--wa-gauge-green-color` | hsl(164deg 83% 53%) | hsl(164deg 83% 53%) | hsl(164deg 83% 53%) |
| `--wa-gauge-orange-color` | hsl(29deg 100% 59%) | hsl(29deg 100% 59%) | hsl(29deg 100% 59%) |
| `--wa-gauge-red-color` | hsl(10deg 100% 57%) | hsl(10deg 100% 57%) | hsl(10deg 100% 57%) |
| `--wa-gauge-size` | 48px | 48px | 48px |
| `--wa-gauge-transition-duration` | 2s | 2s | 2s |
| `--wa-gauge-yellow-color` | hsl(47deg 100% 57%) | hsl(47deg 100% 57%) | hsl(47deg 100% 57%) |
| `--wa-pagination-height` | 38px | 38px | 38px |

### Countdown timer (7)

| Token | All themes |
|-------|------------|
| `--wa-countdown-timer-color` | var(--wa-text-color) |
| `--wa-countdown-timer-donut-size` | 10 |
| `--wa-countdown-timer-loader-color` | var(--wa-label-color) |
| `--wa-countdown-timer-loader-size` | 10 |
| `--wa-countdown-timer-scale-color` | var(--wa-label-color) |
| `--wa-countdown-timer-scale-stroke-dasharray` | 2 5.65 |
| `--wa-countdown-timer-scale-stroke-width` | 2 |

### Icon (9)

| Token | wa1-dark | wa2-dark | wa2-light |
|-------|-----------|-----------|------------|
| `--wa-accordion-header-icon-color` | var(--wa-icon-color) | var(--wa-icon-color) | var(--wa-icon-color) |
| `--wa-gauge-exclamation-icon-color` | hsl(0deg 0% 100%) | hsl(0deg 0% 100%) | hsl(0deg 0% 0%) |
| `--wa-icon-color` | var(--wa-text-color) | var(--wa-text-color) | hsl(205deg 8% 64%) |
| `--wa-icon-color-disabled` | var(--wa-text-color-disabled) | var(--wa-text-color-disabled) | hsl(206deg 14% 80%) |
| `--wa-icon-size-xs` | 16px | 14px | 14px |
| `--wa-icon-size-s` | 24px | 16px | 16px |
| `--wa-icon-size-m` | 26px | 20px | 20px |
| `--wa-icon-size-l` | 28px | 24px | 24px |
| `--wa-icon-size-xl` | 32px | 28px | 28px |

### Progress bar / scrollbar / spinner (8)

| Token | wa1-dark | wa2-dark | wa2-light |
|-------|-----------|-----------|------------|
| `--wa-circular-progress-bar-linecap` | round | round | round |
| `--wa-circular-progress-bar-loader-color` | var(--wa-label-color) | var(--wa-label-color) | var(--wa-label-color) |
| `--wa-circular-progress-bar-scale-color` | var(--wa-label-color) | var(--wa-label-color) | var(--wa-label-color) |
| `--wa-circular-progress-bar-scale-stroke-dasharray` | 2 5.65 | 2 5.65 | 2 5.65 |
| `--wa-circular-progress-bar-scale-stroke-width` | 2 | 2 | 2 |
| `--wa-circular-progress-bar-size` | 100px | 100px | 100px |
| `--wa-scrollbar-size` | 6px | 6px | 6px |
| `--wa-spinner-color` | var(--wa-text-color) | var(--wa-text-color) | var(--wa-text-color) |

### Smart list (1)

| Token | wa1-dark | wa2-dark | wa2-light |
|-------|-----------|-----------|------------|
| `--wa-smart-list-row-height` | 30px | 30px | var(--wa-component-size-m) |

### Depth (3)

| Token | wa1-dark | wa2-dark | wa2-light |
|-------|-----------|-----------|------------|
| `--wa-depth-s` | 0px 1px 2px var(--wa-black-color-20opc) inset | 0px 1px 2px var(--wa-black-color-40opc) inset | 0px 1px 2px var(--wa-black-color-20opc) inset |
| `--wa-depth-m` | 0px 2px 4px var(--wa-black-color-20opc) inset | 0px 2px 4px var(--wa-black-color-40opc) inset | 0px 2px 4px var(--wa-black-color-20opc) inset |
| `--wa-depth-l` | 0px 4px 8px var(--wa-black-color-20opc) inset | 0px 4px 8px var(--wa-black-color-40opc) inset | 0px 4px 8px var(--wa-black-color-20opc) inset |

### Elevation (5)

| Token | wa1-dark | wa2-dark | wa2-light |
|-------|-----------|-----------|------------|
| `--wa-dropdown-elevation` | var(--wa-elevation-m) | var(--wa-elevation-m) | var(--wa-elevation-m) |
| `--wa-elevation-s` | 0px 1px 2px var(--wa-black-color-20opc) | 0px 1px 2px var(--wa-black-color-40opc) | 0px 1px 2px var(--wa-black-color-20opc) |
| `--wa-elevation-m` | 0px 2px 4px var(--wa-black-color-20opc) | 0px 2px 4px 0px … | 0px 2px 4px var(--wa-black-color-20opc) |
| `--wa-elevation-l` | 0px 5px 10px var(--wa-black-color-40opc) | 0px 5px 10px var(--wa-black-color-40opc) | 0px 5px 10px var(--wa-black-color-40opc) |
| `--wa-toast-elevation` | var(--wa-elevation-m) | var(--wa-elevation-m) | var(--wa-elevation-m) |

### Highlight (11)

| Token | All themes |
|-------|------------|
| `--wa-highlight-color` | hsl(45deg 100% 74%) |
| `--wa-highlight-color-{0…90}opc` | hsl(45deg 100% 74% / N%) |

### Outline (2)

| Token | wa1-dark | wa2-dark | wa2-light |
|-------|-----------|-----------|------------|
| `--wa-outline-color` | var(--wa-action-color-info) | hsl(257deg 100% 72%) | var(--wa-action-color-info) |
| `--wa-component-outline` | 0px 0px 0px 2px var(…) | 0px 0px 2px 2px var(…) | 0px 0px 2px 2px var(…) |

### Shadow (2)

| Token | wa1-dark | wa2-dark | wa2-light |
|-------|-----------|-----------|------------|
| `--wa-circular-progress-bar-box-shadow` | none | none | none |
| `--wa-dialog-box-shadow` | 0px 5px 10px 0px var(--wa-black-color-50opc) | 0px 5px 10px 0px var(--wa-black-color-50opc) | 0px 10px 30px 0px var(--wa-black-color-20opc) |

### Radio button (12)

| Token | wa1-dark | wa2-dark | wa2-light |
|-------|-----------|-----------|------------|
| `--wa-radio-button-border-style` | solid | solid | solid |
| `--wa-radio-button-border-width` | 1px | 2px | 2px |
| `--wa-radio-button-color` | var(--wa-action-color-info) | var(--wa-action-color-info) | var(--wa-action-color-info) |
| `--wa-radio-button-color-disabled` | var(--wa-text-color-disabled) | var(--wa-text-color-disabled) | var(--wa-text-color-disabled) |
| `--wa-radio-button-dot-color` | var(--wa-action-color-info) | var(--wa-action-color-info) | var(--wa-action-color-info) |
| `--wa-radio-button-dot-color-disabled` | var(--wa-text-color-disabled) | hsl(221deg 35% 80%) | hsl(0deg 0% 100%) |
| `--wa-radio-button-dot-size` | 8px | 8px | 8px |
| `--wa-radio-button-focus-ring-color` | var(--wa-action-color-info-50opc) | var(--wa-action-color-info-30opc) | var(--wa-action-color-info-30opc) |
| `--wa-radio-button-focus-ring-size` | 3px | 3px | 3px |
| `--wa-radio-button-size` | 20px | 18px | 18px |
| `--wa-radio-button-outline-color` | var(--wa-action-color-info-40opc) | var(--wa-action-color-info-40opc) | var(--wa-action-color-info-40opc) |
| `--wa-radio-button-outline-color-disabled` | var(--wa-action-color-info-20opc) | var(--wa-action-color-info-20opc) | var(--wa-action-color-info-20opc) |

### Form / label (5)

| Token | wa1-dark | wa2-dark | wa2-light |
|-------|-----------|-----------|------------|
| `--wa-form-validation-invalid` | var(--wa-action-color-error) | var(--wa-action-color-error) | var(--wa-action-color-error) |
| `--wa-form-validation-mandatory` | var(--wa-action-color-warn) | var(--wa-action-color-warn) | var(--wa-action-color-warn) |
| `--wa-form-validation-valid` | var(--wa-action-color-success) | var(--wa-action-color-success) | var(--wa-action-color-success) |
| `--wa-gauge-label-color` | hsl(0deg 0% 100%) | hsl(0deg 0% 100%) | hsl(0deg 0% 0%) |
| `--wa-label-color` | hsl(0deg 0% 50%) | hsl(221deg 15% 60%) | hsl(207deg 8% 45%) |

### Input (4)

| Token | wa1-dark | wa2-dark | wa2-light |
|-------|-----------|-----------|------------|
| `--wa-input-icon-color` | var(--wa-icon-color) | var(--wa-icon-color) | var(--wa-icon-color) |
| `--wa-input-placeholder-color` | hsl(221deg 27% 30%) | hsl(221deg 20% 36%) | hsl(206deg 9% 64%) |
| `--wa-input-placeholder-color-disabled` | hsl(221deg 27% 50%) | hsl(221deg 20% 35%) | hsl(206deg 9% 64%) |
| `--wa-tabs-input-placeholder-color` | var(--wa-input-placeholder-color) | var(--wa-input-placeholder-color) | var(--wa-input-placeholder-color) |

### Border colour (15)

| Token | wa1-dark | wa2-dark | wa2-light |
|-------|-----------|-----------|------------|
| `--wa-accordion-border-color` | var(--wa-border-color) | var(--wa-border-color) | var(--wa-border-color) |
| `--wa-border-color` | hsl(221deg 20% 35%) | hsl(221deg 27% 11%) | hsl(206deg 14% 81%) |
| `--wa-button-border-color` | hsl(209deg 25% 34%) | var(--wa-border-color) | var(--wa-border-color) |
| `--wa-button-border-color-disabled` | var(--wa-background-color-100) | var(--wa-background-color-100) | hsl(206deg 14% 91%) |
| `--wa-button-border-color-hover` | hsl(209deg 25% 39%) | hsl(209deg 25% 39%) | hsl(206deg 14% 61%) |
| `--wa-dropdown-border-color` | hsl(221deg 36% 17%) | hsl(221deg 36% 17%) | hsl(206deg 14% 81%) |
| `--wa-dropdown-item-border-color` | var(--wa-background-color-700) | transparent | transparent |
| `--wa-form-border-color` | hsl(206deg 14% 81%) | hsl(221deg 25% 25%) | var(--wa-border-color) |
| `--wa-input-border-color` | #314168 | var(--wa-border-color) | var(--wa-border-color) |
| `--wa-input-border-color-hover` | hsl(221deg 29% 11%) | var(--wa-border-color) | var(--wa-border-color) |
| `--wa-radio-button-border-color` | hsl(0deg 0% 100%) | var(--wa-text-color) | var(--wa-text-color) |
| `--wa-radio-button-border-color-checked` | var(--wa-action-color-info) | var(--wa-action-color-info) | var(--wa-action-color-info) |
| `--wa-radio-button-border-color-disabled` | transparent | var(--wa-text-color-disabled) | hsl(206deg 14% 91%) |
| `--wa-tabs-border-color` | var(--wa-border-color) | var(--wa-border-color) | var(--wa-border-color) |
| `--wa-tabs-placeholder-border-color` | var(--wa-action-color-info-30opc) | var(--wa-action-color-info-30opc) | var(--wa-action-color-info-30opc) |

### Border radius (13)

| Token | wa1-dark | wa2-dark | wa2-light |
|-------|-----------|-----------|------------|
| `--wa-border-radius-xs` | 1px | 1px | 1px |
| `--wa-border-radius-s` | 2px | 2px | 2px |
| `--wa-border-radius-m` | 4px | 4px | 4px |
| `--wa-border-radius-l` | 8px | 8px | 8px |
| `--wa-border-radius-xl` | 16px | 10px | 16px |
| `--wa-dialog-border-radius` | var(--wa-border-radius-m) | var(--wa-border-radius-m) | var(--wa-border-radius-m) |
| `--wa-dropdown-border-radius` | 4px | var(--wa-border-radius-m) | var(--wa-border-radius-m) |
| `--wa-dropdown-item-border-radius` | 4px | var(--wa-border-radius-m) | var(--wa-border-radius-m) |
| `--wa-scrollbar-thumb-border-radius` | 3px | 3px | 3px |
| `--wa-scrollbar-track-border-radius` | 3px | 3px | 3px |
| `--wa-tabs-border-radius` | 4px 4px 0px 0px | 4px 4px 0px 0px | 8px 8px 0px 0px |
| `--wa-tabs-new-tab-button-border-radius` | 4px | 4px | 50% |
| `--wa-toast-border-radius` | var(--wa-border-radius-m) | var(--wa-border-radius-m) | var(--wa-border-radius-m) |

### Component size (3)

| Token | wa1-dark | wa2-dark | wa2-light |
|-------|-----------|-----------|------------|
| `--wa-component-size-s` | 20px | 20px | 24px |
| `--wa-component-size-m` | 26px | 30px | 30px |
| `--wa-component-size-l` | 36px | 36px | 36px |

### Gap survivors (2)

| Token | All themes |
|-------|------------|
| `--wa-calendar-row-gap` | 5px |
| `--wa-tabs-gap-size` | 2px |

### Padding (7)

| Token | wa1-dark | wa2-dark | wa2-light |
|-------|-----------|-----------|------------|
| `--wa-dropdown-item-padding` | 8px | var(--wa-padding-m) | var(--wa-padding-m) |
| `--wa-padding-xs` | 2px | 2px | 2px |
| `--wa-padding-s` | 4px | 4px | 4px |
| `--wa-padding-m` | 8px | 8px | 8px |
| `--wa-padding-l` | 12px | 12px | 12px |
| `--wa-padding-xl` | 16px | 16px | 16px |
| `--wa-tabs-padding` | 5px | 5px | 5px |

### Dialog / toast borders (2)

| Token | wa1-dark | wa2-dark | wa2-light |
|-------|-----------|-----------|------------|
| `--wa-dialog-border` | 1px solid var(--wa-background-color-900) | 1px solid var(--wa-background-color-900) | 1px solid hsl(0deg 0% 80%) |
| `--wa-toast-border` | 1px solid hsl(209deg 26% 25%) | 1px solid hsl(209deg 26% 25%) | 1px solid hsl(209deg 26% 25%) |

### Tabs (6)

| Token | wa1-dark | wa2-dark | wa2-light |
|-------|-----------|-----------|------------|
| `--wa-tabs-cont-height` | 30px | 30px | 30px |
| `--wa-tabs-height` | 28px | 28px | var(--wa-component-size-m) |
| `--wa-tabs-height-selected` | 30px | 30px | 30px |
| `--wa-tabs-icon-color` | var(--wa-text-color) | var(--wa-text-color) | var(--wa-text-color) |
| `--wa-tabs-icon-size` | var(--wa-icon-size-xs) | var(--wa-icon-size-xs) | var(--wa-icon-size-xs) |
| `--wa-tabs-width` | 150px | 150px | 150px |

### Other (1)

| Token | wa1-dark | wa2-dark | wa2-light |
|-------|-----------|-----------|------------|
| `--wa-text-size` | 1rem | 10px | 10px |

Note: `--wa-text-size` is the base unit for v2's numeric font scale (not shipped).
Use `--wa-font-size-m` for body text.

### Font family (8)

| Token | wa1-dark | wa2-dark | wa2-light |
|-------|-----------|-----------|------------|
| `--wa-dropdown-item-font-family` | var(--wa-font-family) | var(--wa-font-family) | var(--wa-font-family) |
| `--wa-font-family` | "Public Sans" | "Public Sans" | "Public Sans" |
| `--wa-font-family-bold` | "Public Sans Bold" | "Public Sans Bold" | "Public Sans Bold" |
| `--wa-font-family-light` | "Public Sans Light" | "Public Sans Light" | "Public Sans Light" |
| `--wa-font-family-semibold` | "Public Sans Semibold" | "Public Sans SemiBold" | "Public Sans SemiBold" |
| `--wa-label-font-family` | var(--wa-font-family) | var(--wa-font-family) | var(--wa-font-family) |
| `--wa-toast-font-family` | var(--wa-font-family) | var(--wa-font-family) | var(--wa-font-family) |
| `--wa-toast-header-font-family` | var(--wa-font-family-bold) | var(--wa-font-family-bold) | var(--wa-font-family-bold) |

Note: `--wa-font-family-semibold` deliberately preserves the v1/v2 casing difference.

### Font size (10)

| Token | wa1-dark | wa2-dark | wa2-light |
|-------|-----------|-----------|------------|
| `--wa-dropdown-item-font-size` | var(--wa-font-size-m) | var(--wa-font-size-m) | var(--wa-font-size-m) |
| `--wa-font-size-xs` | 10px | 10px | 10px |
| `--wa-font-size-s` | 12px | 12px | 12px |
| `--wa-font-size-m` | 14px | 13px | 13px |
| `--wa-font-size-l` | 16px | 14px | 14px |
| `--wa-font-size-xl` | 18px | 16px | 16px |
| `--wa-gauge-label-font-size` | 16px | 16px | 16px |
| `--wa-label-font-size` | var(--wa-font-size-s) | var(--wa-font-size-s) | var(--wa-font-size-s) |
| `--wa-toast-font-size` | var(--wa-font-size-m) | var(--wa-font-size-m) | var(--wa-font-size-m) |
| `--wa-toast-header-font-size` | var(--wa-font-size-l) | var(--wa-font-size-l) | var(--wa-font-size-l) |

### Font weight (9)

| Token | All themes |
|-------|------------|
| `--wa-font-weight-thin` | 100 |
| `--wa-font-weight-extralight` | 200 |
| `--wa-font-weight-light` | 300 |
| `--wa-font-weight-normal` | 400 |
| `--wa-font-weight-medium` | 500 |
| `--wa-font-weight-semibold` | 600 |
| `--wa-font-weight-bold` | 700 |
| `--wa-font-weight-extrabold` | 800 |
| `--wa-font-weight-black` | 900 |

### Line height (5)

| Token | All themes |
|-------|------------|
| `--wa-line-height-xs` | 15px |
| `--wa-line-height-s` | 18px |
| `--wa-line-height-m` | 21px |
| `--wa-line-height-l` | 24px |
| `--wa-line-height-xl` | 27px |

Note: These are px values, not unitless ratios.

### Links (4)

| Token | wa1-dark | wa2-dark | wa2-light |
|-------|-----------|-----------|------------|
| `--wa-link-color` | hsl(216deg 86% 51%) | hsl(216deg 86% 66%) | hsl(216deg 86% 47%) |
| `--wa-link-color-active` | hsl(271deg 100% 60%) | hsl(271deg 100% 75%) | hsl(271deg 100% 56%) |
| `--wa-link-color-hover` | hsl(216deg 86% 56%) | hsl(216deg 86% 71%) | hsl(216deg 86% 52%) |
| `--wa-link-color-visited` | hsl(271deg 100% 50%) | hsl(271deg 100% 65%) | hsl(271deg 100% 46%) |

### Text colour (29)

| Token | wa1-dark | wa2-dark | wa2-light |
|-------|-----------|-----------|------------|
| `--wa-accordion-header-text-color` | var(--wa-text-color) | var(--wa-text-color) | var(--wa-text-color) |
| `--wa-button-text-color` | var(--wa-text-color) | var(--wa-text-color) | var(--wa-text-color) |
| `--wa-button-text-color-disabled` | var(--wa-background-color-100) | var(--wa-text-color-disabled) | var(--wa-text-color-disabled) |
| `--wa-button-text-color-hover` | var(--wa-text-color) | var(--wa-text-color) | var(--wa-text-color) |
| `--wa-calendar-weekdays-text-color` | var(--wa-action-color-info-100) | var(--wa-action-color-info-100) | var(--wa-action-text-color-info) |
| `--wa-countdown-timer-donut-text-color` | var(--wa-text-color) | var(--wa-text-color) | var(--wa-text-color) |
| `--wa-countdown-timer-text-color` | var(--wa-label-color) | var(--wa-label-color) | var(--wa-label-color) |
| `--wa-dropdown-item-text-color` | var(--wa-text-color) | var(--wa-text-color) | var(--wa-text-color) |
| `--wa-dropdown-item-text-color-active` | var(--wa-action-color-info) | var(--wa-action-color-info) | var(--wa-action-color-info) |
| `--wa-dropdown-item-text-color-disabled` | var(--wa-background-color-100) | var(--wa-background-color-100) | hsl(205deg 12% 70%) |
| `--wa-dropdown-item-text-color-hover` | var(--wa-action-color-info) | var(--wa-action-color-info) | var(--wa-action-color-info) |
| `--wa-dropdown-item-text-color-selected` | var(--wa-action-text-color-info) | var(--wa-action-text-color-info) | var(--wa-action-text-color-info) |
| `--wa-header-text-color` | hsl(29deg 100% 59%) | hsl(30deg 70% 60%) | hsl(206deg 38% 15%) |
| `--wa-header-text-color-disabled` | hsl(29deg 100% 84%) | hsl(30deg 60% 60%) | hsl(206deg 7% 55%) |
| `--wa-header-text-color-hover` | hsl(29deg 100% 64%) | hsl(30deg 70% 64%) | hsl(206deg 38% 25%) |
| `--wa-input-text-color` | var(--wa-text-color) | var(--wa-text-color) | var(--wa-text-color) |
| `--wa-input-text-color-disabled` | var(--wa-text-color-disabled) | var(--wa-text-color-disabled) | var(--wa-text-color-disabled) |
| `--wa-input-text-color-hover` | var(--wa-text-color) | var(--wa-text-color) | var(--wa-text-color) |
| `--wa-radio-button-text-color` | var(--wa-text-color) | var(--wa-text-color) | var(--wa-text-color) |
| `--wa-radio-button-text-color-disabled` | var(--wa-text-color-disabled) | var(--wa-text-color-disabled) | var(--wa-text-color-disabled) |
| `--wa-tabs-input-text-color` | var(--wa-input-text-color) | var(--wa-input-text-color) | var(--wa-input-text-color) |
| `--wa-tabs-text-color` | var(--wa-text-color) | var(--wa-text-color) | var(--wa-text-color) |
| `--wa-tabs-text-color-disabled` | var(--wa-text-color-disabled) | var(--wa-text-color-disabled) | var(--wa-text-color-disabled) |
| `--wa-tabs-text-color-hover` | var(--wa-text-color) | var(--wa-text-color) | var(--wa-text-color) |
| `--wa-tabs-text-color-selected` | var(--wa-text-color) | var(--wa-text-color) | var(--wa-text-color) |
| `--wa-text-color` | hsl(0deg 0% 100%) | hsl(221deg 30% 96%) | hsl(206deg 38% 15%) |
| `--wa-text-color-disabled` | hsl(0deg 0% 66%) | hsl(221deg 20% 57%) | hsl(206deg 9% 64%) |
| `--wa-toast-header-text-color` | hsl(0deg 0% 100%) | hsl(0deg 0% 100%) | hsl(0deg 0% 100%) |
| `--wa-toast-text-color` | hsl(0deg 0% 92%) | hsl(0deg 0% 92%) | hsl(0deg 0% 92%) |

### Text shadow (7)

| Token | wa1-dark | wa2-dark | wa2-light |
|-------|-----------|-----------|------------|
| `--wa-button-text-shadow` | none | none | none |
| `--wa-calendar-weekdays-text-shadow` | 0px 1px 1px var(--wa-black-color) | 0px 1px 1px var(--wa-black-color) | 0px 1px 1px var(--wa-black-color) |
| `--wa-dropdown-item-text-shadow` | none | none | none |
| `--wa-header-text-shadow` | 0px 1px 1px var(--wa-black-color) | 0px 1px 1px var(--wa-black-color) | none |
| `--wa-label-text-shadow` | none | 0px 1px 1px var(--wa-black-color) | none |
| `--wa-tabs-text-shadow` | none | none | none |
| `--wa-text-shadow` | none | 0px 1px 1px var(--wa-black-color) | none |

---

## What is deliberately absent, and what to use instead

| Absent | Reason | Use instead |
|--------|--------|-------------|
| `--wa-primary-color*`, `-secondary-*`, `-tertiary-*` | v1-only (deprecated in v2) | `--wa-action-color-info` |
| `--wa-gap-*` | v2-only | `--wa-padding-*` |
| `--wa-font-size-2…12` | resolves ~3× larger under v2 than v1 | `--wa-font-size-xs…xl` |
| `--wa-input-border-color-disabled` | v2 value references `--wa-border-color-disabled`, a v2-only unshipped token | — |
| `--wa-circular-progress-bar-gradient-color-start` | references `--wa-primary-color` (v1-only) | — |
| `--wa-circular-progress-bar-gradient-color-end` | references `--wa-secondary-color` (v1-only, no replacement) | — |
