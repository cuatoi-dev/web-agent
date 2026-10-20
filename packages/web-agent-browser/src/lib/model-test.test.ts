// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import {
  mountRowTest,
  runTest,
  testModel,
  testResultLine,
} from "./model-test";
import type { ResolvedProvider } from "./types";
import { PERMISSION_DENIED_ERROR } from "./provider-form-rules";
import { UNREACHABLE_ENDPOINT_ERROR } from "./refresh-models-dialog";

const openai = (text: string) => ({
  id: "x",
  object: "chat.completion",
  created: 0,
  model: "m1",
  choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
});
const anthropic = (text: string) => ({
  id: "m",
  type: "message",
  role: "assistant",
  model: "m1",
  content: [{ type: "text", text }],
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: { input_tokens: 1, output_tokens: 1 },
});
const gemini = (text: string) => ({
  candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }],
  usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
});
const ok = (body: unknown) => vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
const fail = (status: number, body: string, statusText = "") =>
  vi.fn().mockResolvedValue(new Response(body, { status, statusText }));
const tick = () => new Promise<void>((r) => setTimeout(r, 0));
const provider = (over: Partial<ResolvedProvider> = {}): ResolvedProvider => ({
  id: "",
  kind: "custom",
  name: "",
  endpoint: "http://h/v1",
  wireFormat: "openai",
  apiKey: "k",
  headers: [],
  ...over,
});
const sent = (f: ReturnType<typeof vi.fn>) => ({
  url: String(f.mock.calls[0][0]),
  headers: new Headers((f.mock.calls[0][1] as RequestInit).headers),
  body: JSON.parse(((f.mock.calls[0][1] as RequestInit).body as string) ?? "null") as Record<string, unknown>,
});

