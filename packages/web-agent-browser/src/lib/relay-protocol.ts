export type {
  RelayRequest,
  RelayAbort,
  RelayHead,
  RelayChunk,
  RelayEnd,
  RelayError,
  RelayToWorker,
  RelayToPage,
} from "./types";

export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  const CHUNK = 0x8000; // String.fromCharCode has an argument-count limit
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
