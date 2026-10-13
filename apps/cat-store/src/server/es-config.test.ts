// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readEsConfig } from "./es-config.js";

const ALL = {
  CATSTORE_ES_URL: "http://elasticsearch:9200",
  CATSTORE_ES_USER: "elastic",
  CATSTORE_ES_PASSWORD: "secret",
};

describe("readEsConfig", () => {
  it("all three variables set -> ok with the values", () => {
    const result = readEsConfig(ALL);
    expect(result).toEqual({
      ok: true,
      config: {
        url: ALL.CATSTORE_ES_URL,
        user: ALL.CATSTORE_ES_USER,
        password: ALL.CATSTORE_ES_PASSWORD,
      },
    });
  });

  const KEYS = ["CATSTORE_ES_URL", "CATSTORE_ES_USER", "CATSTORE_ES_PASSWORD"] as const;

  it.each(KEYS)("%s missing entirely -> not ok, naming exactly that variable", (key) => {
    const env = { ...ALL };
    delete (env as Record<string, string>)[key];
    const result = readEsConfig(env);
    expect(result).toEqual({ ok: false, missing: [key] });
  });

  it.each(KEYS)("%s blank -> not ok, naming exactly that variable", (key) => {
    const env = { ...ALL, [key]: "" };
    const result = readEsConfig(env);
    expect(result).toEqual({ ok: false, missing: [key] });
  });

  it("no fallback to DEV_ES_* — with only those set, all three are missing", () => {
    const env = {
      DEV_ES_URL: "http://elasticsearch:9200",
      DEV_ES_USER: "elastic",
      DEV_ES_PASSWORD: "secret",
    };
    const result = readEsConfig(env);
    expect(result).toEqual({ ok: false, missing: [...KEYS] });
  });

  it("CATSTORE_ES_INDEX is not read and not required", () => {
    const env = { ...ALL, CATSTORE_ES_INDEX: undefined };
    const result = readEsConfig(env);
    expect(result).toEqual({ ok: true, config: { url: ALL.CATSTORE_ES_URL, user: ALL.CATSTORE_ES_USER, password: ALL.CATSTORE_ES_PASSWORD } });
  });
});
