import { describe, it, expect, vi } from "vitest";
import type { ToolContext } from "@cuatoi/web-agent-core";
import { createPageEvalTool, pageEvalTools, describeValue } from "./page-eval-tool";

/** The minimum ToolContext the tools under test read. `app` and `signal` are
 *  the interface's only required fields (web-agent-core tool-hooks.types.ts);
 *  none of these tools touches the optional ones. */
function toolCtx(): ToolContext {
  return { app: {}, signal: new AbortController().signal };
}

describe("createPageEvalTool", () => {
  describe("the runner seam", () => {
    it("returns the resolved value", async () => {
      const tool = createPageEvalTool({ runner: () => Promise.resolve(42) });
      const result = await tool.execute({ code: "return 42" }, toolCtx());
      expect(result.isError).toBeFalsy();
      expect(result.content).toContain("Result type: number");
      expect(result.content).toContain("42");
    });

    it("awaits a promise the code returns", async () => {
      const tool = createPageEvalTool({ runner: () => Promise.resolve(["a", "b"]) });
      const result = await tool.execute({ code: "return await something()" }, toolCtx());
      expect(result.isError).toBeFalsy();
      expect(result.content).toContain("Array(2)");
      expect(result.content).toContain('"a"');
      expect(result.content).toContain('"b"');
    });

    it("a rejected promise is an error", async () => {
      const tool = createPageEvalTool({ runner: () => Promise.reject(new Error("nope")) });
      const result = await tool.execute({ code: "return await fails()" }, toolCtx());
      expect(result.isError).toBe(true);
      expect(result.content).toContain("The code threw Error: nope");
    });

    it("a thrown error carries its message and name", async () => {
      const tool = createPageEvalTool({
        runner: () => {
          throw new TypeError("x is not a function");
        },
      });
      const result = await tool.execute({ code: "x()" }, toolCtx());
      expect(result.isError).toBe(true);
      expect(result.content).toContain("TypeError");
      expect(result.content).toContain("x is not a function");
    });

    it("empty code is rejected without calling the runner", async () => {
      const runner = vi.fn();
      const tool = createPageEvalTool({ runner });

      const emptyResult = await tool.execute({}, toolCtx());
      expect(emptyResult.isError).toBe(true);
      expect(emptyResult.content).toBe("No code provided to page_eval.");

      const blankResult = await tool.execute({ code: "   " }, toolCtx());
      expect(blankResult.isError).toBe(true);
      expect(blankResult.content).toBe("No code provided to page_eval.");

      expect(runner).not.toHaveBeenCalled();
    });

    it("the default runner uses the real realm", async () => {
      const tool = createPageEvalTool();
      const result = await tool.execute({ code: "return 1 + 1" }, toolCtx());
      expect(result.isError).toBeFalsy();
      expect(result.content).toContain("2");
    });

    it("the default runner sees a global", async () => {
      globalThis.__T__ = 5;
      try {
        const tool = createPageEvalTool();
        const result = await tool.execute({ code: "return globalThis.__T__" }, toolCtx());
        expect(result.content).toContain("5");
      } finally {
        delete globalThis.__T__;
      }
    });

    it("truncation", async () => {
      const tool = createPageEvalTool({ runner: () => Promise.resolve("Y".repeat(10_000)), maxChars: 6000 });
      const result = await tool.execute({ code: "return 'Y'.repeat(10000)" }, toolCtx());
      expect(result.content).toContain("…(output truncated)");
      expect(result.content.length).toBeLessThanOrEqual(6000 + "Result type: string\n\n".length);
    });

    it("summarize shortens a long first line", () => {
      const tool = createPageEvalTool();
      const summary = tool.summarize?.({ code: "return " + "a".repeat(200) }, toolCtx());
      expect(summary).toBeDefined();
      expect(summary!.endsWith("…")).toBe(true);
      expect(summary!.length).toBeLessThanOrEqual(61);
    });
  });

  describe("the CSP path", () => {
    it("message-only refusal", async () => {
      const tool = createPageEvalTool({
        runner: () => {
          throw new EvalError(
            `Evaluating a string as JavaScript violates the following Content Security Policy directive because 'unsafe-eval' is not an allowed source of script: script-src 'self'".`,
          );
        },
      });
      const result = await tool.execute({ code: "return 1" }, toolCtx());
      expect(result.isError).toBe(true);
      expect(result.content?.startsWith("Blocked by this page's Content Security Policy")).toBe(true);
      expect(result.content).toContain("script-src 'self'");
    });

    it("event-carried policy wins", async () => {
      const tool = createPageEvalTool({
        runner: () => {
          setTimeout(() => {
            document.dispatchEvent(
              Object.assign(new Event("securitypolicyviolation"), {
                blockedURI: "eval",
                effectiveDirective: "script-src",
                originalPolicy: "script-src 'self' 'unsafe-inline'; object-src 'none'",
              }),
            );
          }, 0);
          throw new EvalError(
            `Evaluating a string as JavaScript violates the following Content Security Policy directive because 'unsafe-eval' is not an allowed source of script: script-src 'self' 'unsafe-inline'".`,
          );
        },
      });
      const result = await tool.execute({ code: "return 1" }, toolCtx());
      expect(result.content).toContain(
        "Policy: script-src 'self' 'unsafe-inline'; object-src 'none'",
      );
    });

    it("an ordinary error is not misread as a CSP refusal", async () => {
      const tool = createPageEvalTool({
        runner: () => {
          throw new Error("boom");
        },
      });
      const result = await tool.execute({ code: "throw new Error('boom')" }, toolCtx());
      expect(result.content).toContain("The code threw Error: boom");
      expect(result.content).not.toContain("Content Security Policy");
    });

    it("the listener is removed after each execute", async () => {
      let shouldViolate = true;
      const tool = createPageEvalTool({
        runner: () => {
          if (shouldViolate) {
            setTimeout(() => {
              document.dispatchEvent(
                Object.assign(new Event("securitypolicyviolation"), {
                  blockedURI: "eval",
                  effectiveDirective: "script-src",
                  originalPolicy: "script-src 'self'",
                }),
              );
            }, 0);
            throw new EvalError("blocked");
          }
          return Promise.resolve(1);
        },
      });

      await tool.execute({ code: "throw" }, toolCtx());

      shouldViolate = false;
      const second = await tool.execute({ code: "return 1" }, toolCtx());
      expect(second.content).not.toContain("Policy:");
    });
  });
});

