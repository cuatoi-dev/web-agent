import { describe, it, expect, vi } from "vitest";
import { resolveApiSourceUrl, resolveApiFetch, fetchOpenApiDocument } from "./fetch-seam.js";
import type { ApiSourceConfig } from "./types.js";

function makeSource(overrides?: Partial<ApiSourceConfig>): ApiSourceConfig {
  return {
    name: "cat-store",
    description: "Cat store backend API",
    specUrl: "http://localhost:28780/cat-store/openapi.json",
    operations: ["listCats"],
    credentials: "same-origin",
    required: true,
    ...overrides,
  };
}

describe("API fetch-seam module", () => {
  describe("resolveApiSourceUrl", () => {
    it("keeps absolute HTTP/HTTPS URLs intact", () => {
      expect(resolveApiSourceUrl("http://localhost:28780/openapi.json")).toBe(
        "http://localhost:28780/openapi.json",
      );
      expect(resolveApiSourceUrl("https://example.com/openapi.json")).toBe(
        "https://example.com/openapi.json",
      );
    });

    it("resolves relative path against specified base URL", () => {
      expect(resolveApiSourceUrl("/openapi.json", "http://example.com/app/")).toBe(
        "http://example.com/openapi.json",
      );
    });
  });

  describe("resolveApiFetch", () => {
    it("returns host-supplied source.fetch when present", () => {
      const customFetch = vi.fn();
      const source = makeSource({ fetch: customFetch as unknown as typeof fetch });
      expect(resolveApiFetch(source)).toBe(customFetch);
    });

    it("returns global fetch when source.fetch is undefined", async () => {
      const mockFetch = vi.fn().mockResolvedValue(new Response("ok"));
      const globalFetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(mockFetch);
      const source = makeSource();

      const resolved = resolveApiFetch(source);
      await resolved("http://example.com/");

      expect(mockFetch).toHaveBeenCalledWith("http://example.com/");
      globalFetchSpy.mockRestore();
    });
  });

  describe("fetchOpenApiDocument", () => {
    it("fetches successfully and returns parsed JSON, passing credentials", async () => {
      const doc = { openapi: "3.0.0", paths: {} };
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => Promise.resolve(doc),
      });
      const source = makeSource({ credentials: "same-origin", fetch: mockFetch as unknown as typeof fetch });

      const result = await fetchOpenApiDocument(source);

      expect(result).toEqual(doc);
      expect(mockFetch).toHaveBeenCalledWith(source.specUrl, { credentials: "same-origin" });
    });

    it("invokes custom fetch instead of global fetch", async () => {
      const customFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => Promise.resolve({}),
      });
      const globalFetchSpy = vi.spyOn(globalThis, "fetch");
      const source = makeSource({ fetch: customFetch as unknown as typeof fetch });

      await fetchOpenApiDocument(source);

      expect(customFetch).toHaveBeenCalledTimes(1);
      expect(globalFetchSpy).not.toHaveBeenCalled();
      globalFetchSpy.mockRestore();
    });

    it.each(["omit", "same-origin", "include"] as const)(
      "passes credentials %s verbatim",
      async (credentials) => {
        const mockFetch = vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          statusText: "OK",
          json: () => Promise.resolve({}),
        });
        const source = makeSource({ credentials, fetch: mockFetch as unknown as typeof fetch });

        await fetchOpenApiDocument(source);

        expect(mockFetch).toHaveBeenCalledWith(source.specUrl, { credentials });
      },
    );

    it("throws a descriptive error on network failure", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("network error"));
      const source = makeSource({ fetch: mockFetch as unknown as typeof fetch });

      await expect(fetchOpenApiDocument(source)).rejects.toThrow(
        /Failed to fetch OpenAPI document for API source "cat-store" from ".*": network error/,
      );
    });

    it("throws a descriptive error on HTTP non-2xx response", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: () => Promise.resolve({}),
      });
      const source = makeSource({ fetch: mockFetch as unknown as typeof fetch });

      await expect(fetchOpenApiDocument(source)).rejects.toThrow(
        /Failed to fetch OpenAPI document for API source "cat-store" from ".*": HTTP 404 Not Found/,
      );
    });

    it("throws a descriptive error on invalid JSON body", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => Promise.reject(new SyntaxError("Unexpected token < in JSON")),
      });
      const source = makeSource({ fetch: mockFetch as unknown as typeof fetch });

      await expect(fetchOpenApiDocument(source)).rejects.toThrow(
        /Failed to parse OpenAPI document JSON for API source "cat-store" from ".*"/,
      );
    });
  });
});
