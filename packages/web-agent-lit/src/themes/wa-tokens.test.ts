import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Helper — CSS block parser
// ---------------------------------------------------------------------------

type Block = { theme: string; decls: Map<string, string> };

/**
 * Parse `[data-theme="X"] { … }` blocks and collect `--name: value;`
 * declarations inside each.  Values may span multiple lines and may contain
 * nested `var()` — we rely on balanced-brace counting to find block ends.
 */
function parseBlocks(css: string): Block[] {
  const blocks: Block[] = [];

  // Strip comments so they don't interfere with brace counting or `{` counting.
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");

  // Regex: match `[data-theme="X"]`, then the rest of the selector list
  // (the `:where([data-theme-base="X"])` base selector), then `{`
  const blockStart = /\[data-theme="([^"]+)"\][^{]*\{/g;
  let m: RegExpExecArray | null;

  while ((m = blockStart.exec(stripped)) !== null) {
    const theme = m[1];
    let depth = 1;
    let i = m.index + m[0].length;

    while (i < stripped.length && depth > 0) {
      if (stripped[i] === "{") depth++;
      else if (stripped[i] === "}") depth--;
      i++;
    }

    const body = stripped.slice(m.index + m[0].length, i - 1);
    const decls = new Map<string, string>();

    // Match `--name: value;` — value may not contain `;` inside var() but our
    // values are all single-line in this generated file.
    const declRe = /(--[\w-]+)\s*:\s*([^;]+);/g;
    let d: RegExpExecArray | null;
    while ((d = declRe.exec(body)) !== null) {
      const name = d[1].trim();
      const value = d[2].trim();
      decls.set(name, value);
    }

    blocks.push({ theme, decls });
  }

  return blocks;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number): number => {
    let tt = t % 1;
    if (tt < 0) tt += 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)];
}

/** Parses an `hsl(Hdeg S% L%)` token value into 0-1 RGB. */
function parseHsl(value: string): [number, number, number] {
  const m = value.match(
    /^hsla?\(\s*([\d.]+)(?:deg)?\s+([\d.]+)%\s+([\d.]+)%\s*\)$/i
  );
  if (!m) throw new Error(`not a plain hsl() token: ${value}`);
  const h = (parseFloat(m[1]) % 360) / 360;
  const s = parseFloat(m[2]) / 100;
  const l = parseFloat(m[3]) / 100;
  return hslToRgb(h, s, l);
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number): number =>
    v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2.1 contrast ratio between two `hsl()` token values. */
function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(parseHsl(a));
  const lb = relativeLuminance(parseHsl(b));
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

// ---------------------------------------------------------------------------
// Load the real CSS — use path.resolve(__dirname) because the jsdom
// environment does not give import.meta.url a file:// scheme.
// ---------------------------------------------------------------------------

const cssPath = path.resolve(__dirname, "wa-tokens.css");
const css = readFileSync(cssPath, "utf-8");
const blocks = parseBlocks(css);

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

