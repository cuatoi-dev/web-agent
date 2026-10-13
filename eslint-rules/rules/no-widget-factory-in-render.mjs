// ---------------------------------------------------------------------------
// no-widget-factory-in-render
//
// A widget must be built by the template, not by the code that runs while the
// template is being produced.
//
// Two shapes caused the 2026-09-25 Lit defects:
//
//   render() { return uiRegistry.button({ ... }); }   -- a registry factory
//   render() { return document.createElement("div"); } -- a detached element
//
// Both bypass lit-html. The element exists before the template is rendered, so
// Lit re-renders around it instead of into it, and a re-render that should
// update the widget leaves the old node in place. The fix is a `<wa-*>` tag (or
// the project's own element tag) written in the template, which Lit owns.
//
// The rule inspects the AST, not the file text: this is a JavaScript pattern,
// not CSS in a string. It is scoped by `eslint.config.mjs` to the production
// source of the units that render, and ignores test files.
//
// A "render scope" is either
//   * a method (or class field) named `render` or `template`, or starting with
//     `_render`, or
//   * a function or arrow function whose body returns an `html` tagged
//     template.
// Inside a render scope the rule reports `document.createElement(...)` and a
// `<registry>.<role>(...)` call for the widget roles below, where `<registry>`
// is named `uiRegistry`/`registry` or was imported from a `ui/registry` module.
// A render scope reached through nested callbacks still counts.
// ---------------------------------------------------------------------------

const WIDGET_ROLES = new Set([
  "button",
  "iconButton",
  "textInput",
  "checkbox",
  "menu",
  "progress",
  "textArea",
  "workingDots",
  "icon",
]);

/** The non-computed name of a method/field/property node, or undefined. */
function memberName(node) {
  if (!node || node.computed) return undefined;
  const key = node.key;
  if (!key) return undefined;
  if (key.type === "Identifier") return key.name;
  if (key.type === "Literal") return key.value;
  return undefined;
}

/** True for a tagged template whose tag is an `html` identifier or `x.html`. */
function isHtmlTemplate(node) {
  if (!node || node.type !== "TaggedTemplateExpression") return false;
  const tag = node.tag;
  if (tag.type === "Identifier") return tag.name === "html";
  if (
    tag.type === "MemberExpression" &&
    !tag.computed &&
    tag.property.type === "Identifier"
  ) {
    return tag.property.name === "html";
  }
  return false;
}

/**
 * True when the function's body returns an `html` tagged template.
 *
 * The walk stays out of nested functions: a nested `render` has its own scope,
 * and an inner helper's return does not make the outer function a template
 * function.
 */
function returnsHtmlTemplate(fn) {
  if (fn.body.type !== "BlockStatement") return isHtmlTemplate(fn.body);

  const stack = [...fn.body.body];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node.type !== "string") continue;
    if (node.type === "ReturnStatement") {
      if (isHtmlTemplate(node.argument)) return true;
      continue;
    }
    if (
      node.type === "FunctionDeclaration" ||
      node.type === "FunctionExpression" ||
      node.type === "ArrowFunctionExpression"
    ) {
      continue;
    }
    for (const key of Object.keys(node)) {
      if (key === "parent") continue;
      const value = node[key];
      if (Array.isArray(value)) {
        stack.push(...value);
      } else if (value && typeof value.type === "string") {
        stack.push(value);
      }
    }
  }
  return false;
}

/** True when the function is itself a render scope. */
function isRenderScope(fn) {
  const parent = fn.parent;
  if (
    parent &&
    (parent.type === "MethodDefinition" ||
      parent.type === "PropertyDefinition" ||
      parent.type === "Property") &&
    parent.value === fn
  ) {
    const name = memberName(parent);
    if (name === "render" || name === "template") return true;
    if (name && name.startsWith("_render")) return true;
  }
  return returnsHtmlTemplate(fn);
}

const FUNCTION_TYPES = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);

export default {
  meta: {
    type: "problem",
    schema: [],
    docs: {
      description:
        "Build widgets as `<wa-*>` tags in the template, not inside a render.",
    },
    messages: {
      factory:
        "Build widgets as <wa-*> tags in the template, not inside a render.",
    },
  },
  create(context) {
    const registryNames = new Set(["uiRegistry", "registry"]);

    /** True when the call sits inside a render scope. */
    function inRenderScope(node) {
      const ancestors = context.sourceCode.getAncestors(node);
      for (let i = ancestors.length - 1; i >= 0; i--) {
        const ancestor = ancestors[i];
        if (FUNCTION_TYPES.has(ancestor.type) && isRenderScope(ancestor)) {
          return true;
        }
      }
      return false;
    }

    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        if (typeof source !== "string") return;
        if (!/ui\/registry(\.js|\.ts)?$/.test(source)) return;
        for (const specifier of node.specifiers) {
          registryNames.add(specifier.local.name);
        }
      },

      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== "MemberExpression" || callee.computed) return;
        if (callee.property.type !== "Identifier") return;

        const role = callee.property.name;
        const object = callee.object;
        if (object.type !== "Identifier") return;

        const isCreateElement =
          object.name === "document" && role === "createElement";
        const isWidgetFactory =
          WIDGET_ROLES.has(role) && registryNames.has(object.name);
        if (!isCreateElement && !isWidgetFactory) return;

        if (!inRenderScope(node)) return;
        context.report({ node, messageId: "factory" });
      },
    };
  },
};
