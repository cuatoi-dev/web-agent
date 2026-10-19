import { ICON_SVGS } from "@cuatoi/web-agent-lit/ui/icon-svgs";
import { PROVIDER_LOGOS } from "./provider-logos";
import type { ModelDef, WireFormat } from "./types";

import type { BuiltIn } from "./provider-builtins.types";

/** Built-in providers in the order shown by the Provider select. */
export const BUILT_IN: BuiltIn[] = [
  {
    id: "openrouter",
    name: "OpenRouter",
    formats: [
      { wireFormat: "openai", endpoint: "https://openrouter.ai/api/v1" },
      { wireFormat: "anthropic", endpoint: "https://openrouter.ai/api" },
    ],
    models: [],
  },
  {
    id: "anthropic",
    name: "Anthropic",
    formats: [
      { wireFormat: "anthropic", endpoint: "https://api.anthropic.com" },
      { wireFormat: "openai", endpoint: "https://api.anthropic.com/v1/" },
    ],
    models: [
      { model: "claude-fable-5-1", label: "Claude Fable 5.1", vision: true },
      { model: "claude-opus-5-5", label: "Claude Opus 5.5", vision: true },
      { model: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", vision: true },
      { model: "claude-haiku-5-5", label: "Claude Haiku 5.5", vision: true },
    ],
  },
  {
    id: "openai",
    name: "OpenAI",
    formats: [{ wireFormat: "openai", endpoint: "https://api.openai.com/v1" }],
    models: [
      { model: "gpt-6-astra", label: "GPT-6 Astra", vision: true },
      { model: "gpt-6.1-sol", label: "GPT-6.1 Sol", vision: true },
      { model: "gpt-6-luna", label: "GPT-6 Luna", vision: true },
      { model: "gpt-6-sol", label: "GPT-6 Sol", vision: true },
      { model: "gpt-5.6-sol", label: "GPT-5.6 Sol", vision: true },
      { model: "gpt-5.6-terra", label: "GPT-5.6 Terra", vision: true },
      { model: "gpt-5.6-luna", label: "GPT-5.6 Luna", vision: true },
    ],
  },
  {
    id: "xai",
    name: "xAI",
    formats: [{ wireFormat: "openai", endpoint: "https://api.x.ai/v1" }],
    models: [],
  },
  {
    id: "google",
    name: "Google AI",
    formats: [
      { wireFormat: "gemini", endpoint: "https://generativelanguage.googleapis.com" },
      {
        wireFormat: "openai",
        endpoint: "https://generativelanguage.googleapis.com/v1beta/openai/",
      },
    ],
    models: [
      { model: "gemini-4-argon", label: "Gemini 4 Argon", vision: true },
      { model: "gemini-3.8-flash", label: "Gemini 3.8 Flash", vision: true },
      { model: "gemini-3.6-flash", label: "Gemini 3.6 Flash", vision: true },
      { model: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite", vision: true },
      { model: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite", vision: true },
      { model: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (preview)", vision: true },
      { model: "gemini-3-flash-preview", label: "Gemini 3 Flash (preview)", vision: true },
    ],
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    formats: [
      { wireFormat: "openai", endpoint: "https://api.deepseek.com" },
      { wireFormat: "anthropic", endpoint: "https://api.deepseek.com/anthropic" },
    ],
    models: [
      { model: "deepseek-flash", label: "DeepSeek V4.1 Flash", vision: true },
      { model: "deepseek-v4-pro", label: "DeepSeek V4 Pro", vision: false },
    ],
  },
  {
    id: "moonshot",
    name: "Moonshot (Kimi)",
    formats: [{ wireFormat: "openai", endpoint: "https://api.moonshot.ai/v1" }],
    models: [],
  },
];

/** The last entry of the Provider select, which is the custom form. */
export const CUSTOM_TILE = { id: "custom", name: "Custom" } as const;

/** The built-in provider with this id, or `undefined` for an unknown id. */
export function builtInById(id: string | undefined): BuiltIn | undefined {
  return id === undefined ? undefined : BUILT_IN.find((p) => p.id === id);
}

/** The endpoint `provider` uses for `wireFormat`; `undefined` when the
 *  provider does not offer that format. */
export function endpointForFormat(provider: BuiltIn, wireFormat: WireFormat): string | undefined {
  return provider.formats.find((f) => f.wireFormat === wireFormat)?.endpoint;
}

/** A fresh copy of the known model list, so the form can never write into the
 *  constant. */
export function builtInInitialModels(provider: BuiltIn): ModelDef[] {
  return provider.models.map((m) => ({ ...m }));
}

/** The logo markup of a built-in provider. A brand provider, or an unknown
 *  id, gets the generic server icon. */
export function providerIconSvg(builtIn: string | undefined): string {
  const logo = builtIn === undefined ? undefined : PROVIDER_LOGOS[builtIn === "google" ? "gemini" : builtIn];
  return typeof logo === "string" ? logo : ICON_SVGS.dns;
}

/** The same logo as a decorated DOM node: it takes the text colour and is
 *  hidden from assistive technology because the name sits beside it. */
export function providerIconNode(builtIn: string | undefined): Element {
  const holder = document.createElement("div");
  holder.innerHTML = providerIconSvg(builtIn);
  const svg = holder.firstElementChild ?? document.createElement("i");
  svg.classList.add("logo");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  return svg;
}
