import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { describe as helperDescribe, fillPrepare, readValue, setFiles, locator, iframeSelector } from "./helper-api";
import { selectPrepare, selectExecute } from "./helper-api-actions";

// jsdom (as vendored by this vitest version) has no DataTransfer — a
// well-known gap (drag-and-drop / file-input construction is unimplemented).
// setFiles() itself only calls `.items.add(file)` and reads `.files`, so a
// minimal polyfill exercises the REAL production logic; only the browser's
// own DataTransfer implementation is stubbed out. The mock-tier e2e (R9)
// proves this against a real Chromium DataTransfer.
beforeAll(() => {
  // jsdom (as vendored by this vitest version) has no CSS.escape.
  // iframeSelector's own use is limited to plain identifiers in these tests,
  // so a minimal escape that matches the spec for the common case is enough.
  if (typeof CSS === "undefined" || typeof CSS.escape !== "function") {
    (globalThis as unknown as { CSS: { escape: (s: string) => string } }).CSS = {
      escape: (s: string) => s.replace(/([^a-zA-Z0-9_-])/g, "\\$1"),
    };
  }
  if (typeof DataTransfer === "undefined") {
    class DataTransferPolyfill {
      private list: File[] = [];
      items = { add: (f: File) => { this.list.push(f); } };
      get files(): FileList {
        const arr = this.list.slice();
        const withItem = Object.assign(arr, { item: (i: number) => arr[i] ?? null });
        return withItem;
      }
    }
    (globalThis as unknown as { DataTransfer: unknown }).DataTransfer = DataTransferPolyfill;
  }
});

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("describe", () => {
  it("reports connected false for a detached element", () => {
    const el = document.createElement("button");
    expect(helperDescribe(el, "1")).toEqual({ connected: false, name: "", desc: "", permission: "allow", disabled: false });
  });

  it("returns role-and-name desc for a button", () => {
    const el = document.createElement("button");
    el.textContent = "Apply";
    document.body.appendChild(el);
    const d = helperDescribe(el, "1");
    expect(d.connected).toBe(true);
    expect(d.name).toBe("Apply");
    expect(d.desc).toBe('button "Apply"');
    expect(d.permission).toBe("allow");
    expect(d.refusal).toBeUndefined();
  });

  it("sets refusal to disabledRef for a disabled element", () => {
    const el = document.createElement("button");
    el.textContent = "Apply";
    el.disabled = true;
    document.body.appendChild(el);
    const d = helperDescribe(el, "2");
    expect(d.disabled).toBe(true);
    expect(d.refusal).toBe('Ref 2 ("Apply") is disabled. Inspect the form for unmet requirements.');
  });

  it("sets refusal to blockedByPolicy for a block-policy element", () => {
    const el = document.createElement("button");
    el.textContent = "Delete account";
    el.setAttribute("data-agent-permission", "block");
    el.setAttribute("data-agent-permission-reason", "Irreversible");
    document.body.appendChild(el);
    const d = helperDescribe(el, "3");
    expect(d.permission).toBe("block");
    expect(d.refusal).toBe(
      'Blocked by interaction policy ("block"): not allowed to operate [3] "Delete account" (Irreversible); ask the user to do it themselves.',
    );
  });

  it("leaves refusal undefined for an ask-policy element and reports permission ask", () => {
    const el = document.createElement("button");
    el.textContent = "Place order";
    el.setAttribute("data-agent-permission", "ask");
    el.setAttribute("data-agent-permission-reason", "Charges the card");
    document.body.appendChild(el);
    const d = helperDescribe(el, "4");
    expect(d.permission).toBe("ask");
    expect(d.reason).toBe("Charges the card");
    expect(d.refusal).toBeUndefined();
  });
});

describe("fillPrepare", () => {
  it("selects an input's text and reports hadText", () => {
    const el = document.createElement("input");
    el.value = "old";
    document.body.appendChild(el);
    const r = fillPrepare(el, "1");
    expect(r).toEqual({ ok: true, hadText: true });
  });

  it("reports hadText false for an empty input", () => {
    const el = document.createElement("input");
    document.body.appendChild(el);
    const r = fillPrepare(el, "1");
    expect(r).toEqual({ ok: true, hadText: false });
  });

  it("handles contenteditable", () => {
    const el = document.createElement("div");
    el.setAttribute("contenteditable", "true");
    el.textContent = "hello";
    document.body.appendChild(el);
    const r = fillPrepare(el, "1");
    expect(r).toEqual({ ok: true, hadText: true });
  });

  it("refuses a div with the interactions.ts wording", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    const r = fillPrepare(el, "9");
    expect(r).toEqual({ ok: false, message: "Ref 9 is not a text input, textarea, or contenteditable." });
  });
});

