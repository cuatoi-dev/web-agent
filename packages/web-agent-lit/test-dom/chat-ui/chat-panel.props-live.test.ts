import { describe, it, expect, vi, afterEach } from "vitest";
import { AgentChatPanel } from "../../src/chat-ui/chat-panel.js";
import { setMockScript, type CustomToolDef, type SkillRegistry } from "@cuatoi/web-agent-core";

if (!customElements.get("agent-chat-panel")) {
  customElements.define("agent-chat-panel", AgentChatPanel);
}

/** A connected panel on a REAL core session (mock endpoint). `before` runs
 *  before the panel connects, so a test can set properties the session is
 *  created with. */
async function mountRealPanel(before?: (p: AgentChatPanel) => void): Promise<AgentChatPanel> {
  const panel = document.createElement("agent-chat-panel");
  panel.config = { persist: false };
  panel.type = "mock";
  panel.model = "m1";
  before?.(panel);
  document.body.appendChild(panel);
  await panel.session!.initPromise;
  await panel.updateComplete;
  return panel;
}

const assistantTexts = (p: AgentChatPanel) =>
  p.session!.getState().messages
    .filter((m) => m.role === "assistant")
    .map((m) => m.text ?? (m.parts ?? []).filter((x) => x.kind === "text").map((x) => x.text).join(""));

describe("AgentChatPanel — live property updates", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("nine session-affecting properties written in one task call updateConfig once", async () => {
    const panel = await mountRealPanel();
    const spy = vi.spyOn(panel.session!, "updateConfig");
    panel.store = { getState: () => ({}) };
    panel.appContext = { appName: "A" };
    panel.cues = { enabled: false };
    panel.path = "/x";
    panel.thinking = true;
    panel.images = { maxDimension: 512 };
    panel.sources = [];
    panel.skills = [];
    panel.hooks = {};
    expect(spy).toHaveBeenCalledTimes(0);
    await Promise.resolve();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatchObject({
      appContext: { appName: "A" },
      baseURL: "/x",
    });
  });

  it("an equal value calls neither updateConfig nor requestUpdate", async () => {
    const panel = await mountRealPanel();
    panel.appContext = { appName: "A" };
    panel.cues = { enabled: true, speed: "fast" };
    panel.images = { maxDimension: 512 };
    await Promise.resolve();

    const spy = vi.spyOn(panel.session!, "updateConfig");
    const ru = vi.spyOn(panel, "requestUpdate");
    panel.appContext = { appName: "A" };
    panel.config = { persist: false };
    panel.cues = { speed: "fast", enabled: true };
    panel.images = { maxDimension: 512 };
    panel.model = "m1";
    panel.type = "mock";
    const name = panel.agentName;
    panel.agentName = name;
    await Promise.resolve();
    expect(spy).toHaveBeenCalledTimes(0);
    expect(ru).toHaveBeenCalledTimes(0);

    panel.appContext = { appName: "B" };
    await Promise.resolve();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("the conversation survives a property change", async () => {
    setMockScript([{ text: "A1" }, { text: "A2" }]);
    const panel = await mountRealPanel();
    await panel.send("My cat is named Tofu");
    panel.appContext = { ...panel.appContext, appName: "Changed" };
    await Promise.resolve();
    expect(panel.session!.getState().messages.length).toBe(2);
    await panel.send("again");
    expect(panel.session!.getState().messages.length).toBe(4);
    expect(assistantTexts(panel)).toEqual(["A1", "A1"]);
  });

  it("toolProviders assigned after connect: old disposed, new tool runs", async () => {
    const oldDispose = vi.fn();
    const echoExec = vi.fn(() => Promise.resolve({ content: "echo: hi" }));
    const echo: CustomToolDef = {
      name: "echo_probe",
      description: "Echo text",
      inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      execute: echoExec,
    };
    const panel = await mountRealPanel((p) => {
      p.toolProviders = [{ name: "old", required: false, load: () => Promise.resolve([]), dispose: oldDispose }];
    });
    setMockScript([{ toolCalls: [{ id: "t1", name: "echo_probe", input: { text: "hi" } }] }, { text: "done" }]);
    panel.toolProviders = [{ name: "echo", required: false, load: () => Promise.resolve([echo]) }];
    await Promise.resolve();
    expect(oldDispose).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(panel.session!.availableTools().map((t) => t.name)).toContain("echo_probe"));
    await panel.send("call it");
    expect(echoExec).toHaveBeenCalledTimes(1);
    expect(echoExec).toHaveBeenCalledWith({ text: "hi" }, expect.anything());
  });

  it("skillRegistry assigned after connect adds its skills", async () => {
    const panel = await mountRealPanel();
    panel.skillRegistry = {
      list: () => Promise.resolve([{ name: "probe_skill", description: "Probe", definition: "Say probe.", command: true }]),
      get: () => Promise.resolve(undefined),
    } satisfies SkillRegistry;
    await vi.waitFor(() => expect(panel.session!.commands().map((c) => c.name)).toContain("probe_skill"));
  });

  it("a property written just before send reaches the turn", async () => {
    setMockScript([{ text: "A1" }]);
    const panel = await mountRealPanel();
    const spy = vi.spyOn(panel.session!, "updateConfig");
    panel.model = "m2";
    const sending = panel.send("hi");
    expect(spy).toHaveBeenCalledTimes(1);
    await sending;
    expect(panel.session!.getState().model).toBe("m2");
    await Promise.resolve();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
