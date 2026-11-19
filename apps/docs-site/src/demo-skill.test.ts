import { describe, it, expect } from "vitest";
import { validateUIBlock } from "@cuatoi/web-agent-core";
import { docsDemoSkill } from "./demo-skill";

describe("docsDemoSkill", () => {
  it("has a non-empty description", () => {
    expect(docsDemoSkill.description.length).toBeGreaterThan(0);
  });

  it("definition covers every required tool/skill token", () => {
    const def = docsDemoSkill.definition;
    const required = [
      "search_skills",
      "search_docs",
      "docs-guide",
      "snapshot_page",
      "show_generative_ui",
      "present_to_user",
      "see",
      "web-agent-docs",
    ];
    for (const token of required) {
      expect(def, `definition should mention "${token}"`).toContain(token);
    }
  });

  it("definition contains the vision guard phrase", () => {
    expect(docsDemoSkill.definition).toContain("vision skipped");
  });

  /**
   * Parses the step 8 call out of the skill text and runs it through the real
   * block validator. It reads the shipped skill string, so it fails if anyone
   * reintroduces a field key the schema refuses — it is not a copy of the
   * block pasted into the test.
   */
  function extractStep8Block(): Record<string, unknown> {
    const def = docsDemoSkill.definition;
    const step8 = def.slice(def.indexOf("**Step 8"));
    const fence = step8.match(/```\n([\s\S]*?)```/);
    if (!fence) throw new Error("step 8 has no fenced show_generative_ui block");
    const src = fence[1].trim().replace(/^show_generative_ui\(/, "").replace(/\)$/, "");
    return new Function(`return (${src})`)() as Record<string, unknown>;
  }

  it("step 8's form block validates against the real UI-block schema", async () => {
    const block = extractStep8Block();
    const result = await validateUIBlock(block);
    expect(result.ok, result.ok ? "" : result.message).toBe(true);
  });

  it("no step 8 field carries a `type` key", () => {
    const block = extractStep8Block();
    const fields = block.fields as Record<string, unknown>[];
    expect(fields).toHaveLength(3);
    for (const f of fields) {
      expect(Object.keys(f)).not.toContain("type");
      expect(f.kind).toBeTypeOf("string");
    }
  });

  /**
   * Steps 1 and 11 both call show_generative_ui with a buttons block. Parses
   * both out of the skill text and runs each through the real block
   * validator — same approach as extractStep8Block, applied to the buttons
   * branch alongside the step 8 check.
   */
  function extractButtonsBlocks(): Record<string, unknown>[] {
    const def = docsDemoSkill.definition;
    const fences = [...def.matchAll(/```\n([\s\S]*?)```/g)]
      .map((m) => m[1].trim())
      .filter((src) => src.includes('type: "buttons"'));
    if (fences.length === 0) throw new Error("no fenced buttons show_generative_ui block found");
    return fences.map((src) => {
      const body = src.replace(/^show_generative_ui\(/, "").replace(/\)$/, "");
      return new Function(`return (${body})`)() as Record<string, unknown>;
    });
  }

  it("both buttons blocks (steps 1 and 11) validate against the real UI-block schema", async () => {
    const blocks = extractButtonsBlocks();
    expect(blocks).toHaveLength(2);
    for (const block of blocks) {
      const result = await validateUIBlock(block);
      expect(result.ok, result.ok ? "" : `${JSON.stringify(block)}: ${result.message}`).toBe(true);
    }
  });

  it("no buttons block carries a `buttons` key", () => {
    const blocks = extractButtonsBlocks();
    for (const b of blocks) {
      expect(Object.keys(b)).not.toContain("buttons");
      expect(Array.isArray(b.options)).toBe(true);
    }
  });
});
