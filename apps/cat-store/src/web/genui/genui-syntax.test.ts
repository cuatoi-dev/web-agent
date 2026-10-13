import { describe, expect, it } from "vitest";
import { checkSyntax, scriptTypeOf, isExecutableScriptTag } from "./genui-syntax";

describe("checkSyntax", () => {
  it("passes valid JavaScript in <script>", () => {
    const result = checkSyntax("<script>const x = 1;</script>");
    expect(result).toHaveLength(0);
  });

  it("supports top-level await", () => {
    const result = checkSyntax("<script>await Promise.resolve();</script>");
    expect(result).toHaveLength(0);
  });

  it("passes with no script tags", () => {
    const result = checkSyntax("<div><p>Hello</p></div>");
    expect(result).toHaveLength(0);
  });

  it("passes with empty script tag", () => {
    const result = checkSyntax("<script>  </script>");
    expect(result).toHaveLength(0);
  });

  it("reports syntax error with ruleId syntax-error", () => {
    const result = checkSyntax("<script>const = 1;</script>");
    expect(result).toHaveLength(1);
    expect(result[0].ruleId).toBe("syntax-error");
    expect(result[0].message).toMatch(/syntax error/i);
  });

  it("reports syntax error with exact line and column for inline script", () => {
    // Source: <div>\n\n<script>\nconst = 1;\n</script></div>
    // The script content starts at line 4, so the error should be on line 4
    const source = "<div>\n\n<script>\nconst = 1;\n</script></div>";
    const result = checkSyntax(source);
    expect(result).toHaveLength(1);
    expect(result[0].line).toBe(4);
    // "const = 1;" — after "const " (6 chars), the `=` is column 7
    expect(result[0].column).toBe(7);
  });

  it("locates syntax error in second script block", () => {
    const source = "<script>const x = 1;</script>\n<script>const = 2;</script>";
    const result = checkSyntax(source);
    expect(result).toHaveLength(1);
    // Second script block starts on line 2
    expect(result[0].line).toBe(2);
  });

  it("reports separate errors for multiple broken script blocks", () => {
    const source = "<script>const = 1;</script><script>let = 2;</script>";
    const result = checkSyntax(source);
    expect(result).toHaveLength(2);
  });

  it("application/json is not parsed as JavaScript", () => {
    const result = checkSyntax('<script type="application/json">{ "a": 1 }</script>');
    expect(result).toHaveLength(0);
  });

  it("the same JSON content in an executable script still fails", () => {
    const result = checkSyntax('<script>{ "a": 1 }</script>');
    expect(result).toHaveLength(1);
    expect(result[0].ruleId).toBe("syntax-error");
  });

  it("type=module is still parsed", () => {
    const result = checkSyntax('<script type="module">import x from</script>');
    expect(result).toHaveLength(1);
  });

  it("type attribute in single quotes is read", () => {
    const result = checkSyntax("<script type='application/json'>{ \"a\": 1 }</script>");
    expect(result).toHaveLength(0);
  });

  it("uppercase type is skipped", () => {
    const result = checkSyntax('<script TYPE="APPLICATION/JSON">{ "a": 1 }</script>');
    expect(result).toHaveLength(0);
  });

  it("a real JavaScript error after a JSON block reports the right line", () => {
    const source =
      '<script type="application/json">{ "a": 1 }</script>\n<script>const = 2;</script>';
    const result = checkSyntax(source);
    expect(result).toHaveLength(1);
    expect(result[0].ruleId).toBe("syntax-error");
    expect(result[0].line).toBe(2);
  });
});

describe("scriptTypeOf", () => {
  it("returns empty string for a tag with no type", () => {
    expect(scriptTypeOf("<script>")).toBe("");
  });

  it("returns the type value for a double-quoted type", () => {
    expect(scriptTypeOf('<script type="application/json">')).toBe("application/json");
  });

  it("returns the type value for a single-quoted type", () => {
    expect(scriptTypeOf("<script type='text/javascript'>")).toBe("text/javascript");
  });
});

describe("isExecutableScriptTag", () => {
  it("treats a tag with no type as executable", () => {
    expect(isExecutableScriptTag("<script>")).toBe(true);
  });

  it("treats application/json as non-executable", () => {
    expect(isExecutableScriptTag('<script type="application/json">')).toBe(false);
  });

  it("treats module as executable", () => {
    expect(isExecutableScriptTag('<script type="module">')).toBe(true);
  });
});
