// ---------------------------------------------------------------------------
// no-innerhtml-write
//
// A file that renders with a Lit template must not also write HTML by hand.
//
// An `innerHTML` write (or `outerHTML`, or `insertAdjacentHTML`) replaces the
// DOM under Lit's control. Lit keeps a record of the nodes it created, so after
// the write the next re-render patches against a tree that is no longer there
// and the widget breaks. The fix is to render the markup through the template,
// with `unsafeHTML(sanitized)` when the string is trusted HTML.
//
// The rule applies only to a file that imports `html` from `lit`, `lit-html` or
// a `ui/template` module. A plain `innerHTML` write elsewhere — for example a
// sanitiser that parses HTML into a detached element — is out of scope on
// purpose, and the scoped lint block keeps the write out of a template file.
//
// The rule buffers the writes and reports them at `Program:exit`, so an import
// that comes after the write is still seen. Import order must not change the
// result.
// ---------------------------------------------------------------------------

const HTML_MODULES = new Set(["lit", "lit-html"]);

/** True for a module path the rule treats as the HTML template entry. */
function isHtmlModule(source) {
  if (typeof source !== "string") return false;
  if (HTML_MODULES.has(source)) return true;
  return /ui\/template(\.js|\.ts)?$/.test(source);
}

/** The non-computed name of a member expression, or undefined. */
function memberName(node) {
  if (node.type !== "MemberExpression" || node.computed) return undefined;
  if (node.property.type !== "Identifier") return undefined;
  return node.property.name;
}

export default {
  meta: {
    type: "problem",
    schema: [],
    docs: {
      description:
        "Render HTML through the Lit template, not an `innerHTML` write.",
    },
    messages: {
      write:
        "Render HTML through the template (unsafeHTML(sanitized)), not innerHTML.",
    },
  },
  create(context) {
    let importsHtml = false;
    const writes = [];

    return {
      ImportDeclaration(node) {
        if (!isHtmlModule(node.source.value)) return;
        for (const specifier of node.specifiers) {
          if (
            specifier.type === "ImportSpecifier" &&
            specifier.imported.type === "Identifier" &&
            specifier.imported.name === "html"
          ) {
            importsHtml = true;
          }
        }
      },

      AssignmentExpression(node) {
        if (node.left.type !== "MemberExpression") return;
        const name = memberName(node.left);
        if (name === "innerHTML" || name === "outerHTML") {
          writes.push(node);
        }
      },

      CallExpression(node) {
        if (node.callee.type !== "MemberExpression") return;
        if (memberName(node.callee) === "insertAdjacentHTML") {
          writes.push(node);
        }
      },

      "Program:exit"() {
        if (!importsHtml) return;
        for (const node of writes) {
          context.report({ node, messageId: "write" });
        }
      },
    };
  },
};
