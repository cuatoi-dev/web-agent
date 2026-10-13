import { describe, it, expect } from "vitest";
import { base64ToBytes, bytesToBase64 } from "./relay-protocol";

describe("relay-protocol byte codec", () => {
  it("roundtrips an empty array", () => {
    const input = new Uint8Array(0);
    const b64 = bytesToBase64(input);
    const output = base64ToBytes(b64);
    expect(output).toEqual(input);
  });

  it("roundtrips ASCII payload", () => {
    const text = "Hello, world!";
    const input = new TextEncoder().encode(text);
    const b64 = bytesToBase64(input);
    const output = base64ToBytes(b64);
    expect(Array.from(output)).toEqual(Array.from(input));
    expect(new TextDecoder().decode(output)).toBe(text);
  });

  it("roundtrips all bytes 0x00 to 0xFF", () => {
    const input = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      input[i] = i;
    }
    const b64 = bytesToBase64(input);
    const output = base64ToBytes(b64);
    expect(output).toEqual(input);
  });

  it("rejoins split multi-byte UTF-8 character across chunks", () => {
    const emoji = "🌟🚀";
    const fullBytes = new TextEncoder().encode(emoji);
    // Split at an odd byte offset inside a multi-byte sequence
    const chunk1 = fullBytes.subarray(0, 3);
    const chunk2 = fullBytes.subarray(3);

    const b64_1 = bytesToBase64(chunk1);
    const b64_2 = bytesToBase64(chunk2);

    const out1 = base64ToBytes(b64_1);
    const out2 = base64ToBytes(b64_2);

    const rejoined = new Uint8Array(out1.length + out2.length);
    rejoined.set(out1, 0);
    rejoined.set(out2, out1.length);

    expect(new TextDecoder().decode(rejoined)).toBe(emoji);
  });

  it("roundtrips payload larger than 0x8000 chunk size", () => {
    const size = 0x8000 + 1000;
    const input = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
      input[i] = (i * 31) % 256;
    }
    const b64 = bytesToBase64(input);
    const output = base64ToBytes(b64);
    expect(output).toEqual(input);
  });
});
