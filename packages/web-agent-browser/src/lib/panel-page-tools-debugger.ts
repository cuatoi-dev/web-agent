// The debugger session tools: start_debugging, stop_debugging (124/001), and
// page_hover, page_press_key, page_emulate (124/002). The session itself
// lives in debugger-session.ts, one per side panel page.
import { z } from "zod";
import type { CustomToolDef } from "@cuatoi/web-agent-core";
import { createHelperWorlds, STALE_REF } from "./debugger-helper-world";
import type { HelperDescribe } from "./helper-api";
import type { JournalTarget } from "./action-journal.types";
import type { PanelPageToolsOptions } from "./types";
import type { DevicePreset, KeyDef } from "./panel-page-tools-debugger.types";
import {
  createActionJournal,
  emulateEntry,
  emulateResetEntry,
  hoverEntry,
  journalSuffix,
  notJournaledSuffix,
  pressKeyEntry,
} from "./action-journal";

function tabIdText(input: Record<string, unknown>): string {
  return typeof input.tabId === "number" || typeof input.tabId === "string" ? String(input.tabId) : "(none)";
}

const KEYS: Record<string, KeyDef> = {
  Enter: { key: "Enter", code: "Enter", vk: 13, text: "\r" },
  Escape: { key: "Escape", code: "Escape", vk: 27 },
  Tab: { key: "Tab", code: "Tab", vk: 9 },
  Backspace: { key: "Backspace", code: "Backspace", vk: 8 },
  Delete: { key: "Delete", code: "Delete", vk: 46 },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", vk: 38 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", vk: 40 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", vk: 37 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", vk: 39 },
  Home: { key: "Home", code: "Home", vk: 36 },
  End: { key: "End", code: "End", vk: 35 },
  PageUp: { key: "PageUp", code: "PageUp", vk: 33 },
  PageDown: { key: "PageDown", code: "PageDown", vk: 34 },
  Space: { key: " ", code: "Space", vk: 32, text: " " },
};
for (let i = 1; i <= 12; i++) {
  KEYS[`F${i}`] = { key: `F${i}`, code: `F${i}`, vk: 111 + i };
}

const MODIFIER_BITS: Record<string, number> = { Alt: 1, Control: 2, Meta: 4, Shift: 8 };

/** Resolve a `page_press_key` `key` input to a CDP key definition, or the
 *  unknown-key error text. A one-character key gets a synthesized letter or
 *  digit code; anything else must be a name in {@link KEYS}. */
function resolveKeyDef(key: string): { ok: true; def: KeyDef } | { ok: false; error: string } {
  if (Object.prototype.hasOwnProperty.call(KEYS, key)) {
    return { ok: true, def: KEYS[key] };
  }
  if (key.length === 1) {
    const upper = key.toUpperCase();
    const code = /[a-zA-Z]/.test(key) ? `Key${upper}` : /[0-9]/.test(key) ? `Digit${key}` : "";
    return { ok: true, def: { key, code, vk: upper.charCodeAt(0), text: key } };
  }
  return {
    ok: false,
    error: `Unknown key "${key}". Use a Playwright key name such as Enter, Escape, Tab, ArrowDown, or one character.`,
  };
}

const PRESETS: Record<string, DevicePreset> = {
  "iPhone 15": {
    width: 393,
    height: 659,
    scale: 3,
    mobile: true,
    touch: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/15E148 Safari/604.1",
  },
  "iPad Mini landscape": {
    width: 1024,
    height: 768,
    scale: 2,
    mobile: true,
    touch: true,
    userAgent:
      "Mozilla/5.0 (iPad; CPU OS 12_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/15E148 Safari/604.1",
  },
  "Desktop Chrome": {
    width: 1280,
    height: 720,
    scale: 1,
    mobile: false,
    touch: false,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.7827.55 Safari/537.36",
  },
};

