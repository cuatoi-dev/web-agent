import { test as base, chromium, type BrowserContext, type Page } from "@playwright/test";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION = path.resolve(HERE, "../dist");
const PROMPTS_LOG = path.resolve(HERE, "../test-results/demo-prompts.jsonl");

export interface AuditCall {
  name: string;
  input: unknown;
  outcomeSummary: string;
  failed?: boolean;
}

export interface DemoPromptRecord {
  test: string;
  prompt: string;
  model: string;
  trace: AuditCall[];
  reply: string;
  error: string | null;
  ms: number;
}

export interface DemoExtensionFixture {
  context: BrowserContext;
  extensionId: string;
  model: string;
}

export const test = base.extend<{ demoExtension: DemoExtensionFixture }>({
  demoExtension: [
    async ({ browserName }, use) => {
      void browserName;
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "web-agent-demo-"));
      let context: BrowserContext | undefined;
      try {
        context = await chromium.launchPersistentContext(dir, {
          channel: "chromium",
          args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
        });

        let [worker] = context.serviceWorkers();
        if (!worker) worker = await context.waitForEvent("serviceworker");
        const extensionId = worker.url().split("/")[2];

        const modelChoice = process.env.DEMO_MODEL;
        const configuredModel = await worker.evaluate(async (modelId) => {
          await chrome.storage.local.set({ enabledOrigins: ["http://localhost:10040"] });
          let chosen = "sonnet";
          try {
            const resp = await fetch(chrome.runtime.getURL("brand.json"));
            const brand = (await resp.json()) as { models?: Array<{ id: string; endpoint: string; wireFormat: string; model: string }> };
            const models = brand.models ?? [];
            const entry = modelId ? models.find((m) => m.id === modelId || m.model === modelId) : models[0];
            if (entry) {
              chosen = entry.model;
              await chrome.storage.local.set({
                agentSettings: {
                  endpoint: entry.endpoint,
                  wireFormat: entry.wireFormat,
                  model: entry.model,
                  apiKey: "",
                  theme: "auto",
                },
              });
            }
          } catch {
            // keep fallback
          }
          return chosen;
        }, modelChoice);

        await use({ context, extensionId, model: configuredModel });
      } finally {
        await context?.close();
        await fs.rm(dir, { recursive: true, force: true });
      }
    },
    { scope: "test" },
  ],
});

export const expect = test.expect;

export function normalizeBrandReply(reply: string): string {
  return reply.trim().replace(/[.!]+$/, "").toUpperCase();
}