describe("wa-tokens.css", () => {
  // 1. Parse exactly the three theme blocks
  it("applies theme tokens when data-theme is on a non-root container", () => {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);

    const container = document.createElement("div");
    container.setAttribute("data-theme", "wa1-dark");
    document.body.appendChild(container);

    const computed = getComputedStyle(container);
    const declared = blocks
      .find((b) => b.theme === "wa1-dark")
      ?.decls.get("--wa-action-color-info");
    expect(declared).toBeDefined();
    expect(
      computed.getPropertyValue("--wa-action-color-info").trim()
    ).toBe(declared);

    document.head.removeChild(style);
    document.body.removeChild(container);
  });

  // 10. data-theme="provided" inherits ancestor tokens and respects host overrides.
  // jsdom does not model custom-property inheritance across elements, so this
  // verifies every piece of the contract it CAN: (a) the host override wins on
  // the `provided` element, (b) the ancestor base-theme block applies to the
  // ancestor element, and (c) the package ships NO rule for `provided` — so the
  // only token sources a `provided` subtree has are its host overrides and
  // inheritance from the ancestor theme (a real-browser cascade behaviour,
  // covered visually by the showcase worked example).
  it("provided theme inherits ancestor tokens and applies host overrides", () => {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);

    const parent = document.createElement("div");
    parent.setAttribute("data-theme", "wa2-light");

    const child = document.createElement("div");
    child.setAttribute("data-theme", "provided");
    child.style.setProperty("--wa-action-color-info", "#c2185b");

    parent.appendChild(child);
    document.body.appendChild(parent);

    // (a) Host override wins on the `provided` element.
    const childComputed = getComputedStyle(child);
    expect(
      childComputed.getPropertyValue("--wa-action-color-info").trim()
    ).toBe("#c2185b");

    // (b) The ancestor base-theme block applies to the ancestor element.
    const parentComputed = getComputedStyle(parent);
    expect(
      parentComputed.getPropertyValue("--wa-text-color").trim()
    ).toBe("hsl(206deg 38% 15%)");

    // (c) No packaged rule targets `data-theme="provided"` — the package ships
    // no values for it, so everything except host overrides must come from
    // inheritance.
    const selectors = Array.from(
      document.styleSheets[0].cssRules as CSSStyleRule[]
    ).map((r) => r.selectorText);
    expect(selectors).toEqual([
      '[data-theme="wa1-dark"], :where([data-theme-base="wa1-dark"])',
      '[data-theme="wa2-dark"], :where([data-theme-base="wa2-dark"])',
      '[data-theme="wa2-light"], :where([data-theme-base="wa2-light"])',
    ]);

    document.head.removeChild(style);
    document.body.removeChild(parent);
  });

  // 11. Action error/success/warn tokens meet the WCAG AA body-text floor
  // (4.5:1) against both panel backgrounds in every theme. `info` is excluded:
  // it is used as an accent/border colour, not body text, and stays below the floor
  // by design.
  it("action error/success/warn tokens meet WCAG AA contrast against theme backgrounds", () => {
    const backgroundNames = [
      "--wa-background-color",
      "--wa-smart-list-background-color",
    ];
    const actionNames = [
      "--wa-action-color-error",
      "--wa-action-color-success",
      "--wa-action-color-warn",
    ];
    const failures: string[] = [];
    for (const block of blocks) {
      for (const actionName of actionNames) {
        const fg = block.decls.get(actionName);
        expect(fg, `${actionName} missing in ${block.theme}`).toBeDefined();
        for (const bgName of backgroundNames) {
          const bg = block.decls.get(bgName);
          expect(bg, `${bgName} missing in ${block.theme}`).toBeDefined();
          const ratio = contrastRatio(fg!, bg!);
          if (ratio < 4.5) {
            failures.push(
              `${block.theme} ${actionName} (${fg}) vs ${bgName} (${bg}): ${ratio.toFixed(2)}:1`
            );
          }
        }
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("label text meets WCAG AA contrast on the Configuration card, panel, and menu", () => {
    const backgrounds = [
      "--wa-background-color-300",
      "--wa-background-color",
      "--wa-dropdown-background-color",
    ];
    const failures: string[] = [];
    for (const block of blocks) {
      const label = block.decls.get("--wa-label-color");
      expect(label, `label token missing in ${block.theme}`).toBeDefined();
      for (const name of backgrounds) {
        const background = block.decls.get(name);
        expect(background, `${name} missing in ${block.theme}`).toBeDefined();
        const ratio = contrastRatio(label!, background!);
        if (ratio < 4.5) failures.push(`${block.theme} label vs ${name}: ${ratio.toFixed(2)}:1`);
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });

  // 12. The error action token used as a SURFACE: its paired on-colour must
  // clear the AA body-text floor against it in every theme. Case 11 above
  // measures the same token as a FOREGROUND, so raising
  // its lightness for the text role and silently break every error-coloured
  // button, badge and #stop-run at the same time (2.84:1 in wa2-dark, caught
  // only by the end-of-loop mock e2e). `info`, `success` and `warn` are not
  // covered here: `success` and `warn` are never painted as a full-strength
  // surface in this repo. `info` is covered by case 13 below, added by task
  // 005 when the accent moved to hsl(257deg 100% 66%) and reached 4.55:1.
  it("the error on-colour meets WCAG AA contrast against the error surface", () => {
    const failures: string[] = [];
    for (const block of blocks) {
      const surface = block.decls.get("--wa-action-color-error");
      const onColour = block.decls.get("--wa-action-text-color-error");
      expect(surface, `--wa-action-color-error missing in ${block.theme}`).toBeDefined();
      expect(
        onColour,
        `--wa-action-text-color-error missing in ${block.theme}`
      ).toBeDefined();
      const ratio = contrastRatio(onColour!, surface!);
      if (ratio < 4.5) {
        failures.push(
          `${block.theme} --wa-action-text-color-error (${onColour}) on --wa-action-color-error (${surface}): ${ratio.toFixed(2)}:1`
        );
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });

  // 13. The info action token used as a SURFACE: white text sits on it in the
  // cat-store top bar, the .wa-btn primary button, the embed chrome, the chat
  // bubble and the chart-block header. The wa2 accent was lowered from
  // hsl(257deg 100% 67%) (4.36:1) to hsl(257deg 100% 66%) (4.55:1) to clear
  // the floor. Case 14 pins the opposite direction, which is what stopped the
  // value going lower still.
  it("the info on-colour meets WCAG AA contrast against the info surface", () => {
    const failures: string[] = [];
    for (const block of blocks) {
      const surface = block.decls.get("--wa-action-color-info");
      const onColour = block.decls.get("--wa-action-text-color-info");
      expect(surface, `--wa-action-color-info missing in ${block.theme}`).toBeDefined();
      expect(
        onColour,
        `--wa-action-text-color-info missing in ${block.theme}`
      ).toBeDefined();
      const ratio = contrastRatio(onColour!, surface!);
      if (ratio < 4.5) {
        failures.push(
          `${block.theme} --wa-action-text-color-info (${onColour}) on --wa-action-color-info (${surface}): ${ratio.toFixed(2)}:1`
        );
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });

  // 14. The info action token used as a BORDER, OUTLINE or FOCUS RING against
  // the theme background — --wa-outline-color is var(--wa-action-color-info)
  // in wa1-dark and wa2-light (wa2-dark has its own value, see 14b), and
  // the ring rules in cat-store's agent-page.styles.ts and
  // agent-page-panels.styles.ts read --wa-outline-color. WCAG SC 1.4.11 sets a 3:1 floor for non-text contrast. This case
  // is why the wa2 accent uses hsl(257deg 100% 66%) and not the darker 62%
  // proposed: 62% reaches 5.45:1 against white but falls to 2.59:1 here.
  // Case 13 holds the other side: white text on the same token needs 4.5:1,
  // so the value has to sit between the two floors.
  it("the info accent meets the non-text contrast floor against every theme background", () => {
    const failures: string[] = [];
    expect(blocks.map((b) => b.theme)).toEqual(["wa1-dark", "wa2-dark", "wa2-light"]);
    for (const block of blocks) {
      const accent = block.decls.get("--wa-action-color-info");
      const bg = block.decls.get("--wa-background-color");
      expect(accent, `--wa-action-color-info missing in ${block.theme}`).toBeDefined();
      expect(bg, `--wa-background-color missing in ${block.theme}`).toBeDefined();
      const ratio = contrastRatio(accent!, bg!);
      if (ratio < 3) {
        failures.push(
          `${block.theme} --wa-action-color-info (${accent}) vs --wa-background-color (${bg}): ${ratio.toFixed(2)}:1`
        );
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });

  // 14b. The outline token itself — the focus ring role — resolved through one
  // var() hop, meets the same 3:1 floor in every block against BOTH surfaces a
  // ring sits on: the theme background, and --wa-background-color-700, the
  // session column of cat-store's agent page (agent-page.styles.ts .col-sessions).
  // wa2-dark needs its own lighter value: the accent has to stay dark enough
  // for white text (case 13), which leaves it 2.50:1 on the lighter column.
  it("the outline token meets the non-text contrast floor against the background and the session column", () => {
    const failures: string[] = [];
    const surfaces = ["--wa-background-color", "--wa-background-color-700"];
    for (const block of blocks) {
      let outline = block.decls.get("--wa-outline-color");
      expect(outline, `--wa-outline-color missing in ${block.theme}`).toBeDefined();
      const ref = outline!.match(/^var\((--[\w-]+)\)$/);
      if (ref) outline = block.decls.get(ref[1]);
      expect(outline, `--wa-outline-color does not resolve in ${block.theme}`).toBeDefined();
      for (const name of surfaces) {
        const surface = block.decls.get(name);
        expect(surface, `${name} missing in ${block.theme}`).toBeDefined();
        const ratio = contrastRatio(outline!, surface!);
        if (ratio < 3) {
          failures.push(
            `${block.theme} --wa-outline-color (${outline}) vs ${name} (${surface}): ${ratio.toFixed(2)}:1`
          );
        }
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });

  // 15. Input placeholder token meets the WCAG AA body-text floor (4.5:1)
  // against the input background in every theme.
  it("input placeholder token meets WCAG AA contrast against input background", () => {
    const failures: string[] = [];
    for (const block of blocks) {
      const placeholder = block.decls.get("--wa-input-placeholder-color");
      const bg = block.decls.get("--wa-input-background-color");
      expect(
        placeholder,
        `--wa-input-placeholder-color missing in ${block.theme}`
      ).toBeDefined();
      expect(
        bg,
        `--wa-input-background-color missing in ${block.theme}`
      ).toBeDefined();
      const ratio = contrastRatio(placeholder!, bg!);
      if (ratio < 4.5) {
        failures.push(
          `${block.theme} --wa-input-placeholder-color (${placeholder}) vs --wa-input-background-color (${bg}): ${ratio.toFixed(2)}:1`
        );
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });

  // 16. 010 — the jump button's 1px ring meets the non-text contrast floor
  // (3:1) against the list background in EVERY theme, including wa1-dark
  // where the fill alone measures 2.92:1 (see case 14's exclusion). This case
  // is what makes the button's boundary compliant in the theme where the
  // fill is not.
  it("the ring colour meets the non-text contrast floor against the theme background in every theme", () => {
    const failures: string[] = [];
    for (const block of blocks) {
      const ring = block.decls.get("--wa-text-color");
      const bg = block.decls.get("--wa-background-color");
      expect(ring, `--wa-text-color missing in ${block.theme}`).toBeDefined();
      expect(bg, `--wa-background-color missing in ${block.theme}`).toBeDefined();
      const ratio = contrastRatio(ring!, bg!);
      if (ratio < 3) {
        failures.push(
          `${block.theme} --wa-text-color (${ring}) vs --wa-background-color (${bg}): ${ratio.toFixed(2)}:1`
        );
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });
});
