import { describe, it, expect, vi } from "vitest";
import { createModelSwitch, type ModelSwitchTarget } from "./model-switch";
import type { PublicModel } from "./types";

class FakeTarget extends EventTarget implements ModelSwitchTarget {
  path?: string;
  type?: string;
  model?: string;
  imageInput?: boolean;
  selectedModel?: string;
  models?: Array<{ id: string; label: string; icon?: string }>;
}

const M1: PublicModel = {
  ref: "brand:m1",
  label: "M1 Anthropic",
  endpoint: "https://m1.test/api/anthropic",
  wireFormat: "anthropic",
  model: "claude-m1",
  vision: true,
  icon: "<svg>m1</svg>",
};

const M2: PublicModel = {
  ref: "brand:m2",
  label: "M2 OpenAI",
  endpoint: "https://m2.test/api/openai/v1",
  wireFormat: "openai",
  model: "gpt-m2",
  vision: false,
  icon: "<svg>m2</svg>",
};

const M3: PublicModel = {
  ref: "brand:m3",
  label: "M3 Gemini",
  endpoint: "https://m3.test/api/gemini",
  wireFormat: "gemini",
  model: "gemini-m3",
  vision: true,
  icon: "<svg>m3</svg>",
};

describe("model-switch", () => {
  it("initializes target fields, tool providers, and handles switching events", () => {
    const target = new FakeTarget();
    const buildToolProviders = vi.fn();
    const models = [M1, M2, M3];

    const sw = createModelSwitch({
      target,
      models,
      initial: M1.ref,
      buildToolProviders,
      mock: false,
    });

    expect(target.path).toBe(M1.endpoint);
    expect(target.type).toBe("anthropic");
    expect(target.model).toBe("claude-m1");
    expect(target.imageInput).toBe(true);
    expect(target.selectedModel).toBe(M1.ref);
    expect(target.models).toEqual([
      { id: M1.ref, label: M1.label, icon: M1.icon },
      { id: M2.ref, label: M2.label, icon: M2.icon },
      { id: M3.ref, label: M3.label, icon: M3.icon },
    ]);
    expect(buildToolProviders).toHaveBeenCalledTimes(1);
    expect(buildToolProviders).toHaveBeenCalledWith(true);
    expect(sw.current()).toBe(M1.ref);

    // Switch to M2
    const eventM2 = new CustomEvent("agent-model-select", { detail: { id: M2.ref }, cancelable: true });
    target.dispatchEvent(eventM2);
    expect(eventM2.defaultPrevented).toBe(true);
    expect(target.path).toBe(M2.endpoint);
    expect(target.type).toBe("openai");
    expect(target.model).toBe("gpt-m2");
    expect(target.imageInput).toBe(false);
    expect(target.selectedModel).toBe(M2.ref);
    expect(buildToolProviders).toHaveBeenCalledTimes(2);
    expect(buildToolProviders).toHaveBeenLastCalledWith(false);

    // Switch to M3
    const eventM3 = new CustomEvent("agent-model-select", { detail: { id: M3.ref }, cancelable: true });
    target.dispatchEvent(eventM3);
    expect(eventM3.defaultPrevented).toBe(true);
    expect(target.imageInput).toBe(true);
    expect(buildToolProviders).toHaveBeenCalledTimes(3);
    expect(buildToolProviders).toHaveBeenLastCalledWith(true);

    // Switching M3 -> M1 (both vision: true) does not call buildToolProviders again
    const eventM1 = new CustomEvent("agent-model-select", { detail: { id: M1.ref }, cancelable: true });
    target.dispatchEvent(eventM1);
    expect(eventM1.defaultPrevented).toBe(true);
    expect(target.selectedModel).toBe(M1.ref);
    expect(buildToolProviders).toHaveBeenCalledTimes(3);

    // Unknown id after first apply -> nothing changes, still prevented
    const eventUnknown = new CustomEvent("agent-model-select", { detail: { id: "unknown" }, cancelable: true });
    target.dispatchEvent(eventUnknown);
    expect(eventUnknown.defaultPrevented).toBe(true);
    expect(target.selectedModel).toBe(M1.ref);

  });

  it("mock: true preserves existing target.type", () => {
    const target = new FakeTarget();
    target.type = "mock";
    const buildToolProviders = vi.fn();

    createModelSwitch({
      target,
      models: [M1],
      initial: M1.ref,
      buildToolProviders,
      mock: true,
    });

    expect(target.type).toBe("mock");
  });

  it("unknown initial ref opens on first model", () => {
    const target = new FakeTarget();
    const buildToolProviders = vi.fn();

    const sw = createModelSwitch({
      target,
      models: [M1, M2],
      initial: "brand:unknown",
      buildToolProviders,
      mock: false,
    });

    expect(target.selectedModel).toBe(M1.ref);
    expect(sw.current()).toBe(M1.ref);
  });
});
