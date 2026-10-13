import { describe, it, expect } from "vitest";
import type { ToolContext } from "@cuatoi/web-agent-core";
import type { z } from "zod";
import { createExportTestTool } from "./export-test-tool";
import { clickEntry, createActionJournal } from "./action-journal";
import type { JournalTarget } from "./action-journal.types";

function toolCtx(): ToolContext {
  return { app: {}, signal: new AbortController().signal };
}

const APPLY: JournalTarget = {
  role: "button",
  name: "Apply",
  label: 'button "Apply"',
  locator: "getByRole('button', { name: 'Apply' })",
  isPassword: false,
};

describe("export-test-tool", () => {
  it("1. returns the BDD text for a valid input", async () => {
    const sid = "a";
    const journal = createActionJournal(() => sid);
    journal.append([clickEntry(APPLY, APPLY.locator!)]);
    const tool = createExportTestTool(journal);

    const result = await tool.execute(
      { format: "bdd", suite: "S", cases: [{ id: "TC-01", title: "T", steps: [{ text: "x", journal: [1] }] }] },
      toolCtx(),
    );
    expect(result).toEqual({ content: "# S\n\n### Scenario: TC-01 T\n**Given** x" });
  });

  it("2. a session change empties the journal, so the same call errors", async () => {
    let sid = "a";
    const journal = createActionJournal(() => sid);
    journal.append([clickEntry(APPLY, APPLY.locator!)]);
    const tool = createExportTestTool(journal);
    sid = "b";

    const result = await tool.execute(
      { format: "bdd", suite: "S", cases: [{ id: "TC-01", title: "T", steps: [{ text: "x", journal: [1] }] }] },
      toolCtx(),
    );
    expect(result).toEqual({ content: "Journal entry #1 does not exist in this chat.", isError: true });
  });

  it("3. inputSchema validates suite, cases and step text", () => {
    const journal = createActionJournal();
    const tool = createExportTestTool(journal);
    const schema = tool.inputSchema as z.ZodTypeAny;

    expect(schema.safeParse({ format: "playwright", suite: "", cases: [] }).success).toBe(false);
    expect(
      schema.safeParse({ format: "playwright", suite: "S", cases: [{ id: "TC-01", title: "T", steps: [] }] }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        format: "playwright",
        suite: "S",
        cases: [{ id: "TC-01", title: "T", steps: [{ text: "" }] }],
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ format: "bdd", suite: "S", cases: [{ id: "TC-01", title: "T", steps: [{ text: "x", journal: [1] }] }] })
        .success,
    ).toBe(true);
  });
});
