/** `<wa-button>` visual variant. */
export type WaButtonVariant = "primary" | "secondary" | "danger";

/** One `<wa-menu>` entry. `id` comes back in the `select` event. */
export interface WaMenuItem {
  id: string;
  label: string;
  disabled?: boolean;
  icon?: string;
  checked?: boolean;
}

/** `detail` of `<wa-menu>`'s `select` event. */
export interface WaSelectDetail { id: string; }

/** `detail` of `<wa-checkbox>`'s `checked-change` event. */
export interface WaCheckedChangeDetail { checked: boolean; }

/** `detail` of `value-input` from `<wa-text-input>` and `<wa-text-area>`. */
export interface WaValueInputDetail { value: string; }

/** A tag name and the class a registry registers under it. */
export type WaElementEntry = readonly [tag: string, cls: CustomElementConstructor];
