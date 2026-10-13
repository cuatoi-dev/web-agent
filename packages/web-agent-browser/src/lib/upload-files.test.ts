import { describe, expect, it } from "vitest";
import { checkFileSpecs, formatSize } from "./upload-files";

describe("upload-files (124/003)", () => {
  it("U2.1: empty array or undefined returns error", () => {
    expect(checkFileSpecs([])).toEqual({ ok: false, error: "Pass at least one file." });
    expect(checkFileSpecs(undefined)).toEqual({ ok: false, error: "Pass at least one file." });
  });

  it("U2.2: text and base64 both set returns form error", () => {
    const res = checkFileSpecs([
      { name: "a", mimeType: "text/plain", text: "hi", base64: "aGk=" },
    ]);
    expect(res).toEqual({ ok: false, error: 'File "a": pass text, base64, or size and fill.' });
  });

  it("U2.3: size without fill and fill without size returns form error", () => {
    expect(
      checkFileSpecs([{ name: "a", mimeType: "text/plain", size: 10 }]),
    ).toEqual({ ok: false, error: 'File "a": pass text, base64, or size and fill.' });
    expect(
      checkFileSpecs([{ name: "a", mimeType: "text/plain", fill: "A" }]),
    ).toEqual({ ok: false, error: 'File "a": pass text, base64, or size and fill.' });
  });

  it("U2.4: no content form returns form error", () => {
    expect(
      checkFileSpecs([{ name: "a", mimeType: "text/plain" }]),
    ).toEqual({ ok: false, error: 'File "a": pass text, base64, or size and fill.' });
  });

  it("U2.5: fill with more than one character returns fill error", () => {
    expect(
      checkFileSpecs([{ name: "a", mimeType: "application/octet-stream", size: 3, fill: "AB" }]),
    ).toEqual({ ok: false, error: 'File "a": fill must be one character.' });
  });

  it("U2.6: exceeding MAX_UPLOAD_BYTES returns limit error", () => {
    expect(
      checkFileSpecs([{ name: "a", mimeType: "application/octet-stream", size: 11534336, fill: "A" }]),
    ).toEqual({ ok: false, error: "Uploads are limited to 10 MB in total." });
  });

  it("U2.7: exactly 10 MB succeeds", () => {
    const res = checkFileSpecs([{ name: "a", mimeType: "application/octet-stream", size: 10485760, fill: "A" }]);
    expect(res.ok).toBe(true);
  });

  it("U2.8: UTF-8 multibyte characters count towards byte total", () => {
    const res = checkFileSpecs([
      { name: "a", mimeType: "application/octet-stream", size: 10485759, fill: "A" },
      { name: "b", mimeType: "text/plain", text: "é" },
    ]);
    expect(res).toEqual({ ok: false, error: "Uploads are limited to 10 MB in total." });
  });

  it("U2.9: base64 decoded length counts towards byte total", () => {
    const res = checkFileSpecs([
      { name: "a", mimeType: "application/octet-stream", size: 10485758, fill: "A" },
      { name: "b", mimeType: "application/octet-stream", base64: "aGk=" },
    ]);
    expect(res.ok).toBe(true);
  });

  it("U2.10: ok result files keeps only the chosen content fields", () => {
    const res = checkFileSpecs([
      { name: "orders.csv", mimeType: "text/csv", text: "a,b\n1,2\n" },
    ]);
    expect(res).toEqual({
      ok: true,
      files: [{ name: "orders.csv", mimeType: "text/csv", text: "a,b\n1,2\n" }],
    });
  });

  it("U2.11: formatSize formats bytes, KB and MB", () => {
    expect(formatSize(8)).toBe("8 B");
    expect(formatSize(2150)).toBe("2.1 KB");
    expect(formatSize(5242880)).toBe("5.0 MB");
  });
});
