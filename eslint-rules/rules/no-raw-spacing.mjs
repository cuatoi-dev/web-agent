// ---------------------------------------------------------------------------
// no-raw-spacing
//
// The spacing scales are theme-varying, exactly like the colour palette:
// `--wa-border-radius-xl` is 16px in one theme and 10px in another, and
// `--wa-component-size-m` is 26px in one and 30px in others. A raw length
// therefore escapes the theme the same way a raw hex does.
//
// There are NO margin tokens. The rule checks the SHAPE of the value, not which
// token supplies it, so a margin is satisfied by the padding ladder
// (`--wa-padding-xs/s/m/l/xl` = 2/4/8/12/16px) — the same spacing steps. No
// new token is required.
//
// Percentages are NOT flagged: `padding: 0 50%` is a layout ratio, not a step
// on the spacing scale, and no token expresses it.
// ---------------------------------------------------------------------------

import { textRule } from "../lib/css-text.mjs";

const SPACING_PROPERTY =
  /\b(padding|margin|gap|row-gap|column-gap|border-radius)(?:-(?:top|right|bottom|left|block|inline|start|end))?\s*:\s*([^;]+);/gi;

// A raw length: a number followed by an absolute or font-relative unit.
const RAW_LENGTH = /(?<![\w-])\d*\.?\d+\s*(px|rem|em|ch|vh|vw|vmin|vmax)\b/i;

export default textRule(
  {
    type: "problem",
    docs: {
      description:
        "Require padding, margin, gap and border-radius to resolve from a --wa-* token rather than a raw length.",
    },
    schema: [],
    messages: {
      rawSpacing:
        "Raw spacing `{{property}}: {{value}}` is not themed. Use var(--wa-<name>, {{value}}) — the spacing scale is --wa-padding-xs/s/m/l/xl and --wa-border-radius-xs/s/m/l/xl.",
    },
  },
  (lines, filename) => {
    if (filename.endsWith("wa-tokens.css")) return [];
    const out = [];
    lines.forEach((line, i) => {
      const re = new RegExp(SPACING_PROPERTY.source, "gi");
      let m;
      while ((m = re.exec(line)) !== null) {
        const [, property, rawValue] = m;
        const value = rawValue.trim();
        // Every masked token, and any value with no raw length in it (0, auto,
        // inherit, 50%), is already acceptable.
        if (!RAW_LENGTH.test(value)) continue;
        out.push({
          line: i + 1,
          column: m.index,
          length: m[0].length,
          messageId: "rawSpacing",
          data: { property, value },
        });
      }
    });
    return out;
  },
);
