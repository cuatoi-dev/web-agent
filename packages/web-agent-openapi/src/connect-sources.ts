import type { CustomToolDef } from "@cuatoi/web-agent-core";
import { buildApiTool } from "./execute-operation.js";
import { fetchOpenApiDocument } from "./fetch-seam.js";
import { parseOpenApiOperations } from "./parse-openapi.js";
import type {
  ApiRequestOptions,
  ApiSourceConfig,
  ApiSourceFailure,
  ApiToolDef,
  ConnectApiSourcesResult,
} from "./types.js";

export type { ApiSourceFailure, ConnectApiSourcesResult };

/** Thrown when a source declared `required: true` fails to load. */
export class ApiRequiredSourceError extends Error {
  readonly failures: ApiSourceFailure[];
  constructor(failures: ApiSourceFailure[]) {
    const detail = failures
      .map((f) => `"${f.source.name}" (${f.source.specUrl}): ${errText(f.error)}`)
      .join("; ");
    super(`Required API source(s) failed to load — ${detail}`);
    this.name = "ApiRequiredSourceError";
    this.failures = failures;
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Fetch one source's OpenAPI document, resolve its whitelist, and build one live
 * tool per whitelisted operation.
 *
 * All three stages throw on failure inside this async function, so every failure rejects
 * the returned promise, and `Promise.allSettled` in {@link connectApiSources} catches it.
 */
export async function loadApiSource(
  source: ApiSourceConfig,
  options?: ApiRequestOptions,
): Promise<ApiToolDef[]> {
  const doc = await fetchOpenApiDocument(source, options);
  const descriptors = await parseOpenApiOperations(source, doc);
  return descriptors.map((d) => buildApiTool(source, d, options));
}

/**
 * Load every configured API source **concurrently** and collect their tools.
 *
 * - Every load starts in the same tick, so a slow source never serialises a fast one.
 * - A `required: false` source that fails is `console.warn`-logged and contributes
 *   no tools.
 * - If any `required: true` source fails, an {@link ApiRequiredSourceError} carrying
 *   every required failure is thrown. Nothing needs closing first — API sources hold
 *   no open connection.
 * - Two sources whose names sanitize to the same tool prefix would generate identical
 *   tool names. The first source to claim a name keeps it; a later source that
 *   collides is dropped whole and treated as a failure, classified by its own
 *   `required` flag.
 * - A collision with a tool name from any other provider is not checked here — those
 *   tool lists are not visible to this function. Core's `buildTools` already resolves
 *   duplicates first-wins, so the tool registered earlier always wins.
 * - A source with an empty `operations` whitelist simply contributes no tools. That is
 *   not an error.
 */
export async function connectApiSources(
  sources: ApiSourceConfig[] | undefined,
  options?: ApiRequestOptions & {
    /** Test seam: overrides the network call. Defaults to `loadApiSource`. */
    load?: typeof loadApiSource;
  },
): Promise<ConnectApiSourcesResult> {
  if (!sources || sources.length === 0) {
    return { tools: [], failures: [] };
  }

  const load = options?.load ?? loadApiSource;
  const settled = await Promise.allSettled(sources.map((s) => load(s, options)));

  const tools: CustomToolDef[] = [];
  const failures: ApiSourceFailure[] = [];
  const requiredFailures: ApiSourceFailure[] = [];
  /** tool name -> the `name` of the source that claimed it first. */
  const claimedBy = new Map<string, string>();

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];
    const outcome = settled[i];

    let error: unknown;
    let sourceTools: CustomToolDef[] | undefined;

    if (outcome.status === "fulfilled") {
      const clash = outcome.value.find((d) => claimedBy.has(d.toolDef.name));
      if (clash) {
        const name = clash.toolDef.name;
        error = new Error(
          `API source "${source.name}" generates tool name "${name}", which API ` +
            `source "${claimedBy.get(name)}" already provides. Two source names that ` +
            `sanitize to the same tool prefix cannot be used together — rename one.`,
        );
      } else {
        // Identical snippet on every tool from this source: core's
        // buildSystemPromptParts de-duplicates identical snippet strings, so this
        // yields exactly one "# Tool guidelines" line per source.
        const snippet = `${source.name} (API source) — ${source.description}`;
        sourceTools = outcome.value.map((d) => ({ ...d.toolDef, promptSnippet: snippet }));
      }
    } else {
      error = outcome.reason;
    }

    if (sourceTools) {
      for (const t of sourceTools) claimedBy.set(t.name, source.name);
      tools.push(...sourceTools);
      continue;
    }

    const failure: ApiSourceFailure = { source, error };
    if (source.required) {
      requiredFailures.push(failure);
    } else {
      failures.push(failure);
      console.warn(
        `[api] optional source "${source.name}" (${source.specUrl}) failed to load — ` +
          `its tools are unavailable this session: ${errText(error)}`,
        error,
      );
    }
  }

  if (requiredFailures.length > 0) {
    throw new ApiRequiredSourceError(requiredFailures);
  }

  return { tools, failures };
}