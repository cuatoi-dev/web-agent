import { describe, it, expect } from "vitest";
import { readBridgeMessage } from "./bridge-protocol";

function fireEvent(init: MessageEventInit): MessageEvent {
  return new MessageEvent("message", init);
}

describe("readBridgeMessage", () => {
  it("returns null when event.source is not window", () => {
    const otherWindow = {} as Window;
    const event = fireEvent({ source: otherWindow, data: { type: "wa-bridge-enable" } });
    expect(readBridgeMessage(event)).toBeNull();
  });

  it("returns null when event.data is null, a string, or a number", () => {
    expect(readBridgeMessage(fireEvent({ source: window, data: null }))).toBeNull();
    expect(readBridgeMessage(fireEvent({ source: window, data: "not an object" }))).toBeNull();
    expect(readBridgeMessage(fireEvent({ source: window, data: 7 }))).toBeNull();
  });

  it("returns null when event.data.type is not a string", () => {
    const event = fireEvent({ source: window, data: { type: 7 } });
    expect(readBridgeMessage(event)).toBeNull();
  });

  it("returns each of the 13 known message types unchanged, with a payload field surviving", () => {
    const cases: { data: Record<string, unknown>; payloadKey: string; payloadValue: unknown }[] = [
      { data: { type: "wa-bridge-enable", current: "brand:x" }, payloadKey: "current", payloadValue: "brand:x" },
      { data: { type: "wa-bridge-toggle", current: "brand:x" }, payloadKey: "current", payloadValue: "brand:x" },
      { data: { type: "wa-bridge-send", text: "hello" }, payloadKey: "text", payloadValue: "hello" },
      { data: { type: "wa-bridge-read" }, payloadKey: "type", payloadValue: "wa-bridge-read" },
      { data: { type: "wa-bridge-state-request" }, payloadKey: "type", payloadValue: "wa-bridge-state-request" },
      { data: { type: "wa-bridge-toggle-result", mounted: true, foreign: false, requested: "on" }, payloadKey: "requested", payloadValue: "on" },
      { data: { type: "wa-bridge-state", mounted: false, foreign: true }, payloadKey: "foreign", payloadValue: true },
      { data: { type: "wa-bridge-send-result", mounted: true, foreign: false, delivered: true, ranCommand: true, command: "new" }, payloadKey: "delivered", payloadValue: true },
      { data: { type: "wa-bridge-read-result", mounted: true, foreign: false, messages: [], running: true }, payloadKey: "running", payloadValue: true },
      { data: { type: "wa-bridge-set-origin-enabled", origin: "https://example.com", enabled: true }, payloadKey: "origin", payloadValue: "https://example.com" },
      { data: { type: "wa-relay-req", reqId: "r1", request: { type: "abort" } }, payloadKey: "reqId", payloadValue: "r1" },
      { data: { type: "wa-relay-res", reqId: "r1", msg: { type: "end" } }, payloadKey: "msg", payloadValue: { type: "end" } },
      { data: { type: "wa-relay-abort", reqId: "r1" }, payloadKey: "reqId", payloadValue: "r1" },
    ];

    for (const { data, payloadKey, payloadValue } of cases) {
      const event = fireEvent({ source: window, data });
      const result = readBridgeMessage(event);
      expect(result?.type).toBe(data.type);
      expect((result as unknown as Record<string, unknown>)[payloadKey]).toEqual(payloadValue);
    }
  });

  it("brand survives the guard on wa-bridge-enable", () => {
    const event = fireEvent({
      source: window,
      data: { type: "wa-bridge-enable", current: "brand:x", brand: { prompts: { inPage: "P" } } },
    });
    const msg = readBridgeMessage(event);
    expect(msg).not.toBeNull();
    expect((msg as { brand?: { prompts?: { inPage?: string } } }).brand?.prompts?.inPage).toBe("P");
  });

  it("ranCommand and command survive the guard on wa-bridge-send-result", () => {
    const event = fireEvent({
      source: window,
      data: { type: "wa-bridge-send-result", mounted: true, foreign: false, delivered: true, ranCommand: true, command: "new" },
    });
    const result = readBridgeMessage(event) as unknown as Record<string, unknown>;
    expect(result.ranCommand).toBe(true);
    expect(result.command).toBe("new");
  });

  it("requested survives the guard on wa-bridge-toggle-result", () => {
    const event = fireEvent({
      source: window,
      data: { type: "wa-bridge-toggle-result", mounted: false, foreign: false, requested: "on" },
    });
    const result = readBridgeMessage(event) as unknown as Record<string, unknown>;
    expect(result.requested).toBe("on");
  });

  it("still returns a message with an unrecognised type, rather than rejecting it", () => {
    // content.ts and bridge.ts both fall through to `return` on an
    // unrecognised type today; the guard must not start dropping them earlier.
    const event = fireEvent({ source: window, data: { type: "wa-something-unknown", extra: 1 } });
    const result = readBridgeMessage(event);
    expect(result?.type).toBe("wa-something-unknown");
  });
});
