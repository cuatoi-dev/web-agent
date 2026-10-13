import { test, expect } from "./fixtures";
import { openPanel, sendChat, shot } from "./helpers";

test.skip(process.env.E2E_ENV !== "mock", "mock tier is mock-only");

test("declarative OpenAPI tool ordersApi_describeOrders executes against backend", async ({ page }) => {
  await page.addInitScript(() => {
    window.__WA_MOCK_SCRIPT__ = [
      {
        toolCalls: [
          {
            id: "call_openapi_1",
            name: "ordersApi_describeOrders",
            input: {},
          },
        ],
      },
      {
        text: "Described orders dataset via OpenAPI tool!",
        finishReason: "stop",
      },
    ];
  });

  await openPanel(page);
  await sendChat(page, "describe orders via openapi tool");

  const toolPhrase = page.locator("agent-message-view .tool-step-phrase").first();
  await expect(toolPhrase).toBeVisible({ timeout: 15_000 });
  await expect(toolPhrase).toContainText("ordersApi_describeOrders", { timeout: 15_000 });

  await expect(page.locator("agent-message-view .assistant .content").last()).toContainText(
    "Described orders dataset via OpenAPI tool!",
    { timeout: 15_000 }
  );

  await shot(page, "cat-store-openapi-tool.png");
});

// Whitelist enforcement: the cat-store OpenAPI spec (apps/cat-store/src/server/openapi.ts)
// defines four operations — describeOrders, queryOrders, createOrder, getOpenApiSpec — but
// the host (apps/cat-store/src/web/agent-panel-config.ts) whitelists only the first two. createOrder is a
// mutating POST; it must never become a callable tool.
//
// `AgentChatPanel._availableTools()` is not the right proof for this. Since 110/004 it does
// report the session's real resolved list, provider tools included (the controller folds them
// into the agent's factory at packages/web-agent-core/src/controller-config.ts:219-233), so an absent
// name there is evidence about the tool list — not about the network. The whitelist is a
// security property, and it is only proven
// behaviorally: force the mock LLM to call the excluded operation's tool name and verify the
// backend never receives the request that name would trigger. A non-whitelisted operation was
// never turned into a tool at all, so its executor lookup misses and the mutating endpoint is
// never reached — that is the actual security property, and this is what asserting on the
// network layer proves.
test("non-whitelisted operation ordersApi_createOrder is never invoked", async ({ page }) => {
  const mutatingRequests: string[] = [];
  page.on("request", (req) => {
    const url = req.url();
    if (req.method() === "POST" && url.includes("/api/orders") && !url.endsWith("/mcp")) {
      mutatingRequests.push(url);
    }
  });

  await page.addInitScript(() => {
    window.__WA_MOCK_SCRIPT__ = [
      {
        toolCalls: [
          {
            id: "call_whitelist_breach",
            name: "ordersApi_createOrder",
            input: { customer: "Whitelist Breach", total: 1, items: "contraband" },
          },
        ],
      },
      {
        text: "Attempted the excluded operation.",
        finishReason: "stop",
      },
    ];
  });

  await openPanel(page);
  await sendChat(page, "create an order via the openapi tool");

  // The transcript still names the attempted tool (the phrase is built from the assistant's
  // tool_use block name, not from whether an executor exists for it) — this test cares about
  // whether the operation actually reached the backend, not the transcript wording.
  await expect(page.locator("agent-message-view .assistant .content").last()).toContainText(
    "Attempted the excluded operation.",
    { timeout: 15_000 }
  );

  expect(mutatingRequests).toEqual([]);
});
