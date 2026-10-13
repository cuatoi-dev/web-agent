// human-input-events.test.ts — vitest + jsdom
import { describe, it, expect } from "vitest";
import {
  holdsFocus,
  focusLikeHuman,
  typeChunkLikeHuman,
  dispatchChangeLikeHuman,
  blurLikeHuman,
} from "./human-input-events.js";

const TRACKED_TYPES = [
  "pointerdown", "mousedown", "focus", "focusin",
  "keydown", "beforeinput", "input", "keyup",
  "change", "blur", "focusout",
];

function recorder(el: Element) {
  const events: { type: string; event: Event }[] = [];
  for (const t of TRACKED_TYPES) {
    el.addEventListener(t, (e) => events.push({ type: e.type, event: e }));
  }
  return { events, types: () => events.map((e) => e.type) };
}

describe("holdsFocus", () => {
  it("light DOM: true after focus(), false after blur()", () => {
    document.body.innerHTML = '<input id="a" />';
    const el = document.getElementById("a") as HTMLInputElement;
    el.focus();
    expect(holdsFocus(el)).toBe(true);
    el.blur();
    expect(holdsFocus(el)).toBe(false);
  });

  it("shadow root: true for the field while document.activeElement is the host", () => {
    document.body.innerHTML = '<div id="host"></div>';
    const host = document.getElementById("host")!;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = '<input id="field" />';
    const field = shadow.getElementById("field") as HTMLInputElement;
    field.focus();
    expect(holdsFocus(field)).toBe(true);
    expect(document.activeElement).toBe(host);
  });
});

describe("focusLikeHuman", () => {
  it("dispatches pointerdown, mousedown, focus, focusin in order and takes focus", () => {
    document.body.innerHTML = '<input id="a" />';
    const el = document.getElementById("a") as HTMLInputElement;
    const rec = recorder(el);

    focusLikeHuman(el);

    expect(rec.types()).toEqual(["pointerdown", "mousedown", "focus", "focusin"]);
    expect(document.activeElement).toBe(el);
  });

  it("pointer: false ⇒ only focus and focusin", () => {
    document.body.innerHTML = '<select id="s"><option>A</option></select>';
    const el = document.getElementById("s") as HTMLSelectElement;
    const rec = recorder(el);

    focusLikeHuman(el, { pointer: false });

    expect(rec.types()).toEqual(["focus", "focusin"]);
  });

  it("fallback: an unfocusable element still gets focus and focusin recorded once each", () => {
    document.body.innerHTML = '<div id="d"></div>';
    const el = document.getElementById("d") as HTMLDivElement;
    const rec = recorder(el);

    focusLikeHuman(el);

    expect(rec.types().filter((t) => t === "focus").length).toBe(1);
    expect(rec.types().filter((t) => t === "focusin").length).toBe(1);
  });
});

describe("typeChunkLikeHuman", () => {
  it("dispatches keydown, beforeinput, input, keyup in order; commit runs between beforeinput and input", () => {
    document.body.innerHTML = '<input id="a" value="old" />';
    const el = document.getElementById("a") as HTMLInputElement;
    const rec = recorder(el);
    let valueDuringBeforeInput = "";
    let valueDuringInput = "";
    el.addEventListener("beforeinput", () => { valueDuringBeforeInput = el.value; });
    el.addEventListener("input", () => { valueDuringInput = el.value; });

    typeChunkLikeHuman(el, "x", () => { el.value = "new"; });

    expect(rec.types()).toEqual(["keydown", "beforeinput", "input", "keyup"]);
    expect(valueDuringBeforeInput).toBe("old");
    expect(valueDuringInput).toBe("new");
  });

  it("beforeinput/input are InputEvent with inputType insertText and correct cancelable/bubbles/composed", () => {
    document.body.innerHTML = '<input id="a" />';
    const el = document.getElementById("a") as HTMLInputElement;
    const rec = recorder(el);

    typeChunkLikeHuman(el, "hi", () => { el.value = "hi"; });

    const beforeinput = rec.events.find((e) => e.type === "beforeinput")!.event as InputEvent;
    const input = rec.events.find((e) => e.type === "input")!.event as InputEvent;
    expect(beforeinput).toBeInstanceOf(InputEvent);
    expect(input).toBeInstanceOf(InputEvent);
    expect(beforeinput.inputType).toBe("insertText");
    expect(input.inputType).toBe("insertText");
    expect(beforeinput.data).toBe("hi");
    expect(input.data).toBe("hi");
    expect(beforeinput.cancelable).toBe(true);
    expect(input.cancelable).toBe(false);
    expect(beforeinput.bubbles).toBe(true);
    expect(input.bubbles).toBe(true);
    expect(beforeinput.composed).toBe(true);
    expect(input.composed).toBe(true);
  });

  it("keydown.key and keyup.key equal the chunk's last character", () => {
    document.body.innerHTML = '<input id="a" />';
    const el = document.getElementById("a") as HTMLInputElement;
    const rec = recorder(el);

    typeChunkLikeHuman(el, "abc", () => { el.value = "abc"; });

    const keydown = rec.events.find((e) => e.type === "keydown")!.event as KeyboardEvent;
    const keyup = rec.events.find((e) => e.type === "keyup")!.event as KeyboardEvent;
    expect(keydown.key).toBe("c");
    expect(keyup.key).toBe("c");
  });
});

describe("dispatchChangeLikeHuman", () => {
  it("crosses a shadow boundary: a document-level change listener fires", () => {
    document.body.innerHTML = '<div id="host"></div>';
    const host = document.getElementById("host")!;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = '<input id="field" />';
    const field = shadow.getElementById("field") as HTMLInputElement;

    let firedOnDocument = false;
    document.addEventListener("change", () => { firedOnDocument = true; });

    dispatchChangeLikeHuman(field);

    expect(firedOnDocument).toBe(true);
  });
});

describe("blurLikeHuman", () => {
  it("dispatches blur then focusout, and the field loses focus", () => {
    document.body.innerHTML = '<input id="a" />';
    const el = document.getElementById("a") as HTMLInputElement;
    focusLikeHuman(el);
    const rec = recorder(el);

    blurLikeHuman(el);

    expect(rec.types()).toEqual(["blur", "focusout"]);
    expect(document.activeElement).not.toBe(el);
  });

  it("is a no-op when the field does not hold focus", () => {
    document.body.innerHTML = '<input id="a" /><input id="b" />';
    const a = document.getElementById("a") as HTMLInputElement;
    const b = document.getElementById("b") as HTMLInputElement;
    b.focus();
    const rec = recorder(a);

    blurLikeHuman(a);

    expect(rec.types()).toEqual([]);
  });
});
