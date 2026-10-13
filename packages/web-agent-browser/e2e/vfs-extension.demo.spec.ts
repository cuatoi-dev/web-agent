import { test, expect, ask, expectCall } from "./demo-helpers";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

test.describe("VFS extension — live proof", () => {
  test("one turn writes the agent-home and shared files", async ({ demoExtension }) => {
    test.setTimeout(300_000);
    const panel = await demoExtension.context.newPage();
    await panel.setViewportSize({ width: 400, height: 700 });
    await panel.goto(`chrome-extension://${demoExtension.extensionId}/sidepanel.html`);
    await expect(panel.locator("#chat agent-chat-panel")).toBeAttached();

    const { trace } = await ask(
      panel,
      "Write 'I am chromagent' to /home/agent/SOUL.md and 'Timezone: SGT' to /home/shared/USER.md",
      { model: demoExtension.model },
    );

    expectCall(trace, "write_file", (i) => isRecord(i) && i.file_path === "/home/agent/SOUL.md" && typeof i.content === "string" && i.content.trim() === "I am chromagent");
    expectCall(trace, "write_file", (i) => isRecord(i) && i.file_path === "/home/shared/USER.md" && typeof i.content === "string" && i.content.trim() === "Timezone: SGT");

    await panel.close();
  });
});
