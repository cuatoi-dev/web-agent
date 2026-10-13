// ---------------------------------------------------------------------------
// dom-test-in-test-dom
//
// A spec that awaits `element.updateComplete` is waiting for Lit to settle real
// DOM. In a headless CI container, when something the component reaches for is
// not working there, that promise never resolves: the spec HANGS instead of
// failing, and takes the whole run with it.
//
// Those specs live in each unit's `test-dom/` folder and run under
// `pnpm test:dom`, so a pipeline can give them their own container, timeout and
// retry policy — or skip them — without slowing the fast tier. This rule is the
// reminder: write one in `src/` and it tells you where it belongs, instead of
// the split quietly eroding one file at a time.
//
// Added 2026-09-06 at the user's request, alongside the split itself.
// ---------------------------------------------------------------------------

import { maskTokensAndComments } from "../lib/css-text.mjs";

const AWAITS_DOM_SETTLE = /await\s[^;\n]*\.updateComplete/;

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require a spec that awaits updateComplete to live in the unit's test-dom/ folder.",
    },
    schema: [],
    messages: {
      wrongFolder:
        "This spec awaits `updateComplete`, so it belongs in the DOM tier. Move it to `{{suggested}}` and it will run under `pnpm test:dom`. Specs that await the DOM hang rather than fail in a headless container, which is why they run separately.",
    },
  },
  create(context) {
    return {
      "Program:exit"() {
        const filename = (context.filename ?? context.getFilename()).split("\\").join("/");
        if (!/\.test\.ts$/.test(filename)) return;
        // Already in the DOM tier, or not in a unit's src/ at all.
        if (filename.includes("/test-dom/")) return;
        const m = /^(.*?\/(?:packages|apps)\/[^/]+)\/src\/(.*)$/.exec(filename);
        if (!m) return;

        const text = maskTokensAndComments(context.sourceCode.getText());
        if (!AWAITS_DOM_SETTLE.test(text)) return;

        const lines = text.split("\n");
        const idx = lines.findIndex((l) => AWAITS_DOM_SETTLE.test(l));
        const line = idx >= 0 ? idx + 1 : 1;
        context.report({
          loc: { start: { line, column: 0 }, end: { line, column: lines[line - 1]?.length ?? 1 } },
          messageId: "wrongFolder",
          data: { suggested: `test-dom/${m[2]}` },
        });
      },
    };
  },
};
