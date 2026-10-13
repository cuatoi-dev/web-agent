// ---------------------------------------------------------------------------
// no-deep-import
//
// A package may be entered at a shallow, deliberate subpath. It may not be dug
// into.
//
// The architecture in `AGENTS.md` requires some subpaths to exist: an
// enhancement package stays framework-agnostic at its `.` entry and puts each
// framework binding behind its own subpath, so `@cuatoi/web-agent-charting/lit`
// is the intended way in and a host importing the `.` entry never pulls Lit.
// Stylesheets are the same — `.../themes/wa-tokens.css` is an asset, and no
// `index.ts` can re-export it.
//
// What is NOT intended is reaching further, past whatever the package chose to
// publish, into the file that happens to hold the thing you want today:
//
//     @cuatoi/web-agent-core/src/loop/run-turn.js      // source layout
//     @cuatoi/web-agent-lit/dist/chat-ui/panel.js      // build output
//     ../../../web-agent-core/src/controller.js           // straight past the
//                                                         // package boundary
//
// Each of those makes an internal module part of the contract by accident: it
// can no longer be renamed, moved or deleted without breaking a consumer the
// package never agreed to serve.
//
// Two limits, both crossed independently:
//
//   depth      at most `maxDepth` segments after the package name. An entry
//              point is a short, chosen name; a path into a file is long.
//   build dirs `src`, `dist` and `node_modules` are never part of a public
//              specifier at any depth. Their presence means the import is
//              addressing the package's internal layout rather than its API.
//
// Test files are exempt, and the exemption lives in `eslint.config.mjs` — this
// rule is scoped to production source. A test reaching into the unit it tests
// is what a unit test is.
// ---------------------------------------------------------------------------

import path from "node:path";
import { resolveRelative, unitOf, importVisitor } from "../lib/module-graph.mjs";

/** Segments that address a package's internal layout, never its API. */
const INTERNAL_SEGMENTS = new Set(["src", "dist", "node_modules"]);

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Enter a package at a shallow subpath; never import a path into its internals.",
    },
    schema: [
      {
        type: "object",
        properties: {
          scope: { type: "string" },
          root: { type: "string" },
          maxDepth: { type: "integer", minimum: 1 },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      tooDeep:
        "`{{spec}}` is {{depth}} levels into `{{pkg}}`; at most {{max}} is allowed. Import one of the package's own entry points, or have it export what you need.",
      internalSegment:
        "`{{spec}}` addresses the internal layout of `{{pkg}}` through `{{segment}}/`. That path is a build detail, not API — import the package's entry point instead.",
      crossUnit:
        "`{{spec}}` resolves into `{{other}}`, another workspace unit. Import that unit by its package name so the dependency goes through a published entry point.",
    },
  },
  create(context) {
    const opts = context.options[0] ?? {};
    const scope = opts.scope ?? "@cuatoi/";
    const root = opts.root ?? process.cwd();
    const maxDepth = opts.maxDepth ?? 2;
    const filename = context.filename ?? context.getFilename();
    const ownUnit = unitOf(filename, root);

    return importVisitor((node, spec) => {
      if (typeof spec !== "string" || spec.length === 0) return;

      if (spec.startsWith(scope)) {
        const parts = spec.slice(scope.length).split("/");
        const pkg = scope + parts[0];
        const sub = parts.slice(1);
        // `@scope/pkg` and `@scope/pkg/package.json` are always fine.
        if (sub.length === 0 || (sub.length === 1 && sub[0] === "package.json")) return;

        const internal = sub.find((s) => INTERNAL_SEGMENTS.has(s));
        if (internal) {
          context.report({
            node,
            messageId: "internalSegment",
            data: { spec, pkg, segment: internal },
          });
          return;
        }
        if (sub.length > maxDepth) {
          context.report({
            node,
            messageId: "tooDeep",
            data: { spec, pkg, depth: String(sub.length), max: String(maxDepth) },
          });
        }
        return;
      }

      // A relative path that climbs out of this unit into another one is the
      // deepest dig there is: it skips the package boundary entirely.
      if (!spec.startsWith(".") || !ownUnit) return;
      const target = resolveRelative(filename, spec);
      if (!target) return;
      const targetUnit = unitOf(target, root);
      if (targetUnit && targetUnit !== ownUnit) {
        context.report({
          node,
          messageId: "crossUnit",
          data: { spec, other: path.relative(root, targetUnit) },
        });
      }
    });
  },
};
