import {
  createAnthropicLanguageModel,
  createGeminiLanguageModel,
  createOpenAILanguageModel,
  DEFAULT_CONFIG,
  type AgentConfig,
  type LanguageModel,
} from "@cuatoi/web-agent-core";
import { iconNode } from "@cuatoi/web-agent-lit/ui/icon-svgs";
import { authHeaders } from "./auth-headers";
import { originPattern } from "./origin";
import { PERMISSION_DENIED_ERROR } from "./provider-form-rules";
import { UNREACHABLE_ENDPOINT_ERROR } from "./refresh-models-dialog";
import type { ResolvedProvider } from "./types";
import type {
  ModelTestDeps,
  ResultLine,
  RowTestContext,
  RowTestState,
  RunTestDeps,
  TestResult,
} from "./model-test.types";

const TIMEOUT_MS = 30_000;
const MAX_OUTPUT_TOKENS = 256;
const PROMPT = "Reply with OK";
const TEST_LABEL = "Test key and model";
const RUNNING_LABEL = "Testing key and model";
const EMPTY_ID_TITLE = "Enter a model ID first";

/** Reason phrases for statuses whose answer may come over HTTP/2, which has
 *  none, so the browser reports statusText "" (api.deepseek.com and
 *  opencode.ai, curl 2026-10-20). */
const REASON: Record<number, string> = {
  400: "Bad Request", 401: "Unauthorized", 402: "Payment Required",
  403: "Forbidden", 404: "Not Found", 408: "Request Timeout",
  409: "Conflict", 413: "Payload Too Large", 422: "Unprocessable Entity",
  429: "Too Many Requests", 500: "Internal Server Error",
  502: "Bad Gateway", 503: "Service Unavailable", 504: "Gateway Timeout",
};

function statusTextFor(res: Response): string {
  if (res.statusText !== "") return res.statusText;
  return REASON[res.status] ?? "";
}

/** Sends one "Reply with OK" request to `modelId` at `provider` and says what
 *  happened. One request, no retry, 30 s limit, 256 output tokens, text only. */
export async function testModel(
  provider: ResolvedProvider,
  modelId: string,
  deps: ModelTestDeps = {},
): Promise<TestResult> {
  const fetchImpl = deps.fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const now = deps.now ?? (() => performance.now());
  let recorded: { status: number; statusText: string; body: string | null } | null = null;
  const fetchFn: typeof fetch = async (input, init) => {
    const headers = new Headers(init?.headers);
    // Custom headers win (authHeaders puts them last).
    for (const [name, value] of Object.entries(authHeaders(provider))) headers.set(name, value);
    const res = await fetchImpl(input, { ...init, headers }); // a throw propagates
    recorded = {
      status: res.status,
      statusText: statusTextFor(res),
      body: res.ok ? null : await res.clone().text(),
    };
    return res;
  };

  const id = modelId.trim();
  const cfg: AgentConfig = {
    ...DEFAULT_CONFIG,
    endpointType: provider.wireFormat,
    baseURL: provider.endpoint.trim(),
    model: id,
  };
  const model: LanguageModel =
    provider.wireFormat === "openai"
      ? createOpenAILanguageModel(cfg, { fetch: fetchFn })
      : provider.wireFormat === "anthropic"
        ? createAnthropicLanguageModel(cfg, { fetch: fetchFn })
        : createGeminiLanguageModel(cfg, { fetch: fetchFn });

  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, TIMEOUT_MS);
  const t0 = now();
  try {
    const result = await model.generate({
      model: id,
      messages: [{ role: "user", content: PROMPT }],
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      abortSignal: ctrl.signal,
    });
    const reply = result.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const ms = now() - t0;
    if (/\bok\b/i.test(reply)) return { ok: true, kind: "pass", ms };
    return { ok: false, kind: "noOk", reply, ms };
  } catch {
    const ms = now() - t0;
    if (timedOut) return { ok: false, kind: "timeout", ms };
    const rec = recorded as { status: number; statusText: string; body: string | null } | null;
    if (rec !== null && (rec.status < 200 || rec.status > 299)) {
      const s = rec.status;
      if (s === 401 || s === 403) {
        return { ok: false, kind: "auth", status: s, statusText: rec.statusText, ms };
      }
      if (s === 404) {
        return { ok: false, kind: "notfound", status: 404, ms };
      }
      const body = rec.body ?? "";
      let message = "";
      try {
        const parsed: unknown = JSON.parse(body);
        if (typeof parsed === "object" && parsed !== null && "error" in parsed) {
          const err = parsed.error;
          if (typeof err === "object" && err !== null && "message" in err) {
            const msg = err.message;
            if (typeof msg === "string" && msg !== "") {
              message = msg;
            }
          }
        }
      } catch {
        // Not JSON
      }
      if (message === "") {
        message = body.slice(0, 120) + (body.length > 120 ? "…" : "");
      }
      return { ok: false, kind: "http", status: s, statusText: rec.statusText, message, ms };
    }
    return { ok: false, kind: "network", ms };
  } finally {
    clearTimeout(timer);
  }
}

