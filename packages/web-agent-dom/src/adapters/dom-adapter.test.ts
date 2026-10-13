// dom-adapter.test.ts — vitest + jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("html-to-image", () => ({
  toPng: vi.fn(() => Promise.resolve("data:image/png;base64,AAA=")),
}));
vi.mock("../utils/image-alpha.js", () => ({
  hasVisiblePixels: vi.fn(() => Promise.resolve(undefined)),
}));
vi.mock("@cuatoi/web-agent-core", async (orig) => ({
  ...(await orig<typeof import("@cuatoi/web-agent-core")>()),
  downscaleToolImage: vi.fn((u: string) => Promise.resolve(u)),
}));
import { DomAdapter } from "./dom-adapter.js";
import type { ActionCueFn } from "./dom-adapter.js";
import { RefTable } from "./ref-table.js";
import { searchText } from "./snapshot-match.js";

/**
 * jsdom notes:
 * - `getComputedStyle` is limited in jsdom, so hidden detection relies on
 *   inline style, hidden attr, and aria-hidden. Full computed-style coverage
 *   is validated in the browser artifact.
 * - getName does not use `CSS.escape`: it escapes `"` and `\\` in an id by
 *   hand before building the `label[for="…"]` selector.
 */

function setupHtml(html: string): void {
  document.body.innerHTML = html;
}

/**
 * jsdom has no layout engine: `getBoundingClientRect()` returns all zeros for
 * every element, even one with an explicit width and height. Give one element a
 * real box so tests can exercise the size-dependent paths.
 */
function stubRect(el: Element, width: number, height: number): void {
  (el as HTMLElement).getBoundingClientRect = () =>
    ({ x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, width, height,
       toJSON: () => ({}) });
}

