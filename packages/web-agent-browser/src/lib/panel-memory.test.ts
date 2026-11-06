import { describe, expect, it, vi } from "vitest";
import { createPanelMemorySync, isAgentMemoryOn } from "./panel-memory";
import type { PanelMemorySessionState } from "./panel-memory.types";

describe("isAgentMemoryOn", () => {
  const cases: { memory: boolean | undefined; switchOn: boolean | undefined; expected: boolean }[] = [
    { memory: undefined, switchOn: undefined, expected: false },
    { memory: undefined, switchOn: true, expected: false },
    { memory: false, switchOn: true, expected: false },
    { memory: true, switchOn: undefined, expected: false },
    { memory: true, switchOn: false, expected: false },
    { memory: true, switchOn: true, expected: true },
  ];

  for (const c of cases) {
    it(`memory ${String(c.memory)} with the switch ${String(c.switchOn)} is ${String(c.expected)}`, () => {
      expect(isAgentMemoryOn({ id: "tesagent", memory: c.memory }, { tesagent: c.switchOn as boolean }))
        .toBe(c.expected);
    });
  }

  it("reads only this agent's switch", () => {
    expect(isAgentMemoryOn({ id: "tesagent", memory: true }, { chromagent: true })).toBe(false);
    expect(isAgentMemoryOn({ id: "tesagent", memory: true }, { tesagent: true, chromagent: false })).toBe(true);
  });
});

describe("createPanelMemorySync", () => {
  function setup(initialOn: boolean, fresh: () => boolean) {
    const apply = vi.fn();
    const sync = createPanelMemorySync({ initialOn, isCurrentChatFresh: fresh, apply });
    return { sync, apply };
  }

  it("starts on the initial state and applies nothing", () => {
    const { sync, apply } = setup(false, () => true);
    expect(sync.active()).toBe(false);
    expect(sync.desired()).toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });

  it("applies at once when the current chat is fresh", () => {
    const { sync, apply } = setup(false, () => true);
    sync.setDesired(true);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(true);
    expect(sync.active()).toBe(true);
  });

  it("holds the change while the current chat is no longer fresh", () => {
    let fresh = false;
    const { sync, apply } = setup(false, () => fresh);
    sync.setDesired(true);
    expect(apply).not.toHaveBeenCalled();
    expect(sync.active()).toBe(false);
    expect(sync.desired()).toBe(true);

    fresh = true;
    sync.onSessionState({ activeSessionId: "s1", messages: [], running: false });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(true);
    expect(sync.active()).toBe(true);
  });

  it("ignores a repeated set of the current state", () => {
    const { sync, apply } = setup(true, () => true);
    sync.setDesired(true);
    expect(apply).not.toHaveBeenCalled();
    sync.setDesired(false);
    expect(apply).toHaveBeenCalledWith(false);
    sync.setDesired(false);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("applies a held change only on an open, idle, empty session", () => {
    const { sync, apply } = setup(false, () => false);
    sync.setDesired(true);
    const states: PanelMemorySessionState[] = [
      { activeSessionId: undefined, messages: [], running: false },
      { activeSessionId: "s1", messages: [], running: true },
      { activeSessionId: "s1", messages: [{ role: "user" }], running: false },
    ];
    for (const state of states) sync.onSessionState(state);
    expect(apply).not.toHaveBeenCalled();
    expect(sync.active()).toBe(false);

    sync.onSessionState({ activeSessionId: "s2", messages: [], running: false });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(true);
  });
});
