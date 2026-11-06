/** What the page tools know about one element. */
export interface ElementTarget {
  role: string;
  name: string;
  label: string;
  isPassword: boolean;
}

/** 127/002 — the neutral locator set for one element. Every optional form is
 *  present only when it matches exactly that element. */
export interface LocatorSet {
  role: string;
  name: string;
  /** How many elements have this role and name. Always present. */
  roleMatches: number;
  id?: string;
  /** data-testid. */
  testId?: string;
  /** The name attribute. */
  nameAttr?: string;
  /** For an element with no usable role: the text to find it by, and how many
   *  elements `getByText` matches with it. Set together, and only when `role`
   *  is empty. */
  text?: string;
  textMatches?: number;
  css?: string;
  xpath?: string;
  /** CSS of each enclosing `<iframe>`, from the top page down. */
  frames?: string[];
  /** For an element inside open shadow roots: the CSS of each shadow host from
   *  the page down, then the element's CSS inside the last root. Replaces `css`
   *  and `xpath`. */
  shadow?: string[];
}
