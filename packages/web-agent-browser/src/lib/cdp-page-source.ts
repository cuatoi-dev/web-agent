// 131/001 — the two functions the side panel runs inside the page through the
// Chrome debugger, as SOURCE TEXT.
//
// Each one is self-contained: every helper it uses is declared inside its own
// body and it reads no module-level name, so `.toString()` is still valid
// JavaScript after webpack's production minifier has renamed everything
// (probed 2026-09-19). `Runtime.callFunctionOn` takes the string as
// `functionDeclaration`; `Runtime.evaluate` takes it wrapped in parentheses.
//
// `describeValue` (src/core/run-eval.ts) and `runPageFetch`
// (src/core/run-fetch.ts) stay where they are, for the in-page bubble.
// `cdp-page-source.test.ts` asserts these two produce the same output for the
// same input, so the panel's text and the bubble's cannot drift apart.

/** `describeValue` with `this` as the value. Runs in the visited page. */
export function pageDescribeValue(this: unknown): { kind: string; text: string } {
  const isRecord = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null;
  const safeJson = (input: unknown): string => {
    const seen = new WeakSet<object>();
    const out = JSON.stringify(
      input,
      (_key: string, v: unknown) => {
        if (typeof v === "bigint") return `${String(v)}n`;
        if (typeof v === "symbol") return String(v);
        if (typeof v === "function") return `[Function: ${(v as (...args: unknown[]) => unknown).name || "anonymous"}]`;
        if (v && typeof v === "object") {
          if (isRecord(v) && typeof v.nodeType === "number") {
            return `[${(v.constructor as { name?: string } | undefined)?.name || "Node"}]`;
          }
          if (seen.has(v)) return "[Circular]";
          seen.add(v);
        }
        return v;
      },
      2,
    );
    return out === undefined ? String(input) : out;
  };

  function describe(value: unknown): { kind: string; text: string } {
    if (value === undefined) return { kind: "undefined", text: "undefined" };
    if (value === null) return { kind: "null", text: "null" };
    if (typeof value === "string") return { kind: "string", text: value };
    if (typeof value === "number" || typeof value === "boolean") {
      return { kind: typeof value, text: String(value) };
    }
    if (typeof value === "bigint") return { kind: "bigint", text: `${String(value)}n` };
    if (typeof value === "symbol") return { kind: "symbol", text: String(value) };
    if (typeof value === "function") {
      const name = (value as (...args: unknown[]) => unknown).name || "anonymous";
      return { kind: "function", text: `[Function: ${name}]` };
    }

    const rec = isRecord(value) ? value : {};
    const ctor = (rec.constructor as { name?: string } | undefined)?.name || "Object";
    if (typeof rec.nodeType === "number") {
      const outer = typeof rec.outerHTML === "string" ? rec.outerHTML : "";
      const head = outer ? outer.slice(0, 300) : (typeof rec.nodeValue === "string" ? rec.nodeValue : "");
      return { kind: ctor, text: `[${ctor}] ${head}` };
    }
    if (value instanceof Error) {
      return { kind: value.name || "Error", text: `${value.name}: ${value.message}` };
    }
    if (value instanceof Map) {
      return { kind: `Map(${value.size})`, text: safeJson(Array.from(value.entries())) };
    }
    if (value instanceof Set) {
      return { kind: `Set(${value.size})`, text: safeJson(Array.from(value.values())) };
    }
    const kind = Array.isArray(value) ? `Array(${(value as unknown[]).length})` : ctor;
    const json = safeJson(value);
    if (json === "{}" && Object.keys(value).length === 0) {
      const names = Object.getOwnPropertyNames(value);
      const props = names.length ? names.join(", ") : "(none)";
      return { kind, text: `[${kind}] no enumerable properties; own property names: ${props}` };
    }
    return { kind, text: json };
  }

  return describe(this);
}

/** `runPageFetch` with no seams: it always uses the page's own `fetch` and
 *  `location.origin`, which is what the side panel wants. Runs in the page. */
export async function pageRunFetch(args: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}): Promise<Record<string, unknown>> {
  const errorMessage = (err: unknown): string => {
    if (err instanceof Error) return err.message || String(err);
    if (typeof err === "object" && err !== null && "message" in err) {
      const m = (err as { message?: unknown }).message;
      if (typeof m === "string" && m) return m;
    }
    return String(err);
  };
  const thrownName = (err: unknown): string => {
    if (err instanceof Error) return err.name;
    if (typeof err === "object" && err !== null && typeof (err as { name?: unknown }).name === "string") {
      return (err as { name: string }).name;
    }
    return "Error";
  };

  const origin = location.origin;
  const rawUrl = typeof args.url === "string" ? args.url.trim() : "";
  if (!rawUrl) {
    return { kind: "invalid-url", url: "", message: "No URL or path provided to page_fetch." };
  }
  let targetUrl: URL;
  try {
    targetUrl = new URL(rawUrl, origin);
  } catch (e) {
    return { kind: "invalid-url", url: rawUrl, message: `Invalid URL "${rawUrl}": ${errorMessage(e)}` };
  }
  if (targetUrl.origin !== origin) {
    return { kind: "cross-origin", requested: targetUrl.origin, pageOrigin: origin };
  }
  try {
    const res = await fetch(targetUrl.href, {
      method: typeof args.method === "string" && args.method ? args.method : "GET",
      headers: args.headers,
      body: args.body,
      credentials: "same-origin",
    });
    return {
      kind: "response",
      status: res.status,
      statusText: res.statusText || "",
      contentType: res.headers.get("content-type") || "(unknown)",
      body: await res.text(),
    };
  } catch (err) {
    return { kind: "throw", name: thrownName(err), message: errorMessage(err), url: targetUrl.href };
  }
}

/** For `Runtime.callFunctionOn`'s `functionDeclaration`. */
export const PAGE_DESCRIBE_SOURCE = pageDescribeValue.toString();

/** Wrap in parentheses and call it for `Runtime.evaluate`'s `expression`. */
export const PAGE_FETCH_SOURCE = pageRunFetch.toString();