describe("describeValue", () => {
  it("undefined and null", () => {
    expect(describeValue(undefined)).toEqual({ kind: "undefined", text: "undefined" });
    expect(describeValue(null)).toEqual({ kind: "null", text: "null" });
  });

  it("a string is returned as-is", () => {
    const result = describeValue("hello");
    expect(result.kind).toBe("string");
    expect(result.text).toBe("hello");
  });

  it("primitives render with their kinds", () => {
    expect(describeValue(123)).toEqual({ kind: "number", text: "123" });
    expect(describeValue(true)).toEqual({ kind: "boolean", text: "true" });
    expect(describeValue(10n)).toEqual({ kind: "bigint", text: "10n" });
    expect(describeValue(Symbol("s")).kind).toBe("symbol");
    expect(describeValue(Symbol("s")).text).toContain("Symbol(s)");
  });

  it("a named function", () => {
    function myFn() {}
    const result = describeValue(myFn);
    expect(result.kind).toBe("function");
    expect(result.text).toBe("[Function: myFn]");
  });

  it("a DOM element", () => {
    const div = document.createElement("div");
    div.id = "x";
    const result = describeValue(div);
    expect(result.kind).toBe("HTMLDivElement");
    expect(result.text).toContain("<div id=\"x\">");
  });

  it("a circular object does not throw", () => {
    const a: { n: number; self?: unknown } = { n: 1 };
    a.self = a;
    const result = describeValue(a);
    expect(result.text).toContain("[Circular]");
  });

  it("an object holding a DOM node and a function", () => {
    const div = document.createElement("div");
    const obj = { el: div, fn: function named() {} };
    const result = describeValue(obj);
    expect(result.text).toContain("[HTMLDivElement]");
    expect(result.text).toContain("[Function: ");
  });

  it("a Map and a Set", () => {
    const map = new Map([["a", 1], ["b", 2]]);
    const mapResult = describeValue(map);
    expect(mapResult.kind).toBe("Map(2)");
    expect(mapResult.text).toContain("a");
    expect(mapResult.text).toContain("b");

    const set = new Set([1, 2]);
    const setResult = describeValue(set);
    expect(setResult.kind).toBe("Set(2)");
  });

  it("an Error", () => {
    const result = describeValue(new Error("bad"));
    expect(result.kind).toBe("Error");
    expect(result.text).toBe("Error: bad");
  });

  it("a class instance with only prototype members is described, not {}", () => {
    class C {
      get x() {
        return 1;
      }
    }
    const result = describeValue(new C());
    expect(result.text).toContain("no enumerable properties");
    expect(result.text).toContain("[C]");
    expect(result.text).not.toBe("{}");
  });

  it("an array of numbers", () => {
    const result = describeValue([1, 2, 3]);
    expect(result.kind).toBe("Array(3)");
    expect(result.text).toContain("1");
    expect(result.text).toContain("2");
    expect(result.text).toContain("3");
  });
});

describe("pageEvalTools", () => {
  it("returns exactly one provider that loads createPageEvalTool", async () => {
    const providers = pageEvalTools();
    expect(providers).toHaveLength(1);
    expect(providers[0].name).toBe("page-eval-tools");
    expect(providers[0].required).toBe(false);

    const tools = await providers[0].load();
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("page_eval");
    expect(tools[0].description).toBeTruthy();
    expect(tools[0].inputSchema).toBeTruthy();
  });
});
