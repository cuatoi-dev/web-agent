import { test, expect } from "./fixtures";
import { openPanel, sendChat, shot } from "./helpers";
import type { Order } from "../src/shared/orders";

test.skip(process.env.E2E_ENV !== "mock", "mock tier is mock-only");

test("remote MCP tool demomcp_place_order executes and persists order to Express backend", async ({ page }) => {
  // Inject mock LLM script to trigger demomcp_place_order tool call on turn 1
  await page.addInitScript(() => {
    window.__WA_MOCK_SCRIPT__ = [
      {
        toolCalls: [
          {
            id: "call_mcp_1",
            name: "demomcp_place_order",
            input: { customer: "MCP Cat", total: 49.99, items: "Organic Salmon Pâté" },
          },
        ],
      },
      {
        text: "Placed order via remote MCP!",
        finishReason: "stop",
      },
    ];
  });

  await openPanel(page);
  await sendChat(page, "place order via mcp");

  // 1. Transcript renders the tool call step
  const toolPhrase = page.locator("agent-message-view .tool-step-phrase").first();
  await expect(toolPhrase).toBeVisible({ timeout: 15_000 });
  await expect(toolPhrase).toContainText("demomcp_place_order", { timeout: 15_000 });

  // 2. Final response text appears
  await expect(page.locator("agent-message-view .assistant .content").last()).toContainText(
    "Placed order via remote MCP!",
    { timeout: 15_000 }
  );

  // 3. Verify order persistence via REST API (/api/orders)
  const res = await page.request.get("/api/orders");
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { rows: Order[] };
  const mcpOrder = body.rows.find((r) => r.customer === "MCP Cat");
  expect(mcpOrder).toBeDefined();
  expect(mcpOrder!.items).toBe("Organic Salmon Pâté");
  expect(mcpOrder!.total).toBe(49.99);

  // 4. Capture Playwright screenshot for visual review
  await shot(page, "cat-store-remote-mcp.png");
});

test("unreachable optional MCP server is skipped without failing session initialization", async ({ page }) => {
  await page.addInitScript(() => {
    window.__WA_MOCK_SCRIPT__ = { text: "Session active", finishReason: "stop" };
    window.__WA_EXTRA_MCP_SERVERS__ = [
      {
        name: "unreachable",
        description: "Optional unreachable server test",
        url: "http://localhost:59999/mcp",
        required: false,
      },
    ];
  });

  await openPanel(page);
  await sendChat(page, "ping");

  await expect(page.locator("agent-message-view .assistant .content").last()).toContainText(
    "Session active",
    { timeout: 15_000 }
  );
});
