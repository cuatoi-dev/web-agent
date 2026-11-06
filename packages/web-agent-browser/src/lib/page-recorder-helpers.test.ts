import { describe, expect, it } from "vitest";
import { recordTarget, target } from "./page-recorder-helpers";

/** The event has to be read during dispatch: composedPath() is empty after. */
function clickAndRead(el: Element): { raw: Element | null; recorded: Element | null } {
  const seen: { raw: Element | null; recorded: Element | null } = { raw: null, recorded: null };
  const read = (event: Event): void => {
    seen.raw = target(event);
    seen.recorded = recordTarget(event);
  };
  window.addEventListener("click", read, true);
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
  window.removeEventListener("click", read, true);
  return seen;
}

describe("recordTarget (rec 002)", () => {
  it("keeps a named control", () => {
    document.body.innerHTML = '<button id="go">Apply</button>';
    expect(clickAndRead(document.getElementById("go")!).recorded?.id).toBe("go");
  });

  it("walks up from an icon-only button to the named combobox host", () => {
    document.body.innerHTML = "";
    const host = document.createElement("x-combo");
    host.setAttribute("role", "combobox");
    host.setAttribute("aria-label", "Country");
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = "<button><svg></svg></button>";
    document.body.appendChild(host);
    const seen = clickAndRead(root.querySelector("button")!);
    expect(seen.raw?.tagName.toLowerCase()).toBe("button");
    expect(seen.recorded).toBe(host);
  });

  it("records the button when the click lands on its presentation overlay", () => {
    document.body.innerHTML = '<button id="login">LOGIN<span id="cover" role="presentation"></span></button>';
    const seen = clickAndRead(document.getElementById("cover")!);
    // target() already skips the presentation span and stops at the button.
    expect(seen.raw?.id).toBe("login");
    expect(seen.recorded?.id).toBe("login");
  });

  it("walks up more than one level, across a non-interactive wrapper", () => {
    document.body.innerHTML =
      '<div role="menuitem" aria-label="More"><span><button id="inner"><svg></svg></button></span></div>';
    const seen = clickAndRead(document.getElementById("inner")!);
    expect(seen.raw?.id).toBe("inner");
    expect(seen.recorded?.getAttribute("aria-label")).toBe("More");
  });

  it("keeps the element when the ancestor's role is not interactive", () => {
    document.body.innerHTML =
      '<div role="group" aria-label="Tools"><div id="tile" onclick="void 0"></div></div>';
    expect(clickAndRead(document.getElementById("tile")!).recorded?.id).toBe("tile");
  });

  it("keeps the element when nothing named is above it", () => {
    document.body.innerHTML = '<div id="tile" onclick="void 0"></div>';
    expect(clickAndRead(document.getElementById("tile")!).recorded?.id).toBe("tile");
  });

  it("returns null for a base of null, so the closed-root lookup still decides", () => {
    document.body.innerHTML = '<button id="go">Apply</button>';
    let recorded: Element | null | undefined;
    const read = (event: Event): void => {
      recorded = recordTarget(event, null);
    };
    window.addEventListener("click", read, true);
    document.getElementById("go")!.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    window.removeEventListener("click", read, true);
    expect(recorded).toBeNull();
  });
});
