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
  css?: string;
  xpath?: string;
  /** CSS of each enclosing `<iframe>`, from the top page down. */
  frames?: string[];
  /** For an element inside open shadow roots: the CSS of each shadow host from
   *  the page down, then the element's CSS inside the last root. Replaces `css`
   *  and `xpath`. */
  shadow?: string[];
}
