// The shapes for multi-select.ts. Split out per `wa/types-in-types-file`.

/** "*" means every name, including names added later. */
export type MultiSelectValue = "*" | string[];

export interface MultiSelectGroup {
  /** Shown above the group's rows; null = no heading. */
  heading: string | null;
  names: string[];
}

export interface MultiSelectAllOption {
  label: string;
  hint?: string;
}

export interface MultiSelectOptions {
  /** Prefix for every element id the control creates. Unique on the page. */
  id: string;
  /** Visible label, also the accessible name of the box and the list. */
  label: string;
  groups: MultiSelectGroup[];
  /** null = no "All (*)" row (the two exclude fields). */
  allOption: MultiSelectAllOption | null;
  value: MultiSelectValue;
  disabled: boolean;
  /** true only for Tools and Excluded tools. */
  filter: boolean;
  onChange: (value: MultiSelectValue) => void;
}

/** One option row. */
export interface MultiSelectRow {
  name: string;
  el: HTMLElement;
  tick: HTMLElement;
}

/** One group's heading and rows, for hiding a heading with no visible row. */
export interface MultiSelectSection {
  heading: HTMLElement | null;
  rows: MultiSelectRow[];
}

export interface MultiSelect {
  /** `div.field.ms`: label, box, popup. The caller appends hints and errors. */
  root: HTMLElement;
  /** The `role="combobox"` element. */
  box: HTMLElement;
  getValue(): MultiSelectValue;
  /** Repaints chips and ticks. Does NOT call onChange. */
  setValue(value: MultiSelectValue): void;
  setDisabled(disabled: boolean): void;
  isOpen(): boolean;
  open(): void;
  close(): void;
}
