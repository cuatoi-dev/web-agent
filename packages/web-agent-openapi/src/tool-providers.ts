import type { CustomToolDef, ToolProvider } from "@cuatoi/web-agent-core";
import { connectApiSources, type loadApiSource } from "./connect-sources.js";
import type { ApiRequestOptions } from "./execute-operation.js";
import type { ApiSourceConfig } from "./types.js";

/**
 * Build the {@link ToolProvider} for a host's declarative OpenAPI sources, for
 * `SessionConfig.toolProviders`.
 *
 * Returns **one** provider covering the whole list, not one per source. A tool
 * name claimed by one source is refused to a later source, and that rule needs a
 * view across every source — which a per-source provider cannot have.
 *
 * `required: true` is correct for the single provider because
 * {@link connectApiSources} throws only when a `required: true` **source** fails;
 * an optional source failure is warned and swallowed inside it.
 *
 * There is no `dispose()` — an API source holds no open connection.
 *
 * Sources are loaded at session start by core's tool-provider runner, and
 * again when a new `toolProviders` array is assigned.
 */
export function openApiToolProviders(
  sources: ApiSourceConfig[],
  options?: ApiRequestOptions & {
    /** Test seam: overrides the network call. Defaults to `loadApiSource`. */
    load?: typeof loadApiSource;
  },
): ToolProvider[] {
  return [
    {
      name: "openapi",
      required: true,
      async load(): Promise<CustomToolDef[]> {
        const result = await connectApiSources(sources, options);
        return result.tools;
      },
    },
  ];
}
