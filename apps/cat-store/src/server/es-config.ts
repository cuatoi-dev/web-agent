import type { EsConfig } from "./types.js";

export type { EsConfig } from "./types.js";

const REQUIRED_VARS = ["CATSTORE_ES_URL", "CATSTORE_ES_USER", "CATSTORE_ES_PASSWORD"] as const;

/**
 * Returns the config, or the names of the variables that are unset/blank.
 * There is no default and no fallback to DEV_ES_* — a missing or blank value
 * is a hard configuration error, named explicitly.
 */
export function readEsConfig(
  env: NodeJS.ProcessEnv = process.env,
): { ok: true; config: EsConfig } | { ok: false; missing: string[] } {
  const missing = REQUIRED_VARS.filter((name) => !env[name] || env[name].trim() === "");
  if (missing.length > 0) {
    return { ok: false, missing };
  }
  return {
    ok: true,
    config: {
      url: env.CATSTORE_ES_URL!,
      user: env.CATSTORE_ES_USER!,
      password: env.CATSTORE_ES_PASSWORD!,
    },
  };
}
