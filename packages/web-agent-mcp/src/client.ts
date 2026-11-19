import type { CustomToolDef, JsonSchemaObject, ToolImage, ToolOutcome } from "@cuatoi/web-agent-core";
import { resolveRelativeUrl, sanitizeName } from "@cuatoi/web-agent-core";
import type {
  ConnectMcpOptions,
  McpCallToolResult,
  McpClientSession,
  McpContentBlock,
  McpToolInfo,
} from "./types.js";

export type {
  McpClientSession,
  ConnectMcpOptions,
  McpToolInfo,
  McpContentBlock,
  McpCallToolResult,
} from "./types.js";

/** Sanitize server name to produce a valid tool name prefix (alphanumeric + underscore). */
export function sanitizeServerName(name: string): string {
  return sanitizeName(name, "mcp");
}

/** Resolve a relative or absolute MCP server URL against window.location or a base URL. */
export function resolveMcpServerUrl(url: string, baseUrl?: string): string {
  return resolveRelativeUrl(url, baseUrl);
}

/** Format MCP content blocks into text and tool images. */
export function formatMcpContent(content: McpContentBlock[] | undefined): {
  text: string;
  images: ToolImage[];
} {
  if (!content || content.length === 0) {
    return { text: "", images: [] };
  }
  const text = content
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("\n")
    .trim();
  const images: ToolImage[] = [];
  for (const block of content) {
    if (
      block.type === "image" &&
      typeof block.data === "string" &&
      block.data.length > 0 &&
      typeof block.mimeType === "string" &&
      block.mimeType.startsWith("image/")
    ) {
      images.push({
        dataUrl: `data:${block.mimeType};base64,${block.data}`,
        mediaType: block.mimeType,
      });
    }
  }
  return { text, images };
}

/** Map an MCP tool definition to a CustomToolDef with prefixed name and draft-07 inputSchema. */
export function mapMcpToolToCustomToolDef(
  serverName: string,
  mcpTool: McpToolInfo,
  callToolFn: (args: Record<string, unknown>) => Promise<McpCallToolResult>,
): CustomToolDef {
  const prefix = sanitizeServerName(serverName);
  const toolName = `${prefix}_${mcpTool.name}`;
  const inputSchema = (mcpTool.inputSchema as JsonSchemaObject) ?? { type: "object", properties: {} };

  return {
    name: toolName,
    description: mcpTool.description ?? `MCP tool ${mcpTool.name} from ${serverName}`,
    inputSchema,
    execute: async (input: Record<string, unknown>): Promise<ToolOutcome> => {
      try {
        const res = await callToolFn(input);
        const { text, images } = formatMcpContent(res.content);
        return {
          content: text,
          isError: res.isError ?? false,
          ...(images.length > 0 ? { images } : {}),
        };
      } catch (err: unknown) {
        return {
          content: err instanceof Error ? err.message : String(err),
          isError: true,
        };
      }
    },
  };
}

/** Connect to a remote MCP server via StreamableHTTPClientTransport and discover tools. */
export async function connectMcpClient(
  serverName: string,
  serverUrl: string,
  options?: ConnectMcpOptions,
): Promise<McpClientSession> {
  const resolvedUrl = resolveMcpServerUrl(serverUrl);

  // Literal specifiers only — a variable specifier here makes webpack emit
  // "Critical dependency: the request of a dependency is an expression" and
  // drop the module from the build.
  const { Client } = await import(
    /* webpackChunkName: "mcp-sdk-client" */
    "@modelcontextprotocol/sdk/client/index.js"
  );
  const { StreamableHTTPClientTransport } = await import(
    /* webpackChunkName: "mcp-sdk-transport" */
    "@modelcontextprotocol/sdk/client/streamableHttp.js"
  );

  const transport = new StreamableHTTPClientTransport(new URL(resolvedUrl), {
    fetch: options?.fetch,
  });

  const client = new Client(
    {
      name: options?.clientName ?? "web-agent-client",
      version: options?.clientVersion ?? "0.1.0",
    },
    { capabilities: {} },
  );

  await client.connect(transport);

  const toolsResult = await client.listTools();
  const rawTools: McpToolInfo[] = toolsResult?.tools ?? [];

  const tools: CustomToolDef[] = rawTools.map((t) =>
    mapMcpToolToCustomToolDef(serverName, t, (args) =>
      client.callTool({ name: t.name, arguments: args }),
    ),
  );

  return {
    serverName,
    serverUrl: resolvedUrl,
    tools,
    client,
    transport,
    close: async () => {
      await client.close();
    },
  };
}
