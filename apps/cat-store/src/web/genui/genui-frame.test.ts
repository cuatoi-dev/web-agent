import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildFrameUrl, mountIntoFrame, buildInjectedScript } from "./genui-frame";

describe("buildFrameUrl", () => {
  it("returns default path when no profile", () => {
    expect(buildFrameUrl()).toBe("genui/frame");
  });

  it("returns default path with custom base", () => {
    expect(buildFrameUrl("custom/path")).toBe("custom/path");
  });

  it("appends material profile as query param", () => {
    expect(buildFrameUrl("genui/frame", "material")).toBe("genui/frame?profile=material");
  });

  it("appends plain profile as query param", () => {
    expect(buildFrameUrl("genui/frame", "plain")).toBe("genui/frame?profile=plain");
  });
});

describe("mountIntoFrame", () => {
  let iframe: HTMLIFrameElement;

  beforeEach(() => {
    iframe = document.createElement("iframe");
    // jsdom does not implement <iframe srcdoc> navigation (only `src`), and
    // `reloadFrame` now reloads on every mount — use `src="about:blank"` so
    // the reload actually completes and fires "load" in tests, matching how
    // the real app's frame is always loaded via `src`, never `srcdoc`.
    iframe.src = "about:blank";
    document.body.appendChild(iframe);
  });

  afterEach(() => {
    iframe.remove();
  });

  it("creates #genui-root and appends parsed HTML", async () => {
    await mountIntoFrame(iframe, '<div id="test">Hello</div>');
    const doc = iframe.contentDocument!;
    const root = doc.getElementById("genui-root");
    expect(root).not.toBeNull();
    expect(root!.querySelector("#test")).not.toBeNull();
    expect(root!.querySelector("#test")!.textContent).toBe("Hello");
  });

  it("replaces previous content on second call", async () => {
    await mountIntoFrame(iframe, '<div id="first">First</div>');
    await mountIntoFrame(iframe, '<div id="second">Second</div>');
    const doc = iframe.contentDocument!;
    const root = doc.getElementById("genui-root")!;
    expect(root.querySelector("#first")).toBeNull();
    expect(root.querySelector("#second")).not.toBeNull();
  });

  it("handles inline scripts without throwing", async () => {
    const src = '<script>window.__TEST_VAR__ = "executed";</script>';
    await mountIntoFrame(iframe, src);
    // The function completes without error; script re-creation
    // works in a real browser frame (tested live in task 004).
    const doc = iframe.contentDocument!;
    const root = doc.getElementById("genui-root");
    expect(root).not.toBeNull();
  });

  it("throws when iframe contentDocument is inaccessible", async () => {
    const badIframe = document.createElement("iframe");
    // Not connected to DOM → contentDocument is null
    await expect(mountIntoFrame(badIframe, "<p>test</p>")).rejects.toThrow(
      "Cannot access frame document",
    );
  });

  it("the injected script element carries the sourceURL comment", async () => {
    await mountIntoFrame(iframe, '<div>hi</div><script>console.log(1);</script>');
    const doc = iframe.contentDocument!;
    const scripts = doc.querySelectorAll("script");
    const inlineScript = Array.from(scripts).find((s) => s.textContent?.includes("console.log"));
    expect(inlineScript).toBeDefined();
    expect(inlineScript!.textContent).toContain("//# sourceURL=agent-ui.js");
  });

  it("clears global state on subsequent mount", async () => {
    await mountIntoFrame(iframe, '<script>window.__PREV_VAR__ = "leftover";</script>');
    expect((iframe.contentWindow as unknown as { __PREV_VAR__?: string }).__PREV_VAR__).toBe("leftover");

    await mountIntoFrame(iframe, "<div>Clean</div>");
    expect((iframe.contentWindow as unknown as { __PREV_VAR__?: string }).__PREV_VAR__).toBeUndefined();
  });

  it("handles repeated top-level let declarations across mounts without syntax error", async () => {
    await mountIntoFrame(iframe, "<script>let count = 1; window.__C1__ = count;</script>");
    expect((iframe.contentWindow as unknown as { __C1__?: number }).__C1__).toBe(1);

    await mountIntoFrame(iframe, "<script>let count = 2; window.__C2__ = count;</script>");
    expect((iframe.contentWindow as unknown as { __C2__?: number }).__C2__).toBe(2);
  });

  it("a data block is not lifted out of its parent element", async () => {
    await mountIntoFrame(
      iframe,
      '<agent-chart-block><script type="application/json">{"a":1}</script></agent-chart-block>',
    );
    const doc = iframe.contentDocument!;
    const block = doc.querySelector("agent-chart-block");
    expect(block).not.toBeNull();
    const jsonScript = block!.querySelector('script[type="application/json"]');
    expect(jsonScript).not.toBeNull();
    expect(jsonScript!.textContent).not.toContain("sourceURL");
    expect(jsonScript!.textContent).toContain('"a":1');
  });

  it("the mount hook is called with the root synchronously", async () => {
    let hookRoot: HTMLElement | null = null;
    let jsonChildPresent = false;

    // The reload fires the load event on the iframe; we install the hook
    // on the new contentWindow inside that listener so it is present when
    // mountIntoFrame calls it (right after root.innerHTML = htmlContent).
    iframe.addEventListener("load", () => {
      const newWin = iframe.contentWindow as unknown as Record<string, unknown>;
      newWin.__WA_GENUI_FRAME_ON_MOUNT__ = (root: HTMLElement) => {
        hookRoot = root;
        const block = root.querySelector("agent-chart-block");
        jsonChildPresent = !!block?.querySelector('script[type="application/json"]');
      };
    }, { once: true });

    await mountIntoFrame(
      iframe,
      '<agent-chart-block><script type="application/json">{"x":1}</script></agent-chart-block>',
    );
    expect(hookRoot).not.toBeNull();
    expect(jsonChildPresent).toBe(true);
  });

  it("the ready hook is awaited", async () => {
    // Same pattern: install the hook after the reload, inside the load listener.
    iframe.addEventListener("load", () => {
      const newWin = iframe.contentWindow as unknown as Record<string, unknown>;
      newWin.__WA_GENUI_FRAME_READY__ = () =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, 60);
        });
    }, { once: true });

    const start = Date.now();
    await mountIntoFrame(iframe, "<div>test</div>");
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(50);
  });

  it("a throwing mount hook does not break the mount", async () => {
    let hookCalled = false;
    iframe.addEventListener("load", () => {
      const newWin = iframe.contentWindow as unknown as Record<string, unknown>;
      newWin.__WA_GENUI_FRAME_ON_MOUNT__ = () => {
        hookCalled = true;
        throw new Error("hook crash");
      };
    }, { once: true });

    await expect(mountIntoFrame(iframe, "<div>ok</div>")).resolves.toBeUndefined();
    expect(hookCalled).toBe(true);
    const doc = iframe.contentDocument!;
    expect(doc.getElementById("genui-root")).not.toBeNull();
  });
});

