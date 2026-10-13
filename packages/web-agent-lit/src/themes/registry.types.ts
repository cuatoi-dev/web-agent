/** A theme's colour scheme. `defaultTheme` maps each to a built-in theme. */
export type ThemeScheme = "dark" | "light";

/** One registered theme. `id` is the `data-theme` value. */
export interface Theme {
  id: string;
  /** What theme pickers show. */
  label: string;
  scheme: ThemeScheme;
  /** A built-in theme id. It fills every token the theme does not declare. */
  base?: string;
  /** The theme stylesheet: a `URL` is linked, a string is CSS text. */
  css?: URL | string;
}