export async function ask(
  panelPage: Page,
  prompt: string,
  opts: { timeoutMs?: number; model?: string } = {},
): Promise<{ trace: AuditCall[]; reply: string; error: string | null }> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const startMs = Date.now();

  const before = await panelPage.evaluate(() => {
    const panel = document.querySelector("agent-chat-panel:not([hidden])")
      ?? document.querySelector("web-agent-bubble")?.shadowRoot?.querySelector("agent-chat-panel");
    return (panel as { messages?: unknown[] })?.messages?.length ?? 0;
  });

  const sendPromise = panelPage.evaluate((text) => {
    const panel = document.querySelector("agent-chat-panel:not([hidden])")
      ?? document.querySelector("web-agent-bubble")?.shadowRoot?.querySelector("agent-chat-panel");
    if (!panel) throw new Error("no agent-chat-panel found");
    return (panel as { send: (t: string) => Promise<{ ran: string }> }).send(text);
  }, prompt);

  let timer: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("TIMED_OUT")), timeoutMs);
  });

  try {
    const outcome = await Promise.race([sendPromise, timeoutPromise]);
    if (outcome.ran === "command") {
      // Slash commands return before their model turn finishes. Wait for that
      // turn's reply so the trace and prompt record describe the real result.
      await panelPage.waitForFunction((beforeIndex) => {
        const panel = document.querySelector("agent-chat-panel:not([hidden])")
          ?? document.querySelector("web-agent-bubble")?.shadowRoot?.querySelector("agent-chat-panel");
        const messages = (panel as { messages?: Array<{ role?: string; text?: string }> })?.messages ?? [];
        return messages.slice(beforeIndex).some((m) => m.role === "assistant" && Boolean(m.text?.trim()))
          && !(panel as { running?: boolean })?.running;
      }, before, { timeout: timeoutMs });
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "TIMED_OUT") {
      const state = await panelPage.evaluate((sentPrompt) => {
        const panel = document.querySelector("agent-chat-panel:not([hidden])")
          ?? document.querySelector("web-agent-bubble")?.shadowRoot?.querySelector("agent-chat-panel");
        const msgs = (panel as { messages?: Array<{ role?: string; text?: string; trace?: AuditCall[] }> })?.messages ?? [];
        const wanted = sentPrompt.trim();
        const currentUserIndex = msgs.findLastIndex((m) => {
          if (m.role !== "user") return false;
          const shown = m.text?.trim() ?? "";
          return shown === wanted || shown.endsWith(`\n${wanted}`);
        });
        const turn = currentUserIndex < 0 ? [] : msgs.slice(currentUserIndex);
        const traceSoFar = turn.flatMap((m) => m.trace ?? []).map((t) => `${t.name}(${JSON.stringify(t.input)}) -> ${JSON.stringify((t.outcomeSummary ?? "").slice(0, 200))}`);
        return traceSoFar.join(", ");
      }, prompt);
      throw new Error(`turn timed out after ${timeoutMs}ms; trace so far: ${state}`, { cause: err });
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }

  const { turn, panelError } = await panelPage.evaluate((sentPrompt) => {
    const panel = document.querySelector("agent-chat-panel:not([hidden])")
      ?? document.querySelector("web-agent-bubble")?.shadowRoot?.querySelector("agent-chat-panel");
    const msgs = (panel as { messages?: Array<{ role?: string; text?: string; trace?: AuditCall[] }> })?.messages ?? [];
    const error = (panel as { error?: string | null })?.error ?? null;
    // Session history can load after the initial length is read. Select the
    // latest copy of this prompt so earlier turns cannot satisfy an assertion.
    // An attachment provider (Watch me) puts its own text before the prompt,
    // joined with "\n", so that message ends with the prompt.
    const wanted = sentPrompt.trim();
    const currentUserIndex = msgs.findLastIndex((m) => {
      if (m.role !== "user") return false;
      const shown = m.text?.trim() ?? "";
      return shown === wanted || shown.endsWith(`\n${wanted}`);
    });
    if (currentUserIndex < 0) throw new Error(`sent prompt missing from conversation: ${sentPrompt}`);
    return { turn: msgs.slice(currentUserIndex), panelError: error };
  }, prompt);

  const elapsedMs = Date.now() - startMs;
  const trace: AuditCall[] = turn.flatMap((m) => m.trace ?? []).map((t) => ({
    name: t.name,
    input: t.input,
    outcomeSummary: t.outcomeSummary ?? "",
    failed: t.failed,
  }));

  const lastAssistant = [...turn].reverse().find((m) => m.role === "assistant");
  const reply = (typeof lastAssistant?.text === "string" ? lastAssistant.text : "").trim();

  if (panelError && /HTTP 429|rate limit/i.test(panelError)) {
    throw new Error(`gateway rate limit: ${panelError}`);
  }

  const entry: DemoPromptRecord = {
    test: test.info().title,
    prompt,
    model: opts.model ?? process.env.DEMO_MODEL ?? "sonnet",
    trace,
    reply,
    error: panelError,
    ms: elapsedMs,
  };

  await record(entry);
  return { trace, reply, error: panelError };
}

export async function record(entry: DemoPromptRecord): Promise<void> {
  await fs.mkdir(path.dirname(PROMPTS_LOG), { recursive: true });
  await fs.appendFile(PROMPTS_LOG, JSON.stringify(entry) + "\n", "utf8");
  await test.info().attach("demo-prompt", {
    body: JSON.stringify(entry, null, 2),
    contentType: "application/json",
  });
}

export function expectCall(
  trace: AuditCall[],
  name: string,
  argsMatch?: Record<string, unknown> | ((input: unknown) => boolean),
): void {
  const calls = trace.filter((t) => t.name === name);
  const calledSummary = trace.length > 0
    ? trace.map((t) => `${t.name}(${JSON.stringify(t.input)})`).join(", ")
    : "none";
  if (calls.length === 0) {
    throw new Error(`expected a ${name} call; the model called: ${calledSummary}`);
  }
  if (argsMatch) {
    const matches = typeof argsMatch === "function"
      ? calls.some((c) => argsMatch(c.input))
      : calls.some((c) => {
          if (typeof c.input !== "object" || c.input === null) return false;
          const inputRec = c.input as Record<string, unknown>;
          return Object.entries(argsMatch).every(([k, v]) => inputRec[k] === v);
        });
    if (!matches) {
      const inputsSummary = calls.map((c) => JSON.stringify(c.input)).join(", ");
      throw new Error(`${name} was called, but its inputs were: ${inputsSummary}`);
    }
  }
}

export function expectOrder(trace: AuditCall[], names: string[]): void {
  let prevIndex = -1;
  let prevName = "";
  for (const name of names) {
    const idx = trace.findIndex((t, i) => i > prevIndex && t.name === name);
    if (idx === -1) {
      const calledSummary = trace.map((t) => t.name).join(", ");
      throw new Error(`expected ${name} in trace, but it was not called (called: ${calledSummary})`);
    }
    if (idx <= prevIndex) {
      throw new Error(`expected ${name} (index ${idx}) after ${prevName} (index ${prevIndex})`);
    }
    prevIndex = idx;
    prevName = name;
  }
}

export function expectNoCall(trace: AuditCall[], name: string): void {
  const calls = trace.filter((t) => t.name === name);
  if (calls.length > 0) {
    const inputsSummary = calls.map((c) => JSON.stringify(c.input)).join(", ");
    throw new Error(`expected no ${name} call; the model called: ${inputsSummary}`);
  }
}
