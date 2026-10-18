export type ScreenshotSelection =
  | { ok: true; element: Element; count: number }
  | { ok: false; error: string };

/** One inline declaration, with its priority (for example "important"). */
export interface ScreenshotStyleDeclaration {
  name: string;
  value: string;
  priority: string;
}

/** The inline outline state of an element before the highlight. */
export interface ScreenshotOutline {
  declarations: ScreenshotStyleDeclaration[];
}

/** An element with an inline `style`: HTML and SVG elements. */
export type Styled = (HTMLElement | SVGElement) & { style: CSSStyleDeclaration };
