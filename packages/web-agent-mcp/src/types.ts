import type { CustomToolDef } from "@cuatoi/web-agent-core";

export interface McpClientSession {
  serverName: string;
  serverUrl: string;
  tools: CustomToolDef[];
  client: unknown;
  transport: unknown;
  close: () => Promise<void>;
}

export interface ConnectMcpOptions {
  clientName?: string;
  clientVersion?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpContentBlock {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
  [key: string]: unknown;
}

export interface McpCallToolResult {
  content?: McpContentBlock[];
  isError?: boolean;
  [key: string]: unknown;
}

/**
 * One remote MCP server a host wants the agent to use.
 *
 * All four fields are required on purpose: `required` has **no default**, so a
 * host must state its degrade intent explicitly rather than inherit one.
 *
 * `url` may be relative (e.g. "/mcp"); it is resolved against the page URL by
 * {@link resolveMcpServerUrl}. A same-origin relative path avoids CORS entirely.
 *
 * Servers are connected at session start by the core tool-provider runner.
 * Assigning a new `toolProviders` array later closes these clients and
 * connects the new list.
 */
export interface McpServerConfig {
  /** Short id; also the tool-name prefix after sanitization ("cat-store" → "cat_store_"). */
  name: string;
  /** What this group of tools is for. Surfaced to the model as a tool guideline. */
  description: string;
  /** Streamable-HTTP MCP endpoint. Absolute, or relative to the page URL. */
  url: string;
  /** true → a connect/discover failure is a hard startup error. false → logged and skipped. */
  required: boolean;
}
