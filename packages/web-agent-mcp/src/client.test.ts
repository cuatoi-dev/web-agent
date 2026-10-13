import { describe, it, expect, vi } from "vitest";
import {
  sanitizeServerName,
  resolveMcpServerUrl,
  formatMcpContent,
  mapMcpToolToCustomToolDef,
} from "./client.js";
import { buildTools, type ToolContext } from "@cuatoi/web-agent-core";

describe("MCP client module", () => {
  describe("sanitizeServerName", () => {
    it("sanitizes special characters to underscores", () => {
      expect(sanitizeServerName("cat-store")).toBe("cat_store");
      expect(sanitizeServerName("my.server!v1")).toBe("my_server_v1");
      expect(sanitizeServerName("")).toBe("mcp");
    });
  });

  describe("resolveMcpServerUrl", () => {
    it("keeps absolute HTTP/HTTPS URLs intact", () => {
      expect(resolveMcpServerUrl("http://localhost:28780/cat-store/mcp")).toBe(
        "http://localhost:28780/cat-store/mcp",
      );
      expect(resolveMcpServerUrl("https://example.com/mcp")).toBe("https://example.com/mcp");
    });

    it("resolves relative path against specified base URL", () => {
      expect(resolveMcpServerUrl("/cat-store/mcp", "http://localhost:28780/app/")).toBe(
        "http://localhost:28780/cat-store/mcp",
      );
    });
  });

  describe("formatMcpContent", () => {
    it("formats text content blocks", () => {
      expect(
        formatMcpContent([
          { type: "text", text: "Hello" },
          { type: "text", text: "World" },
        ]),
      ).toEqual({
        text: "Hello\nWorld",
        images: [],
      });
    });

    it("returns empty text and empty images for empty or undefined content", () => {
      expect(formatMcpContent([])).toEqual({ text: "", images: [] });
      expect(formatMcpContent(undefined)).toEqual({ text: "", images: [] });
    });

    it("extracts valid image blocks as ToolImage records with data URLs", () => {
      const result = formatMcpContent([
        { type: "image", data: "AAAA", mimeType: "image/png" },
        { type: "image", data: "BBBB", mimeType: "image/jpeg" },
      ]);
      expect(result).toEqual({
        text: "",
        images: [
          { dataUrl: "data:image/png;base64,AAAA", mediaType: "image/png" },
          { dataUrl: "data:image/jpeg;base64,BBBB", mediaType: "image/jpeg" },
        ],
      });
    });

    it("handles mixed text and image blocks preserving order", () => {
      const result = formatMcpContent([
        { type: "text", text: "Two charts for Q3." },
        { type: "image", data: "CCCC", mimeType: "image/png" },
      ]);
      expect(result).toEqual({
        text: "Two charts for Q3.",
        images: [{ dataUrl: "data:image/png;base64,CCCC", mediaType: "image/png" }],
      });
    });

    it("skips image blocks with missing data, empty data, or non-image MIME type", () => {
      const result = formatMcpContent([
        { type: "image", data: "", mimeType: "image/png" },
        { type: "image", mimeType: "image/png" },
        { type: "image", data: "DDDD", mimeType: "application/pdf" },
        { type: "image", data: "EEEE", mimeType: "text/plain" },
        { type: "image", data: 123 as unknown as string, mimeType: "image/png" },
        { type: "text", text: "Valid text." },
      ]);
      expect(result).toEqual({
        text: "Valid text.",
        images: [],
      });
    });

    it("ignores non-text and non-image blocks like audio and resource", () => {
      const result = formatMcpContent([
        { type: "audio", data: "FFFF", mimeType: "audio/mp3" },
        { type: "resource", uri: "https://example.com/test.txt" },
        { type: "text", text: "Kept text." },
      ]);
      expect(result).toEqual({
        text: "Kept text.",
        images: [],
      });
    });

    it("preserves valid blocks alongside invalid images", () => {
      const result = formatMcpContent([
        { type: "image", data: "missing-mime" },
        { type: "image", mimeType: "image/png" },
        { type: "image", data: "first", mimeType: "image/png" },
        { type: "text", text: "  Kept text.  " },
        { type: "image", data: "wrong-mime", mimeType: "application/pdf" },
        { type: "image", data: "second", mimeType: "image/jpeg" },
      ]);
      expect(result.text).toBe("Kept text.");
      expect(result.images).toEqual([
        { dataUrl: "data:image/png;base64,first", mediaType: "image/png" },
        { dataUrl: "data:image/jpeg;base64,second", mediaType: "image/jpeg" },
      ]);
    });
  });

  describe("mapMcpToolToCustomToolDef", () => {
    it("prefixes tool name with server name", () => {
      const mockCallTool = vi.fn().mockResolvedValue({ content: [{ type: "text", text: "ok" }] });
      const def = mapMcpToolToCustomToolDef(
        "cat-store",
        { name: "place_order", description: "Place an order" },
        mockCallTool,
      );

      expect(def.name).toBe("cat_store_place_order");
      expect(def.description).toBe("Place an order");
    });

    it("executes callTool with passed arguments and returns ToolOutcome", async () => {
      const mockCallTool = vi.fn().mockResolvedValue({
        content: [{ type: "text", text: '{"id":"ORD-100"}' }],
        isError: false,
      });
      const def = mapMcpToolToCustomToolDef("cat-store", { name: "place_order" }, mockCallTool);

      const outcome = await def.execute({ items: "Cat food" }, {} as ToolContext);

      expect(mockCallTool).toHaveBeenCalledWith({ items: "Cat food" });
      expect(outcome.content).toBe('{"id":"ORD-100"}');
      expect(outcome.isError).toBe(false);
    });

    it("includes images in ToolOutcome when MCP tool returns image blocks", async () => {
      const mockCallTool = vi.fn().mockResolvedValue({
        content: [
          { type: "text", text: "Chart output" },
          { type: "image", data: "PNGDATA", mimeType: "image/png" },
        ],
        isError: false,
      });
      const def = mapMcpToolToCustomToolDef("cat-store", { name: "get_chart" }, mockCallTool);
      const outcome = await def.execute({}, {} as ToolContext);

      expect(outcome.content).toBe("Chart output");
      expect(outcome.isError).toBe(false);
      expect(outcome.images).toEqual([
        { dataUrl: "data:image/png;base64,PNGDATA", mediaType: "image/png" },
      ]);
    });

    it("omits images property from ToolOutcome when MCP tool returns text only", async () => {
      const mockCallTool = vi.fn().mockResolvedValue({
        content: [{ type: "text", text: "Plain text" }],
        isError: false,
      });
      const def = mapMcpToolToCustomToolDef("cat-store", { name: "plain" }, mockCallTool);
      const outcome = await def.execute({}, {} as ToolContext);

      expect(outcome.content).toBe("Plain text");
      expect(outcome.images).toBeUndefined();
    });

    it("returns empty text and images for an image-only MCP result", async () => {
      const callTool = vi.fn().mockResolvedValue({
        content: [{ type: "image", data: "PNGDATA", mimeType: "image/png" }],
      });
      const def = mapMcpToolToCustomToolDef("cat-store", { name: "chart" }, callTool);
      const outcome = await def.execute({}, {} as ToolContext);
      expect(outcome.content).toBe("");
      expect(outcome.isError).toBe(false);
      expect(outcome.images).toEqual([
        { dataUrl: "data:image/png;base64,PNGDATA", mediaType: "image/png" },
      ]);
    });

    it("returns an error outcome when callTool rejects", async () => {
      const mockCallTool = vi.fn().mockRejectedValue(new Error("network down"));
      const def = mapMcpToolToCustomToolDef("cat-store", { name: "place_order" }, mockCallTool);

      const outcome = await def.execute({}, {} as ToolContext);

      expect(outcome.isError).toBe(true);
      expect(outcome.content).toBe("network down");
      expect(outcome.images).toBeUndefined();
    });
  });

  describe("buildTools collision handling with MCP tools", () => {
    it("skips duplicate tool names when two servers collide", () => {
      const def1 = mapMcpToolToCustomToolDef("cat-store", { name: "place_order" }, vi.fn());
      const def2 = mapMcpToolToCustomToolDef("cat-store", { name: "place_order" }, vi.fn());

      const ctx = {} as ToolContext;
      const { tools } = buildTools(ctx, [def1, def2]);

      expect(tools.filter((t) => t.name === "cat_store_place_order")).toHaveLength(1);
    });
  });
});
