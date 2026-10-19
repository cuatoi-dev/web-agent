import { describe, it, expect } from "vitest";
import { authHeaders } from "./auth-headers";
import type { ResolvedProvider } from "./types";

function prov(over: Partial<ResolvedProvider> = {}): ResolvedProvider {
  return {
    id: "p",
    kind: "brand",
    name: "n",
    endpoint: "https://e",
    wireFormat: "openai",
    apiKey: "",
    headers: [],
    ...over,
  };
}

describe("authHeaders", () => {
  it("brand, no key returns no headers", () => {
    expect(authHeaders(prov({ wireFormat: "openai", apiKey: "" }))).toEqual({});
  });

  it("brand, whitespace-only key returns no headers", () => {
    expect(authHeaders(prov({ wireFormat: "openai", apiKey: "   " }))).toEqual({});
  });

  it("brand openai key returns Authorization and no X-Web-Agent-Token", () => {
    const h = authHeaders(prov({ kind: "brand", wireFormat: "openai", apiKey: "bk" }));
    expect(h).toEqual({ Authorization: "Bearer bk" });
  });

  it("brand gemini key returns x-goog-api-key", () => {
    expect(authHeaders(prov({ kind: "brand", wireFormat: "gemini", apiKey: "bk" }))).toEqual({
      "x-goog-api-key": "bk",
    });
  });

  it("openai key returns exactly Authorization: Bearer", () => {
    expect(authHeaders(prov({ wireFormat: "openai", apiKey: "sk" }))).toEqual({
      Authorization: "Bearer sk",
    });
  });

  it("anthropic key returns x-api-key and the two browser direct headers", () => {
    expect(authHeaders(prov({ wireFormat: "anthropic", apiKey: "ak" }))).toEqual({
      "x-api-key": "ak",
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    });
  });

  it("anthropic brand, no key returns only the two anthropic headers", () => {
    expect(authHeaders(prov({ wireFormat: "anthropic", apiKey: "" }))).toEqual({
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    });
  });

  it("gemini key returns exactly x-goog-api-key", () => {
    expect(authHeaders(prov({ wireFormat: "gemini", apiKey: "gk" }))).toEqual({
      "x-goog-api-key": "gk",
    });
  });

  it("custom, no key, openai returns empty headers object", () => {
    expect(authHeaders(prov({ kind: "custom", wireFormat: "openai", apiKey: "" }))).toEqual({});
  });

  it("custom openai key sk with custom Authorization header overrides case-insensitively", () => {
    const p1 = prov({
      kind: "custom",
      wireFormat: "openai",
      apiKey: "sk",
      headers: [{ name: "Authorization", value: "Bearer other" }],
    });
    const r1 = authHeaders(p1);
    expect(r1).toEqual({ Authorization: "Bearer other" });
    expect(Object.keys(r1)).toHaveLength(1);

    const p2 = prov({
      kind: "custom",
      wireFormat: "openai",
      apiKey: "sk",
      headers: [{ name: "authorization", value: "Bearer other" }],
    });
    const r2 = authHeaders(p2);
    expect(r2).toEqual({ authorization: "Bearer other" });
    expect(Object.keys(r2)).toHaveLength(1);
  });

  it("header X-Team: web is added beside the auth header", () => {
    const p = prov({
      kind: "custom",
      wireFormat: "openai",
      apiKey: "sk",
      headers: [{ name: "X-Team", value: "web" }],
    });
    expect(authHeaders(p)).toEqual({
      Authorization: "Bearer sk",
      "X-Team": "web",
    });
  });
});
