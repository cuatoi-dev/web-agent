import { describe, it, expect } from "vitest";
import { renderAxSnapshot } from "./ax-snapshot";
import type { AxFrame, AxNode } from "./ax-snapshot.types";

const role = (value: string) => ({ type: "role", value });

function renderSingleFrame(nodes: AxNode[], opts: { scopeRef?: string; includeText?: string } = {}) {
  return renderAxSnapshot({
    frames: [{ refPrefix: "", frameId: "top", origin: "", nodes }],
    ...opts,
  });
}

describe("ax-snapshot", () => {
  it("prints role, name and ref for a button", () => {
    const nodes: AxNode[] = [
      { nodeId: "1", role: role("RootWebArea"), childIds: ["23"], backendDOMNodeId: 1 },
      { nodeId: "23", role: role("button"), name: { value: "Apply" }, backendDOMNodeId: 23 },
    ];
    const result = renderSingleFrame(nodes, { scopeRef: "23" });
    expect(result).toMatchObject({ kind: "ok", text: '- button "Apply" [ref=23]' });
  });

  it("prints a textbox's current value after a colon", () => {
    const nodes: AxNode[] = [
      { nodeId: "2", role: role("textbox"), name: { value: "Email" }, value: { value: "old@x.com" }, backendDOMNodeId: 2 },
    ];
    const result = renderSingleFrame(nodes, { scopeRef: "2" });
    expect(result).toMatchObject({ kind: "ok", text: '- textbox "Email" [ref=2]: old@x.com' });
  });

  it("skips an ignored node and lifts its children", () => {
    const nodes: AxNode[] = [
      { nodeId: "1", role: role("RootWebArea"), childIds: ["5"], backendDOMNodeId: 1 },
      { nodeId: "5", ignored: true, role: role("none"), childIds: ["7"] },
      { nodeId: "7", role: role("button"), name: { value: "Apply" }, backendDOMNodeId: 7 },
    ];
    const result = renderSingleFrame(nodes);
    expect(result).toMatchObject({ kind: "ok", text: '- RootWebArea [ref=1]\n  - button "Apply" [ref=7]' });
  });

  it("skips an unnamed generic wrapper and lifts its children", () => {
    const nodes: AxNode[] = [
      { nodeId: "1", role: role("RootWebArea"), childIds: ["24"], backendDOMNodeId: 1 },
      { nodeId: "24", role: role("generic"), name: { value: "" }, childIds: ["33"], backendDOMNodeId: 24 },
      { nodeId: "33", role: role("button"), name: { value: "Apply" }, backendDOMNodeId: 33 },
    ];
    const result = renderSingleFrame(nodes);
    expect(result).toMatchObject({ kind: "ok", text: '- RootWebArea [ref=1]\n  - button "Apply" [ref=33]' });
  });

  it("keeps a NAMED generic", () => {
    const nodes: AxNode[] = [
      { nodeId: "1", role: role("RootWebArea"), childIds: ["24"], backendDOMNodeId: 1 },
      { nodeId: "24", role: role("generic"), name: { value: "Card" }, backendDOMNodeId: 24 },
    ];
    const result = renderSingleFrame(nodes);
    expect(result).toMatchObject({ kind: "ok", text: '- RootWebArea [ref=1]\n  - generic "Card" [ref=24]' });
  });

  it("does not repeat a button's own text as a StaticText line", () => {
    const nodes: AxNode[] = [
      { nodeId: "1", role: role("button"), name: { value: "Apply" }, childIds: ["2"], backendDOMNodeId: 1 },
      { nodeId: "2", role: { type: "internalRole", value: "StaticText" }, name: { value: "Apply" } },
    ];
    const result = renderSingleFrame(nodes);
    expect(result).toMatchObject({ kind: "ok", text: '- button "Apply" [ref=1]' });
  });

  it("never prints a ref for a StaticText node, even when it carries a backendDOMNodeId", () => {
    const nodes: AxNode[] = [
      { nodeId: "1", role: role("RootWebArea"), childIds: ["2"], backendDOMNodeId: 1 },
      { nodeId: "2", role: role("generic"), name: { value: "" }, childIds: ["3"], backendDOMNodeId: 2 },
      { nodeId: "3", role: { type: "internalRole", value: "StaticText" }, name: { value: "Coupon" }, backendDOMNodeId: 99 },
    ];
    const result = renderSingleFrame(nodes);
    expect(result).toMatchObject({ kind: "ok", text: '- RootWebArea [ref=1]\n  - StaticText "Coupon"' });
  });

  it("keeps a StaticText whose name differs from its parent's", () => {
    const nodes: AxNode[] = [
      { nodeId: "1", role: role("generic"), name: { value: "Card" }, childIds: ["2"], backendDOMNodeId: 1 },
      { nodeId: "2", role: { type: "internalRole", value: "StaticText" }, name: { value: "Something else" } },
    ];
    const result = renderSingleFrame(nodes);
    expect(result).toMatchObject({ kind: "ok", text: '- generic "Card" [ref=1]\n  - StaticText "Something else"' });
  });

  it("flattens InlineTextBox", () => {
    const nodes: AxNode[] = [
      { nodeId: "1", role: role("generic"), name: { value: "Card" }, childIds: ["2"], backendDOMNodeId: 1 },
      { nodeId: "2", role: role("InlineTextBox"), childIds: ["3"] },
      { nodeId: "3", role: { type: "internalRole", value: "StaticText" }, name: { value: "Text" } },
    ];
    const result = renderSingleFrame(nodes);
    expect(result).toMatchObject({ kind: "ok", text: '- generic "Card" [ref=1]\n  - StaticText "Text"' });
  });

  it("prints a boolean property as a bare bracket and a valued one as name=value", () => {
    const nodes: AxNode[] = [
      {
        nodeId: "1",
        role: role("checkbox"),
        name: { value: "Agree" },
        properties: [{ name: "disabled", value: { value: true } }, { name: "level", value: { value: 2 } }],
        backendDOMNodeId: 1,
      },
    ];
    const result = renderSingleFrame(nodes, { scopeRef: "1" });
    expect(result).toMatchObject({ kind: "ok", text: '- checkbox "Agree" [level=2] [disabled] [ref=1]' });
  });

  it("does not print a property that is not in the printed-property list", () => {
    const nodes: AxNode[] = [
      {
        nodeId: "1",
        role: role("button"),
        name: { value: "Apply" },
        properties: [
          { name: "focusable", value: { value: true } },
          { name: "invalid", value: { value: "false" } },
        ],
        backendDOMNodeId: 1,
      },
    ];
    const result = renderSingleFrame(nodes, { scopeRef: "1" });
    expect(result).toMatchObject({ kind: "ok", text: '- button "Apply" [ref=1]' });
  });

  it("indents two spaces per depth", () => {
    const nodes: AxNode[] = [
      { nodeId: "1", role: role("RootWebArea"), childIds: ["2"], backendDOMNodeId: 1 },
      { nodeId: "2", role: role("generic"), name: { value: "Wrap" }, childIds: ["3"], backendDOMNodeId: 2 },
      { nodeId: "3", role: role("button"), name: { value: "Apply" }, backendDOMNodeId: 3 },
    ];
    const result = renderSingleFrame(nodes);
    expect(result).toMatchObject({
      kind: "ok",
      text: '- RootWebArea [ref=1]\n  - generic "Wrap" [ref=2]\n    - button "Apply" [ref=3]',
    });
  });

  it("scope prints only the subtree", () => {
    const nodes: AxNode[] = [
      { nodeId: "1", role: role("RootWebArea"), childIds: ["2", "3"], backendDOMNodeId: 1 },
      { nodeId: "2", role: role("button"), name: { value: "Cancel" }, backendDOMNodeId: 2 },
      { nodeId: "3", role: role("button"), name: { value: "Apply" }, backendDOMNodeId: 3 },
    ];
    const result = renderSingleFrame(nodes, { scopeRef: "3" });
    expect(result).toMatchObject({ kind: "ok", text: '- button "Apply" [ref=3]' });
  });

  it("scope that matches no node reports scope-missing", () => {
    const nodes: AxNode[] = [{ nodeId: "1", role: role("RootWebArea"), backendDOMNodeId: 1 }];
    const result = renderSingleFrame(nodes, { scopeRef: "999999" });
    expect(result).toEqual({ kind: "scope-missing" });
  });

  it("include_text keeps matching nodes and their ancestors, in tree order", () => {
    const nodes: AxNode[] = [
      { nodeId: "1", role: role("RootWebArea"), childIds: ["2", "4"], backendDOMNodeId: 1 },
      { nodeId: "2", role: role("textbox"), name: { value: "Email" }, backendDOMNodeId: 2 },
      { nodeId: "4", role: role("combobox"), name: { value: "Shipping" }, backendDOMNodeId: 4 },
    ];
    const result = renderSingleFrame(nodes, { includeText: "email" });
    expect(result).toMatchObject({ kind: "ok", text: '- RootWebArea [ref=1]\n  - textbox "Email" [ref=2]' });
  });

  it("include_text matches a value as well as a name", () => {
    const nodes: AxNode[] = [
      { nodeId: "1", role: role("RootWebArea"), childIds: ["2"], backendDOMNodeId: 1 },
      { nodeId: "2", role: role("textbox"), name: { value: "Coupon" }, value: { value: "SAVE10" }, backendDOMNodeId: 2 },
    ];
    const result = renderSingleFrame(nodes, { includeText: "SAVE10" });
    expect(result).toMatchObject({ kind: "ok", text: '- RootWebArea [ref=1]\n  - textbox "Coupon" [ref=2]: SAVE10' });
  });

  it("include_text ignores case", () => {
    const nodes: AxNode[] = [
      { nodeId: "1", role: role("RootWebArea"), childIds: ["2"], backendDOMNodeId: 1 },
      { nodeId: "2", role: role("button"), name: { value: "Apply" }, backendDOMNodeId: 2 },
    ];
    const result = renderSingleFrame(nodes, { includeText: "APPLY" });
    expect(result).toMatchObject({ kind: "ok", text: '- RootWebArea [ref=1]\n  - button "Apply" [ref=2]' });
  });

  it("cuts at the budget on a whole-line boundary and adds the note", () => {
    const nodes: AxNode[] = [{ nodeId: "1", role: role("RootWebArea"), childIds: [], backendDOMNodeId: 1 }];
    const childIds: string[] = [];
    for (let i = 2; i < 2000; i++) {
      childIds.push(String(i));
      nodes.push({ nodeId: String(i), role: role("button"), name: { value: `Item ${i}` }, backendDOMNodeId: i });
    }
    nodes[0].childIds = childIds;

    const result = renderSingleFrame(nodes);
    if (result.kind !== "ok") throw new Error("expected ok");
    const note = "\n(Snapshot cut at 12,000 characters. Pass scope with a ref, or include_text, to see more.)";
    expect(result.text.endsWith(note)).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(12_000 + note.length);
    const withoutNote = result.text.slice(0, -note.length);
    for (const line of withoutNote.split("\n").slice(1)) {
      expect(line).toMatch(/^ {2}- button "Item \d+" \[ref=\d+\]$/);
    }
  });

  it("an empty tree reports no accessible content", () => {
    const nodes: AxNode[] = [{ nodeId: "1", role: role("generic"), name: { value: "" }, backendDOMNodeId: 1 }];
    const result = renderSingleFrame(nodes);
    expect(result).toMatchObject({ kind: "ok", text: "The page has no accessible content." });
  });

  it("a node with no backendDOMNodeId prints no ref bracket", () => {
    const nodes: AxNode[] = [{ nodeId: "1", role: role("RootWebArea"), name: { value: "" } }];
    const result = renderSingleFrame(nodes);
    expect(result).toMatchObject({ kind: "ok", text: "- RootWebArea" });
  });

  // Multi-frame tests
  it("prints an iframe line and its tree one level deeper", () => {
    const topNodes: AxNode[] = [
      { nodeId: "1", role: role("RootWebArea"), childIds: ["2"], backendDOMNodeId: 1 },
      { nodeId: "2", role: role("Iframe"), childIds: [], backendDOMNodeId: 2 },
    ];
    const childNodes: AxNode[] = [
      { nodeId: "10", role: role("RootWebArea"), childIds: ["11"], backendDOMNodeId: 10 },
      { nodeId: "11", role: role("button"), name: { value: "Pay" }, backendDOMNodeId: 11 },
    ];
    const frames: AxFrame[] = [
      { refPrefix: "", frameId: "top", origin: "http://shop.test", nodes: topNodes },
      {
        refPrefix: "f1:",
        sessionId: "S1",
        frameId: "F1",
        origin: "http://pay.test",
        owner: { refPrefix: "", backendNodeId: 2 },
        nodes: childNodes,
      },
    ];
    const result = renderAxSnapshot({ frames });
    expect(result).toMatchObject({
      kind: "ok",
      text: '- RootWebArea [ref=1]\n  - iframe · http://pay.test [ref=2]\n    - RootWebArea [ref=f1:10]\n      - button "Pay" [ref=f1:11]',
    });
  });

  it("prints an iframe whose owner node is ignored", () => {
    const topNodes: AxNode[] = [
      { nodeId: "1", role: role("RootWebArea"), childIds: ["2"], backendDOMNodeId: 1 },
      { nodeId: "2", ignored: true, role: role("Iframe"), childIds: [], backendDOMNodeId: 2 },
    ];
    const childNodes: AxNode[] = [
      { nodeId: "10", role: role("button"), name: { value: "Pay" }, backendDOMNodeId: 10 },
    ];
    const frames: AxFrame[] = [
      { refPrefix: "", frameId: "top", origin: "http://shop.test", nodes: topNodes },
      {
        refPrefix: "f1:",
        sessionId: "S1",
        frameId: "F1",
        origin: "http://pay.test",
        owner: { refPrefix: "", backendNodeId: 2 },
        nodes: childNodes,
      },
    ];
    const result = renderAxSnapshot({ frames });
    expect(result).toMatchObject({
      kind: "ok",
      text: '- RootWebArea [ref=1]\n  - iframe · http://pay.test [ref=2]\n    - button "Pay" [ref=f1:10]',
    });
  });

  it("prints (content not available) for an unavailable frame", () => {
    const topNodes: AxNode[] = [
      { nodeId: "1", role: role("RootWebArea"), childIds: ["2"], backendDOMNodeId: 1 },
      { nodeId: "2", role: role("Iframe"), childIds: [], backendDOMNodeId: 2 },
    ];
    const frames: AxFrame[] = [
      { refPrefix: "", frameId: "top", origin: "http://shop.test", nodes: topNodes },
      {
        refPrefix: "f1:",
        sessionId: "S1",
        frameId: "F1",
        origin: "http://pay.test",
        owner: { refPrefix: "", backendNodeId: 2 },
        nodes: [],
        unavailable: true,
      },
    ];
    const result = renderAxSnapshot({ frames });
    expect(result).toMatchObject({
      kind: "ok",
      text: "- RootWebArea [ref=1]\n  - iframe · http://pay.test (content not available) [ref=2]",
    });
  });

  it("prints (content not available) for an iframe element with no frame", () => {
    const topNodes: AxNode[] = [
      { nodeId: "1", role: role("RootWebArea"), childIds: ["2"], backendDOMNodeId: 1 },
      { nodeId: "2", role: role("Iframe"), childIds: [], backendDOMNodeId: 2 },
    ];
    const frames: AxFrame[] = [
      { refPrefix: "", frameId: "top", origin: "http://shop.test", nodes: topNodes },
    ];
    const result = renderAxSnapshot({ frames });
    expect(result).toMatchObject({
      kind: "ok",
      text: "- RootWebArea [ref=1]\n  - iframe (content not available) [ref=2]",
    });
  });

  it("scopes into a child frame by a prefixed ref", () => {
    const topNodes: AxNode[] = [
      { nodeId: "1", role: role("RootWebArea"), childIds: ["2"], backendDOMNodeId: 1 },
      { nodeId: "2", role: role("Iframe"), childIds: [], backendDOMNodeId: 2 },
    ];
    const childNodes: AxNode[] = [
      { nodeId: "10", role: role("RootWebArea"), childIds: ["7"], backendDOMNodeId: 10 },
      { nodeId: "7", role: role("button"), name: { value: "Pay" }, backendDOMNodeId: 7 },
    ];
    const frames: AxFrame[] = [
      { refPrefix: "", frameId: "top", origin: "http://shop.test", nodes: topNodes },
      {
        refPrefix: "f1:",
        sessionId: "S1",
        frameId: "F1",
        origin: "http://pay.test",
        owner: { refPrefix: "", backendNodeId: 2 },
        nodes: childNodes,
      },
    ];
    const result = renderAxSnapshot({ frames, scopeRef: "f1:7" });
    expect(result).toEqual({
      kind: "ok",
      text: '- button "Pay" [ref=f1:7]',
      refs: [{ ref: "f1:7", sessionId: "S1", frameId: "F1" }],
    });
  });

  it("returns scope-missing for a scope ref in no frame", () => {
    const frames: AxFrame[] = [
      { refPrefix: "", frameId: "top", origin: "", nodes: [{ nodeId: "1", role: role("RootWebArea"), backendDOMNodeId: 1 }] },
    ];
    const result = renderAxSnapshot({ frames, scopeRef: "f2:99" });
    expect(result).toEqual({ kind: "scope-missing" });
  });

  it("keeps the iframe ancestor line when include_text matches inside the frame", () => {
    const topNodes: AxNode[] = [
      { nodeId: "1", role: role("RootWebArea"), childIds: ["2"], backendDOMNodeId: 1 },
      { nodeId: "2", role: role("Iframe"), childIds: [], backendDOMNodeId: 2 },
    ];
    const childNodes: AxNode[] = [
      { nodeId: "10", role: role("RootWebArea"), childIds: ["11"], backendDOMNodeId: 10 },
      { nodeId: "11", role: role("button"), name: { value: "Pay Now" }, backendDOMNodeId: 11 },
    ];
    const frames: AxFrame[] = [
      { refPrefix: "", frameId: "top", origin: "http://shop.test", nodes: topNodes },
      {
        refPrefix: "f1:",
        sessionId: "S1",
        frameId: "F1",
        origin: "http://pay.test",
        owner: { refPrefix: "", backendNodeId: 2 },
        nodes: childNodes,
      },
    ];
    const result = renderAxSnapshot({ frames, includeText: "Pay" });
    expect(result).toMatchObject({
      kind: "ok",
      text: '- RootWebArea [ref=1]\n  - iframe · http://pay.test [ref=2]\n    - RootWebArea [ref=f1:10]\n      - button "Pay Now" [ref=f1:11]',
    });
  });

  it("reports every printed ref with its frame", () => {
    const topNodes: AxNode[] = [
      { nodeId: "1", role: role("RootWebArea"), childIds: ["2"], backendDOMNodeId: 1 },
      { nodeId: "2", role: role("Iframe"), childIds: [], backendDOMNodeId: 2 },
    ];
    const childNodes: AxNode[] = [
      { nodeId: "7", role: role("button"), name: { value: "Pay" }, backendDOMNodeId: 7 },
    ];
    const frames: AxFrame[] = [
      { refPrefix: "", frameId: "top", origin: "http://shop.test", nodes: topNodes },
      {
        refPrefix: "f1:",
        sessionId: "S1",
        frameId: "F1",
        origin: "http://pay.test",
        owner: { refPrefix: "", backendNodeId: 2 },
        nodes: childNodes,
      },
    ];
    const result = renderAxSnapshot({ frames });
    if (result.kind !== "ok") throw new Error("expected ok");
    expect(result.refs).toEqual([
      { ref: "1", frameId: "top" },
      { ref: "2", frameId: "top" },
      { ref: "f1:7", sessionId: "S1", frameId: "F1" },
    ]);
  });

  it("applies the 12,000 character cap across all frames", () => {
    const topNodes: AxNode[] = [{ nodeId: "1", role: role("RootWebArea"), childIds: ["2"], backendDOMNodeId: 1 }, { nodeId: "2", role: role("Iframe"), backendDOMNodeId: 2 }];
    const childNodes: AxNode[] = [{ nodeId: "10", role: role("RootWebArea"), childIds: [], backendDOMNodeId: 10 }];
    const childIds: string[] = [];
    for (let i = 20; i < 2000; i++) {
      childIds.push(String(i));
      childNodes.push({ nodeId: String(i), role: role("button"), name: { value: `Child Item ${i}` }, backendDOMNodeId: i });
    }
    childNodes[0].childIds = childIds;

    const frames: AxFrame[] = [
      { refPrefix: "", frameId: "top", origin: "http://shop.test", nodes: topNodes },
      {
        refPrefix: "f1:",
        sessionId: "S1",
        frameId: "F1",
        origin: "http://pay.test",
        owner: { refPrefix: "", backendNodeId: 2 },
        nodes: childNodes,
      },
    ];
    const result = renderAxSnapshot({ frames });
    if (result.kind !== "ok") throw new Error("expected ok");
    const note = "\n(Snapshot cut at 12,000 characters. Pass scope with a ref, or include_text, to see more.)";
    expect(result.text.endsWith(note)).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(12_000 + note.length);
  });
});
