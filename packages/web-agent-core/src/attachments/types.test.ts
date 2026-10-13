import { describe, it, expect } from "vitest";
import {
  ATTACHMENT_CHIPS_KEY,
  attachmentChipsMeta,
  readAttachmentChips,
  type AttachmentProvider,
} from "./types.js";

/** The exact fallback formula `chat-panel-elements.ts`'s `_updateProviderButton`
 *  applies to a provider's `view()` — a provider with no `view` (or one that
 *  returns `{}`) must behave identically to its own static `icon`/`label`,
 *  not disabled, no tooltip. */
function resolveView(p: AttachmentProvider): { icon: string; label: string; disabled: boolean; tooltip: string | undefined } {
  const v = p.view?.() ?? {};
  return {
    icon: v.icon ?? p.icon,
    label: v.label ?? p.label,
    disabled: v.disabled ?? false,
    tooltip: v.tooltip,
  };
}

describe("readAttachmentChips", () => {
  it("returns [] for undefined, missing key, and non-array value", () => {
    expect(readAttachmentChips(undefined)).toEqual([]);
    expect(readAttachmentChips({})).toEqual([]);
    expect(readAttachmentChips({ [ATTACHMENT_CHIPS_KEY]: "invalid" })).toEqual([]);
  });

  it("drops malformed entries and keeps well-formed ones", () => {
    const raw = [
      { providerId: "a", label: "x" },
      { providerId: 1, label: "y" },
      { label: "z" },
      null,
      undefined,
      "string",
    ];
    expect(readAttachmentChips({ [ATTACHMENT_CHIPS_KEY]: raw })).toEqual([
      { providerId: "a", label: "x" },
    ]);
  });

  it("attachmentChipsMeta round-trips through readAttachmentChips", () => {
    const chips = [
      { providerId: "image", label: "1 image" },
      { providerId: "custom", label: "Custom attachment" },
    ];
    const meta = attachmentChipsMeta(chips);
    expect(readAttachmentChips(meta)).toEqual(chips);
  });
});

describe("AttachmentProviderView fallback", () => {
  const base: AttachmentProvider = {
    id: "stub",
    label: "Static label",
    icon: "attach_file",
    pick: () => {},
    hasPending: () => false,
    onUserPrompt: () => undefined,
  };

  it("a provider with no view() resolves to its static icon/label, enabled, no tooltip", () => {
    expect(resolveView(base)).toEqual({
      icon: "attach_file",
      label: "Static label",
      disabled: false,
      tooltip: undefined,
    });
  });

  it("a view() returning {} resolves identically to no view() at all", () => {
    expect(resolveView({ ...base, view: () => ({}) })).toEqual(resolveView(base));
  });

  it("view() fields override the static ones only where present", () => {
    expect(resolveView({ ...base, view: () => ({ icon: "stop" }) })).toEqual({
      icon: "stop",
      label: "Static label",
      disabled: false,
      tooltip: undefined,
    });
    expect(resolveView({ ...base, view: () => ({ disabled: true, tooltip: "Turn on the agent in this tab to record" }) })).toEqual({
      icon: "attach_file",
      label: "Static label",
      disabled: true,
      tooltip: "Turn on the agent in this tab to record",
    });
  });

  it("an explicit tooltip: undefined still removes any earlier tooltip", () => {
    expect(resolveView({ ...base, view: () => ({ tooltip: undefined }) }).tooltip).toBeUndefined();
  });
});
