import { describe, expect, it } from "vitest";
import { createRequire } from "module";
import { defaultTools, type CustomToolDef, type ToolContext } from "@cuatoi/web-agent-core";
import { tabTools } from "./tab-tools";
import { pageAgentTools } from "./page-agent-tools";
import { panelPageTools } from "./panel-page-tools";
import { vfsTools } from "@cuatoi/web-agent-vfs";

const require = createRequire(import.meta.url);
const { SIDE_PANEL_TOOL_NAMES } = require("../../tool/sidepanel-tools.cjs") as {
  SIDE_PANEL_TOOL_NAMES: string[];
};

describe("SIDE_PANEL_TOOL_NAMES", () => {
  it("union of core defaultTools and all extension providers matches static list", async () => {
    const ctx: ToolContext = {
      _scheduler: { list: () => [], add: () => ({ id: "1" }), cancel: () => true },
      _todos: { read: () => [], write: () => {} },
      skillRegistry: {
        list: () => Promise.resolve([]),
        get: () => Promise.resolve(undefined),
        save: async () => {},
        remove: async () => {},
      },
    } as unknown as ToolContext;

    const core = defaultTools(ctx).map((t) => t.name);

    const loadProvider = async (providers: ReturnType<typeof tabTools>): Promise<string[]> => {
      const lists = await Promise.all(providers.map((p) => p.load()));
      return lists.flatMap((tools: CustomToolDef[]) => tools.map((t) => t.name));
    };

    const tabs = await loadProvider(tabTools());
    const pageAgent = await loadProvider(pageAgentTools());
    const panelPage = await loadProvider(panelPageTools({ endpointType: "anthropic", model: "sonnet" }));
    // 069/003 — vfsTools returns ONE provider, not an array, so it is wrapped
    // before it goes through the same loader.
    const vfs = await loadProvider([vfsTools()]);

    const discovered = [...new Set([...core, ...tabs, ...pageAgent, ...panelPage, ...vfs])].sort();
    expect(discovered).toEqual([...SIDE_PANEL_TOOL_NAMES].sort());
  });
});