describe("readValue", () => {
  it("reads an input's value", () => {
    const el = document.createElement("input");
    el.value = "hi";
    expect(readValue(el)).toEqual({ value: "hi" });
  });

  it("falls back to textContent", () => {
    const el = document.createElement("div");
    el.textContent = "hello";
    expect(readValue(el)).toEqual({ value: "hello" });
  });

  it("returns no value for an element with neither", () => {
    const el = document.createElement("br");
    expect(readValue(el)).toEqual({ value: "" });
  });
});

function makeSelect(options: string[], multiple = false): HTMLSelectElement {
  const el = document.createElement("select");
  el.multiple = multiple;
  for (const o of options) {
    const opt = document.createElement("option");
    opt.value = o.toLowerCase().replace(/\s+/g, "-");
    opt.textContent = o;
    el.appendChild(opt);
  }
  document.body.appendChild(el);
  return el;
}

describe("selectPrepare", () => {
  it("refuses a non-select with the exact text", () => {
    const el = document.createElement("div");
    const r = selectPrepare(el, "5", ["x"]);
    expect(r).toEqual({ ok: false, message: "Ref 5 is not a native <select>. Custom dropdowns: click to open then click the option." });
  });

  it("refuses two values on a single-choice select", () => {
    const el = makeSelect(["Standard", "Express"]);
    const r = selectPrepare(el, "5", ["Standard", "Express"]);
    expect(r).toEqual({ ok: false, message: "Ref 5 is a single-choice select; pass exactly one value." });
  });

  it("accepts one value on a single-choice select", () => {
    const el = makeSelect(["Standard", "Express"]);
    const r = selectPrepare(el, "5", ["Express"]);
    expect(r.ok).toBe(true);
  });

  it("accepts two values on a multi-select", () => {
    const el = makeSelect(["Gift wrap", "Card", "Insurance"], true);
    const r = selectPrepare(el, "6", ["Gift wrap", "Card"]);
    expect(r.ok).toBe(true);
  });
});

describe("selectExecute", () => {
  it("matches by label", () => {
    const el = makeSelect(["Standard", "Express"]);
    const r = selectExecute(el, "5", ["Express"]);
    // jsdom's <select> has no layout box, so every result carries the
    // invisibleTargetNote suffix — the same note interactions.ts adds today.
    expect(r.text).toMatch(/^Selected "Express" in \[5\] combobox/);
    expect(r.text).toContain("Note: ref 5");
    expect(el.value).toBe("express");
  });

  it("matches by value", () => {
    const el = makeSelect(["Standard", "Express"]);
    selectExecute(el, "5", ["express"]);
    expect(el.value).toBe("express");
  });

  it("matches case-insensitively", () => {
    const el = makeSelect(["Standard", "Express"]);
    selectExecute(el, "5", ["EXPRESS"]);
    expect(el.value).toBe("express");
  });

  it("fires input then change", () => {
    const el = makeSelect(["Standard", "Express"]);
    const order: string[] = [];
    el.addEventListener("input", () => order.push("input"));
    el.addEventListener("change", () => order.push("change"));
    selectExecute(el, "5", ["Express"]);
    expect(order).toEqual(["input", "change"]);
  });

  it('returns Selected "Express" in [7] <role> "<name>".', () => {
    const el = makeSelect(["Standard", "Express"]);
    el.setAttribute("aria-label", "Shipping");
    const r = selectExecute(el, "7", ["Express"]);
    expect(r.text).toMatch(/^Selected "Express" in \[7\] combobox "Shipping"\./);
  });

  it("throws selectOptionMissing's text for an unknown value", () => {
    const el = makeSelect(["Standard", "Express"]);
    expect(() => selectExecute(el, "5", ["Overnight"])).toThrow('No option "Overnight". Available: Standard, Express.');
  });

  it("selects several options on a multi-select and lists them in order", () => {
    const el = makeSelect(["Gift wrap", "Card", "Insurance"], true);
    const r = selectExecute(el, "6", ["Gift wrap", "Card"]);
    // getRole() (element-semantics.ts) does not special-case `multiple`, so
    // describeElement still reports "combobox" here — only Chrome's real AX
    // tree distinguishes listbox for a multi-select (measured 2026-09-19).
    expect(r.text).toMatch(/^Selected "Gift wrap", "Card" in \[6\] combobox/);
    expect(Array.from(el.selectedOptions).map((o) => o.value)).toEqual(["gift-wrap", "card"]);
  });
});

