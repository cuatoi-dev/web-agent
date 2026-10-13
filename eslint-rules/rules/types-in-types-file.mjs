// ---------------------------------------------------------------------------
// types-in-types-file
//
// Every interface and type alias lives in `types.ts` or `<name>.types.ts`.
//
// Types declared beside the code that happens to use them first are invisible
// to everyone else: there is no one place to look for the shape of a thing, so
// the same shape gets re-declared, and a change to one copy silently disagrees
// with the others. A named types file gives each shape one home and one
// import path, which is what makes "find all references" and "rename symbol"
// tell the truth.
//
// This rule covers `interface` and `type` declarations only. An `enum` emits
// runtime code, so it is a value and belongs with the module that owns it.
// ---------------------------------------------------------------------------

import path from "node:path";

/** True for `types.ts` and `<name>.types.ts`, in every TS extension. */
function isTypesFile(filename) {
  const base = path.basename(filename);
  return /^types\.[cm]?tsx?$/.test(base) || /\.types\.[cm]?tsx?$/.test(base);
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Declare interfaces and type aliases in `types.ts` or `<name>.types.ts`.",
    },
    schema: [],
    messages: {
      misplaced:
        "`{{name}}` is a {{kind}} declared in `{{file}}`. Types live in `types.ts` or `<name>.types.ts` — move it there and import it with `import type`.",
    },
  },
  create(context) {
    const filename = context.filename ?? context.getFilename();
    if (isTypesFile(filename)) return {};
    const base = path.basename(filename);

    /** Reports one declaration, pointing at its name rather than its body. */
    const report = (kind) => (node) => {
      context.report({
        node: node.id ?? node,
        messageId: "misplaced",
        data: { name: node.id?.name ?? "(anonymous)", kind, file: base },
      });
    };

    return {
      TSInterfaceDeclaration: report("interface"),
      TSTypeAliasDeclaration: report("type alias"),
    };
  },
};