export function createDebuggerPageTools(options: PanelPageToolsOptions): CustomToolDef[] {
  const session = options.debuggerSession;
  if (!session) return [];
  const helper = options.helper ?? createHelperWorlds(session);
  const journal = options.journal ?? createActionJournal();

  const startDebugging: CustomToolDef = {
    name: "start_debugging",
    description:
      "Start debugging a browser tab through Chrome's debugger. page_click and page_fill_form need this first. Chrome shows a bar that says the extension started debugging this browser; if the user presses Cancel on it, debugging stops and you can call start_debugging again. While a tab is being debugged, a dialog the page opens (alert, confirm, prompt) is dismissed. Call read_tabs first and pass the tab ID it reports.",
    inputSchema: z.object({
      tabId: z.number().describe("The ID of the tab. Call read_tabs first and pass the ID it reports."),
    }),
    summarize: (input) => `Start debugging tab #${tabIdText(input)}`,
    execute: async (input) => {
      const tabId = Number(input.tabId);
      // 131/001 — no activation check and no page script. Chrome's own
      // debugging bar is the consent, so start_debugging attaches to any tab
      // Chrome allows.
      const started = await session.start(tabId);
      // The step line renders "<agent> started debugging <host>" from the host
      // map, which `onActivatedOrigin` fills (page-tool-phrases.ts:190-196).
      if (!started.isError) {
        const url = await session.tabUrl(tabId).catch(() => "");
        try {
          options.onActivatedOrigin?.(tabId, new URL(url).origin);
        } catch {
          // A tab with no parsable URL keeps UNKNOWN_HOST. Not an error.
        }
      }
      return started;
    },
  };

  const stopDebugging: CustomToolDef = {
    name: "stop_debugging",
    description:
      "Stop debugging a browser tab and detach Chrome's debugger from it. Call it when you have finished acting on the tab. Calling it on a tab that is not being debugged is not an error.",
    inputSchema: z.object({
      tabId: z.number().describe("The ID of the tab. Call read_tabs first and pass the ID it reports."),
    }),
    summarize: (input) => `Stop debugging tab #${tabIdText(input)}`,
    execute: async (input) => ({ content: await session.stop(Number(input.tabId)) }),
  };

  const pageHover: CustomToolDef = {
    name: "page_hover",
    description:
      "Hover the mouse over an element in a browser tab by its ref from page_snapshot. Call read_tabs first and pass the tab ID it reports. Needs start_debugging on the tab first.",
    inputSchema: z.object({
      tabId: z.number().describe("The ID of the tab. Call read_tabs first and pass the ID it reports."),
      ref: z.string().describe('A ref from a page_snapshot call, e.g. "3".'),
    }),
    summarize: (input) => {
      const idText = typeof input.tabId === "number" || typeof input.tabId === "string" ? String(input.tabId) : "(none)";
      const ref = typeof input.ref === "string" ? input.ref : "";
      return `Hover [${ref}] in tab #${idText}`;
    },
    execute: async (input) => {
      const tabId = Number(input.tabId);
      const g = session.gate(tabId);
      if (!g.ok) return { content: g.error, isError: true };

      const ref = typeof input.ref === "string" ? input.ref : "";
      const d = await helper.call<HelperDescribe>(tabId, ref, "describe", [ref]);
      if (!d.ok) return { content: d.error, isError: true };
      if (!d.value.connected) return { content: STALE_REF(ref), isError: true };
      if (d.value.refusal !== undefined) return { content: d.value.refusal, isError: true };

      const c = await helper.centre(tabId, ref);
      if (!c.ok) return { content: c.error, isError: true };

      await options.recording?.pause(tabId);
      try {
        await session.send(tabId, "Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x: c.x,
          y: c.y,
        });
      } finally {
        await options.recording?.resume(tabId);
      }
      const t = await helper.call<JournalTarget>(tabId, ref, "target", [ref, d.value.desc]);
      const chain = await helper.frameChain(tabId, ref);
      const content = `Hovered [${ref}] ${d.value.desc}.`;
      if (!t.ok || t.value.locator === undefined) {
        return { content: content + notJournaledSuffix(t.ok ? t.value.label : `[${ref}] ${d.value.desc}`) };
      }
      return { content: content + journalSuffix(journal.append([hoverEntry(t.value, t.value.locator, chain)])) };
    },
  };

  const pagePressKey: CustomToolDef = {
    name: "page_press_key",
    description:
      "Press a keyboard key or key combination in an activated browser tab. Supports named keys (Enter, Escape, Tab, Backspace, Delete, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Home, End, PageUp, PageDown, Space, F1-F12), single characters, and modifiers (Alt, Control, Meta, Shift). Needs start_debugging on the tab first.",
    inputSchema: z.object({
      tabId: z.number().describe("The ID of the tab. Call read_tabs first and pass the ID it reports."),
      key: z.string().describe('Key name such as "Enter", "Escape", "Tab", "ArrowDown", or a single character.'),
      modifiers: z.array(z.string()).optional().describe('Optional modifier list: "Alt", "Control", "Meta", "Shift".'),
    }),
    summarize: (input) => {
      const idText = typeof input.tabId === "number" || typeof input.tabId === "string" ? String(input.tabId) : "(none)";
      const key = typeof input.key === "string" ? input.key : "";
      const mods = Array.isArray(input.modifiers) ? input.modifiers.filter((m): m is string => typeof m === "string") : [];
      const combo = mods.length ? `${mods.join("+")}+${key}` : key;
      return `Press ${combo} in tab #${idText}`;
    },
    execute: async (input) => {
      const tabId = Number(input.tabId);
      const g = session.gate(tabId);
      if (!g.ok) return { content: g.error, isError: true };

      const key = typeof input.key === "string" ? input.key : "";
      const keyResult = resolveKeyDef(key);
      if (!keyResult.ok) return { content: keyResult.error, isError: true };
      const def = keyResult.def;

      const mods = Array.isArray(input.modifiers) ? (input.modifiers as string[]) : [];
      for (const m of mods) {
        if (!Object.prototype.hasOwnProperty.call(MODIFIER_BITS, m)) {
          return { content: `Unknown modifier "${m}". Use Alt, Control, Meta or Shift.`, isError: true };
        }
      }

      const mask = mods.reduce((acc, m) => acc + (MODIFIER_BITS[m] ?? 0), 0);
      const hasCmdCtrl = (mask & (MODIFIER_BITS.Control | MODIFIER_BITS.Alt | MODIFIER_BITS.Meta)) !== 0;
      const text = hasCmdCtrl ? undefined : def.text;

      await options.recording?.pause(tabId);
      try {
        await session.send(tabId, "Input.dispatchKeyEvent", {
          type: text !== undefined ? "keyDown" : "rawKeyDown",
          key: def.key,
          code: def.code,
          windowsVirtualKeyCode: def.vk,
          modifiers: mask,
          ...(text !== undefined ? { text } : {}),
        });
        await session.send(tabId, "Input.dispatchKeyEvent", {
          type: "keyUp",
          key: def.key,
          code: def.code,
          windowsVirtualKeyCode: def.vk,
          modifiers: mask,
        });
      } finally {
        await options.recording?.resume(tabId);
      }

      const combo = `${mods.length ? `${mods.join("+")}+` : ""}${key}`;
      return { content: `Pressed ${combo}.` + journalSuffix(journal.append([pressKeyEntry(combo)])) };
    },
  };

  const pageEmulate: CustomToolDef = {
    name: "page_emulate",
    description:
      "Emulate a mobile or desktop device's screen dimensions, device scale factor, mobile viewport, touch events, and user agent. Pass preset (\"iPhone 15\", \"iPad Mini landscape\", \"Desktop Chrome\"), or custom dimensions (width, height, scale, mobile, touch), or reset: true. Needs start_debugging on the tab first.",
    inputSchema: z.object({
      tabId: z.number().describe("The ID of the tab. Call read_tabs first and pass the ID it reports."),
      preset: z.string().optional().describe('Preset name: "iPhone 15", "iPad Mini landscape", or "Desktop Chrome".'),
      width: z.number().optional().describe("Viewport width in CSS pixels (1 to 4096)."),
      height: z.number().optional().describe("Viewport height in CSS pixels (1 to 4096)."),
      scale: z.number().optional().describe("Device scale factor (0 to 4)."),
      mobile: z.boolean().optional().describe("Whether to emulate a mobile viewport."),
      touch: z.boolean().optional().describe("Whether to enable touch event emulation."),
      reset: z.boolean().optional().describe("Reset emulation back to the browser's default viewport and user agent."),
    }),
    summarize: (input) => {
      const idText = typeof input.tabId === "number" || typeof input.tabId === "string" ? String(input.tabId) : "(none)";
      if (input.reset) return `Reset emulation in tab #${idText}`;
      if (typeof input.preset === "string") return `Emulate ${input.preset} in tab #${idText}`;
      return `Emulate custom device in tab #${idText}`;
    },
    execute: async (input) => {
      const tabId = Number(input.tabId);
      const g = session.gate(tabId);
      if (!g.ok) return { content: g.error, isError: true };

      const hasPreset = typeof input.preset === "string";
      const hasAllCustom =
        input.width !== undefined &&
        input.height !== undefined &&
        input.scale !== undefined &&
        input.mobile !== undefined &&
        input.touch !== undefined;
      const hasAnyCustom =
        input.width !== undefined ||
        input.height !== undefined ||
        input.scale !== undefined ||
        input.mobile !== undefined ||
        input.touch !== undefined;
      const hasReset = input.reset === true;

      const formCount = (hasPreset ? 1 : 0) + (hasAllCustom ? 1 : 0) + (hasReset ? 1 : 0);
      if (formCount !== 1 || (hasPreset && hasAnyCustom) || (hasReset && (hasAnyCustom || hasPreset)) || (!hasPreset && !hasReset && !hasAllCustom)) {
        return { content: "Pass preset, or width, height, scale, mobile and touch, or reset: true.", isError: true };
      }

      if (hasReset) {
        await session.resetEmulation(tabId, g.state);
        return { content: "Emulation was reset." + journalSuffix(journal.append([emulateResetEntry()])) };
      }

      if (hasPreset) {
        const presetName = input.preset as string;
        if (!Object.prototype.hasOwnProperty.call(PRESETS, presetName)) {
          return {
            content: `Unknown preset "${presetName}". Use iPhone 15, iPad Mini landscape or Desktop Chrome.`,
            isError: true,
          };
        }
      }

      if (hasAllCustom) {
        const w = Number(input.width);
        const h = Number(input.height);
        const s = Number(input.scale);
        if (w < 1 || w > 4096 || h < 1 || h > 4096 || s <= 0 || s > 4) {
          return { content: "Width and height must be 1 to 4096, and scale 0 to 4.", isError: true };
        }
      }

      const v = hasPreset
        ? PRESETS[input.preset as string]
        : {
            width: Number(input.width),
            height: Number(input.height),
            scale: Number(input.scale),
            mobile: Boolean(input.mobile),
            touch: Boolean(input.touch),
          };

      // Touch emulation is applied BEFORE the device metrics override: the
      // metrics override is what triggers the page's "resize" event (probed
      // 2026-09-17), so touch/pointer state must already be in place when
      // that event fires, or a listener that reads both in one "resize"
      // handler (as the checkout fixture does) captures a stale pointer
      // value with no second event to correct it.
      await session.send(tabId, "Emulation.setTouchEmulationEnabled", {
        enabled: v.touch,
        maxTouchPoints: v.touch ? 5 : 1,
        configuration: v.mobile ? "mobile" : "desktop",
      });
      await session.send(tabId, "Emulation.setDeviceMetricsOverride", {
        width: v.width,
        height: v.height,
        deviceScaleFactor: v.scale,
        mobile: v.mobile,
      });
      if (hasPreset && "userAgent" in v) {
        await session.send(tabId, "Emulation.setUserAgentOverride", { userAgent: v.userAgent });
      }

      g.state.emulation = {
        ...(hasPreset ? { preset: input.preset } : {}),
        ...v,
      };

      const mobileLabel = v.mobile ? "mobile" : "desktop";
      const touchLabel = v.touch ? "touch" : "no touch";
      const content = hasPreset
        ? `Emulating ${String(input.preset)} (${v.width} × ${v.height}, scale ${v.scale}, ${mobileLabel}, ${touchLabel}).`
        : `Emulating a custom device (${v.width} × ${v.height}, scale ${v.scale}, ${mobileLabel}, ${touchLabel}).`;
      const ids = journal.append([
        emulateEntry({
          ...(hasPreset ? { preset: input.preset as string } : {}),
          width: v.width,
          height: v.height,
          scale: v.scale,
          mobile: v.mobile,
          touch: v.touch,
        }),
      ]);
      return { content: content + journalSuffix(ids) };
    },
  };

  return [startDebugging, stopDebugging, pageHover, pagePressKey, pageEmulate];
}
