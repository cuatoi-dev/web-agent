// ---------------------------------------------------------------------------
// no-cycle
//
// No cycle in the module import graph.
//
// A cycle makes module initialisation order load-bearing: whichever file the
// bundler happens to enter first wins, and the other sees a partly-initialised
// module — typically as `undefined` at the top level, far from the import that
// caused it. Extracting shared shapes into a `types.ts` is the usual fix, and
// is why this rule ships beside `types-in-types-file`.
//
// The walk follows relative imports only. A cross-package cycle cannot form
// while `no-internal-import` holds, because every package is entered through
// its own `index.ts`.
// ---------------------------------------------------------------------------

import path from "node:path";
import { resolveRelative, pathBackTo, importVisitor } from "../lib/module-graph.mjs";

export default {
  meta: {
    type: "problem",
    docs: { description: "Forbid a cycle in the module import graph." },
    schema: [
      {
        type: "object",
        properties: { root: { type: "string" } },
        additionalProperties: false,
      },
    ],
    messages: {
      cycle: "Import cycle: {{chain}}.",
    },
  },
  create(context) {
    const opts = context.options[0] ?? {};
    const root = opts.root ?? process.cwd();
    const filename = context.filename ?? context.getFilename();

    return importVisitor((node, spec) => {
      if (typeof spec !== "string" || !spec.startsWith(".")) return;
      const target = resolveRelative(filename, spec);
      if (!target || target === filename) return;

      // The import closes a cycle when the file it points at can reach back
      // here.
      const chain = pathBackTo(target, filename);
      if (!chain) return;

      const shown = [filename, ...chain].map((f) => path.relative(root, f));
      context.report({
        node,
        messageId: "cycle",
        data: { chain: shown.join(" -> ") },
      });
    });
  },
};
