// ---------------------------------------------------------------------------
// no-untokenized-font
//
// Replaces the vitest guard that used to live in
// `packages/web-agent-lit/src/themes/no-untokenized-font-guard.test.ts`.
// ---------------------------------------------------------------------------

import { textRule } from "../lib/css-text.mjs";

const FONT_KEYWORD_ALLOW_LIST = new Set([
  "inherit",   // cascade keyword
  "monospace", // generic family for code, not the palette font
]);

const FONT_FAMILY = /font-family\s*:\s*([^;]+);/g;

export default textRule(
  {
    type: "problem",
    docs: {
      description:
        "Require font-family to resolve from the --wa-font-family token rather than a hardcoded family.",
    },
    schema: [],
    messages: {
      rawFont:
        "font-family `{{value}}` is not themed. Use var(--wa-font-family, {{value}}).",
    },
  },
  (lines, filename) => {
    if (filename.endsWith("wa-tokens.css")) return [];
    const out = [];
    lines.forEach((line, i) => {
      const re = new RegExp(FONT_FAMILY.source, "g");
      let m;
      while ((m = re.exec(line)) !== null) {
        const value = m[1].trim();
        if (value === "VAR_WA_FALLBACK") continue;
        if (FONT_KEYWORD_ALLOW_LIST.has(value)) continue;
        out.push({
          line: i + 1,
          column: m.index,
          length: m[0].length,
          messageId: "rawFont",
          data: { value },
        });
      }
    });
    return out;
  },
);
