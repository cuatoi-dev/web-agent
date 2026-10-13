import type { CustomToolDef, ToolProvider } from "@cuatoi/web-agent-core";
import { connectMcpClient } from "./client.js";
import type {
  ConnectMcpOptions,
  McpClientSession,
  McpServerConfig,
} from "./types.js";

export type { McpServerConfig } from "./types.js";

/**
 * Build one {@link ToolProvider} per configured MCP server, for
 * `SessionConfig.toolProviders`.
 *
 * Each provider carries its server's `name` and `required`, connects in `load()`,
 * stamps the server's prompt snippet on every tool it returns, and closes the
 * session in `dispose()`. Concurrency, the `required` degrade rule, and
 * dispose-on-required-failure are handled by core's runner.
 */
export function mcpToolProviders(
  servers: McpServerConfig[],
  options?: ConnectMcpOptions & {
    /** Test seam: overrides the network call. Defaults to `connectMcpClient`. */
    connect?: typeof connectMcpClient;
  },
): ToolProvider[] {
  const connect = options?.connect ?? connectMcpClient;
  return servers.map((server): ToolProvider => {
    let session: McpClientSession | undefined;
    return {
      name: server.name,
      required: server.required,
      async load(): Promise<CustomToolDef[]> {
        session = await connect(server.name, server.url, options);
        // Identical snippet on every tool from this server: buildSystemPromptParts
        // (core prompt/system-prompt.ts) de-duplicates identical snippet strings
        // via its `arr.indexOf(val) === i` filter, so this yields exactly one
        // "# Tool guidelines" line per server.
        const snippet = `${server.name} (MCP server) — ${server.description}`;
        return session.tools.map((t) => ({ ...t, promptSnippet: snippet }));
      },
      async dispose(): Promise<void> {
        const s = session;
        session = undefined;
        if (s) await s.close();
      },
    };
  });
}