describe("buildInjectedScript", () => {
  it("appends the sourceURL comment", () => {
    const built = buildInjectedScript("x", "x");
    expect(built.text).toContain("//# sourceURL=agent-ui.js");
    expect(built.text.endsWith("//# sourceURL=agent-ui.js")).toBe(true);
  });

  it("pads so the script's first code line keeps its source line number", () => {
    const source = '<div>hi</div>\n<script>\n  console.log("a");\n  throw new Error("boom");\n</script>';
    const scriptText = '\n  console.log("a");\n  throw new Error("boom");\n';
    const built = buildInjectedScript(source, scriptText);
    const lines = built.text.split("\n");
    // console.log should be at line index 2 (line 3 of injected text = line 3 of source)
    expect(lines[2]).toBe('  console.log("a");');
    // throw should be at line index 3 (line 4)
    expect(lines[3]).toBe('  throw new Error("boom");');
  });

  it("a script on line 1 needs no pad", () => {
    const built = buildInjectedScript("<script>foo()</script>", "foo()");
    expect(built.padLines).toBe(0);
  });

  it("a second script block keeps mapping to the source", () => {
    const source = "<script>a()</script>\n<p>mid</p>\n<script>b()</script>";
    const first = buildInjectedScript(source, "a()");
    expect(first.padLines).toBe(0);
    const second = buildInjectedScript(source, "b()", first.nextIndex);
    // There are two line breaks before "<script>b()</script>" and none inside it
    expect(second.padLines).toBeGreaterThan(first.padLines);
  });

  it("identical script text twice does not collapse onto the first match", () => {
    const source = "<script>x()</script>\n<p>mid</p>\n<script>x()</script>";
    const first = buildInjectedScript(source, "x()");
    expect(first.padLines).toBe(0);
    const second = buildInjectedScript(source, "x()", first.nextIndex);
    expect(second.padLines).toBeGreaterThan(0);
  });

  it("missing text falls back to no pad", () => {
    const built = buildInjectedScript("abc", "not-in-source");
    expect(built.padLines).toBe(0);
    expect(built.text).toContain("//# sourceURL=agent-ui.js");
  });
});
