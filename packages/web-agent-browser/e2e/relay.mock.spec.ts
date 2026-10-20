import { test, expect } from "./extension.fixture";

test.describe("Relay worker key verification", () => {
  test("the worker reaches the gateway with the brand key in the format header", async ({ context }) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");

    const statuses = await worker.evaluate(async () => {
      const brand = await (await fetch(chrome.runtime.getURL("brand.json"))).json();
      const key = brand.models.find((m: { id: string }) => m.id === "openai-sonnet").apiKey as string;
      const url = "http://localhost:30000/api/openai/v1/models";
      const ok = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
      const wrong = await fetch(url, { headers: { Authorization: "Bearer wrong-key" } });
      return [ok.status, wrong.status];
    });
    expect(statuses).toEqual([200, 401]);
  });
});
