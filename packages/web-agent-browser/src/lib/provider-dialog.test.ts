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
  it("opens Anthropic with its logo, selected format, endpoint and four vision models", () => {
    void openProviderDialog({ builtIn: "anthropic" });
    expect(q("dialog h2")?.textContent).toBe("Add Anthropic");
    expect(q("dialog h2 svg.logo")).not.toBeNull();
    expect(q<HTMLInputElement>("#provider-endpoint").value).toBe("https://api.anthropic.com");
    expect(q(".format-opt[data-format='anthropic']").getAttribute("aria-pressed")).toBe("true");
    expect(document.querySelectorAll(".format-opt")).toHaveLength(2);
    expect([...document.querySelectorAll<HTMLInputElement>(".form-model-id")].map((i) => i.value)).toEqual([
      "claude-fable-5-1",
      "claude-opus-5-5",
      "claude-sonnet-5-5",
      "claude-haiku-5-5",
    ]);
    expect([...document.querySelectorAll<HTMLInputElement>(".form-model-vision")].every((i) => i.checked)).toBe(true);
    expect(q<HTMLButtonElement>(".refresh-models-btn").hidden).toBe(true);
    q<HTMLButtonElement>(".cancel-btn").click();
  });

  it("switches a two-format provider's endpoint and shows Refresh for openai", () => {
    void openProviderDialog({ builtIn: "google" });
    expect(q<HTMLInputElement>("#provider-name").value).toBe("Google AI");
    expect(q<HTMLInputElement>("#provider-endpoint").value).toBe("https://generativelanguage.googleapis.com");
    expect(q(".format-opt[data-format='gemini']").getAttribute("aria-pressed")).toBe("true");
    expect(q<HTMLButtonElement>(".refresh-models-btn").hidden).toBe(true);
    expect(document.querySelectorAll(".form-model-row").length).toBe(7);

    q<HTMLButtonElement>(".format-opt[data-format='openai']").click();
    expect(q<HTMLInputElement>("#provider-endpoint").value).toBe(
      "https://generativelanguage.googleapis.com/v1beta/openai/",
    );
    expect(q(".format-opt[data-format='openai']").getAttribute("aria-pressed")).toBe("true");
    expect(q(".format-opt[data-format='gemini']").getAttribute("aria-pressed")).toBe("false");
    expect(q<HTMLButtonElement>(".refresh-models-btn").hidden).toBe(false);
    q<HTMLButtonElement>(".cancel-btn").click();
  });

  it("shows one fixed format and no models for xAI", () => {
    void openProviderDialog({ builtIn: "xai" });
    expect(q(".format-fixed").textContent).toBe("openai");
    expect(document.querySelector(".format-opt")).toBeNull();
    expect(q<HTMLInputElement>("#provider-endpoint").value).toBe("https://api.x.ai/v1");
    expect(document.querySelectorAll(".form-model-row").length).toBe(1);
    expect(q<HTMLInputElement>(".form-model-id").value).toBe("");
    q<HTMLButtonElement>(".cancel-btn").click();
  });

  it("saves a built-in provider with its id, endpoint and known models", async () => {
    const requestPermission = vi.fn().mockResolvedValue(true);
    const p = openProviderDialog({ builtIn: "deepseek", requestPermission, newId: () => "id-ds" });
    q<HTMLButtonElement>(".save-provider-btn").click();
    expect(requestPermission).toHaveBeenCalledWith("https://api.deepseek.com/*");
    const saved = await p;
    expect(saved?.builtIn).toBe("deepseek");
    expect(saved?.wireFormat).toBe("openai");
    expect(saved?.endpoint).toBe("https://api.deepseek.com");
    expect(saved?.models).toEqual([
      { model: "deepseek-flash", label: "DeepSeek V4.1 Flash", vision: true },
      { model: "deepseek-v4-pro", label: "DeepSeek V4 Pro", vision: false },
    ]);
  });

  it("keeps the built-in heading and the stored values when editing", () => {
    const existing: CustomProvider = {
      id: "p1",
      builtIn: "anthropic",
      name: "My Claude",
      wireFormat: "openai",
      endpoint: "https://api.anthropic.com/v1/",
      apiKey: "secret",
      headers: [],
      models: [{ model: "mine", label: "Mine", vision: false }],
    };
    void openProviderDialog({ provider: existing });
    expect(q("dialog h2")?.textContent).toBe("Edit Anthropic");
    expect(q<HTMLInputElement>("#provider-name").value).toBe("My Claude");
    expect(q(".format-opt[data-format='openai']").getAttribute("aria-pressed")).toBe("true");
    expect(q<HTMLInputElement>("#provider-endpoint").value).toBe("https://api.anthropic.com/v1/");
    expect([...document.querySelectorAll<HTMLInputElement>(".form-model-id")].map((i) => i.value)).toEqual(["mine"]);
    q<HTMLButtonElement>(".cancel-btn").click();
  });
  it("opens the current OpenAI models as editable vision rows", () => {
    void openProviderDialog({ builtIn: "openai" });
    expect(document.querySelectorAll(".form-model-row")).toHaveLength(7);
    const rows = [...document.querySelectorAll<HTMLInputElement>(".form-model-id")];
    expect(rows.every((row) => /^gpt-(6|5\.6)/.test(row.value))).toBe(true);
    expect(new Set(rows.map((row) => row.value)).size).toBe(rows.length);
    expect([...document.querySelectorAll<HTMLInputElement>(".form-model-vision")].every((row) => row.checked)).toBe(true);
    q<HTMLButtonElement>(".cancel-btn").click();
  });

  it("opens Moonshot with one fixed format and an empty editable row", () => {
    void openProviderDialog({ builtIn: "moonshot" });
    expect(q(".format-fixed").textContent).toBe("openai");
    expect(document.querySelector(".format-opt")).toBeNull();
    expect(q<HTMLInputElement>(".form-model-id").value).toBe("");
    q<HTMLButtonElement>(".cancel-btn").click();
  });

});