describe("testModel", () => {
  it("T1: openai ok. -> pass with request shape verified", async () => {
    const fetchImpl = ok(openai("ok."));
    const res = await testModel(provider(), "m1", { fetchImpl });
    expect(res).toMatchObject({ ok: true, kind: "pass" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const { url, headers, body } = sent(fetchImpl);
    expect(url).toBe("http://h/v1/chat/completions");
    expect(body.model).toBe("m1");
    expect(body.max_tokens).toBe(256);
    expect(body.stream).toBe(false);
    expect(body.messages).toEqual([{ role: "user", content: "Reply with OK" }]);
    expect(body.tools).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("image");
    expect(headers.get("authorization")).toBe("Bearer k");
  });

  it.each([
    ["OK", true, "pass"],
    ["ok.", true, "pass"],
    ["Ok!", true, "pass"],
    ["Okay, done", false, "noOk"],
    ["token", false, "noOk"],
  ])("T2: handles reply %s -> ok=%s kind=%s", async (reply, expectedOk, expectedKind) => {
    const fetchImpl = ok(openai(reply));
    const res = await testModel(provider(), "m1", { fetchImpl });
    expect(res.ok).toBe(expectedOk);
    expect(res.kind).toBe(expectedKind);
    if (expectedKind === "noOk") {
      expect(res.reply).toBe(reply);
    }
  });

  it("T3: anthropic request format and headers", async () => {
    const fetchImpl = ok(anthropic("OK"));
    const res = await testModel(provider({ endpoint: "http://h", wireFormat: "anthropic" }), "m1", { fetchImpl });
    expect(res.ok).toBe(true);
    expect(res.kind).toBe("pass");
    const { url, headers, body } = sent(fetchImpl);
    expect(url).toBe("http://h/v1/messages");
    expect(body.max_tokens).toBe(256);
    expect(body.tools).toBeUndefined();
    expect(JSON.stringify(body.messages)).toContain("Reply with OK");
    expect(headers.get("x-api-key")).toBe("k");
    expect(headers.get("anthropic-version")).toBe("2023-06-01");
  });

  it("T4: gemini request format and headers", async () => {
    const fetchImpl = ok(gemini("OK"));
    const res = await testModel(provider({ endpoint: "http://h", wireFormat: "gemini" }), "m1", { fetchImpl });
    expect(res.ok).toBe(true);
    expect(res.kind).toBe("pass");
    const { url, headers, body } = sent(fetchImpl);
    expect(url).toBe("http://h/v1beta/models/m1:generateContent");
    expect(body.generationConfig.maxOutputTokens).toBe(256);
    expect(body.tools).toBeUndefined();
    expect(headers.get("x-goog-api-key")).toBe("k");
  });

  it("T5: custom headers win", async () => {
    const fetchImpl = ok(openai("ok."));
    await testModel(provider({ headers: [{ name: "authorization", value: "Custom" }] }), "m1", { fetchImpl });
    const { headers } = sent(fetchImpl);
    expect(headers.get("authorization")).toBe("Custom");
  });

  it("T6: 401 with status text -> auth", async () => {
    const fetchImpl = fail(401, "{}", "Unauthorized");
    const res = await testModel(provider(), "m1", { fetchImpl });
    expect(res).toMatchObject({ kind: "auth", status: 401, statusText: "Unauthorized" });
  });

  it("T7: empty status text fallback for 401 and 403", async () => {
    const fetchImpl401 = fail(401, "{}");
    const res401 = await testModel(provider(), "m1", { fetchImpl: fetchImpl401 });
    expect(res401).toMatchObject({ kind: "auth", status: 401, statusText: "Unauthorized" });
    const fetchImpl403 = fail(403, "{}");
    const res403 = await testModel(provider(), "m1", { fetchImpl: fetchImpl403 });
    expect(res403).toMatchObject({ kind: "auth", status: 403, statusText: "Forbidden" });
  });

  it("T8: 404 -> notfound", async () => {
    const fetchImpl = fail(404, "{}");
    const res = await testModel(provider(), "m1", { fetchImpl });
    expect(res).toMatchObject({ kind: "notfound", status: 404 });
  });

  it("T9: 500 with json error message -> http with parsed message", async () => {
    const fetchImpl = fail(500, '{"error":{"message":"boom"}}');
    const res = await testModel(provider(), "m1", { fetchImpl });
    expect(res).toMatchObject({ kind: "http", status: 500, statusText: "Internal Server Error", message: "boom" });
  });

  it("T10: 502 with html body slice", async () => {
    const htmlLong = "<html>" + "x".repeat(200);
    const fetchImplLong = fail(502, htmlLong);
    const resLong = await testModel(provider(), "m1", { fetchImpl: fetchImplLong });
    expect(resLong.message).toBe(htmlLong.slice(0, 120) + "…");

    const html120 = "x".repeat(120);
    const fetchImpl120 = fail(502, html120);
    const res120 = await testModel(provider(), "m1", { fetchImpl: fetchImpl120 });
    expect(res120.message).toBe(html120);
  });

  it("T11: 418 unknown status text -> statusText empty string", async () => {
    const fetchImpl = fail(418, "teapot");
    const res = await testModel(provider(), "m1", { fetchImpl });
    expect(res).toMatchObject({ kind: "http", statusText: "", message: "teapot" });
  });

  it("T12: fetch throwing -> network", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    const res = await testModel(provider(), "m1", { fetchImpl });
    expect(res.kind).toBe("network");
  });

  it("T13: 200 non-json -> network", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("not json", { status: 200 }));
    const res = await testModel(provider(), "m1", { fetchImpl });
    expect(res.kind).toBe("network");
  });

  it("T14: timeout after 30s with exactly one request", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn(() => new Promise<Response>(() => {}));
      let settled = false;
      const p = testModel(provider(), "m1", { fetchImpl }).then((r) => {
        settled = true;
        return r;
      });
      await vi.advanceTimersByTimeAsync(29_999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const res = await p;
      expect(res.kind).toBe("timeout");
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("T15: deps.now returns custom timing", async () => {
    let call = 0;
    const now = vi.fn(() => {
      call++;
      return call === 1 ? 1000 : 1840;
    });
    const fetchImpl = ok(openai("ok."));
    const res = await testModel(provider(), "m1", { fetchImpl, now });
    expect(res.ms).toBe(840);
  });
});

describe("testResultLine", () => {
  it("L1: pass format for <1s and >=1s", () => {
    const r1 = testResultLine({ ok: true, kind: "pass", ms: 840 });
    expect(r1).toEqual({ ok: true, text: "✓ OK · 840 ms" });
    const r2 = testResultLine({ ok: true, kind: "pass", ms: 1234 });
    expect(r2).toEqual({ ok: true, text: "✓ OK · 1.2 s" });
  });

  it("L2: auth format with and without statusText", () => {
    const r1 = testResultLine({ ok: false, kind: "auth", status: 401, statusText: "Unauthorized", ms: 10 });
    expect(r1).toEqual({ ok: false, text: "✗ 401 Unauthorized. Check the API key." });
    const r2 = testResultLine({ ok: false, kind: "auth", status: 401, statusText: "", ms: 10 });
    expect(r2).toEqual({ ok: false, text: "✗ 401. Check the API key." });
  });

  it("L3: notfound format", () => {
    const r = testResultLine({ ok: false, kind: "notfound", status: 404, ms: 10 });
    expect(r).toEqual({ ok: false, text: "✗ 404 Not Found. Check the model ID." });
  });

  it("L4: http format with and without statusText", () => {
    const r1 = testResultLine({ ok: false, kind: "http", status: 500, statusText: "Internal Server Error", message: "boom", ms: 10 });
    expect(r1).toEqual({ ok: false, text: "✗ 500 Internal Server Error: boom" });
    const r2 = testResultLine({ ok: false, kind: "http", status: 418, statusText: "", message: "teapot", ms: 10 });
    expect(r2).toEqual({ ok: false, text: "✗ 418: teapot" });
  });

  it("L5: noOk formats reply prefix", () => {
    const reply = "x".repeat(60);
    const r = testResultLine({ ok: false, kind: "noOk", reply, ms: 10 });
    expect(r).toEqual({ ok: false, text: `✗ The reply did not contain OK: "${reply.slice(0, 40)}…"` });
  });

  it("L6: denied, network, and timeout formats", () => {
    expect(testResultLine({ ok: false, kind: "denied", ms: 0 })).toEqual({
      ok: false,
      text: `✗ ${PERMISSION_DENIED_ERROR}`,
    });
    expect(testResultLine({ ok: false, kind: "network", ms: 0 })).toEqual({
      ok: false,
      text: `✗ ${UNREACHABLE_ENDPOINT_ERROR}`,
    });
    expect(testResultLine({ ok: false, kind: "timeout", ms: 30000 })).toEqual({
      ok: false,
      text: "✗ No answer after 30 s.",
    });
  });

  it("L7: ok is false for every kind except pass", () => {
    const kinds = ["auth", "notfound", "http", "noOk", "denied", "network", "timeout"] as const;
    for (const kind of kinds) {
      expect(testResultLine({ ok: false, kind, ms: 0 }).ok).toBe(false);
    }
  });
});

describe("runTest", () => {
  it("R1: denied permission shows denied line and does not call fetch", async () => {
    const button = document.createElement("button");
    const resultEl = document.createElement("p");
    const row = { generation: 0 };
    const fetchImpl = vi.fn();
    const requestPermission = vi.fn().mockResolvedValue(false);

    await runTest(button, resultEl, row, () => provider(), "m1", { fetchImpl, requestPermission });

    expect(resultEl.textContent).toBe(`✗ ${PERMISSION_DENIED_ERROR}`);
    expect(resultEl.classList.contains("fail")).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(button.disabled).toBe(false);
  });

  it("R2: bad endpoint shows unreachable and does not request permission", async () => {
    const button = document.createElement("button");
    const resultEl = document.createElement("p");
    const row = { generation: 0 };
    const requestPermission = vi.fn();

    await runTest(button, resultEl, row, () => provider({ endpoint: "ftp://x" }), "m1", { requestPermission });

    expect(resultEl.textContent).toBe(`✗ ${UNREACHABLE_ENDPOINT_ERROR}`);
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("R3: gesture - requestPermission is invoked immediately", () => {
    const button = document.createElement("button");
    const resultEl = document.createElement("p");
    const row = { generation: 0 };
    const requestPermission = vi.fn().mockReturnValue(new Promise(() => {}));

    void runTest(button, resultEl, row, () => provider({ endpoint: "http://h/v1" }), "m1", { requestPermission });
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(requestPermission).toHaveBeenCalledWith("http://h/*");
  });

  it("R4: running state displays spinner and restores afterwards", async () => {
    const button = document.createElement("button");
    const resultEl = document.createElement("p");
    const row = { generation: 0 };
    let resolveFetch!: (res: Response) => void;
    const fetchImpl = vi.fn(() => new Promise<Response>((r) => { resolveFetch = r; }));
    const requestPermission = vi.fn().mockResolvedValue(true);

    const testPromise = runTest(button, resultEl, row, () => provider(), "m1", { fetchImpl, requestPermission });
    await tick();

    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-label")).toBe("Testing key and model");
    expect(button.title).toBe("Testing key and model");
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.querySelector(".test-spinner")).not.toBeNull();
    expect(button.querySelector("svg")).toBeNull();
    expect(document.body.textContent).not.toContain("Testing…");

    resolveFetch(new Response(JSON.stringify(openai("OK")), { status: 200 }));
    await testPromise;

    expect(button.disabled).toBe(false);
    expect(button.getAttribute("aria-label")).toBe("Test key and model");
    expect(button.querySelector("svg")).not.toBeNull();
    expect(button.hasAttribute("aria-busy")).toBe(false);
    expect(resultEl.textContent).toMatch(/^✓ OK · /);
    expect(resultEl.classList.contains("ok")).toBe(true);
  });

  it("R5: stale result is dropped when generation changes", async () => {
    const button = document.createElement("button");
    const resultEl = document.createElement("p");
    resultEl.hidden = true;
    const row = { generation: 0 };
    let resolveFetch!: (res: Response) => void;
    const fetchImpl = vi.fn(() => new Promise<Response>((r) => { resolveFetch = r; }));
    const requestPermission = vi.fn().mockResolvedValue(true);

    const testPromise = runTest(button, resultEl, row, () => provider(), "m1", { fetchImpl, requestPermission });
    await tick();

    row.generation++;
    resolveFetch(new Response(JSON.stringify(openai("OK")), { status: 200 }));
    await testPromise;

    expect(resultEl.hidden).toBe(true);
    expect(resultEl.textContent).toBe("");
    expect(button.disabled).toBe(false);
    expect(button.querySelector("svg")).not.toBeNull();
  });
});

describe("mountRowTest", () => {
  it("W1: empty ID disables button and typing enables it", () => {
    const row = document.createElement("div");
    row.className = "form-model-row";
    const idInput = document.createElement("input");
    idInput.value = "";
    const ctx = {
      getProvider: () => provider(),
      deps: {},
    };

    const { button } = mountRowTest(row, idInput, ctx);
    expect(button.disabled).toBe(true);
    expect(button.title).toBe("Enter a model ID first");
    expect(button.getAttribute("aria-label")).toBe("Test key and model");

    idInput.value = "m1";
    idInput.dispatchEvent(new Event("input"));
    expect(button.disabled).toBe(false);
    expect(button.title).toBe("Test key and model");
  });

  it("W2: ID input event clears result and bumps generation", async () => {
    const row = document.createElement("div");
    row.className = "form-model-row";
    const idInput = document.createElement("input");
    idInput.value = "m1";
    let resolveFetch!: (res: Response) => void;
    const fetchImpl = vi.fn(() => new Promise<Response>((r) => { resolveFetch = r; }));
    const requestPermission = vi.fn().mockResolvedValue(true);
    const ctx = {
      getProvider: () => provider(),
      deps: { fetchImpl, requestPermission },
    };

    const { button, result } = mountRowTest(row, idInput, ctx);
    button.click();
    await tick();

    // While test is pending, user edits input
    idInput.value = "m2";
    idInput.dispatchEvent(new Event("input"));

    resolveFetch(new Response(JSON.stringify(openai("OK")), { status: 200 }));
    await tick();

    expect(result.hidden).toBe(true);
    expect(result.textContent).toBe("");
  });

  it("W3: emptying ID while test runs leaves button disabled after completion", async () => {
    const row = document.createElement("div");
    row.className = "form-model-row";
    const idInput = document.createElement("input");
    idInput.value = "m1";
    let resolveFetch!: (res: Response) => void;
    const fetchImpl = vi.fn(() => new Promise<Response>((r) => { resolveFetch = r; }));
    const requestPermission = vi.fn().mockResolvedValue(true);
    const ctx = {
      getProvider: () => provider(),
      deps: { fetchImpl, requestPermission },
    };

    const { button } = mountRowTest(row, idInput, ctx);
    expect(button.disabled).toBe(false);

    button.click();
    await tick();

    idInput.value = "";
    resolveFetch(new Response(JSON.stringify(openai("OK")), { status: 200 }));
    await tick();

    expect(button.disabled).toBe(true);
    expect(button.title).toBe("Enter a model ID first");
  });
});

describe("runTest onResult (138/002)", () => {
  const setup = () => {
    const button = document.createElement("button");
    const resultEl = document.createElement("p");
    resultEl.hidden = true;
    return { button, resultEl, row: { generation: 0 } };
  };

  it("C1: reports the shown line once for pass and auth failure", async () => {
    for (const [fetchImpl, cls] of [
      [ok(openai("OK")), "ok"],
      [fail(401, "bad", "Unauthorized"), "fail"],
    ] as const) {
      const { button, resultEl, row } = setup();
      const seen: Array<{ text: string; shown: string; cls: boolean; hidden: boolean }> = [];
      await runTest(button, resultEl, row, () => provider(), "m1",
        { fetchImpl, requestPermission: vi.fn().mockResolvedValue(true) },
        (line) => {
          seen.push({ text: line.text, shown: resultEl.textContent ?? "", cls: resultEl.classList.contains(cls), hidden: resultEl.hidden });
        });
      expect(seen.length).toBe(1);
      expect(seen[0].shown).toBe(seen[0].text);
      expect(seen[0].cls).toBe(true);
      expect(seen[0].hidden).toBe(false);
    }
  });

  it("C2: reports denied permission and a bad endpoint without calling fetch", async () => {
    const fetchImpl = vi.fn();
    const denied = vi.fn();
    const a = setup();
    await runTest(a.button, a.resultEl, a.row, () => provider(), "m1",
      { fetchImpl, requestPermission: vi.fn().mockResolvedValue(false) }, denied);
    expect(denied).toHaveBeenCalledTimes(1);
    expect(denied.mock.calls[0][0].text).toBe(a.resultEl.textContent);

    const bad = vi.fn();
    const b = setup();
    await runTest(b.button, b.resultEl, b.row, () => provider({ endpoint: "ftp://x" }), "m1",
      { fetchImpl, requestPermission: vi.fn() }, bad);
    expect(bad).toHaveBeenCalledTimes(1);
    expect(bad.mock.calls[0][0].text).toBe(b.resultEl.textContent);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("C3: a stale generation emits nothing; clearing the result emits nothing", async () => {
    const { button, resultEl, row } = setup();
    let resolveFetch!: (res: Response) => void;
    const fetchImpl = vi.fn(() => new Promise<Response>((r) => { resolveFetch = r; }));
    const onResult = vi.fn();
    const p = runTest(button, resultEl, row, () => provider(), "m1",
      { fetchImpl, requestPermission: vi.fn().mockResolvedValue(true) }, onResult);
    await tick();
    expect(onResult).not.toHaveBeenCalled();
    row.generation++;
    resolveFetch(new Response(JSON.stringify(openai("OK")), { status: 200 }));
    await p;
    expect(onResult).not.toHaveBeenCalled();
    expect(resultEl.textContent).toBe("");
  });

  it("C4: a detached result element still emits its result", async () => {
    const { button, resultEl, row } = setup();
    const host = document.createElement("div");
    host.append(button, resultEl);
    document.body.append(host);
    const onResult = vi.fn();
    const p = runTest(button, resultEl, row, () => provider(), "m1",
      { fetchImpl: ok(openai("OK")), requestPermission: vi.fn().mockResolvedValue(true) }, onResult);
    host.remove();
    await p;
    expect(onResult).toHaveBeenCalledTimes(1);
  });

  it("C5: a call without the callback still completes", async () => {
    const { button, resultEl, row } = setup();
    await runTest(button, resultEl, row, () => provider(), "m1",
      { fetchImpl: ok(openai("OK")), requestPermission: vi.fn().mockResolvedValue(true) });
    expect(resultEl.textContent).toMatch(/^✓ OK · /);
  });
});