describe("setFiles", () => {
  function fileInput(multiple = false): HTMLInputElement {
    const el = document.createElement("input");
    el.type = "file";
    el.multiple = multiple;
    document.body.appendChild(el);
    return el;
  }

  // jsdom rejects any `input.files = <value>` assignment whose value is not
  // branded as its own internal FileList class (a symbol-based check with no
  // public construction path), independent of the DataTransfer polyfill
  // above. The four cases that would need it (building a text/base64/
  // size-and-fill file, and the input-then-change event order) cannot run in
  // jsdom; the mock-tier e2e's R9 (`ref-tools-131.mock.spec.ts`, real
  // Chromium) and `network-dialog.mock.spec.ts` N9/N10 prove this path for
  // real instead.
  it("refuses a non-file input with the exact text", () => {
    const el = document.createElement("button");
    el.textContent = "Apply";
    document.body.appendChild(el);
    const r = setFiles(el, "9", [{ name: "a.txt", mimeType: "text/plain", text: "hi" }]);
    expect(r).toEqual({ ok: false, message: 'Element [9] button "Apply" is not a file input.' });
  });

  it("refuses two files on a single-file input", () => {
    const el = fileInput(false);
    const r = setFiles(el, "1", [
      { name: "a.txt", mimeType: "text/plain", text: "a" },
      { name: "b.txt", mimeType: "text/plain", text: "b" },
    ]);
    expect(r).toEqual({ ok: false, message: "Element [1] file accepts one file." });
  });

  it("returns the atob error message for invalid base64", () => {
    const el = fileInput();
    const r = setFiles(el, "1", [{ name: "a.bin", mimeType: "application/octet-stream", base64: "not valid base64!!" }]);
    expect(r.ok).toBe(false);
  });
});

describe("locator", () => {
  it("returns neutral locator set for element", () => {
    document.body.innerHTML = "";
    const el = document.createElement("button");
    el.textContent = "Apply";
    document.body.appendChild(el);
    expect(locator(el)).toEqual({
      role: "button",
      name: "Apply",
      roleMatches: 1,
      css: "button:nth-of-type(1)",
      xpath: "/html/body[1]/button[1]",
    });
  });

  it("button with id='go' produces css #go", () => {
    document.body.innerHTML = "";
    const el = document.createElement("button");
    el.id = "go";
    el.textContent = "Go";
    document.body.appendChild(el);
    expect(locator(el).css).toBe("#go");
  });
});

describe("iframeSelector (131/003)", () => {
  it("iframe with id produces #payment", () => {
    document.body.innerHTML = "";
    const el = document.createElement("iframe");
    el.id = "payment";
    document.body.appendChild(el);
    expect(iframeSelector(el)).toEqual({ selector: "#payment" });
  });

  it("two iframes with no id → second gives iframe:nth-of-type(2)", () => {
    document.body.innerHTML = "";
    const a = document.createElement("iframe");
    const b = document.createElement("iframe");
    document.body.append(a, b);
    expect(iframeSelector(b)).toEqual({ selector: "iframe:nth-of-type(2)" });
  });

  it("returns an empty selector for a non-frame element", () => {
    const el = document.createElement("div");
    expect(iframeSelector(el)).toEqual({ selector: "" });
  });

  it("returns an empty selector for an iframe inside an open shadow root", () => {
    document.body.innerHTML = "";
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: "open" });
    const el = document.createElement("iframe");
    root.appendChild(el);
    expect(iframeSelector(el)).toEqual({ selector: "" });
  });
});