/** Formats `TestResult` into a result line and status indicator. */
export function testResultLine(r: TestResult): ResultLine {
  const s = r.statusText ? `${r.status} ${r.statusText}` : `${r.status}`;
  switch (r.kind) {
    case "pass": {
      const timeStr = r.ms < 1000 ? `${Math.round(r.ms)} ms` : `${(r.ms / 1000).toFixed(1)} s`;
      return { ok: true, text: `✓ OK · ${timeStr}` };
    }
    case "auth":
      return { ok: false, text: `✗ ${s}. Check the API key.` };
    case "notfound":
      return { ok: false, text: "✗ 404 Not Found. Check the model ID." };
    case "http":
      return { ok: false, text: `✗ ${s}: ${r.message ?? ""}` };
    case "noOk":
      return { ok: false, text: `✗ The reply did not contain OK: "${(r.reply ?? "").slice(0, 40)}…"` };
    case "denied":
      return { ok: false, text: `✗ ${PERMISSION_DENIED_ERROR}` };
    case "network":
      return { ok: false, text: `✗ ${UNREACHABLE_ENDPOINT_ERROR}` };
    case "timeout":
      return { ok: false, text: "✗ No answer after 30 s." };
  }
}

/** Writes `line` into `el`, or clears and hides `el` when `line` is null. */
export function showResult(el: HTMLElement, line: ResultLine | null): void {
  el.classList.remove("ok", "fail");
  if (line === null) {
    el.textContent = "";
    el.hidden = true;
    return;
  }
  el.textContent = line.text;
  el.classList.add(line.ok ? "ok" : "fail");
  el.hidden = false;
}

function flaskIcon(): Element {
  const svg = iconNode("science");
  svg.classList.add("logo");
  svg.setAttribute("aria-hidden", "true");
  return svg;
}

function spinner(): HTMLElement {
  const s = document.createElement("span");
  s.className = "test-spinner";
  s.setAttribute("aria-hidden", "true");
  return s;
}

function setLabel(button: HTMLButtonElement, label: string): void {
  button.setAttribute("aria-label", label);
  button.title = label;
}

/** The Test click handler (138/001). Task 002 reuses it for the table rows. */
export async function runTest(
  button: HTMLButtonElement,
  resultEl: HTMLElement,
  row: RowTestState,
  getProvider: () => ResolvedProvider,
  modelId: string,
  deps: RunTestDeps = {},
): Promise<void> {
  const provider = getProvider();
  const origin = originPattern(provider.endpoint);
  if (origin === null) {
    showResult(resultEl, testResultLine({ ok: false, kind: "network", ms: 0 }));
    return;
  }
  const requestPerm =
    deps.requestPermission ?? ((o: string) => chrome.permissions.request({ origins: [o] }));
  const granted = await requestPerm(origin);
  if (!granted) {
    showResult(resultEl, testResultLine({ ok: false, kind: "denied", ms: 0 }));
    return;
  }
  const gen = ++row.generation;
  showResult(resultEl, null);
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.replaceChildren(spinner());
  setLabel(button, RUNNING_LABEL);
  const r = await testModel(provider, modelId, deps);
  button.replaceChildren(flaskIcon());
  setLabel(button, TEST_LABEL);
  button.removeAttribute("aria-busy");
  button.disabled = false;
  if (gen !== row.generation) return;
  showResult(resultEl, testResultLine(r));
}

/** Row → its test state and result line, so a form-wide edit can clear every row. */
const rows = new WeakMap<HTMLElement, { state: RowTestState; result: HTMLElement }>();

/** Builds a form row's Test button and result line, and wires the row's rules:
 *  disabled with "Enter a model ID first" while the ID is empty; an ID edit
 *  clears this row's result and drops a result still on its way. */
export function mountRowTest(
  row: HTMLElement,
  idInput: HTMLInputElement,
  ctx: RowTestContext,
): { button: HTMLButtonElement; result: HTMLElement } {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn test-model-btn";
  button.append(flaskIcon());
  setLabel(button, TEST_LABEL);
  const result = document.createElement("p");
  result.className = "form-model-result";
  result.hidden = true;
  const state: RowTestState = { generation: 0 };
  rows.set(row, { state, result });

  const refreshDisabled = (): void => {
    const empty = idInput.value.trim() === "";
    button.disabled = empty;
    button.title = empty ? EMPTY_ID_TITLE : TEST_LABEL;
  };
  refreshDisabled();
  button.addEventListener("click", () => {
    // refreshDisabled after the run: runTest re-enables the button, and the
    // ID may have been emptied while the request ran.
    void runTest(button, result, state, ctx.getProvider, idInput.value, ctx.deps).then(refreshDisabled);
  });
  idInput.addEventListener("input", () => {
    showResult(result, null);
    state.generation++;
    refreshDisabled();
  });
  return { button, result };
}

/** Clears every row's result in `list` and drops every result still on its way. */
export function clearRowResults(list: HTMLElement): void {
  for (const row of Array.from(list.querySelectorAll<HTMLElement>(".form-model-row"))) {
    const entry = rows.get(row);
    if (!entry) continue;
    showResult(entry.result, null);
    entry.state.generation++;
  }
}
