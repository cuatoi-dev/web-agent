import { describe, it, expect } from "vitest";
import {
  docsSearchScript,
  docsProseReplyScript,
  docsMarkdownListScript,
  docsSlugSearchScript,
  docsSkillsScript,
  docsMultiTurnScript,
} from "./mock-scripts";
import type { ProviderCallOptions } from "@cuatoi/web-agent-core";

// ModelMessage itself is not re-exported from the package root; reference the
// element type of ProviderCallOptions["messages"] instead of duplicating it.
type ModelMessage = ProviderCallOptions["messages"][number];

function makeOpts(messages: ModelMessage[]): ProviderCallOptions {
  return { messages, model: "mock" };
}

function toolResultMsg(toolName: string): ModelMessage {
  return {
    role: "tool",
    content: [{ type: "tool-result", toolCallId: `call_${toolName}`, toolName, output: "some docs content" }],
  };
}

describe("docsSearchScript", () => {
  it("no tool-results → search_docs with theming query", () => {
    const result = docsSearchScript(makeOpts([{ role: "user", content: "how do I theme it?" }]));
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].name).toBe("search_docs");
    expect(result.toolCalls![0].input).toEqual({ query: "theming" });
    expect(result.text).toBeUndefined();
  });

  it("search_docs seen → final text, no toolCalls", () => {
    const result = docsSearchScript(
      makeOpts([
        { role: "user", content: "how do I theme it?" },
        toolResultMsg("search_docs"),
      ])
    );
    expect(result.toolCalls).toBeUndefined();
    expect(result.text).toBe("See the Theming guide.");
    expect(result.finishReason).toBe("stop");
  });

  it("idempotent: same messages → same result", () => {
    const opts = makeOpts([{ role: "user", content: "how do I theme it?" }]);
    const r1 = docsSearchScript(opts);
    const r2 = docsSearchScript(opts);
    expect(r1).toEqual(r2);
  });
});

describe("docsProseReplyScript", () => {
  it("returns prose with no tool calls", () => {
    const result = docsProseReplyScript();
    expect(result.toolCalls).toBeUndefined();
    expect(result.finishReason).toBe("stop");
    expect(result.text!.length).toBeGreaterThan(20);
  });

  it("text carries none of the words nonvision test 3 rejects", () => {
    const result = docsProseReplyScript();
    expect(result.text).not.toMatch(/400|error|fail/i);
  });
});

describe("docsMarkdownListScript", () => {
  it("returns a markdown bulleted list", () => {
    const result = docsMarkdownListScript();
    expect(result.text!.match(/^- /gm)!.length).toBeGreaterThanOrEqual(3);
    expect(result.toolCalls).toBeUndefined();
    expect(result.finishReason).toBe("stop");
  });
});

describe("docsSlugSearchScript", () => {
  const user: ModelMessage = { role: "user", content: "search for button" };

  it("no tool result → one search_docs call", () => {
    const result = docsSlugSearchScript(makeOpts([user]));
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].name).toBe("search_docs");
    expect(result.toolCalls![0].input).toEqual({ query: "button" });
    expect(result.text).toBeUndefined();
  });

  it("search_docs seen this turn → final text naming the slug", () => {
    const result = docsSlugSearchScript(makeOpts([user, toolResultMsg("search_docs")]));
    expect(result.toolCalls).toBeUndefined();
    expect(result.finishReason).toBe("stop");
    expect(result.text).toContain("`button`");
    expect(result.text).toContain("#/reference/button");
  });

  it("a NEW user turn re-arms the tool call", () => {
    const user2: ModelMessage = { role: "user", content: "search for something else" };
    const assistant: ModelMessage = { role: "assistant", content: "Here is the button." };
    const result = docsSlugSearchScript(
      makeOpts([user, toolResultMsg("search_docs"), assistant, user2])
    );
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].name).toBe("search_docs");
  });
});

