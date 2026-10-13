import { describe, it, expect, vi } from "vitest";
import { mcpToolProviders, type McpServerConfig } from "./tool-providers.js";
import type { McpClientSession } from "./client.js";
import { buildSystemPromptParts } from "@cuatoi/web-agent-core";

function makeSession(toolNames: string[], serverName = "srv"): McpClientSession {
  return {
    serverName,
    serverUrl: `http://x/${serverName}`,
    tools: toolNames.map((t) => ({
      name: `${serverName}_${t}`,
      description: t,
      inputSchema: { type: "object", properties: {} },
      execute: vi.fn().mockResolvedValue({ content: "ok" }),
    })),
    client: {},
    transport: {},
    close: vi.fn().mockResolvedValue(undefined),
  };
}

describe("mcpToolProviders", () => {
  it("one provider per server, carrying name and required", () => {
    const servers: McpServerConfig[] = [
      { name: "a", description: "desc a", url: "http://x/a", required: true },
      { name: "b", description: "desc b", url: "http://x/b", required: false },
    ];
    const providers = mcpToolProviders(servers);
    expect(providers).toHaveLength(2);
    expect(providers.map((p) => [p.name, p.required])).toEqual([
      ["a", true],
      ["b", false],
    ]);
  });

  it("empty server list -> empty provider array", () => {
    const mockConnect = vi.fn();
    const providers = mcpToolProviders([], { connect: mockConnect });
    expect(providers).toHaveLength(0);
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("load() returns the session's tools tagged with the MCP prompt snippet", async () => {
    const session = makeSession(["t1", "t2"], "srv");
    const mockConnect = vi.fn().mockResolvedValue(session);

    const servers: McpServerConfig[] = [
      { name: "srv", description: "my desc", url: "http://x/srv", required: true },
    ];
    const providers = mcpToolProviders(servers, { connect: mockConnect });

    const tools = await providers[0].load();
    expect(tools).toHaveLength(2);
    expect(tools.map((t) => t.name)).toEqual(["srv_t1", "srv_t2"]);
    expect(tools[0].promptSnippet).toBe("srv (MCP server) — my desc");
    expect(tools[1].promptSnippet).toBe("srv (MCP server) — my desc");
  });

  it("load() does not mutate the session's own tool objects", async () => {
    const session = makeSession(["t1"], "srv");
    const mockConnect = vi.fn().mockResolvedValue(session);

    const servers: McpServerConfig[] = [
      { name: "srv", description: "my desc", url: "http://x/srv", required: true },
    ];
    const providers = mcpToolProviders(servers, { connect: mockConnect });

    await providers[0].load();
    expect(session.tools[0].promptSnippet).toBeUndefined();
  });

  it("dispose() closes the session, and is a safe no-op before load()", async () => {
    const session = makeSession(["t1"], "srv");
    const mockConnect = vi.fn().mockResolvedValue(session);

    const servers: McpServerConfig[] = [
      { name: "srv", description: "my desc", url: "http://x/srv", required: true },
    ];

    // Safe before load
    const p1 = mcpToolProviders(servers, { connect: mockConnect })[0];
    await expect(p1.dispose?.()).resolves.toBeUndefined();
    expect(session.close).not.toHaveBeenCalled();

    // Closes session after load
    const p2 = mcpToolProviders(servers, { connect: mockConnect })[0];
    await p2.load();
    await p2.dispose?.();
    expect(session.close).toHaveBeenCalledTimes(1);
  });

  it("prompt-snippet de-duplication", async () => {
    const session = makeSession(["t1", "t2", "t3"], "srv");
    const mockConnect = vi.fn().mockResolvedValue(session);

    const servers: McpServerConfig[] = [
      { name: "srv", description: "my desc", url: "http://x/srv", required: true },
    ];
    const provider = mcpToolProviders(servers, { connect: mockConnect })[0];
    const tools = await provider.load();

    const toolSnippets = tools
      .map((t) => t.promptSnippet)
      .filter((s): s is string => typeof s === "string");
    const toolNames = tools.map((t) => t.name);

    const app: Parameters<typeof buildSystemPromptParts>[0] = {
      appName: "TestApp",
      appDescription: "A test app",
      route: "/",
      stateShapeSummary: "",
    };
    const { full } = buildSystemPromptParts(app, { toolSnippets, toolNames });

    const line = "- srv (MCP server) — my desc";
    const occurrences = full.split(line).length - 1;
    expect(occurrences).toBe(1);
  });
});
