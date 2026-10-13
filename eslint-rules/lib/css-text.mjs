// ---------------------------------------------------------------------------
// Shared helpers for the rules that scan a file's raw text.
//
// CSS in this codebase lives inside tagged templates (`css` and `html`),
// `.style.cssText` assignments and direct `.style.*` writes, so a text scan
// reaches every form while an AST walk would have to special-case each one.
// ---------------------------------------------------------------------------

/**
 * Blanks comments and masks tokenized `var(--wa-*, <fallback>)` usages.
 *
 * Comments are blanked IN PLACE rather than deleted. Deleting a block comment
 * removes its newlines and shifts every line number below it, which would make
 * every report point at the wrong line.
 *
 * The balanced `(?:[^()]*|\([^()]*\))*` inner pattern consumes a fallback that
 * itself contains parens (`rgba(0,0,0,.5)`) or a nested `var()`. Token NAMES
 * sit inside the `var()` call and are masked away with it, so a colour word
 * embedded in a token name (`--wa-black-color-50opc`) is not misread as a
 * raw literal.
 */
export function maskTokensAndComments(code) {
  let cleaned = code.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  cleaned = cleaned.replace(/^[^\S\r\n]*\/\/.*$/gm, "");
  cleaned = cleaned.replace(
    /var\(--wa-[a-z0-9-]+\s*(?:[^()]*|\([^()]*\))*\)/gi,
    "VAR_WA_FALLBACK",
  );
  // Mask the VALUE of a theme-token DECLARATION. Declaring a token is how a
  // literal legitimately enters the system — `--wa-border-color:#e0e0e0`
  // is the definition, not an un-themed use of #e0e0e0, and a host page
  // overriding a token has to write one.
  //
  // Rewriting a declaration to `var(--wa-border-color, #e0e0e0)` would make
  // the token define itself: that is a custom-property cycle, so the property
  // is invalid at computed-value time and the fallback is NOT used — the
  // override silently disappears. The rule must never ask for that.
  //
  // Only `--wa-*` and the vendor `--md-*` tokens are masked, because those
  // two are the theme contract. An arbitrary `--my-thing: #fff` is still
  // reported: inventing a private custom property is exactly how a raw colour
  // escapes the theme while looking tokenized.
  cleaned = cleaned.replace(
    /(--(?:wa|md)-[a-z0-9-]+\s*:)([^;'"`}]*)/gi,
    (m, decl, value) => decl + value.replace(/[^\n]/g, " "),
  );
  return cleaned;
}

/** Blanks comments only, leaving every `var()` intact for inspection. */
export function maskCommentsOnly(code) {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/^[^\S\r\n]*\/\/.*$/gm, "");
}

/** Reports `messageId` at `line`, spanning the matched text. */
export function reportAt(context, line, column, length, messageId, data) {
  context.report({
    loc: {
      start: { line, column },
      end: { line, column: column + length },
    },
    messageId,
    data,
  });
}

/** Builds a rule that runs `scan(maskedLines, filename)` once per file. */
export function textRule(meta, scan) {
  return {
    meta,
    create(context) {
      return {
        "Program:exit"() {
          const filename = context.filename ?? context.getFilename();
          const masked = maskTokensAndComments(context.sourceCode.getText());
          for (const v of scan(masked.split("\n"), filename)) {
            reportAt(context, v.line, v.column, v.length, v.messageId, v.data);
          }
        },
      };
    },
  };
}
