import { describe, it, expect } from "vitest";
import { authHeaders } from "./auth-headers";
import type { ModelProvider } from "./model-store.types";

function prov(over: Partial<ModelProvider> = {}): ModelProvider {
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
  it("brand, no key, openai returns exactly X-Web-Agent-Token", () => {
    expect(authHeaders(prov({ wireFormat: "openai", apiKey: "" }), "tok")).toEqual({
      "X-Web-Agent-Token": "tok",
    });
  });

  it("brand, key with whitespace only returns same as no key", () => {
    expect(authHeaders(prov({ wireFormat: "openai", apiKey: "   " }), "tok")).toEqual({
      "X-Web-Agent-Token": "tok",
    });
  });

  it("openai key returns exactly Authorization: Bearer", () => {
    expect(authHeaders(prov({ wireFormat: "openai", apiKey: "sk" }), "tok")).toEqual({
      Authorization: "Bearer sk",
    });
  });

  it("anthropic key returns x-api-key and the two browser direct headers", () => {
    expect(authHeaders(prov({ wireFormat: "anthropic", apiKey: "ak" }), "tok")).toEqual({
      "x-api-key": "ak",
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    });
  });

  it("anthropic brand, no key returns token plus the two anthropic headers", () => {
    expect(authHeaders(prov({ wireFormat: "anthropic", apiKey: "" }), "tok")).toEqual({
      "X-Web-Agent-Token": "tok",
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    });
  });

  it("gemini key returns exactly x-goog-api-key", () => {
    expect(authHeaders(prov({ wireFormat: "gemini", apiKey: "gk" }), "tok")).toEqual({
      "x-goog-api-key": "gk",
    });
  });

  it("custom, no key, openai returns empty headers object", () => {
    expect(authHeaders(prov({ kind: "custom", wireFormat: "openai", apiKey: "" }), "tok")).toEqual({});
  });

  it("custom openai key sk with custom Authorization header overrides case-insensitively", () => {
    const p1 = prov({
      kind: "custom",
      wireFormat: "openai",
      apiKey: "sk",
      headers: [{ name: "Authorization", value: "Bearer other" }],
    });
    const r1 = authHeaders(p1, "tok");
    expect(r1).toEqual({ Authorization: "Bearer other" });
    expect(Object.keys(r1)).toHaveLength(1);

    const p2 = prov({
      kind: "custom",
      wireFormat: "openai",
      apiKey: "sk",
      headers: [{ name: "authorization", value: "Bearer other" }],
    });
    const r2 = authHeaders(p2, "tok");
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
    expect(authHeaders(p, "tok")).toEqual({
      Authorization: "Bearer sk",
      "X-Team": "web",
    });
  });
});