describe("docsSkillsScript", () => {
  const user: ModelMessage = { role: "user", content: "integrate lit" };

  it("no tool result → search_skills", () => {
    const result = docsSkillsScript(makeOpts([user]));
    expect(result.toolCalls).toBeDefined();
    expect(result.toolCalls![0].name).toBe("search_skills");
    expect(result.toolCalls![0].input).toEqual({ query: "integrate lit" });
  });

  it("search_skills seen → load_skill docs-guide", () => {
    const result = docsSkillsScript(makeOpts([user, toolResultMsg("search_skills")]));
    expect(result.toolCalls).toBeDefined();
    expect(result.toolCalls![0].name).toBe("load_skill");
    expect(result.toolCalls![0].input).toEqual({ name: "docs-guide" });
  });

  it("both seen → final text", () => {
    const result = docsSkillsScript(
      makeOpts([user, toolResultMsg("search_skills"), toolResultMsg("load_skill")])
    );
    expect(result.toolCalls).toBeUndefined();
    expect(result.finishReason).toBe("stop");
    expect(result.text).toContain("@cuatoi/web-agent-lit");
  });

  it("final text does not ask which framework", () => {
    const result = docsSkillsScript(
      makeOpts([user, toolResultMsg("search_skills"), toolResultMsg("load_skill")])
    );
    expect(result.text).not.toMatch(
      /which.*(framework|Lit)|Lit 3.*Lit 1|framework.*using|what.*framework/i
    );
  });
});

describe("docsMultiTurnScript", () => {
  const u = (i: number): ModelMessage => ({ role: "user", content: `turn ${i}` });

  it("turn 1 → snapshot_page with input {}", () => {
    const result = docsMultiTurnScript(makeOpts([u(1)]));
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].name).toBe("snapshot_page");
    expect(result.toolCalls![0].input).toEqual({});
  });

  it("turn 1 answer half", () => {
    const result = docsMultiTurnScript(makeOpts([u(1), toolResultMsg("snapshot_page")]));
    expect(result.toolCalls).toBeUndefined();
    expect(result.finishReason).toBe("stop");
  });

  it("turn 2 → search_docs with architecture query", () => {
    const result = docsMultiTurnScript(makeOpts([u(1), u(2)]));
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].name).toBe("search_docs");
    expect(result.toolCalls![0].input).toEqual({ query: "architecture" });
  });

  it("turn 2 answer half", () => {
    const result = docsMultiTurnScript(makeOpts([u(1), u(2), toolResultMsg("search_docs")]));
    expect(result.toolCalls).toBeUndefined();
    expect(result.finishReason).toBe("stop");
  });

  it("turn 3 → search_skills with docs query", () => {
    const result = docsMultiTurnScript(makeOpts([u(1), u(2), u(3)]));
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].name).toBe("search_skills");
    expect(result.toolCalls![0].input).toEqual({ query: "docs" });
  });

  it("turn 3 answer half", () => {
    const result = docsMultiTurnScript(makeOpts([u(1), u(2), u(3), toolResultMsg("search_skills")]));
    expect(result.toolCalls).toBeUndefined();
    expect(result.finishReason).toBe("stop");
  });

  it("turn 4 → load_skill with docs-guide name", () => {
    const result = docsMultiTurnScript(makeOpts([u(1), u(2), u(3), u(4)]));
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].name).toBe("load_skill");
    expect(result.toolCalls![0].input).toEqual({ name: "docs-guide" });
  });

  it("turn 4 answer half", () => {
    const result = docsMultiTurnScript(makeOpts([u(1), u(2), u(3), u(4), toolResultMsg("load_skill")]));
    expect(result.toolCalls).toBeUndefined();
    expect(result.finishReason).toBe("stop");
  });

  it("turn 5 → query_state with path $", () => {
    const result = docsMultiTurnScript(makeOpts([u(1), u(2), u(3), u(4), u(5)]));
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].name).toBe("query_state");
    expect(result.toolCalls![0].input).toEqual({ path: "$" });
  });

  it("turn 5 answer half", () => {
    const result = docsMultiTurnScript(makeOpts([u(1), u(2), u(3), u(4), u(5), toolResultMsg("query_state")]));
    expect(result.toolCalls).toBeUndefined();
    expect(result.finishReason).toBe("stop");
  });

  it("turn 6 and beyond falls through", () => {
    const result = docsMultiTurnScript(makeOpts([u(1), u(2), u(3), u(4), u(5), u(6)]));
    expect(result).toEqual({ text: "Unknown turn.", finishReason: "stop" });
  });

  it("a tool result from an EARLIER turn does not suppress this turn's call", () => {
    const assistant: ModelMessage = { role: "assistant", content: "Snapshot done" };
    const result = docsMultiTurnScript(
      makeOpts([u(1), toolResultMsg("snapshot_page"), assistant, u(2)])
    );
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls![0].name).toBe("search_docs");
  });
});
