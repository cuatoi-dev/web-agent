// ---------------------------------------------------------------------------
// no-raw-colour
//
// Replaces the vitest guard that used to live in
// `packages/web-agent-lit/src/themes/no-raw-colour-guard.test.ts`. The
// detection logic is carried over unchanged; only the delivery mechanism
// moved, so a violation now reports at its own file and line while you type
// instead of failing one test in another package.
// ---------------------------------------------------------------------------

import { textRule } from "../lib/css-text.mjs";

// Non-palette CSS and SVG keywords. Each is a special value rather than a
// theme colour, so tokenizing it would be wrong.
const COLOUR_KEYWORD_ALLOW_LIST = new Set([
  "transparent",  // zero-opacity, not a palette entry
  "currentcolor", // inherits the cascade's text colour
  "inherit",
  "initial",
  "unset",
  "none",         // SVG fill/stroke disable
]);

// Files whose colours ENCODE DATA rather than style chrome, exempt by the
// recorded decision on task 018: "The Chart.js data-series palette stays
// untouched … Those are data-encoding colours whose job is to keep N series
// mutually distinguishable; collapsing them onto a 3-theme token set would
// make series ambiguous."
//
// A NEW file is never exempt by default — add it here with its reason.
const DATA_ENCODING_FILES = [
  // Chart.js series palette — the decision above, verbatim.
  "web-agent-charting/src/chart/chart-palette.ts",
  // Candle up/down colours, the reference-line stroke default and the box-fill
  // default, all painted to canvas as data encoding. The annotation LABEL text
  // in this file is chrome and IS themed, so the exemption does not cover it.
  "web-agent-charting/src/chart/finance-charts.ts",
  // Payoff, profit-and-loss, drawdown and waterfall fills: sign- and
  // series-encoding.
  "web-agent-charting/src/ui-blocks/chart-spec.ts",
  // Colours inside the prompt's example JSON — documentation the model copies
  // into a Chart.js config, not application styling.
  "web-agent-charting/src/skills/chart-skill.ts",
];

function isDataEncodingFile(filename) {
  const posix = filename.split("\\").join("/");
  return DATA_ENCODING_FILES.some((f) => posix.endsWith(f));
}

const HEX = /#(?:[0-9a-fA-F]{3,4}){1,2}\b/g;
const COLOUR_FUNC = /\b(?:rgba?|hsla?)\s*\([^)]+\)/gi;
const NAMED = /\b(white|black|red|green|blue|yellow|magenta|cyan)\b/gi;
// A named colour only counts inside a declaration — `green` in prose or an
// identifier is not a style decision.
const COLOUR_CONTEXT = /(?:color|background|border|fill|stroke|shadow)\s*[:=]/i;

export default textRule(
  {
    type: "problem",
    docs: {
      description:
        "Require every colour to resolve from a --wa-* token rather than a raw literal.",
    },
    schema: [],
    messages: {
      rawColour:
        "Raw colour `{{matched}}` is not themed. Use var(--wa-<name>, {{matched}}) so it changes with the theme.",
    },
  },
  (lines, filename) => {
    if (filename.endsWith("wa-tokens.css") || isDataEncodingFile(filename)) return [];
    const out = [];
    lines.forEach((line, i) => {
      for (const re of [new RegExp(HEX.source, "g"), new RegExp(COLOUR_FUNC.source, "gi")]) {
        let m;
        while ((m = re.exec(line)) !== null) {
          out.push({
            line: i + 1,
            column: m.index,
            length: m[0].length,
            messageId: "rawColour",
            data: { matched: m[0] },
          });
        }
      }
      const namedRe = new RegExp(NAMED.source, "gi");
      let m;
      while ((m = namedRe.exec(line)) !== null) {
        if (COLOUR_KEYWORD_ALLOW_LIST.has(m[1].toLowerCase())) continue;
        if (!COLOUR_CONTEXT.test(line)) continue;
        out.push({
          line: i + 1,
          column: m.index,
          length: m[0].length,
          messageId: "rawColour",
          data: { matched: m[0] },
        });
      }
    });
    return out;
  },
);
