import { afterAll, describe, expect, it } from "vitest";
import { listThemes, registerTheme } from "@cuatoi/web-agent-lit/themes";
import { mountThemeSwitcher } from "./gallery-theme";
import { mountThemeShowcaseDemo } from "./gallery-demos-theme";

// Real modules, imported once. Repeated module resets would re-register the
// Lit custom elements this module's dependency graph defines.

/** A theme registered after the modules above were imported. */
const FIXTURE = {
  id: "fixture-gallery",
  label: "Fixture gallery",
  scheme: "light" as const,
  base: "wa2-light",
};

const ORIGINAL_URL = `${window.location.pathname}${window.location.search}`;

/** Undo what a registry application leaves on the document. */
function clearThemeArtifacts(): void {
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-theme-base");
  for (const node of Array.from(document.head.querySelectorAll("[data-wa-theme-css]"))) {
    node.remove();
  }
}

afterAll(() => {
  window.history.replaceState(null, "", ORIGINAL_URL);
  clearThemeArtifacts();
});

describe("theme showcase demo", () => {
  it("renders one card per registered theme plus the provided card", () => {
    // The frame mode without `showcase=1` is the card grid, not a single panel.
    window.history.replaceState(null, "", "/gallery.html?frame=demo-theme-showcase");

    const before = document.createElement("div");
    mountThemeShowcaseDemo(before);
    expect(before.querySelectorAll(".frame-card")).toHaveLength(listThemes().length + 1);
    const beforeIds = Array.from(before.querySelectorAll(".frame-card"), (c) =>
      (c as HTMLElement).dataset.theme,
    );
    expect(beforeIds).toEqual([...listThemes().map((t) => t.id), "provided"]);

    registerTheme(FIXTURE);

    const selectorHost = document.createElement("div");
    mountThemeSwitcher(selectorHost, "wa2-dark", () => {});
    const options = Array.from(selectorHost.querySelectorAll("option"), (o) => [
      o.value,
      o.textContent,
    ]);
    expect(options).toHaveLength(4);
    expect(options).toContainEqual([FIXTURE.id, FIXTURE.label]);

    const showcaseHost = document.createElement("div");
    mountThemeShowcaseDemo(showcaseHost);
    const cards = Array.from(showcaseHost.querySelectorAll(".frame-card"));
    expect(cards).toHaveLength(5);

    const expected = [...listThemes().map(({ id, label }) => ({ id, label })), {
      id: "provided",
      label: "Host-provided (wa2-light + custom info/border)",
    }];
    expect(expected.map((t) => t.id)).toEqual([
      "wa1-dark",
      "wa2-dark",
      "wa2-light",
      FIXTURE.id,
      "provided",
    ]);

    for (const [i, card] of cards.entries()) {
      const descriptor = expected[i];
      const frame = card.querySelector("iframe")!;
      const caption = card.querySelector("figcaption")!;
      const themeParam = new URL(frame.src, "http://localhost/gallery.html").searchParams.get("theme");

      expect((card as HTMLElement).dataset.theme).toBe(descriptor.id);
      expect(frame.getAttribute("data-theme-frame")).toBe(descriptor.id);
      expect(themeParam).toBe(descriptor.id);
      expect(frame.title).toBe(`Agent panel — ${descriptor.label}`);
      expect(caption.textContent).toBe(`${descriptor.label} — ${descriptor.id}`);
    }

    expect((cards.at(-1) as HTMLElement).dataset.theme).toBe("provided");
    expect(
      new URL(
        cards.at(-1)!.querySelector("iframe")!.src,
        "http://localhost/gallery.html",
      ).searchParams.get("theme"),
    ).toBe("provided");

    clearThemeArtifacts();
  });
});