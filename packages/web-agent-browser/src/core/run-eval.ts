import { errorMessage } from "../lib/error-message";
import type { DescribedValue, EvalResult } from "./types";

export type { DescribedValue, EvalResult } from "./types";

// `errorMessage` is the one import this module takes from `src/lib/`. It reads
// a message off a thrown value and touches nothing else — no chrome, no
// transport — so it does not break the rule this directory exists to hold.

/** True when `value` is a plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The page realm's own async-function constructor. Built from a literal
 *  `async function` so no bundler transform can replace it. Constructing one
 *  is what a CSP without 'unsafe-eval' refuses — see `runInPageRealm` below. */
const asyncFunctionProto: unknown = Object.getPrototypeOf(async function () {});
const AsyncFunction = (isRecord(asyncFunctionProto) ? asyncFunctionProto.constructor : undefined) as {
  new (body: string): () => Promise<unknown>;
};

export function describeValue(value: unknown): DescribedValue {
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

  // A DOM node: never JSON-serializable, always worth describing.
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
  // An object with nothing enumerable serializes to "{}" and tells the model
  // nothing. Describe it instead — the acceptance criteria forbid a bare "{}".
  if (json === "{}" && Object.keys(value).length === 0) {
    const names = Object.getOwnPropertyNames(value);
    const props = names.length ? names.join(", ") : "(none)";
    return { kind, text: `[${kind}] no enumerable properties; own property names: ${props}` };
  }
  return { kind, text: json };
}

/** JSON with the browser-realm cases JSON.stringify cannot express, and a
 *  seen-set so a circular structure comes back marked instead of throwing. */
export function safeJson(value: unknown): string {
  const seen = new WeakSet<object>();
  const out = JSON.stringify(
    value,
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
  return out === undefined ? String(value) : out;
}

/** A CSP refusal, not the page's own error. The event is the strong signal;
 *  the message test covers a browser that reports no event. */
function isCspRefusal(message: string, violation: { effectiveDirective?: string } | null): boolean {
  if (violation) return true;
  return /content security policy/i.test(message) || /unsafe-eval/i.test(message);
}

/** Used by both `page_eval` and `page_fetch` (run-fetch.ts:56), so both page
 *  tools truncate identically and the marker is always visible. */
export function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? text.slice(0, maxChars - 22) + "\n…(output truncated)" : text;
}

/** The name to report for a thrown value. Same three-branch narrowing the tool
 *  used to do inline in `src/lib/page-eval-tool.ts`. */
export function thrownName(err: unknown): string {
  if (err instanceof Error) return err.name;
  if (isRecord(err) && typeof err.name === "string") return err.name;
  return "Error";
}

/**
 * Run `code` as the body of an async function in THIS realm and report what
 * happened. Returns a shape, never a message: the in-page bubble and the side
 * panel need different wording for the same CSP refusal.
 *
 * `runner` is the test seam. Its default is the page realm's own
 * `AsyncFunction`, which is the whole point of the tool: constructing one is
 * exactly what a CSP without 'unsafe-eval' refuses.
 */
export async function runInPageRealm(
  code: string,
  runner: (code: string) => Promise<unknown> = (c) => new AsyncFunction(c)(),
): Promise<EvalResult> {
  // Registered before the run: the browser reports a CSP refusal as an event
  // on `document`, and only that event carries the whole policy. Held in a
  // wrapper object (not a plain `let`) so a later read outside the listener
  // does not get narrowed to the declaration-time type.
  const violationBox: { current: { originalPolicy?: string; effectiveDirective?: string } | null } = {
    current: null,
  };
  const onViolation = (e: SecurityPolicyViolationEvent) => {
    if (e.blockedURI === "eval") {
      violationBox.current = { originalPolicy: e.originalPolicy, effectiveDirective: e.effectiveDirective };
    }
  };
  const doc = typeof document !== "undefined" ? document : undefined;
  doc?.addEventListener("securitypolicyviolation", onViolation);

  try {
    return { kind: "value", value: await runner(code) };
  } catch (err) {
    // The violation event lands after this catch but before the next
    // macrotask (measured 2026-08-31). One tick, on the error path only.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const message = errorMessage(err);
    const violation = violationBox.current;
    if (isCspRefusal(message, violation)) {
      return {
        kind: "csp",
        policy: violation?.originalPolicy ?? "(the browser did not report the policy text)",
        message,
      };
    }
    return { kind: "throw", name: thrownName(err), message };
  } finally {
    doc?.removeEventListener("securitypolicyviolation", onViolation);
  }
}
