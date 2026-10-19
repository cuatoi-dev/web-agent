// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { openProviderDialog } from "./provider-dialog";
import type { CustomProvider } from "./types";

const q = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;
const tick = () => new Promise((r) => setTimeout(r, 0));

function fill(sel: string, value: string): void {
  const input = q<HTMLInputElement>(sel);
  input.value = value;
}

describe("openProviderDialog", () => {
  it("opens empty with one model row, no header rows, and Refresh visible for openai", () => {
    void openProviderDialog();
    expect(document.querySelectorAll(".form-model-row").length).toBe(1);
    expect(document.querySelectorAll(".header-row").length).toBe(0);
    expect(q<HTMLButtonElement>(".refresh-models-btn").hidden).toBe(false);
    expect(q(".refresh-models-btn svg")).not.toBeNull();
    q<HTMLButtonElement>(".cancel-btn").click();
  });

  it("hides Refresh for anthropic and shows it again for openai", () => {
    void openProviderDialog();
    const fmt = q<HTMLSelectElement>("#provider-format");
    fmt.value = "anthropic";
    fmt.dispatchEvent(new Event("change"));
    expect(q<HTMLButtonElement>(".refresh-models-btn").hidden).toBe(true);
    fmt.value = "openai";
    fmt.dispatchEvent(new Event("change"));
    expect(q<HTMLButtonElement>(".refresh-models-btn").hidden).toBe(false);
    q<HTMLButtonElement>(".cancel-btn").click();
  });

  it("shows validation errors without asking for permission", () => {
    const requestPermission = vi.fn().mockResolvedValue(true);
    void openProviderDialog({ requestPermission });
    fill("#provider-endpoint", "ftp://x");
    q<HTMLButtonElement>(".save-provider-btn").click();
    expect(q(".provider-endpoint-error").textContent).toBe(
      "Enter an endpoint URL that starts with http:// or https://.",
    );
    expect(q<HTMLElement>(".provider-models-error").textContent).toBe("Add at least one model.");
    expect(requestPermission).not.toHaveBeenCalled();
    q<HTMLButtonElement>(".cancel-btn").click();
  });

  it("asks permission on a valid Save and resolves the provider", async () => {
    const requestPermission = vi.fn().mockResolvedValue(true);
    const p = openProviderDialog({ requestPermission, newId: () => "id-1" });
    fill("#provider-name", "Local");
    fill("#provider-endpoint", "http://localhost:8000/v1");
    fill(".form-model-id", "m1");
    q<HTMLButtonElement>(".add-header-btn").click();
    fill(".header-name", "X-Team");
    fill(".header-value", "web");
    q<HTMLInputElement>(".form-model-vision").checked = true;
    q<HTMLButtonElement>(".save-provider-btn").click();
    expect(requestPermission).toHaveBeenCalledWith("http://localhost/*");
    expect(await p).toEqual({
      id: "id-1",
      name: "Local",
      wireFormat: "openai",
      endpoint: "http://localhost:8000/v1",
      apiKey: "",
      headers: [{ name: "X-Team", value: "web" }],
      models: [{ model: "m1", label: "m1", vision: true }],
    });
  });

  it("keeps the dialog open when permission is refused", async () => {
    const requestPermission = vi.fn().mockResolvedValue(false);
    void openProviderDialog({ requestPermission });
    fill("#provider-endpoint", "http://localhost:8000/v1");
    fill(".form-model-id", "m1");
    q<HTMLButtonElement>(".save-provider-btn").click();
    await tick();
    expect(q(".provider-endpoint-error").textContent).toBe("Permission to reach this endpoint was not granted.");
    expect(document.querySelector("dialog")).not.toBeNull();
    q<HTMLButtonElement>(".cancel-btn").click();
  });

  it("fills every field when editing", () => {
    const existing: CustomProvider = {
      id: "p1",
      name: "Local",
      wireFormat: "anthropic",
      endpoint: "http://localhost:8000/v1",
      apiKey: "secret",
      headers: [{ name: "X-Team", value: "web" }],
      models: [
        { model: "a", label: "Alpha", vision: true },
        { model: "b", label: "Beta", vision: false },
      ],
    };
    void openProviderDialog({ provider: existing });
    expect(q<HTMLInputElement>("#provider-name").value).toBe("Local");
    expect(q<HTMLSelectElement>("#provider-format").value).toBe("anthropic");
    expect(q<HTMLInputElement>("#provider-endpoint").value).toBe("http://localhost:8000/v1");
    expect(q<HTMLInputElement>("#provider-api-key").value).toBe("secret");
    expect(q<HTMLInputElement>(".header-name").value).toBe("X-Team");
    expect([...document.querySelectorAll<HTMLInputElement>(".form-model-id")].map((i) => i.value)).toEqual(["a", "b"]);
    expect([...document.querySelectorAll<HTMLInputElement>(".form-model-vision")].map((i) => i.checked)).toEqual([
      true,
      false,
    ]);
    q<HTMLButtonElement>(".cancel-btn").click();
  });
});
