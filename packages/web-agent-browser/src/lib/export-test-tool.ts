// 124/004 — export_test. Not a page tool: no tabId, no activation check.
import { z } from "zod";
import type { CustomToolDef } from "@cuatoi/web-agent-core";
import { exportTest } from "./export-test";
import type { ActionJournal, ExportTestInput } from "./action-journal.types";

export function createExportTestTool(journal: ActionJournal): CustomToolDef {
  return {
    name: "export_test",
    description:
      "Build a Playwright spec (format playwright) or a BDD Markdown case (format bdd) from this chat's action journal. A successful page_click, page_fill_form, page_select_option, page_hover, page_press_key, page_upload_file, page_dialog or page_emulate result, and a PASS page_verify result, ends with (journal #<id>) or (journal #<a>–#<b>): list those ids in each step's journal. Returns the file text only; show it to the user in a plain Markdown code block.",
    inputSchema: z.object({
      format: z.enum(["playwright", "bdd"]).describe("playwright for a @playwright/test spec, bdd for a Markdown case."),
      suite: z.string().min(1).describe('The suite name, e.g. "Checkout coupon".'),
      url: z.string().optional().describe("The page URL. The Playwright spec opens it at the start of every case."),
      cases: z
        .array(
          z.object({
            id: z.string().describe('The case id, e.g. "TC-01".'),
            title: z.string().describe("The case title."),
            steps: z
              .array(
                z.object({
                  text: z.string().min(1).describe("What the step does."),
                  keyword: z
                    .enum(["given", "when", "and", "then"])
                    .optional()
                    .describe("The BDD keyword. Omit it to use the default."),
                  journal: z.array(z.number()).optional().describe("The journal ids of this step's actions and checks."),
                }),
              )
              .min(1),
          }),
        )
        .min(1),
    }),
    summarize: (input) => {
      const format = typeof input.format === "string" ? input.format : "";
      const suite = typeof input.suite === "string" ? input.suite : "";
      return `Export ${format} test "${suite}"`;
    },
    execute: (input) => {
      const result = exportTest(input as unknown as ExportTestInput, journal.entries());
      return Promise.resolve(result.ok ? { content: result.text } : { content: result.error, isError: true });
    },
  };
}
