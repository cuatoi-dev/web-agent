import { test, expect } from "./extension.fixture";

test.describe("Relay worker token verification", () => {
  test("worker token authentication (Scenarios 16 & 17)", async ({ context }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");

    const defaultToken = process.env.WEB_AGENT_TOKEN || "wa-demo-token";
    const res200 = await worker.evaluate(async (tok) => {
      const got = await chrome.storage.local.get("token");
      const token = typeof got.token === "string" ? got.token : tok;
      const res = await fetch("http://localhost:28780/api/openai/v1/models", {
        headers: { "X-Web-Agent-Token": token },
      });
      return res.status;
    }, defaultToken);
    expect(res200).toBe(200);

    const res401 = await worker.evaluate(async () => {
      const res = await fetch("http://localhost:28780/api/openai/v1/models", {
        headers: { "X-Web-Agent-Token": "wrong-token" },
      });
      return res.status;
    });
    expect(res401).toBe(401);
  });
});