describe("DomAdapter", () => {
  let adapter: DomAdapter;

  beforeEach(() => {
    document.body.innerHTML = "";
    adapter = new DomAdapter();
  });

  // -----------------------------------------------------------------------
  // Constructor / wiring
  // -----------------------------------------------------------------------
  describe("constructor", () => {
    it("creates its own RefTable by default", () => {
      expect(adapter.refTable).toBeDefined();
      expect(adapter.refTable.generation).toBe(0);
    });

    it("accepts a custom refTable", () => {
      const custom = new RefTable();
      custom.invalidateAll();
      const a = new DomAdapter({ refTable: custom });
      expect(a.refTable.generation).toBe(1);
    });

    it("accepts custom snapshotMaxChars", () => {
      const a = new DomAdapter({ snapshotMaxChars: 100 });
      expect(a.snapshotMaxChars).toBe(100);
    });

    it("accepts custom snapshotMaxDepth/SubtreeMaxNodes/MaxNodes", () => {
      const a = new DomAdapter({
        snapshotMaxDepth: 5,
        snapshotSubtreeMaxNodes: 10,
        snapshotMaxNodes: 100,
      });
      expect(a.snapshotMaxDepth).toBe(5);
      expect(a.snapshotSubtreeMaxNodes).toBe(10);
      expect(a.snapshotMaxNodes).toBe(100);
    });

    it("defaults root to document", () => {
      expect(adapter.root).toBe(document);
    });
  });

  // -----------------------------------------------------------------------
  // Snapshot header & generation
  // -----------------------------------------------------------------------
  describe("snapshot — header & generation (S6)", () => {
    it("output starts with generation: N", async () => {
      setupHtml("<p>hello</p>");
      const out = await adapter.snapshot({});
      expect(out).toMatch(/^generation: \d+/);
    });

    it("generation increments on each snapshot", async () => {
      setupHtml("<p>a</p>");
      const out1 = await adapter.snapshot({});
      const gen1 = parseInt(out1.match(/generation: (\d+)/)![1], 10);

      const out2 = await adapter.snapshot({});
      const gen2 = parseInt(out2.match(/generation: (\d+)/)![1], 10);
      expect(gen2).toBe(gen1 + 1);
    });

    it("snapshot() returns a promise even though it is no longer declared async", () => {
      setupHtml("<p>a</p>");
      const returned = adapter.snapshot({});
      expect(returned).toBeInstanceOf(Promise);
      return expect(returned).resolves.toContain("generation:");
    });
  });

  // -----------------------------------------------------------------------
  // Basic element listing
  // -----------------------------------------------------------------------
  describe("snapshot — basic elements", () => {
    it("lists a button with ref", async () => {
      setupHtml('<button id="b">Click me</button>');
      const out = await adapter.snapshot({});
      expect(out).toContain("[1] button \"Click me\"");
    });

    it("lists an input with value and required", async () => {
      setupHtml('<input id="i" value="hello" required />');
      const out = await adapter.snapshot({});
      expect(out).toContain('[1] textbox value="hello" required');
    });

    it("lists a checkbox as checked when checked", async () => {
      setupHtml('<input type="checkbox" checked />');
      const out = await adapter.snapshot({});
      expect(out).toContain("[1] checkbox checked");
    });

    it("lists disabled attribute on a button", async () => {
      setupHtml('<button disabled>Buy</button>');
      const out = await adapter.snapshot({});
      expect(out).toContain("[1] button \"Buy\" disabled");
    });

    it("includes (current) for aria-current=page", async () => {
      setupHtml('<a href="/" aria-current="page">Home</a>');
      const out = await adapter.snapshot({});
      expect(out).toContain("[1] link \"Home\" (current)");
    });

    it("lists select with options", async () => {
      setupHtml(`<select id="s">
        <option value="a">A</option>
        <option value="b">B</option>
        <option value="c">C</option>
      </select>`);
      const out = await adapter.snapshot({});
      expect(out).toContain('[1] combobox');
      expect(out).toContain('options=["A","B","C"]');
    });

    it("truncates select options at 20 with +N more", async () => {
      const opts = Array.from({ length: 25 }, (_, i) => `<option value="o${i}">Opt${i}</option>`).join("\n");
      setupHtml(`<select>${opts}</select>`);
      const out = await adapter.snapshot({});
      expect(out).toContain("…+5 more");
    });
  });

  // -----------------------------------------------------------------------
  // Hidden / skip detection (S4)
  // -----------------------------------------------------------------------
  describe("snapshot — hidden / skip (S4)", () => {
    it("omits script tags", async () => {
      setupHtml("<script>alert(1)</script><button>OK</button>");
      const out = await adapter.snapshot({});
      expect(out).not.toContain("script");
      expect(out).toContain("button");
    });

    it("omits style tags", async () => {
      setupHtml("<style>.x{color:red}</style><button>OK</button>");
      const out = await adapter.snapshot({});
      expect(out).not.toContain("style");
      expect(out).toContain("button");
    });

    it("omits elements with display:none inline", async () => {
      setupHtml('<div style="display:none"><button>Hidden</button></div><button>Visible</button>');
      const out = await adapter.snapshot({});
      expect(out).not.toContain("Hidden");
      expect(out).toContain("Visible");
    });

    it("omits elements with visibility:hidden inline", async () => {
      setupHtml('<div style="visibility:hidden"><button>Hidden</button></div><button>Visible</button>');
      const out = await adapter.snapshot({});
      expect(out).not.toContain("Hidden");
      expect(out).toContain("Visible");
    });

    it("omits elements with hidden attr", async () => {
      setupHtml('<button hidden>Hidden</button><button>Visible</button>');
      const out = await adapter.snapshot({});
      expect(out).not.toContain("Hidden");
      expect(out).toContain("Visible");
    });

    it("omits elements with aria-hidden=true", async () => {
      setupHtml('<div aria-hidden="true"><button>Hidden</button></div><button>Visible</button>');
      const out = await adapter.snapshot({});
      expect(out).not.toContain("Hidden");
      expect(out).toContain("Visible");
    });

    it("assigns refs to elements across all five hiding modes when styled via CSS classes", async () => {
      setupHtml(`
        <style>
          .hide-zero { width: 0; height: 0; }
          .hide-none { display: none; }
          .hide-hidden { visibility: hidden; }
          .hide-opacity { opacity: 0; }
          .hide-clip { clip-path: inset(50%); }
        </style>
        <button class="hide-zero">BtnZeroSize</button>
        <button class="hide-none">BtnDisplayNone</button>
        <button class="hide-hidden">BtnVisibilityHidden</button>
        <button class="hide-opacity">BtnOpacityZero</button>
        <button class="hide-clip">BtnClipPath</button>
        <button>BtnNormal</button>
      `);
      const out = await adapter.snapshot({});
      expect(out).toMatch(/\[\d+\] button "BtnZeroSize"/);
      expect(out).toMatch(/\[\d+\] button "BtnDisplayNone"/);
      expect(out).toMatch(/\[\d+\] button "BtnVisibilityHidden"/);
      expect(out).toMatch(/\[\d+\] button "BtnOpacityZero"/);
      expect(out).toMatch(/\[\d+\] button "BtnClipPath"/);
      expect(out).toMatch(/\[\d+\] button "BtnNormal"/);
    });

    it("does not skip elements with inline opacity, clip-path, or zero-size styles", async () => {
      setupHtml(`
        <button style="opacity: 0">BtnOpacity</button>
        <button style="clip-path: inset(50%)">BtnClip</button>
        <button style="width: 0; height: 0">BtnZero</button>
        <button>BtnNormal</button>
      `);
      const out = await adapter.snapshot({});
      expect(out).toMatch(/\[\d+\] button "BtnOpacity"/);
      expect(out).toMatch(/\[\d+\] button "BtnClip"/);
      expect(out).toMatch(/\[\d+\] button "BtnZero"/);
      expect(out).toMatch(/\[\d+\] button "BtnNormal"/);
    });
  });

  // -----------------------------------------------------------------------
  // Agent UI subtree exclusion (SEC6)
  // -----------------------------------------------------------------------
  describe("snapshot — agent UI exclusion (SEC6)", () => {
    it("excludes elements inside data-agent-ui subtree", async () => {
      setupHtml(`
        <div data-agent-ui><button>Agent button</button></div>
        <button>App button</button>
      `);
      const out = await adapter.snapshot({});
      expect(out).not.toContain("Agent button");
      expect(out).toContain("App button");
    });
  });

  // -----------------------------------------------------------------------
  // interactive_only (S5)
  // -----------------------------------------------------------------------
  describe("snapshot — interactive_only", () => {
    it("omits non-interactive text and structural nodes", async () => {
      setupHtml(`
        <main>
          <p>Some text here</p>
          <button>Action</button>
        </main>
      `);
      const out = await adapter.snapshot({ interactive_only: true });
      // Should not contain "text" lines
      expect(out).not.toContain("text \"Some");
      // The structural "main" line still appears: interactive_only drops text
      // nodes only, and main has a landmark role. This asserts the button.
      expect(out).toContain("[1] button \"Action\"");
    });
  });

  // -----------------------------------------------------------------------
  // Budgeted Tree / progressive disclosure
  // -----------------------------------------------------------------------
  describe("snapshot — budgeted tree", () => {
    it("small page emits no marker and no TRUNCATED", async () => {
      setupHtml(`
        <section>
          <button>A</button>
          <button>B</button>
        </section>
      `);
      const out = await adapter.snapshot({});
      expect(out).not.toContain("hidden");
      expect(out).not.toContain("TRUNCATED");
    });

    it("breadth-first traversal reaches siblings across branches before deeper descendants", async () => {
      setupHtml(`
        <section id="big" role="region" aria-label="Big Section">
          <button>A</button>
          <button>B</button>
          <button>C</button>
          <button>D</button>
        </section>
        <section id="after" role="region" aria-label="After Section">
          <button>E</button>
        </section>
      `);
      const small = new DomAdapter({ snapshotMaxNodes: 3 });
      const out = await small.snapshot({});
      expect(out).toContain("region \"Big Section\"");
      expect(out).toContain("region \"After Section\"");
      expect(out).toContain("nodes hidden — snapshot_page(scope=");
    });

    it("marker hidden-count equals total minus rendered", async () => {
      setupHtml(`
        <section id="big" role="region" aria-label="Big Section">
          <button>A</button>
          <button>B</button>
          <button>C</button>
          <button>D</button>
        </section>
      `);
      const small = new DomAdapter({ snapshotMaxNodes: 3 });
      const out = await small.snapshot({});
      expect(out).toContain("+2 nodes hidden");
    });

    it("assigns a ref to a non-interactive collapse boundary", async () => {
      setupHtml(`
        <div id="boundary" role="region" aria-label="Boundary">
          <button>A</button>
          <button>B</button>
          <button>C</button>
        </div>
      `);
      const small = new DomAdapter({ snapshotMaxNodes: 2 });
      const out = await small.snapshot({});
      const match = out.match(/\[(\d+)\] region "Boundary" … \+2 nodes hidden — snapshot_page\(scope="(\d+)"\)/);
      expect(match).toBeTruthy();
      expect(match![1]).toBe(match![2]);
    });

    it("renders BFS-selected nodes in document order rather than level order", async () => {
      setupHtml(`
        <section role="region" aria-label="First">
          <button>Child 1</button>
        </section>
        <section role="region" aria-label="Second">
          <button>Child 2</button>
        </section>
      `);
      const out = await adapter.snapshot({});
      const idxFirst = out.indexOf('region "First"');
      const idxChild1 = out.indexOf('button "Child 1"');
      const idxSecond = out.indexOf('region "Second"');
      const idxChild2 = out.indexOf('button "Child 2"');

      expect(idxFirst).toBeLessThan(idxChild1);
      expect(idxChild1).toBeLessThan(idxSecond);
      expect(idxSecond).toBeLessThan(idxChild2);
    });

    it("BFS prioritizes breadth across branches before descending into subtrees", async () => {
      setupHtml(`
        <nav role="navigation" aria-label="Sidebar">
          <div role="group">
            <button>Nav 1</button>
            <button>Nav 2</button>
            <button>Nav 3</button>
          </div>
        </nav>
        <main role="main" aria-label="Article">
          <p>Article introduction</p>
        </main>
      `);
      // Budget of 3: Root body (not sig), Sidebar (1), Article (2), group (3).
      // Under DFS, Sidebar (1), group (2), Nav 1 (3) would consume budget before Article is seen.
      const small = new DomAdapter({ snapshotMaxNodes: 3 });
      const out = await small.snapshot({});
      expect(out).toContain('navigation "Sidebar"');
      expect(out).toContain('main "Article"');
    });

    it("depth cap collapses beyond snapshotMaxDepth", async () => {
      setupHtml(`
        <div role="region" aria-label="L1">
          <div role="region" aria-label="L2">
            <div role="region" aria-label="L3">
              <button>Deep</button>
            </div>
          </div>
        </div>
      `);
      const small = new DomAdapter({ snapshotMaxDepth: 2 });
      const out = await small.snapshot({});
      expect(out).toContain("region \"L2\"");
      expect(out).toContain("region \"L3\" … +1 nodes hidden");
      expect(out).not.toContain("button \"Deep\"");
    });

    it("scope drill re-expands a collapsed subtree", async () => {
      setupHtml(`
        <section id="big" role="region" aria-label="Big Section">
          <button>A</button>
          <button>B</button>
          <button>C</button>
          <button>D</button>
        </section>
      `);
      const small = new DomAdapter({ snapshotMaxNodes: 3 });
      const out = await small.snapshot({});
      const match = out.match(/\[(\d+)\] region "Big Section"/);
      expect(match).toBeTruthy();
      const ref = match![1];
      const drill = await small.snapshot({ scope: ref });
      expect(drill).toContain("button \"A\"");
      expect(drill).toContain("button \"B\"");
      expect(drill).not.toContain("button \"C\"");
      expect(drill).not.toContain("button \"D\"");
      expect(drill).toContain("+2 nodes hidden");
      expect(drill).toContain("generation: 2");
    });

    it("emits global TRUNCATED terminal marker when node budget exhausted", async () => {
      setupHtml(`
        <button>A</button>
        <button>B</button>
        <button>C</button>
        <button>D</button>
      `);
      const small = new DomAdapter({ snapshotMaxNodes: 2 });
      const out = await small.snapshot({});
      expect(out).toContain("TRUNCATED");
      expect(out).toContain("2 more significant nodes not shown");
      expect(out).toContain("node budget 2 reached");
    });

    it("interactive_only counts only interactive nodes toward budget", async () => {
      setupHtml(`
        <main>
          <p>Text 1</p>
          <p>Text 2</p>
          <p>Text 3</p>
          <button>Interactive</button>
        </main>
      `);
      const small = new DomAdapter({ snapshotMaxNodes: 3 });
      const out = await small.snapshot({ interactive_only: true });
      expect(out).toContain("button \"Interactive\"");
      expect(out).not.toContain("TRUNCATED");
    });

    it("char safety net still truncates", async () => {
      setupHtml(`
        <button>A</button>
        <button>B</button>
      `);
      const small = new DomAdapter({ snapshotMaxChars: 40 });
      const out = await small.snapshot({});
      expect(out).toContain("TRUNCATED (char cap 40)");
    });
  });

  // -----------------------------------------------------------------------
  // include_text filter (002)
  // -----------------------------------------------------------------------
  describe("snapshot — include_text filter (002)", () => {
    it("attribute-only match is reachable — the ancestors do not carry the term", async () => {
      setupHtml(
        '<div><div><span><a href="#" title="Edit this at Wikidata"><img alt=""></a></span></div></div><section role="region" aria-label="Other"><button>Nothing</button></section>',
      );
      const out = await adapter.snapshot({ include_text: "Wikidata" });
      expect(out).toContain("Edit this at Wikidata");
      expect(out).not.toContain("Nothing");
    });

    it("keeps the significant ancestors of a match so the result is a tree", async () => {
      setupHtml(
        '<main><section role="region" aria-label="Course"><p>Germany invaded Poland today</p></section></main><nav role="navigation" aria-label="Menu"><a href="#">Home</a></nav>',
      );
      const out = await adapter.snapshot({ include_text: "Poland" });
      expect(out).toContain("main");
      expect(out).toContain('region "Course"');
      expect(out).toMatch(/text ".*Poland.*"/);
      const mainIdx = out.indexOf("main");
      const regionIdx = out.indexOf('region "Course"');
      const textIdx = out.indexOf('text "');
      expect(mainIdx).toBeLessThan(regionIdx);
      expect(regionIdx).toBeLessThan(textIdx);
      expect(out).not.toContain('navigation "Menu"');
    });

    it("is case-insensitive", async () => {
      setupHtml(
        '<main><section role="region" aria-label="Course"><p>Germany invaded Poland today</p></section></main><nav role="navigation" aria-label="Menu"><a href="#">Home</a></nav>',
      );
      const outLower = await adapter.snapshot({ include_text: "poland" });
      const outUpper = await adapter.snapshot({ include_text: "POLAND" });
      const outMixed = await adapter.snapshot({ include_text: "Poland" });
      const stripGen = (s: string) => s.replace(/^generation: \d+\n/, "");
      expect(stripGen(outLower)).toBe(stripGen(outMixed));
      expect(stripGen(outUpper)).toBe(stripGen(outMixed));
    });

    it("matches a substring, not a whole word", async () => {
      setupHtml(
        '<div><div><span><a href="#" title="Edit this at Wikidata"><img alt=""></a></span></div></div><section role="region" aria-label="Other"><button>Nothing</button></section>',
      );
      const out = await adapter.snapshot({ include_text: "Wikid" });
      expect(out).toContain("Edit this at Wikidata");
    });

    it("matches an aria-label", async () => {
      setupHtml('<button aria-label="Add Salmon to cart"></button><button>Unrelated</button>');
      const out = await adapter.snapshot({ include_text: "Salmon" });
      expect(out).toContain("Add Salmon to cart");
      expect(out).not.toContain("Unrelated");
    });

    it("matches a placeholder", async () => {
      setupHtml('<input placeholder="Search the store"><button>Unrelated</button>');
      const input = document.querySelector("input")!;
      expect(searchText(input)).toContain("Search the store");
      const out = await adapter.snapshot({ include_text: "Search" });
      expect(out).toContain("textbox");
      expect(out).not.toContain("Unrelated");
    });

    it("matches an input value", async () => {
      setupHtml('<input id="inp" value="Poland"><button>Unrelated</button>');
      (document.getElementById("inp") as HTMLInputElement).value = "Poland";
      const out = await adapter.snapshot({ include_text: "Poland" });
      expect(out).toContain("Poland");
      expect(out).not.toContain("Unrelated");
    });

    it("an unmatched term returns the explanation, not an empty tree", async () => {
      setupHtml('<button>Click me</button>');
      const out = await adapter.snapshot({ include_text: "zzzznotpresent" });
      expect(out).toBe(
        `generation: ${adapter.refTable.generation}\nNo element contains "zzzznotpresent". Take a snapshot without include_text to see the page, or try a shorter term.`,
      );
      expect(out).not.toContain("TRUNCATED");
    });

    it("names the trimmed term in the explanation", async () => {
      setupHtml('<button>Click me</button>');
      const out = await adapter.snapshot({ include_text: "  zzzznotpresent  " });
      expect(out).toContain('No element contains "zzzznotpresent"');
      expect(out).not.toContain('No element contains "  zzzznotpresent  "');
    });

    it("an absent filter changes nothing", async () => {
      setupHtml(`
        <header role="banner"><h1>Title</h1></header>
        <main>
          <button>Action 1</button>
          <button>Action 2</button>
        </main>
      `);
      const a = await adapter.snapshot({});
      const b = await adapter.snapshot({ include_text: "" });
      const c = await adapter.snapshot({ include_text: "   " });
      const stripGen = (s: string) => s.replace(/^generation: \d+\n/, "");
      expect(stripGen(b)).toBe(stripGen(a));
      expect(stripGen(c)).toBe(stripGen(a));
    });

    it("composes with scope", async () => {
      setupHtml(`
        <div id="in" onclick="" role="region" aria-label="In"><button aria-label="cart one"></button></div>
        <div role="region" aria-label="Out"><button aria-label="cart two"></button></div>
      `);
      const initial = await adapter.snapshot({});
      const match = initial.match(/\[(\d+)\] region "In"/);
      expect(match).toBeTruthy();
      const ref = match![1];
      const out = await adapter.snapshot({ scope: ref, include_text: "cart" });
      expect(out).toContain("cart one");
      expect(out).not.toContain("cart two");
    });

    it("composes with interactive_only", async () => {
      setupHtml('<section role="region" aria-label="Cart area"><p>your cart is empty</p><button aria-label="Open cart"></button></section>');
      const out = await adapter.snapshot({ include_text: "cart", interactive_only: true });
      expect(out).toContain("Open cart");
      expect(out).toMatch(/\[\d+\] button "Open cart"/);
      expect(out).not.toContain('text "');
    });

    it("the node budget still applies to the filtered set", async () => {
      setupHtml(`
        <div role="region" aria-label="Cart">
          <button aria-label="cart 1"></button>
          <button aria-label="cart 2"></button>
          <button aria-label="cart 3"></button>
          <button aria-label="cart 4"></button>
          <button aria-label="cart 5"></button>
          <button aria-label="cart 6"></button>
        </div>
      `);
      const small = new DomAdapter({ snapshotMaxNodes: 3 });
      const out = await small.snapshot({ include_text: "cart" });
      const refMatches = out.match(/\[\d+\]/g) ?? [];
      expect(refMatches.length).toBeLessThanOrEqual(3);
      expect(out).toContain("nodes hidden — snapshot_page(scope=");
    });

    it("a hidden count under a filter counts only matching nodes", async () => {
      setupHtml(`
        <div role="region" aria-label="Cart">
          <button aria-label="cart 1"></button>
          <button aria-label="cart 2"></button>
          <button aria-label="cart 3"></button>
          <button aria-label="other 1"></button>
          <button aria-label="other 2"></button>
          <button aria-label="other 3"></button>
          <button aria-label="other 4"></button>
          <button aria-label="other 5"></button>
        </div>
      `);
      const small = new DomAdapter({ snapshotMaxNodes: 3 });
      const out = await small.snapshot({ include_text: "cart" });
      expect(out).toContain("+1 nodes hidden");
      expect(out).not.toContain("+6");
    });

    it("a ref from a filtered snapshot resolves for click", async () => {
      setupHtml('<button id="btn" aria-label="Open cart"></button>');
      const btn = document.getElementById("btn")!;
      let clicked = false;
      btn.addEventListener("click", () => {
        clicked = true;
      });
      const out = await adapter.snapshot({ include_text: "Open cart" });
      const refMatch = out.match(/\[(\d+)\]/);
      expect(refMatch).not.toBeNull();
      const ref = refMatch![1];
      await adapter.click(ref);
      expect(clicked).toBe(true);
    });

    it("snapshotFocused is unaffected", async () => {
      setupHtml('<button id="a">A</button><button id="b">B</button>');
      const btn1 = document.getElementById("a")!;
      const btn2 = document.getElementById("b")!;
      const entries = await adapter.snapshotFocused([btn1, btn2]);
      expect(entries).toHaveLength(2);
      expect(entries[0].ref).not.toBe(entries[1].ref);
      expect(entries[0].text).toMatch(new RegExp(`^\\[${entries[0].ref}\\] button "A"`));
      expect(entries[1].text).toMatch(new RegExp(`^\\[${entries[1].ref}\\] button "B"`));
    });
  });

  // -----------------------------------------------------------------------
  // Scope
  // -----------------------------------------------------------------------
  describe("snapshot — scope", () => {
    it("returns stale note when scope ref is from older generation", async () => {
      setupHtml("<div id='x'><button>Nested</button></div>");
      // Create a custom ref table, assign, then invalidate
      const rt = new RefTable();
      const el = document.getElementById("x")!;
      rt.assign(el);
      rt.invalidateAll();
      const a = new DomAdapter({ refTable: rt });
      const out = await a.snapshot({ scope: "1" });
      expect(out).toContain("stale");
      expect(out).toContain("Take a new snapshot");
    });

    it("returns unknown note for unknown scope ref", async () => {
      const out = await adapter.snapshot({ scope: "99" });
      expect(out).toContain("Unknown ref 99");
    });

    it("returns detached for scope ref whose element was removed (detached before next snapshot)", async () => {
      // When a ref from the current generation points at a removed element,
      // snapshot({scope}) resolves it before invalidateAll and reports it detached.
      setupHtml("<div id='z'><button>Gone</button></div>");
      const rt = new RefTable();
      const el = document.getElementById("z")!;
      rt.assign(el); // gen 0
      el.remove();
      const a = new DomAdapter({ refTable: rt });
      const out = await a.snapshot({ scope: "1" });
      expect(out).toContain("no longer exists");
      expect(out).toContain("Take a new snapshot");
    });
  });

  // -----------------------------------------------------------------------
  // Structural role detection
  // -----------------------------------------------------------------------
  describe("snapshot — structural roles", () => {
    it("lists main element as main", async () => {
      setupHtml("<main>content</main>");
      const out = await adapter.snapshot({});
      // main role with no name
      expect(out).toContain("main");
    });

    it("lists nav with aria-label", async () => {
      setupHtml('<nav aria-label="Main nav"><a href="/">Home</a></nav>');
      const out = await adapter.snapshot({});
      expect(out).toContain('navigation "Main nav"');
      expect(out).toContain("[1] link \"Home\"");
    });

    it("lists heading with (hN)", async () => {
      setupHtml("<h2>Section title</h2>");
      const out = await adapter.snapshot({});
      expect(out).toContain('heading "Section title" (h2)');
    });
  });

  // -----------------------------------------------------------------------
  // Name resolution
  // -----------------------------------------------------------------------
  describe("snapshot — name resolution", () => {
    it("uses aria-label over text content", async () => {
      setupHtml('<button aria-label="Close">X</button>');
      const out = await adapter.snapshot({});
      expect(out).toContain('button "Close"');
      expect(out).not.toContain('"X"');
    });

    it("uses label for= association", async () => {
      setupHtml('<label for="inp">Username</label><input id="inp" />');
      const out = await adapter.snapshot({});
      expect(out).toContain('textbox "Username"');
    });
  });

  // -----------------------------------------------------------------------
  // Author-defined controls — a click handler bound with addEventListener
  // leaves nothing in the DOM for isInteractive's attribute checks to see.
  // See packages/web-agent-dom/docs/tools.md "What gets a ref".
  // -----------------------------------------------------------------------
  describe("snapshot — author-defined controls", () => {
    it('tabindex="0" div earns a ref and a role word', async () => {
      setupHtml('<div tabindex="0"><svg></svg><span>WIDGETS</span></div>');
      const out = await adapter.snapshot({});
      expect(out).toContain('[1] button "WIDGETS"');
      // Not a standalone (unindented) text line — the inner span's text still
      // prints as a nested child of the ref'd button, same as an existing
      // role="button" control with wrapped text. Only the top-level orphan
      // line the pre-fix walk produced is what the fix removes.
      expect(out).not.toMatch(/^text "WIDGETS"$/m);
    });

    it("the same shape inside an open shadow root earns a ref", async () => {
      const host = document.createElement("div");
      document.body.appendChild(host);
      const shadow = host.attachShadow({ mode: "open" });
      const inner = document.createElement("div");
      inner.setAttribute("tabindex", "0");
      inner.innerHTML = "<svg></svg><span>DASHBOARDS</span>";
      shadow.appendChild(inner);

      const out = await adapter.snapshot({});
      expect(out).toContain('[1] button "DASHBOARDS"');
    });

    it('tabindex="-1" earns no ref', async () => {
      setupHtml('<div tabindex="-1">Not a stop</div>');
      const out = await adapter.snapshot({});
      expect(out).not.toMatch(/\[\d+\][^\n]*Not a stop/);
      expect(out).toContain('text "Not a stop"');
    });

    it("a nested wrapper does not double-ref", async () => {
      setupHtml('<div tabindex="0"><span>WIDGETS</span></div>');
      const out = await adapter.snapshot({});
      const refs = out.match(/\[1\]/g) ?? [];
      expect(refs).toHaveLength(1);
    });

    it("a cursor: pointer wrapper around a real button does not steal the ref", async () => {
      setupHtml('<div style="cursor:pointer"><button>Go</button></div>');
      const out = await adapter.snapshot({});
      expect(out).toContain('[1] button "Go"');
      const lines = out.split("\n");
      // No line other than the button's own carries a ref.
      const refLines = lines.filter((l) => /\[\d+\]/.test(l));
      expect(refLines).toHaveLength(1);
      expect(refLines[0]).toContain('button "Go"');
    });

    it("a deep chain of cursor: pointer wrappers does not overflow the call stack", async () => {
      // Reproduces a live crash (Maximum call stack size exceeded) found on
      // 2026-08-12: hasInteractiveAncestor/hasInteractiveDescendant each call
      // back into isInteractive, and on a chain of nested pointer-cursor
      // wrappers that mutual recursion re-derives every element's status
      // from every other element in the chain. The fix memoizes isInteractive
      // per snapshot() call (see InteractiveCache in types.ts).
      let html = '<span id="deep">Deep</span>';
      for (let i = 0; i < 60; i++) {
        html = `<div style="cursor:pointer">${html}</div>`;
      }
      setupHtml(html);
      const out = await adapter.snapshot({});
      expect(out).toContain('[1] button "Deep"');
      const refs = out.match(/\[\d+\]/g) ?? [];
      expect(refs).toHaveLength(1);
    });

    it("an onclick element with no ARIA role prints button, not an empty slot", async () => {
      setupHtml('<div onclick="void 0">Save</div>');
      const out = await adapter.snapshot({});
      expect(out).toMatch(/^\[1\] button "Save"$/m);
    });

    it("a pointer-control ref (no role, no tabindex, no onclick) is clickable through click(ref)", async () => {
      // The undetectable-by-attribute shape from the live reproduction (2026-08-12):
      // a div bound only via addEventListener. Adding `cursor: pointer` is what
      // makes it a *detectable* instance of that shape — see isPointerControl.
      setupHtml('<div style="cursor:pointer"><span>SIDEBAR-NAV</span></div>');
      const el = document.querySelector("div")!;
      let hits = 0;
      el.addEventListener("click", () => { hits += 1; });

      const out = await adapter.snapshot({});
      const match = out.match(/\[(\d+)\] button "SIDEBAR-NAV"/);
      expect(match).not.toBeNull();

      const result = await adapter.click(match![1]);
      expect(result).toContain("Clicked");
      expect(hits).toBe(1);
    });

    it("interactive_only: true includes the new controls", async () => {
      setupHtml('<div tabindex="0"><svg></svg><span>WIDGETS</span></div>');
      const out = await adapter.snapshot({ interactive_only: true });
      expect(out).toContain('[1] button "WIDGETS"');
      expect(out).not.toMatch(/^text "WIDGETS"$/m);
    });
  });

  // -----------------------------------------------------------------------
  // Resilience
  // -----------------------------------------------------------------------
  describe("snapshot — resilience", () => {
    it("handles empty document", async () => {
      const out = await adapter.snapshot({});
      expect(out).toContain("generation:");
    });

    it("does not throw on malformed markup", async () => {
      setupHtml("<div><button>OK<button></div>");
      const out = await adapter.snapshot({});
      expect(out).toContain("button");
    });
  });



  // -----------------------------------------------------------------------
  // Snapshot — permission annotation (§022-002)
  // -----------------------------------------------------------------------
  describe("snapshot — permission annotation (§022-002)", () => {
    it("appends (block) to a button with data-agent-permission=block", async () => {
      setupHtml('<button data-agent-permission="block">Place order</button>');
      const out = await adapter.snapshot({});
      expect(out).toContain('[1] button "Place order" (block)');
    });

    it("appends (ask) to a button with data-agent-permission=ask", async () => {
      setupHtml('<button data-agent-permission="ask">Remove</button>');
      const out = await adapter.snapshot({});
      expect(out).toContain('[1] button "Remove" (ask)');
    });

    it("omits suffix for data-agent-permission=allow", async () => {
      setupHtml('<button data-agent-permission="allow">Submit</button>');
      const out = await adapter.snapshot({});
      expect(out).toContain('[1] button "Submit"');
      expect(out).not.toContain("(allow)");
    });

    it("omits suffix when element has no data-agent-permission attribute", async () => {
      setupHtml("<button>Click me</button>");
      const out = await adapter.snapshot({});
      expect(out).toContain('[1] button "Click me"');
      expect(out).not.toMatch(/\(ask\)|\(block\)/);
    });

    it("ref numbering is unchanged when annotated elements are present", async () => {
      setupHtml(`
        <button>First</button>
        <button data-agent-permission="block">Second</button>
        <button>Third</button>
      `);
      const out = await adapter.snapshot({});
      expect(out).toContain('[1] button "First"');
      expect(out).toContain('[2] button "Second" (block)');
      expect(out).toContain('[3] button "Third"');
    });

    it("annotates (block) when only a parent has data-agent-permission", async () => {
      setupHtml('<div data-agent-permission="block"><button>Delete</button></div>');
      const out = await adapter.snapshot({});
      expect(out).toContain('[1] button "Delete" (block)');
    });

    it("annotates (ask) for a marker on an open shadow-root host", async () => {
      const host = document.createElement("md-icon-button");
      host.setAttribute("data-agent-permission", "ask");
      document.body.appendChild(host);
      const shadow = host.attachShadow({ mode: "open" });
      const inner = document.createElement("button");
      inner.textContent = "Remove";
      shadow.appendChild(inner);

      const out = await adapter.snapshot({});
      expect(out).toContain('[1] button "Remove" (ask)');
    });

    it("appends (ask) after state tags for an annotated input", async () => {
      setupHtml('<input data-agent-permission="ask" value="hello" />');
      const out = await adapter.snapshot({});
      expect(out).toContain("(ask)");
      const line = out.split("\n").find((l) => l.includes("[1]"))!;
      expect(line.indexOf("value=")).toBeLessThan(line.indexOf("(ask)"));
    });
  });

  // -----------------------------------------------------------------------
  // Click action tests
  // -----------------------------------------------------------------------
  describe("click", () => {
    it("fires a bubbling click and event sequence, returns success description", async () => {
      setupHtml('<button id="btn">Hello</button>');
      const btn = document.getElementById("btn")!;
      const events: string[] = [];
      const track = (name: string) => btn.addEventListener(name, (e) => events.push(e.type));
      track("pointerdown");
      track("mousedown");
      track("pointerup");
      track("mouseup");
      track("click");

      await adapter.snapshot({});
      const result = await adapter.click("1");

      expect(events).toEqual(["pointerdown", "mousedown", "pointerup", "mouseup", "click"]);
      expect(result).toContain('Clicked [1] button "Hello"');
    });

    it("throws an error if the element is disabled", async () => {
      setupHtml('<button id="btn" disabled>Hello</button>');
      await adapter.snapshot({});
      await expect(adapter.click("1")).rejects.toThrow('Ref 1 ("Hello") is disabled. Inspect the form for unmet requirements.');
    });

    it("throws an error if the ref is stale due to generation mismatch", async () => {
      setupHtml('<button id="btn1">Button 1</button><button id="btn2">Button 2</button>');
      await adapter.snapshot({}); // Gen 1: btn1 -> 1, btn2 -> 2
      setupHtml('<button id="btn1">Button 1</button>');
      await adapter.snapshot({}); // Gen 2: btn1 -> 1. Ref 2 is not assigned.
      await expect(adapter.click("2")).rejects.toThrow('Ref 2 is stale (generation 1, current 2). Take a new snapshot.');
    });

    it("throws an error if the element is detached", async () => {
      setupHtml('<button id="btn">Hello</button>');
      await adapter.snapshot({});
      const btn = document.getElementById("btn")!;
      btn.remove();
      await expect(adapter.click("1")).rejects.toThrow('Ref 1 no longer exists in the DOM. Take a new snapshot.');
    });

    it("toggles checked state for native checkboxes as native fallback", async () => {
      setupHtml('<input type="checkbox" id="chk" />');
      const chk = document.getElementById("chk") as HTMLInputElement;
      expect(chk.checked).toBe(false);

      await adapter.snapshot({});
      await adapter.click("1");
      expect(chk.checked).toBe(true);
    });

    // 007: click must honour the abort signal — without the post-cue check,
    // one more click is dispatched 6 ms after Stop is pressed.
    it("returns the stopped message and dispatches nothing when the signal is already aborted", async () => {
      setupHtml('<button id="btn">Hello</button>');
      const btn = document.getElementById("btn")!;
      let clicked = false;
      btn.addEventListener("click", () => { clicked = true; });

      const controller = new AbortController();
      controller.abort();

      await adapter.snapshot({});
      const result = await adapter.click("1", controller.signal);
      expect(clicked).toBe(false);
      expect(result).toBe('Stopped by the user before the action on ref 1 ran. Nothing was changed on the page.');
    });

    it("aborts when the signal fires during the cue", async () => {
      setupHtml('<button id="btn">Hello</button>');
      const btn = document.getElementById("btn")!;
      let clicked = false;
      btn.addEventListener("click", () => { clicked = true; });

      const controller = new AbortController();
      const cueAdapter = new DomAdapter({
        actionCue: () => {
          controller.abort();
          return Promise.resolve();
        },
      });
      await cueAdapter.snapshot({});
      const result = await cueAdapter.click("1", controller.signal);
      expect(clicked).toBe(false);
      expect(result).toBe('Stopped by the user before the action on ref 1 ran. Nothing was changed on the page.');
    });

    it("click on opacity:0 element with stubRect executes handler, returns result with invisible note, and suppresses actionCue", async () => {
      setupHtml('<button id="btn" style="opacity:0">Hidden</button>');
      const btn = document.getElementById("btn")!;
      stubRect(btn, 100, 30);
      let clicked = false;
      btn.addEventListener("click", () => { clicked = true; });

      let cueCalled = false;
      const cueAdapter = new DomAdapter({
        actionCue: () => { cueCalled = true; return Promise.resolve(); },
      });
      await cueAdapter.snapshot({});
      const result = await cueAdapter.click("1");

      expect(clicked).toBe(true);
      expect(result).toContain("is not visible on screen");
      expect(cueCalled).toBe(false);
    });

    it("click on zero-size element executes handler, returns result with invisible note, and fires actionCue (zero-size guard in cue-actions suppresses movement)", async () => {
      setupHtml('<button id="btn">Zero</button>');
      const btn = document.getElementById("btn")!;
      stubRect(btn, 0, 0);
      let clicked = false;
      btn.addEventListener("click", () => { clicked = true; });

      let cueCalled = false;
      const cueAdapter = new DomAdapter({
        actionCue: () => { cueCalled = true; return Promise.resolve(); },
      });
      await cueAdapter.snapshot({});
      const result = await cueAdapter.click("1");

      expect(clicked).toBe(true);
      expect(result).toContain("is not visible on screen");
      expect(cueCalled).toBe(true);
    });

    it("click on normal visible element with stubRect returns result without invisible note and fires actionCue", async () => {
      setupHtml('<button id="btn">Hello</button>');
      const btn = document.getElementById("btn")!;
      stubRect(btn, 100, 30);
      let clicked = false;
      btn.addEventListener("click", () => { clicked = true; });

      let cueCalled = false;
      const cueAdapter = new DomAdapter({
        actionCue: () => { cueCalled = true; return Promise.resolve(); },
      });
      await cueAdapter.snapshot({});
      const result = await cueAdapter.click("1");

      expect(clicked).toBe(true);
      expect(result).not.toContain("is not visible on screen");
      expect(cueCalled).toBe(true);
    });

  });

  // -----------------------------------------------------------------------
  // Fill action tests
  // -----------------------------------------------------------------------
  const FULL_EVENT_TYPES = [
    "pointerdown", "mousedown", "focus", "focusin",
    "keydown", "beforeinput", "input", "keyup",
    "change", "blur", "focusout",
  ];
  function trackFull(el: Element, events: string[]) {
    for (const t of FULL_EVENT_TYPES) el.addEventListener(t, (e) => events.push(e.type));
  }

  describe("fill", () => {
    it("sets value, dispatches the full human event sequence for native input", async () => {
      setupHtml('<input id="txt" />');
      const input = document.getElementById("txt") as HTMLInputElement;
      const events: string[] = [];
      trackFull(input, events);

      await adapter.snapshot({});
      const result = await adapter.fill("1", "ACME");

      expect(input.value).toBe("ACME");
      expect(events).toEqual([
        "pointerdown", "mousedown", "focus", "focusin",
        "keydown", "beforeinput", "input", "keyup",
        "change", "blur", "focusout",
      ]);
      expect(result).toContain('Filled [1] textbox → value="ACME"');
    });

    it("sets value, dispatches the full human event sequence for textarea", async () => {
      setupHtml('<textarea id="txt"></textarea>');
      const textarea = document.getElementById("txt") as HTMLTextAreaElement;
      const events: string[] = [];
      trackFull(textarea, events);

      await adapter.snapshot({});
      const result = await adapter.fill("1", "Hello Textarea");

      expect(textarea.value).toBe("Hello Textarea");
      expect(events).toEqual([
        "pointerdown", "mousedown", "focus", "focusin",
        "keydown", "beforeinput", "input", "keyup",
        "change", "blur", "focusout",
      ]);
      expect(result).toContain('Filled [1] textbox → value="Hello Textarea"');
    });

    it("sets textContent, dispatches focus/key/input/blur but no change for contenteditable", async () => {
      setupHtml('<div id="editor" contenteditable="true"></div>');
      const div = document.getElementById("editor")!;
      const events: string[] = [];
      trackFull(div, events);

      await adapter.snapshot({});
      const result = await adapter.fill("1", "Rich Text Content");

      expect(div.textContent).toBe("Rich Text Content");
      expect(events).toEqual([
        "pointerdown", "mousedown", "focus", "focusin",
        "keydown", "beforeinput", "input", "keyup",
        "blur", "focusout",
      ]);
      expect(events.filter((e) => e === "change").length).toBe(0);
      expect(result).toContain('Filled [1] div "Rich Text Content" → value="Rich Text Content"');
    });

    it("throws an error if the element is disabled", async () => {
      setupHtml('<input id="txt" disabled />');
      await adapter.snapshot({});
      await expect(adapter.fill("1", "Hello")).rejects.toThrow('Ref 1 ("") is disabled. Inspect the form for unmet requirements.');
    });

    it("throws an error for non-fillable element", async () => {
      setupHtml('<button id="btn">Click me</button>');
      await adapter.snapshot({});
      await expect(adapter.fill("1", "Hello")).rejects.toThrow('Ref 1 is not a text input, textarea, or contenteditable.');
    });

    it("document.activeElement is the field mid-flight and is not the field after fill resolves", async () => {
      vi.useFakeTimers();
      setupHtml('<input id="txt" />');
      const input = document.getElementById("txt") as HTMLInputElement;

      const typingAdapter = new DomAdapter({ typingPaceMs: () => 50 });
      await typingAdapter.snapshot({});
      const fillPromise = typingAdapter.fill("1", "hello world");
      await vi.advanceTimersByTimeAsync(0); // first chunk fires, still mid-flight
      expect(document.activeElement).toBe(input);
      await vi.advanceTimersByTimeAsync(50);
      await fillPromise;
      expect(document.activeElement).not.toBe(input);

      vi.useRealTimers();
    });

    it("a blur handler reads the final value from the event target", async () => {
      setupHtml('<input id="txt" />');
      const input = document.getElementById("txt") as HTMLInputElement;
      let blurValue = "";
      input.addEventListener("blur", (e) => { blurValue = (e.target as HTMLInputElement).value; });

      await adapter.snapshot({});
      await adapter.fill("1", "hello world foo");

      expect(blurValue).toBe("hello world foo");
    });

    it("a document-level listener sees beforeinput, input and change for a field inside a shadow root", async () => {
      const host = document.createElement("div");
      document.body.appendChild(host);
      const shadow = host.attachShadow({ mode: "open" });
      const field = document.createElement("input");
      shadow.appendChild(field);

      const seen: string[] = [];
      document.addEventListener("beforeinput", () => seen.push("beforeinput"));
      document.addEventListener("input", () => seen.push("input"));
      document.addEventListener("change", () => seen.push("change"));

      await adapter.snapshot({});
      await adapter.fill("1", "hi");

      expect(seen).toEqual(["beforeinput", "input", "change"]);
      expect(field.value).toBe("hi");
    });

    it("does not throw when the host moves focus away mid-sequence, and the field's blur handler still runs once", async () => {
      setupHtml('<input id="txt" /><input id="other" />');
      const input = document.getElementById("txt") as HTMLInputElement;
      const other = document.getElementById("other") as HTMLInputElement;
      let blurCount = 0;
      input.addEventListener("keydown", () => other.focus());
      input.addEventListener("blur", () => { blurCount++; });

      await adapter.snapshot({});
      await expect(adapter.fill("1", "hi")).resolves.toBeDefined();

      expect(blurCount).toBe(1);
    });

    it("writes through the native prototype setter even when the instance has an own value accessor (React-style controlled input)", async () => {
      setupHtml('<input id="txt" />');
      const input = document.getElementById("txt") as HTMLInputElement;
      const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!;
      const nativeSetter: (v: string) => void = proto.set!.bind(input);
      const nativeGetter: () => string = proto.get!.bind(input);
      let ownSetterCalls = 0;
      // Mimics a React-style controlled input: an own accessor shadows the
      // prototype's, but the underlying storage is still the native slot.
      Object.defineProperty(input, "value", {
        configurable: true,
        get() { return nativeGetter(); },
        set(v: string) {
          ownSetterCalls++;
          nativeSetter(v);
        },
      });

      await adapter.snapshot({});
      await adapter.fill("1", "ACME");

      // DomAdapter writes via the prototype's own setter descriptor, which
      // bypasses the instance's own accessor entirely.
      expect(ownSetterCalls).toBe(0);
      expect(input.value).toBe("ACME");
    });

    it("fill on zero-size element sets value and returns result with invisible note and fires actionCue", async () => {
      setupHtml('<input id="txt" />');
      const input = document.getElementById("txt") as HTMLInputElement;
      stubRect(input, 0, 0);

      let cueCalled = false;
      const cueAdapter = new DomAdapter({
        actionCue: () => { cueCalled = true; return Promise.resolve(); },
      });
      await cueAdapter.snapshot({});
      const result = await cueAdapter.fill("1", "ACME");

      expect(input.value).toBe("ACME");
      expect(result).toContain("is not visible on screen");
      expect(cueCalled).toBe(true);
    });

    it("fill on normal visible element with stubRect returns result without invisible note", async () => {
      setupHtml('<input id="txt" />');
      const input = document.getElementById("txt") as HTMLInputElement;
      stubRect(input, 100, 30);

      let cueCalled = false;
      const cueAdapter = new DomAdapter({
        actionCue: () => { cueCalled = true; return Promise.resolve(); },
      });
      await cueAdapter.snapshot({});
      const result = await cueAdapter.fill("1", "ACME");

      expect(input.value).toBe("ACME");
      expect(result).not.toContain("is not visible on screen");
      expect(cueCalled).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Fill — word-by-word typing tests (T-T1..T-T9)
  // -----------------------------------------------------------------------
  describe("fill — word-by-word typing", () => {
    it("T-T1 types word-by-word, N input events, final value correct", async () => {
      vi.useFakeTimers();
      setupHtml('<input id="txt" />');
      const input = document.getElementById("txt") as HTMLInputElement;
      const events: string[] = [];
      input.addEventListener("input", () => events.push(`input:${input.value}`));
      input.addEventListener("change", () => events.push(`change:${input.value}`));

      const typingAdapter = new DomAdapter({ typingPaceMs: () => 50 });
      await typingAdapter.snapshot({});
      const fillPromise = typingAdapter.fill("1", "hello world foo");

      // Advance step by step: each word fires at i*50ms
      await vi.advanceTimersByTimeAsync(0);   // chunk 0 fires
      expect(input.value).toBe("hello ");
      await vi.advanceTimersByTimeAsync(50);  // chunk 1 fires
      expect(input.value).toBe("hello world ");
      await vi.advanceTimersByTimeAsync(50);  // chunk 2 fires
      expect(input.value).toBe("hello world foo");

      await fillPromise;

      expect(input.value).toBe("hello world foo");
      // 3 input events (one per word) + 1 change at the end
      expect(events.filter(e => e.startsWith("input:")).length).toBe(3);
      expect(events.filter(e => e.startsWith("change:")).length).toBe(1);
      // change fires after the last input
      expect(events[events.length - 1]).toBe("change:hello world foo");

      vi.useRealTimers();
    });

    it("T-T2 single word ⇒ full sequence, 1 input + 1 change", async () => {
      vi.useFakeTimers();
      setupHtml('<input id="txt" />');
      const input = document.getElementById("txt") as HTMLInputElement;
      const events: string[] = [];
      trackFull(input, events);

      const typingAdapter = new DomAdapter({ typingPaceMs: () => 50 });
      await typingAdapter.snapshot({});
      const fillPromise = typingAdapter.fill("1", "ACME");
      await vi.advanceTimersByTimeAsync(0);
      await fillPromise;

      expect(input.value).toBe("ACME");
      expect(events).toEqual([
        "pointerdown", "mousedown", "focus", "focusin",
        "keydown", "beforeinput", "input", "keyup",
        "change", "blur", "focusout",
      ]);

      vi.useRealTimers();
    });

    it("paced three-chunk fill: keydown/beforeinput/input ×3, change ×1, blur ×1", async () => {
      vi.useFakeTimers();
      setupHtml('<input id="txt" />');
      const input = document.getElementById("txt") as HTMLInputElement;
      const events: string[] = [];
      trackFull(input, events);

      const typingAdapter = new DomAdapter({ typingPaceMs: () => 50 });
      await typingAdapter.snapshot({});
      const fillPromise = typingAdapter.fill("1", "hello world foo");
      await vi.advanceTimersByTimeAsync(200);
      await fillPromise;

      const count = (t: string) => events.filter((e) => e === t).length;
      expect(count("keydown")).toBe(3);
      expect(count("beforeinput")).toBe(3);
      expect(count("input")).toBe(3);
      expect(count("change")).toBe(1);
      expect(count("blur")).toBe(1);
      // change precedes blur, blur precedes focusout
      expect(events.indexOf("change")).toBeLessThan(events.indexOf("blur"));
      expect(events.indexOf("blur")).toBeLessThan(events.indexOf("focusout"));

      vi.useRealTimers();
    });

    it("instant and paced fills emit the same de-duplicated event-type order", async () => {
      setupHtml('<input id="instant" /><input id="paced" />');
      const instantEl = document.getElementById("instant") as HTMLInputElement;
      const pacedEl = document.getElementById("paced") as HTMLInputElement;
      const instantEvents: string[] = [];
      const pacedEvents: string[] = [];
      trackFull(instantEl, instantEvents);
      trackFull(pacedEl, pacedEvents);

      await adapter.snapshot({});
      await adapter.fill("1", "ACME");

      vi.useFakeTimers();
      const typingAdapter = new DomAdapter({ typingPaceMs: () => 50 });
      await typingAdapter.snapshot({});
      const fillPromise = typingAdapter.fill("2", "hello world foo");
      await vi.advanceTimersByTimeAsync(200);
      await fillPromise;
      vi.useRealTimers();

      expect([...new Set(pacedEvents)]).toEqual([...new Set(instantEvents)]);
    });

    it("T-T3 textarea types word-by-word", async () => {
      vi.useFakeTimers();
      setupHtml('<textarea id="txt"></textarea>');
      const ta = document.getElementById("txt") as HTMLTextAreaElement;
      const events: string[] = [];
      ta.addEventListener("input", () => events.push(`input:${ta.value}`));
      ta.addEventListener("change", () => events.push("change"));

      const typingAdapter = new DomAdapter({ typingPaceMs: () => 50 });
      await typingAdapter.snapshot({});
      const fillPromise = typingAdapter.fill("1", "hello world foo");
      await vi.advanceTimersByTimeAsync(200); // advance past all 3 chunks
      await fillPromise;

      expect(ta.value).toBe("hello world foo");
      expect(events.filter(e => e.startsWith("input:")).length).toBe(3);
      expect(events.filter(e => e === "change").length).toBe(1);

      vi.useRealTimers();
    });

    it("T-T4 change fires once, only at the end", async () => {
      vi.useFakeTimers();
      setupHtml('<input id="txt" />');
      const input = document.getElementById("txt") as HTMLInputElement;
      const order: string[] = [];
      input.addEventListener("input", () => order.push("input"));
      input.addEventListener("change", () => order.push("change"));

      const typingAdapter = new DomAdapter({ typingPaceMs: () => 50 });
      await typingAdapter.snapshot({});
      const fillPromise = typingAdapter.fill("1", "one two three");
      await vi.advanceTimersByTimeAsync(200);
      await fillPromise;

      expect(order.filter(e => e === "change").length).toBe(1);
      // change must come after all inputs
      expect(order[order.length - 1]).toBe("change");
      expect(order.indexOf("change")).toBeGreaterThan(order.indexOf("input"));

      vi.useRealTimers();
    });

    it("T-T5 reduced-motion ⇒ instant (no timer advance needed), full sequence", async () => {
      vi.useFakeTimers();
      setupHtml('<input id="txt" />');
      const input = document.getElementById("txt") as HTMLInputElement;
      const events: string[] = [];
      trackFull(input, events);

      // Stub matchMedia to report reduced-motion
      const origMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia")!;
      Object.defineProperty(window, "matchMedia", {
        writable: true,
        value: (q: string) => ({ matches: q.includes("reduced-motion"), media: q, addEventListener: () => {}, removeEventListener: () => {} }),
      });

      const typingAdapter = new DomAdapter({ typingPaceMs: () => 50 });
      await typingAdapter.snapshot({});
      // fill must complete synchronously (instant path) without timer advance
      const fillPromise = typingAdapter.fill("1", "hello world foo");
      await fillPromise;

      expect(input.value).toBe("hello world foo");
      expect(events).toEqual([
        "pointerdown", "mousedown", "focus", "focusin",
        "keydown", "beforeinput", "input", "keyup",
        "change", "blur", "focusout",
      ]);

      // Restore
      Object.defineProperty(window, "matchMedia", origMatchMedia);
      vi.useRealTimers();
    });

    it("T-T6 pace undefined / 0 ⇒ instant (back-compat)", async () => {
      vi.useFakeTimers();
      setupHtml('<input id="txt" />');
      const input = document.getElementById("txt") as HTMLInputElement;
      const events: string[] = [];
      input.addEventListener("input", () => events.push("input"));
      input.addEventListener("change", () => events.push("change"));

      // Default adapter (no typingPaceMs)
      const defaultAdapter = new DomAdapter();
      await defaultAdapter.snapshot({});
      await defaultAdapter.fill("1", "hello world");
      expect(events).toEqual(["input", "change"]);
      expect(input.value).toBe("hello world");

      // Explicit 0 pace
      document.body.innerHTML = '<input id="txt2" />';
      const input2 = document.getElementById("txt2") as HTMLInputElement;
      const events2: string[] = [];
      input2.addEventListener("input", () => events2.push("input"));
      input2.addEventListener("change", () => events2.push("change"));
      const zeroPaceAdapter = new DomAdapter({ typingPaceMs: () => 0 });
      await zeroPaceAdapter.snapshot({});
      await zeroPaceAdapter.fill("1", "hello world");
      expect(events2).toEqual(["input", "change"]);
      expect(input2.value).toBe("hello world");

      vi.useRealTimers();
    });

    it("T-T7 cancel mid-type via abort leaves a consistent prefix and fires one change for the partial value (007)", async () => {
      vi.useFakeTimers();
      setupHtml('<input id="txt" />');
      const input = document.getElementById("txt") as HTMLInputElement;
      const events: string[] = [];
      input.addEventListener("input", () => events.push(`input:${input.value}`));
      input.addEventListener("change", () => events.push("change"));

      const controller = new AbortController();
      const typingAdapter = new DomAdapter({ typingPaceMs: () => 50 });
      await typingAdapter.snapshot({});
      const fillPromise = typingAdapter.fill("1", "one two three four", controller.signal);

      // Advance past first word (t=0) and second word (t=50)
      await vi.advanceTimersByTimeAsync(0);   // "one "
      await vi.advanceTimersByTimeAsync(50);  // "one two "
      // Abort before third word fires (t=100)
      controller.abort();
      // Advance remaining timers — should NOT fire more input
      await vi.advanceTimersByTimeAsync(200);
      await fillPromise;

      // Prefix "one two " was typed; no further input
      expect(events.filter(e => e.startsWith("input:")).length).toBe(2);
      // 007: the partial value commits a single change (no half-typed value left un-committed)
      expect(events.filter(e => e === "change").length).toBe(1);
      // el.value is the typed partial prefix
      expect(input.value).toBe("one two ");
      // No dangling timers
      expect(vi.getTimerCount()).toBe(0);
      // Cancelling leaves no dangling focus.
      expect(document.activeElement).not.toBe(input);

      vi.useRealTimers();
    });

    it("T-T8 contenteditable still instant with typingPaceMs set", async () => {
      vi.useFakeTimers();
      setupHtml('<div id="editor" contenteditable="true"></div>');
      const div = document.getElementById("editor")!;
      const events: string[] = [];
      div.addEventListener("input", () => events.push("input"));

      const typingAdapter = new DomAdapter({ typingPaceMs: () => 50 });
      await typingAdapter.snapshot({});
      const fillPromise = typingAdapter.fill("1", "hello world");
      // contenteditable branch is instant — no timer advance needed
      await fillPromise;

      expect(div.textContent).toBe("hello world");
      expect(events).toEqual(["input"]);

      vi.useRealTimers();
    });

    it("T-T9 leading/trailing whitespace preserved (no char loss)", async () => {
      vi.useFakeTimers();
      setupHtml('<input id="txt" />');
      const input = document.getElementById("txt") as HTMLInputElement;

      const typingAdapter = new DomAdapter({ typingPaceMs: () => 50 });
      await typingAdapter.snapshot({});
      const fillPromise = typingAdapter.fill("1", "  hi  there ");
      await vi.advanceTimersByTimeAsync(200);
      await fillPromise;

      expect(input.value).toBe("  hi  there ");

      vi.useRealTimers();
    });

    // 007: fill must honour the abort signal after the cue — the field must
    // never become document.activeElement.
    it("does not focus the field when the signal aborts during the cue", async () => {
      setupHtml('<input id="txt" />');
      const input = document.getElementById("txt") as HTMLInputElement;

      const controller = new AbortController();
      const cueAdapter = new DomAdapter({
        actionCue: () => {
          controller.abort();
          return Promise.resolve();
        },
        typingPaceMs: () => 50,
      });
      await cueAdapter.snapshot({});
      const result = await cueAdapter.fill("1", "hello world", controller.signal);

      expect(document.activeElement).not.toBe(input);
      expect(result).toBe('Stopped by the user before the action on ref 1 ran. Nothing was changed on the page.');
    });

    // 007: a stop that lands before the first keystroke leaves the field
    // untouched and fires no change.
    it("a fill aborted before the first chunk fires no change", async () => {
      vi.useFakeTimers();
      setupHtml('<input id="txt" />');
      const input = document.getElementById("txt") as HTMLInputElement;
      const changeEvents: string[] = [];
      input.addEventListener("change", () => changeEvents.push("change"));

      const controller = new AbortController();
      const typingAdapter = new DomAdapter({ typingPaceMs: () => 50 });
      await typingAdapter.snapshot({});
      // Abort synchronously — signal is already aborted before any chunk fires
      controller.abort();
      const fillPromise = typingAdapter.fill("1", "hello world", controller.signal);
      await vi.advanceTimersByTimeAsync(200);
      await fillPromise;

      expect(input.value).toBe("");
      expect(changeEvents.length).toBe(0);
      vi.useRealTimers();
    });

    // 007: regression guard for task 006 — an uninterrupted fill must fire
    // exactly one change event, not one per word.
    it("an uninterrupted fill still fires exactly one change", async () => {
      vi.useFakeTimers();
      setupHtml('<input id="txt" />');
      const input = document.getElementById("txt") as HTMLInputElement;
      const changeEvents: string[] = [];
      input.addEventListener("change", () => changeEvents.push(input.value));

      const typingAdapter = new DomAdapter({ typingPaceMs: () => 50 });
      await typingAdapter.snapshot({});
      const fillPromise = typingAdapter.fill("1", "one two three");
      await vi.advanceTimersByTimeAsync(200);
      await fillPromise;

      expect(input.value).toBe("one two three");
      expect(changeEvents.length).toBe(1);
      expect(changeEvents[0]).toBe("one two three");

      vi.useRealTimers();
    });
  });

  // -----------------------------------------------------------------------
  // Select Option tests
  // -----------------------------------------------------------------------
  describe("selectOption", () => {
    it("selects an option by label, value, case-insensitive, and fires change", async () => {
      setupHtml(`<select id="sel">
        <option value="val1">Label One</option>
        <option value="val2">Label Two</option>
      </select>`);
      const sel = document.getElementById("sel") as HTMLSelectElement;
      let fired = false;
      sel.addEventListener("change", () => { fired = true; });

      await adapter.snapshot({});
      
      let result = await adapter.selectOption("1", "Label One");
      expect(sel.value).toBe("val1");
      expect(fired).toBe(true);
      expect(result).toContain('Selected "Label One" in [1]');

      fired = false;

      result = await adapter.selectOption("1", "val2");
      expect(sel.value).toBe("val2");
      expect(fired).toBe(true);
      expect(result).toContain('Selected "Label Two" in [1]');

      fired = false;

      result = await adapter.selectOption("1", "label one");
      expect(sel.value).toBe("val1");
      expect(fired).toBe(true);
      expect(result).toContain('Selected "Label One" in [1]');
    });

    it("errors when option not found", async () => {
      setupHtml(`<select id="sel"><option value="a">A</option></select>`);
      await adapter.snapshot({});
      await expect(adapter.selectOption("1", "NonExistent")).rejects.toThrow('No option "NonExistent". Available: A');
    });

    it("errors when non-select element is provided", async () => {
      setupHtml(`<button id="btn">Not a select</button>`);
      await adapter.snapshot({});
      await expect(adapter.selectOption("1", "A")).rejects.toThrow('is not a native <select>');
    });

    it("golden path: exact focus/input/change/blur/focusout order, no pointer events, blur count 1", async () => {
      setupHtml(`<select id="sel">
        <option value="">Choose</option>
        <option value="basic">Basic</option>
        <option value="premium">Premium</option>
      </select>`);
      const sel = document.getElementById("sel") as HTMLSelectElement;
      const events: string[] = [];
      trackFull(sel, events);

      await adapter.snapshot({});
      const result = await adapter.selectOption("1", "Premium");

      expect(sel.value).toBe("premium");
      expect(events).toEqual(["focus", "focusin", "input", "change", "blur", "focusout"]);
      expect(events.filter((e) => e === "pointerdown" || e === "mousedown").length).toBe(0);
      expect(events.filter((e) => e === "blur").length).toBe(1);
      expect(result).toContain('Selected "Premium" in [1]');
    });

    // 007: selectOption must honour the abort signal after the cue.
    it("leaves the select unchanged when the signal is aborted", async () => {
      setupHtml(`<select id="sel">
        <option value="">Choose</option>
        <option value="basic">Basic</option>
        <option value="premium">Premium</option>
      </select>`);
      const sel = document.getElementById("sel") as HTMLSelectElement;
      let changeFired = 0;
      sel.addEventListener("change", () => { changeFired++; });

      const controller = new AbortController();
      controller.abort();

      await adapter.snapshot({});
      const result = await adapter.selectOption("1", "Premium", controller.signal);

      expect(sel.value).toBe("");
      expect(changeFired).toBe(0);
      expect(result).toBe('Stopped by the user before the action on ref 1 ran. Nothing was changed on the page.');
    });

    it("selectOption on zero-size select updates option and returns result with invisible note and fires actionCue", async () => {
      setupHtml(`<select id="sel">
        <option value="a">A</option>
        <option value="b">B</option>
      </select>`);
      const sel = document.getElementById("sel") as HTMLSelectElement;
      stubRect(sel, 0, 0);

      let cueCalled = false;
      const cueAdapter = new DomAdapter({
        actionCue: () => { cueCalled = true; return Promise.resolve(); },
      });
      await cueAdapter.snapshot({});
      const result = await cueAdapter.selectOption("1", "B");

      expect(sel.value).toBe("b");
      expect(result).toContain("is not visible on screen");
      expect(cueCalled).toBe(true);
    });

    it("selectOption on normal visible select with stubRect returns result without invisible note", async () => {
      setupHtml(`<select id="sel">
        <option value="a">A</option>
        <option value="b">B</option>
      </select>`);
      const sel = document.getElementById("sel") as HTMLSelectElement;
      stubRect(sel, 100, 30);

      let cueCalled = false;
      const cueAdapter = new DomAdapter({
        actionCue: () => { cueCalled = true; return Promise.resolve(); },
      });
      await cueAdapter.snapshot({});
      const result = await cueAdapter.selectOption("1", "B");

      expect(sel.value).toBe("b");
      expect(result).not.toContain("is not visible on screen");
      expect(cueCalled).toBe(true);
    });

  });

  // -----------------------------------------------------------------------
  // selectOptions — single- and multi-select act-by-ref (122/001)
  // -----------------------------------------------------------------------
  describe("selectOptions", () => {
    it("single select rejects multiple values", async () => {
      setupHtml(`<select id="sel">
        <option value="standard">Standard</option>
        <option value="express">Express</option>
      </select>`);
      const sel = document.getElementById("sel") as HTMLSelectElement;
      await adapter.snapshot({});
      await expect(adapter.selectOptions("1", ["Standard", "Express"])).rejects.toThrow(
        "Ref 1 is a single-choice select; pass exactly one value.",
      );
      expect(sel.value).toBe("standard");
    });

    it("single select with exactly one value delegates to selectOption", async () => {
      setupHtml(`<select id="sel">
        <option value="standard">Standard</option>
        <option value="express">Express</option>
      </select>`);
      const sel = document.getElementById("sel") as HTMLSelectElement;
      await adapter.snapshot({});
      const result = await adapter.selectOptions("1", ["Express"]);
      expect(sel.value).toBe("express");
      expect(result).toContain('Selected "Express" in [1]');
    });

    it("multiple select selects all matched options and fires change once", async () => {
      setupHtml(`<label for="sel">Extras</label><select id="sel" multiple>
        <option value="giftwrap">Gift wrap</option>
        <option value="card">Card</option>
        <option value="insurance">Insurance</option>
      </select>`);
      const sel = document.getElementById("sel") as HTMLSelectElement;
      stubRect(sel, 100, 30);
      let changeCount = 0;
      sel.addEventListener("change", () => { changeCount++; });

      await adapter.snapshot({});
      const result = await adapter.selectOptions("1", ["Gift wrap", "Card"]);

      const selected = Array.from(sel.options).filter((o) => o.selected).map((o) => o.label);
      expect(selected).toEqual(["Gift wrap", "Card"]);
      expect(changeCount).toBe(1);
      expect(result).toBe('Selected "Gift wrap", "Card" in [1] combobox "Extras".');
    });

    it("multiple select replaces a previous selection rather than adding to it", async () => {
      setupHtml(`<select id="sel" multiple>
        <option value="a" selected>A</option>
        <option value="b">B</option>
        <option value="c">C</option>
      </select>`);
      const sel = document.getElementById("sel") as HTMLSelectElement;
      await adapter.snapshot({});
      await adapter.selectOptions("1", ["B", "C"]);
      const selected = Array.from(sel.options).filter((o) => o.selected).map((o) => o.label);
      expect(selected).toEqual(["B", "C"]);
    });

    it("multiple select throws the option-missing message and changes nothing on a bad value", async () => {
      setupHtml(`<select id="sel" multiple>
        <option value="a">A</option>
        <option value="b">B</option>
      </select>`);
      const sel = document.getElementById("sel") as HTMLSelectElement;
      await adapter.snapshot({});
      await expect(adapter.selectOptions("1", ["A", "NotThere"])).rejects.toThrow('No option "NotThere". Available: A, B');
      expect(Array.from(sel.options).some((o) => o.selected)).toBe(false);
    });

    it("errors when non-select element is provided", async () => {
      setupHtml(`<button id="btn">Not a select</button>`);
      await adapter.snapshot({});
      await expect(adapter.selectOptions("1", ["A"])).rejects.toThrow("is not a native <select>");
    });

    it("throws an error if the element is disabled", async () => {
      setupHtml(`<select id="sel" multiple disabled><option value="a">A</option></select>`);
      await adapter.snapshot({});
      await expect(adapter.selectOptions("1", ["A"])).rejects.toThrow("is disabled");
    });
  });

  // -----------------------------------------------------------------------
  // Wait_for tests
  // -----------------------------------------------------------------------
  describe("wait_for", () => {
    it("waitForText resolves true when text becomes present", async () => {
      setupHtml('<div id="content"></div>');
      const promise = adapter.waitForText("Hello Async", 500);

      setTimeout(() => {
        setupHtml('<div id="content">Hello Async</div>');
      }, 50);

      const res = await promise;
      expect(res).toBe(true);
    });

    it("waitForText resolves false on timeout", async () => {
      setupHtml('<div>Nothing</div>');
      const res = await adapter.waitForText("Missing Text", 50);
      expect(res).toBe(false);
    });

    it("waitForText excludes data-agent-ui", async () => {
      setupHtml('<div data-agent-ui="true">Secret Agent UI Text</div>');
      const res = await adapter.waitForText("Agent UI Text", 100);
      expect(res).toBe(false);
    });

    it("waitForText resolves false when aborted", async () => {
      setupHtml('<div>Waiting...</div>');
      const controller = new AbortController();
      const promise = adapter.waitForText("Some text", 500, controller.signal);

      setTimeout(() => {
        controller.abort();
      }, 50);

      const res = await promise;
      expect(res).toBe(false);
    });

    it("waitForIdle resolves true when mutations stop", async () => {
      setupHtml('<div id="content"></div>');
      const promise = adapter.waitForIdle(1000);

      let count = 0;
      const interval = setInterval(() => {
        const div = document.getElementById("content");
        if (div) div.textContent = `Mut ${count++}`;
        if (count >= 3) clearInterval(interval);
      }, 100);

      const res = await promise;
      expect(res).toBe(true);
    });

  });

  // -----------------------------------------------------------------------
  // Screenshot tests
  // -----------------------------------------------------------------------
  describe("screenshot", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("captures document body when no scope given", async () => {
      setupHtml("<main><h1>Hello</h1></main>");
      const result = await adapter.screenshot();
      expect(result.dataUrl).toContain("data:image");
      expect(result.mediaType).toBe("image/png");
      expect(typeof result.width).toBe("number");
      expect(typeof result.height).toBe("number");
      const { toPng } = await import("html-to-image");
      expect(toPng).toHaveBeenCalledTimes(1);
    });

    it("returns mediaType image/jpeg when downscaleToolImage outputs jpeg", async () => {
      setupHtml("<main><h1>Hello</h1></main>");
      const { downscaleToolImage } = await import("@cuatoi/web-agent-core");
      vi.mocked(downscaleToolImage).mockResolvedValueOnce("data:image/jpeg;base64,ZZZ=");
      const result = await adapter.screenshot();
      expect(result.mediaType).toBe("image/jpeg");
    });

    it("captures a specific element subtree when scope ref is given", async () => {
      setupHtml("<div id='x'><button>Nested</button></div>");
      await adapter.snapshot({}); // assigns ref
      // jsdom reports 0x0 for every element, which the new zero-size guard rejects.
      // Stub a real box so this test exercises the normal capture path.
      stubRect(document.querySelector("button")!, 120, 40);
      const result = await adapter.screenshot("1");
      expect(result.dataUrl).toContain("data:image");
      const { toPng } = await import("html-to-image");
      const callArgs = vi.mocked(toPng).mock.calls[0];
      expect(callArgs[0].tagName).toBe("BUTTON");
    });

    it("throws staleRef error for stale scope ref", async () => {
      setupHtml("<div id='y'><button>Gone</button></div>");
      const rt = new RefTable();
      const el = document.getElementById("y")!;
      rt.assign(el);
      rt.invalidateAll();
      const a = new DomAdapter({ refTable: rt });
      await expect(a.screenshot("1")).rejects.toThrow("stale");
    });

    it("throws detachedRef error for detached scope ref", async () => {
      setupHtml("<div id='z'><button>Detach</button></div>");
      const rt = new RefTable();
      const el = document.getElementById("z")!;
      const ref = String(rt.assign(el));
      el.remove();
      const a = new DomAdapter({ refTable: rt });
      await expect(a.screenshot(ref)).rejects.toThrow("no longer exists");
    });

    it("passes the PNG capture to downscaleToolImage", async () => {
      setupHtml("<main><p>Test</p></main>");
      await adapter.screenshot();
      const { downscaleToolImage } = await import("@cuatoi/web-agent-core");
      expect(downscaleToolImage).toHaveBeenCalledWith("data:image/png;base64,AAA=");
    });

    it("throws an actionable error for a scope ref with zero rendered size", async () => {
      setupHtml("<div id='x'><button id='collapsed'>Buy now</button></div>");
      await adapter.snapshot({});                 // assigns ref "1" to the button
      // no stubRect: jsdom's default 0x0 IS the zero-size case
      await expect(adapter.screenshot("1")).rejects.toThrow(/is not visible/);
      const { toPng } = await import("html-to-image");
      expect(toPng).not.toHaveBeenCalled();        // never rasterized
    });

    it("names the ref and the element name in the zero-size error", async () => {
      setupHtml("<div id='x'><button>Buy now</button></div>");
      await adapter.snapshot({});
      await expect(adapter.screenshot("1")).rejects.toThrow(/Ref 1\b/);
      await expect(adapter.screenshot("1")).rejects.toThrow(/"Buy now"/);
    });

    it("does not fire the action cue for a zero-size scope ref", async () => {
      setupHtml("<div id='x'><button>Buy now</button></div>");
      const spy = vi.fn(async () => {});
      const rt = new RefTable();
      const ref = String(rt.assign(document.querySelector("button")!));
      const a = new DomAdapter({ actionCue: spy, refTable: rt });
      await expect(a.screenshot(ref)).rejects.toThrow(/is not visible/);
      expect(spy).not.toHaveBeenCalled();
    });

    it("throws when rasterization yields a data URL with no payload", async () => {
      setupHtml("<main><h1>Hello</h1></main>");
      const { toPng } = await import("html-to-image");
      (toPng as ReturnType<typeof vi.fn>).mockResolvedValueOnce("data:,");
      // no scope, so the zero-size guard does not apply — the payload guard must catch it
      await expect(adapter.screenshot()).rejects.toThrow(/came back empty/);
    });

    it("throws for an empty payload even on a normally sized scope ref", async () => {
      setupHtml("<div id='x'><button>Buy now</button></div>");
      await adapter.snapshot({});
      stubRect(document.querySelector("button")!, 120, 40);
      const { toPng } = await import("html-to-image");
      (toPng as ReturnType<typeof vi.fn>).mockResolvedValueOnce("data:,");
      await expect(adapter.screenshot("1")).rejects.toThrow(/is not visible/);
    });

    it("still returns a real screenshot for a sized scope ref", async () => {
      setupHtml("<div id='x'><button>Buy now</button></div>");
      await adapter.snapshot({});
      stubRect(document.querySelector("button")!, 120, 40);
      const result = await adapter.screenshot("1");
      expect(result.dataUrl).toBe("data:image/png;base64,AAA=");
      expect(result.width).toBe(120);
      expect(result.height).toBe(40);
    });

    it("display:none scoped ref rejects with is not visible triggered by jsdom 0x0 rect", async () => {
      setupHtml("<div id='x'><button>Buy now</button></div>");
      const btn = document.querySelector("button")!;
      const ref = String(adapter.refTable.assign(btn));
      btn.style.display = "none";
      await expect(adapter.screenshot(ref)).rejects.toThrow(/is not visible/);
    });

    it("visibility:hidden with stubRect resolves with warning", async () => {
      setupHtml("<div id='x'><button>Buy now</button></div>");
      const btn = document.querySelector("button")!;
      const ref = String(adapter.refTable.assign(btn));
      btn.style.visibility = "hidden";
      stubRect(btn, 60, 22);
      const result = await adapter.screenshot(ref);
      expect(result.dataUrl).toBe("data:image/png;base64,AAA=");
      expect(result.warning).toMatch(/may not contain the element/);
    });

    it("opacity:0 with stubRect resolves with warning", async () => {
      setupHtml("<div id='x'><button>Buy now</button></div>");
      const btn = document.querySelector("button")!;
      const ref = String(adapter.refTable.assign(btn));
      btn.style.opacity = "0";
      stubRect(btn, 91, 22);
      const result = await adapter.screenshot(ref);
      expect(result.dataUrl).toBe("data:image/png;base64,AAA=");
      expect(result.warning).toMatch(/may not contain the element/);
    });

    it("clip-path with stubRect and hasVisiblePixels returning false resolves with warning", async () => {
      setupHtml("<div id='x'><button>Buy now</button></div>");
      const btn = document.querySelector("button")!;
      const ref = String(adapter.refTable.assign(btn));
      btn.style.clipPath = "inset(50%)";
      stubRect(btn, 63, 22);
      const { hasVisiblePixels } = await import("../utils/image-alpha.js");
      (hasVisiblePixels as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);

      const result = await adapter.screenshot(ref);
      expect(result.dataUrl).toBe("data:image/png;base64,AAA=");
      expect(result.warning).toMatch(/may not contain the element/);
    });

    it("normal element with stubRect and hasVisiblePixels returning true has no warning", async () => {
      setupHtml("<div id='x'><button>Buy now</button></div>");
      await adapter.snapshot({});
      stubRect(document.querySelector("button")!, 120, 40);
      const { hasVisiblePixels } = await import("../utils/image-alpha.js");
      (hasVisiblePixels as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);

      const result = await adapter.screenshot("1");
      expect(result.dataUrl).toBe("data:image/png;base64,AAA=");
      expect(result).not.toHaveProperty("warning");
    });

    it("normal element with hasVisiblePixels returning undefined still has no warning", async () => {
      setupHtml("<div id='x'><button>Buy now</button></div>");
      await adapter.snapshot({});
      stubRect(document.querySelector("button")!, 120, 40);
      const { hasVisiblePixels } = await import("../utils/image-alpha.js");
      (hasVisiblePixels as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);

      const result = await adapter.screenshot("1");
      expect(result.dataUrl).toBe("data:image/png;base64,AAA=");
      expect(result).not.toHaveProperty("warning");
    });

    it("hasVisiblePixels is called with the toPng pre-downscale output", async () => {
      setupHtml("<div id='x'><button>Buy now</button></div>");
      await adapter.snapshot({});
      stubRect(document.querySelector("button")!, 120, 40);

      const { downscaleToolImage } = await import("@cuatoi/web-agent-core");
      (downscaleToolImage as ReturnType<typeof vi.fn>).mockResolvedValueOnce("data:image/png;base64,ZZZ=");

      const { hasVisiblePixels } = await import("../utils/image-alpha.js");
      (hasVisiblePixels as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);

      await adapter.screenshot("1");
      expect(hasVisiblePixels).toHaveBeenCalledWith("data:image/png;base64,AAA=");
    });

    it("unscoped see never calls hasVisiblePixels and never returns a warning", async () => {
      setupHtml("<main><h1>Hello</h1></main>");
      const { hasVisiblePixels } = await import("../utils/image-alpha.js");
      (hasVisiblePixels as ReturnType<typeof vi.fn>).mockClear();

      const result = await adapter.screenshot();
      expect(hasVisiblePixels).not.toHaveBeenCalled();
      expect(result).not.toHaveProperty("warning");
    });
  });

  describe("permission gate", () => {
    it("allow (or absent) click proceeds normally", async () => {
      setupHtml('<button id="btn">Hello</button>');
      let clicked = false;
      document.getElementById("btn")!.addEventListener("click", () => { clicked = true; });
      await adapter.snapshot({});
      const result = await adapter.click("1");
      expect(clicked).toBe(true);
      expect(result).toContain('Clicked [1]');
    });

    it("block returns terminal message and does NOT click", async () => {
      setupHtml('<button id="btn" data-agent-permission="block">Sensitive</button>');
      let clicked = false;
      document.getElementById("btn")!.addEventListener("click", () => { clicked = true; });
      await adapter.snapshot({});
      const result = await adapter.click("1");
      expect(clicked).toBe(false);
      expect(result).toContain("Blocked by interaction policy");
    });

    it("block returns terminal message for fill and dispatches nothing", async () => {
      setupHtml('<input id="inp" data-agent-permission="block" />');
      const input = document.getElementById("inp") as HTMLInputElement;
      const events: string[] = [];
      trackFull(input, events);
      await adapter.snapshot({});
      const result = await adapter.fill("1", "hello");
      expect(result).toContain("Blocked by interaction policy");
      expect(events).toEqual([]);
    });

    it("block returns terminal message for selectOption and dispatches nothing", async () => {
      setupHtml('<select id="sel" data-agent-permission="block"><option>A</option></select>');
      const sel = document.getElementById("sel") as HTMLSelectElement;
      const events: string[] = [];
      trackFull(sel, events);
      await adapter.snapshot({});
      const result = await adapter.selectOption("1", "A");
      expect(result).toContain("Blocked by interaction policy");
      expect(events).toEqual([]);
    });

    it("block includes reason when present", async () => {
      setupHtml('<button data-agent-permission="block" data-agent-permission-reason="Admin only">Delete</button>');
      await adapter.snapshot({});
      const result = await adapter.click("1");
      expect(result).toContain("(Admin only)");
    });

    // "ask"-tier confirmation lives in the `confirmInteraction` gate of
    // `domTools()` (007) — DomAdapter does not know about `confirmInteraction`.
    // By the time click/fill/selectOption run, the gate has already run
    // (see tool-provider.test.ts for the reject path), so
    // DomAdapter itself just performs "ask"-tier actions like "allow".

    it("ask proceeds normally at the DomAdapter level for click", async () => {
      setupHtml('<button id="btn" data-agent-permission="ask">Delete</button>');
      let clicked = false;
      document.getElementById("btn")!.addEventListener("click", () => { clicked = true; });
      await adapter.snapshot({});
      const result = await adapter.click("1");
      expect(clicked).toBe(true);
      expect(result).toContain('Clicked [1]');
    });

    it("ask proceeds normally at the DomAdapter level for fill", async () => {
      setupHtml('<input id="inp" data-agent-permission="ask" />');
      await adapter.snapshot({});
      const result = await adapter.fill("1", "hello");
      expect(result).toContain('Filled');
    });

    it("ask proceeds normally at the DomAdapter level for selectOption", async () => {
      setupHtml('<select id="sel" data-agent-permission="ask"><option>A</option></select>');
      await adapter.snapshot({});
      const result = await adapter.selectOption("1", "A");
      expect(result).toContain('Selected');
    });

    it("inherits permission from nearest ancestor", async () => {
      setupHtml(`
        <div data-agent-permission="block">
          <button id="btn">Nested</button>
        </div>
      `);
      let clicked = false;
      document.getElementById("btn")!.addEventListener("click", () => { clicked = true; });
      await adapter.snapshot({});
      const result = await adapter.click("1");
      expect(clicked).toBe(false);
      expect(result).toContain("Blocked by interaction policy");
    });
  });

  describe("describeRef (004)", () => {
    it("returns name, permission and reason for a resolvable ref", async () => {
      setupHtml('<button id="btn" data-agent-permission="ask" data-agent-permission-reason="confirm please">Remove item</button>');
      await adapter.snapshot({});
      const info = adapter.describeRef("1");
      expect(info).toEqual({ name: "Remove item", permission: "ask", permissionReason: "confirm please" });
    });

    it("returns permission allow with no reason when unset", async () => {
      setupHtml('<button id="btn">Add</button>');
      await adapter.snapshot({});
      const info = adapter.describeRef("1");
      expect(info).toEqual({ name: "Add", permission: "allow", permissionReason: undefined });
    });

    it("returns undefined for a stale/unknown ref", () => {
      const info = adapter.describeRef("999");
      expect(info).toBeUndefined();
    });
  });

  // -----------------------------------------------------------------------
  // inspectRef — the panel page tools' non-throwing pre-check (122/001)
  // -----------------------------------------------------------------------
  describe("inspectRef (122/001)", () => {
    it("returns ok status and details for connected element", async () => {
      setupHtml('<button id="btn" data-agent-permission="ask" data-agent-permission-reason="confirm please">Remove item</button>');
      await adapter.snapshot({});
      const info = adapter.inspectRef("1");
      expect(info.status).toBe("ok");
      expect(info.name).toBe("Remove item");
      expect(info.description).toBe('button "Remove item"');
      expect(info.permission).toBe("ask");
      expect(info.permissionReason).toBe("confirm please");
      expect(info.disabled).toBe(false);
      expect(info.el).toBe(document.getElementById("btn"));
    });

    it("reports disabled true for a disabled element", async () => {
      setupHtml('<button id="btn" disabled>Buy</button>');
      await adapter.snapshot({});
      const info = adapter.inspectRef("1");
      expect(info.status).toBe("ok");
      expect(info.disabled).toBe(true);
    });

    it("returns stale error message for past generation ref", async () => {
      setupHtml('<button id="btn1">Button 1</button><button id="btn2">Button 2</button>');
      await adapter.snapshot({}); // Gen 1: btn1 -> 1, btn2 -> 2
      setupHtml('<button id="btn1">Button 1</button>');
      await adapter.snapshot({}); // Gen 2: btn1 -> 1. Ref 2 is not assigned.
      const info = adapter.inspectRef("2");
      expect(info.status).toBe("stale");
      expect(info.error).toBe("Ref 2 is stale (generation 1, current 2). Take a new snapshot.");
    });

    it("returns detached error message for disconnected element", async () => {
      setupHtml('<button id="btn">Hello</button>');
      await adapter.snapshot({});
      document.getElementById("btn")!.remove();
      const info = adapter.inspectRef("1");
      expect(info.status).toBe("detached");
      expect(info.error).toBe("Ref 1 no longer exists in the DOM. Take a new snapshot.");
    });

    it("returns unknown error message for a ref never assigned", () => {
      const info = adapter.inspectRef("999");
      expect(info.status).toBe("unknown");
      expect(info.error).toBe("Unknown ref 999. Take a new snapshot.");
    });
  });

  // -----------------------------------------------------------------------
  // ActionCue hook tests
  // -----------------------------------------------------------------------
  describe("actionCue hook", () => {
    it("click fires actionCue once with kind='click'", async () => {
      setupHtml('<button id="btn">Hi</button>');
      const spy = vi.fn<Parameters<ActionCueFn>, ReturnType<ActionCueFn>>(
        () => Promise.resolve(),
      );
      const a = new DomAdapter({ actionCue: spy });
      await a.snapshot({});
      await a.click("1");
      expect(spy).toHaveBeenCalledTimes(1);
      const [el, kind] = spy.mock.calls[0];
      expect(el!.tagName.toLowerCase()).toBe("button");
      expect(kind).toBe("click");
    });

    it("fill fires actionCue once with kind='fill' and value detail", async () => {
      setupHtml('<input id="txt" />');
      const spy = vi.fn(async () => {});
      const a = new DomAdapter({ actionCue: spy });
      await a.snapshot({});
      await a.fill("1", "ACME");
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][1]).toBe("fill");
      expect(spy.mock.calls[0][2]).toEqual({ value: "ACME" });
    });

    it("actionCue fires BEFORE the synthetic input event for fill", async () => {
      setupHtml('<input id="txt" />');
      const order: string[] = [];
      const spy = vi.fn((): Promise<void> => { order.push("cue"); return Promise.resolve(); });
      const a = new DomAdapter({ actionCue: spy });
      const input = document.getElementById("txt") as HTMLInputElement;
      input.addEventListener("input", () => { order.push("input"); });
      await a.snapshot({});
      await a.fill("1", "hello");
      expect(order).toEqual(["cue", "input"]);
    });

    it("missing actionCue is a no-op (default constructor)", async () => {
      setupHtml('<button id="btn">Hi</button><input id="txt" />');
      const a = new DomAdapter();
      await a.snapshot({});
      await expect(a.click("1")).resolves.toBeDefined();
      await expect(a.fill("2", "test")).resolves.toBeDefined();
    });

    it("click point detail is provided when actionCue is wired", async () => {
      setupHtml('<button id="btn">Hi</button>');
      const spy = vi.fn<Parameters<ActionCueFn>, ReturnType<ActionCueFn>>(
        () => Promise.resolve(),
      );
      const a = new DomAdapter({ actionCue: spy });
      await a.snapshot({});
      await a.click("1");
      const detail = spy.mock.calls[0][2];
      expect(detail).toBeDefined();
      expect(detail!.point).toBeDefined();
      expect(typeof detail!.point!.x).toBe("number");
      expect(typeof detail!.point!.y).toBe("number");
    });

    it("selectOption fires actionCue once with kind='select' and option value", async () => {
      setupHtml("<select id='sel'><option>A</option><option>B</option></select>");
      const spy = vi.fn(async () => {});
      const a = new DomAdapter({ actionCue: spy });
      await a.snapshot({});
      await a.selectOption("1", "A");
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][1]).toBe("select");
      expect(spy.mock.calls[0][2]).toEqual({ value: "A" });
      expect((spy.mock.calls[0][0] as Element).tagName.toLowerCase()).toBe("select");
    });

    it("selectOption fires actionCue BEFORE the synthetic change event", async () => {
      setupHtml("<select id='sel'><option>A</option><option>B</option></select>");
      const order: string[] = [];
      const spy = vi.fn((): Promise<void> => { order.push("cue"); return Promise.resolve(); });
      const a = new DomAdapter({ actionCue: spy });
      const sel = document.getElementById("sel") as HTMLSelectElement;
      sel.addEventListener("change", () => { order.push("change"); });
      await a.snapshot({});
      await a.selectOption("1", "A");
      expect(order).toEqual(["cue", "change"]);
    });

    it("selectOption does not fire actionCue when no hook is set", async () => {
      setupHtml("<select id='sel'><option>A</option><option>B</option></select>");
      const a = new DomAdapter();
      await a.snapshot({});
      await expect(a.selectOption("1", "A")).resolves.toBeDefined();
    });

    it("screenshot fires actionCue once with kind='see' and rect detail", async () => {
      setupHtml("<main><h1>Hi</h1></main>");
      const spy = vi.fn<Parameters<ActionCueFn>, ReturnType<ActionCueFn>>(
        () => Promise.resolve(),
      );
      const a = new DomAdapter({ actionCue: spy });
      const before = spy.mock.calls.length;
      await a.screenshot();
      expect(spy.mock.calls.length).toBe(before + 1);
      const last = spy.mock.calls.at(-1)!;
      const kind = last[1];
      const detail = last[2];
      expect(kind).toBe("see");
      expect(detail?.rect).toBeDefined();
      expect(typeof detail!.rect!.x).toBe("number");
      expect(typeof detail!.rect!.y).toBe("number");
      expect(typeof detail!.rect!.width).toBe("number");
      expect(typeof detail!.rect!.height).toBe("number");
    });

    it("screenshot does NOT fire actionCue when target is inside [data-agent-ui]", async () => {
      setupHtml("<div data-agent-ui='true' id='panel'><span>only</span></div>");
      const spy = vi.fn(async () => {});
      const rt = new RefTable();
      const panel = document.getElementById("panel")!;
      stubRect(panel, 300, 400);   // jsdom reports 0x0; pass the zero-size guard
      const ref = String(rt.assign(panel));
      const a = new DomAdapter({ actionCue: spy, refTable: rt });
      await a.screenshot(ref);
      expect(spy).not.toHaveBeenCalled();
    });

    it("screenshot does NOT fire actionCue when no hook is set", async () => {
      setupHtml("<main><h1>Hi</h1></main>");
      const a = new DomAdapter();
      await expect(a.screenshot()).resolves.toBeDefined();
    });

    it("all four methods complete without throwing when no actionCue is wired", async () => {
      setupHtml(
        "<button id='b'>Hi</button>" +
          "<input id='t' />" +
          "<select id='s'><option>A</option></select>" +
          "<main></main>",
      );
      const a = new DomAdapter();
      await a.snapshot({});
      await expect(a.click("1")).resolves.toBeDefined();
      await expect(a.fill("2", "x")).resolves.toBeDefined();
      await expect(a.selectOption("3", "A")).resolves.toBeDefined();
      await expect(a.screenshot()).resolves.toBeDefined();
    });

    it("click does NOT call scrollIntoView on the target element", async () => {
      setupHtml('<button id="btn">Click me</button>');
      const a = new DomAdapter();
      await a.snapshot({});
      const btn = document.getElementById("btn")!;
      const spy = vi.fn();
      btn.scrollIntoView = spy;
      await a.click("1");
      expect(spy).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // snapshotFocused (016-2)
  // -----------------------------------------------------------------------
  describe("snapshotFocused", () => {
    it("assigns distinct refs to each pinned element within one generation", async () => {
      setupHtml('<button id="a">A</button><button id="b">B</button>');
      const btn1 = document.getElementById("a")!;
      const btn2 = document.getElementById("b")!;
      const genBefore = adapter.refTable.generation;
      const entries = await adapter.snapshotFocused([btn1, btn2]);
      expect(entries).toHaveLength(2);
      expect(entries[0].ref).not.toBe(entries[1].ref);
      expect(entries[0].text).toMatch(new RegExp(`^\\[${entries[0].ref}\\] button "A"`));
      expect(entries[1].text).toMatch(new RegExp(`^\\[${entries[1].ref}\\] button "B"`));
      expect(adapter.refTable.generation).toBe(genBefore + 1);
    });

    it("force-assigns a ref to a non-interactive scope root (forceRootRef)", async () => {
      setupHtml('<div id="card" role="listitem">Card</div>');
      const card = document.getElementById("card")!;
      const [entry] = await adapter.snapshotFocused([card]);
      expect(entry.ref).toBeDefined();
      expect(entry.text).toMatch(new RegExp(`^\\[${entry.ref}\\] listitem`));
    });

    it("shares one generation across the whole batch so every ref resolves after the fact", async () => {
      setupHtml('<button id="a">A</button><button id="b">B</button>');
      const btn1 = document.getElementById("a")!;
      const btn2 = document.getElementById("b")!;
      const genBefore = adapter.refTable.generation;
      const [e1, e2] = await adapter.snapshotFocused([btn1, btn2]);
      // A naive two-separate-snapshot({scope})-calls implementation would bump
      // the generation twice and reset the ref counter in between, so this
      // proves the shared-generation fix.
      expect(adapter.refTable.generation).toBe(genBefore + 1);
      const r1 = adapter.refTable.resolve(String(e1.ref));
      const r2 = adapter.refTable.resolve(String(e2.ref));
      expect(r1).toMatchObject({ status: "ok", el: btn1 });
      expect(r2).toMatchObject({ status: "ok", el: btn2 });
    });

    it("emits a truncation marker for a pinned element with an oversized subtree", async () => {
      window.__TINY_BUDGETS__ = true;
      try {
        const children = Array.from({ length: 20 }, (_, i) => `<button>Item ${i}</button>`).join("");
        setupHtml(`<div id="wrap" role="list">${children}</div>`);
        const wrap = document.getElementById("wrap")!;
        const [entry] = await adapter.snapshotFocused([wrap]);
        expect(entry.text).toMatch(/nodes hidden/);
      } finally {
        delete window.__TINY_BUDGETS__;
      }
    });
  });
});

