import { describe, it, expect } from "vitest";
import {
  TOOL_NAMES,
  TOOL_DEFS,
} from "./definitions.js";

describe("TOOL_DEFS", () => {
  it("every tool has a name, description, inputSchema, promptSnippet", () => {
    for (const name of TOOL_NAMES) {
      const def = TOOL_DEFS[name];
      expect(def.name).toBe(name);
      expect(def.description).toBeTruthy();
      expect(def.inputSchema).toBeTruthy();
      expect(def.promptSnippet).toBeTruthy();
    }
  });

  it("list_data_sources tells the model how to get field detail", () => {
    const def = TOOL_DEFS.list_data_sources;
    expect(def.description).toMatch(/no field names/i);
    expect(def.description).toContain("Pass 'source'");
    expect(def.promptSnippet).toMatch(/\{ source: "<name>" \}/);
  });

  it("get_field_details describes search, filter, and pagination", () => {
    const def = TOOL_DEFS.get_field_details;
    expect(def.description).toMatch(/search for fields/i);
    expect(def.promptSnippet).toContain("get_field_details:");
    expect(def.description).toMatch(/unsupportedFields/);
    expect(def.promptSnippet).toMatch(/unsupportedFields/);
  });

  it("sample_field_values describes sampling distinct values", () => {
    const def = TOOL_DEFS.sample_field_values;
    expect(def.description).toMatch(/distinct values/i);
    expect(def.promptSnippet).toContain("sample_field_values:");
  });

  it("query_data tells the model to select columns on a wide source", () => {
    const def = TOOL_DEFS.query_data;
    expect(def.description).toMatch(/select/i);
    expect(def.description).toMatch(/wide source/i);
    expect(def.promptSnippet).toContain('"select"');
  });
});
