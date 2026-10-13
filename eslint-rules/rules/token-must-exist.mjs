// ---------------------------------------------------------------------------
// token-must-exist
//
// The other token rules check the SHAPE of a value — that it goes through
// `var(--wa-*, <fallback>)`. They do not check that the token NAMED there
// actually exists, and a name that does not exist is invisible:
//
//     color: var(--wa-txet-colour-typo, #fff);   // shape is fine
//
// That declaration is silently frozen on `#fff` in every theme, which is the
// exact bug the token system exists to prevent. It passed every other rule.
//
// This rule closes that gap. It reads the token index built from
// `wa-tokens.css` and reports any `var(--wa-…)` naming something that
// is not declared in ALL theme blocks — a typo, a token removed from the CSS
// but still referenced, or one added to a single theme.
//
// It replaces the "every --wa-* token used by X is defined in all three
// themes" assertion that six test files each re-implemented by reaching across
// package boundaries with five levels of `../` to read the CSS themselves.
// One rule reads it from one known place instead.
//
// Added 2026-09-06 at the user's instruction: source-reading assertions are
// linting's job.
// ---------------------------------------------------------------------------

import { maskCommentsOnly } from "../lib/css-text.mjs";
import { tokenIndex } from "../lib/token-index.mjs";

const VAR_USE = /var\(\s*(--wa-[a-z0-9-]+)/gi;

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require every --wa-* token referenced in a var() to be declared in every theme block.",
    },
    schema: [],
    messages: {
      unknownToken:
        "`{{token}}` is not declared in wa-tokens.css. This renders the fallback in every theme, so the value is frozen — check the spelling against the token file.",
      partialToken:
        "`{{token}}` is declared in only {{found}} of {{total}} theme blocks. A theme that does not declare it renders the fallback instead, so the value changes between themes for the wrong reason.",
    },
  },
  create(context) {
    const idx = tokenIndex();
    if (!idx.available) return {};
    return {
      "Program:exit"() {
        const filename = (context.filename ?? context.getFilename()).split("\\").join("/");
        // The token file declares these names; it does not consume them.
        if (filename.endsWith("wa-tokens.css")) return;

        // Comments are blanked so a token named in prose is not reported, but
        // var() masking is NOT applied here: the whole point is to look at the
        // token name inside each var().
        const lines = maskCommentsOnly(context.sourceCode.getText()).split("\n");
        lines.forEach((line, i) => {
          const re = new RegExp(VAR_USE.source, "gi");
          let mm;
          while ((mm = re.exec(line)) !== null) {
            const token = mm[1];
            if (idx.inAll.has(token)) continue;
            const loc = {
              start: { line: i + 1, column: mm.index },
              end: { line: i + 1, column: mm.index + mm[0].length },
            };
            if (idx.partial.has(token)) {
              context.report({
                loc,
                messageId: "partialToken",
                data: {
                  token,
                  found: String(idx.partial.get(token)),
                  total: String(idx.blockCount),
                },
              });
            } else {
              context.report({ loc, messageId: "unknownToken", data: { token } });
            }
          }
        });
      },
    };
  },
};
