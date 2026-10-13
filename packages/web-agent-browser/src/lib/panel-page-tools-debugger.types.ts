// Shapes for the debugger page tools' key and device tables (124/002).
// Imports nothing, mirroring page-screenshot-tool.types.ts.

/** A CDP `Input.dispatchKeyEvent` key/code/vk/text quad, per key name. */
export interface KeyDef {
  key: string;
  code: string;
  vk: number;
  text?: string;
}

/** A `page_emulate` device preset. Values copied verbatim from Playwright
 *  1.58.2's `deviceDescriptorsSource.json` (see the task's External facts). */
export interface DevicePreset {
  width: number;
  height: number;
  scale: number;
  mobile: boolean;
  touch: boolean;
  userAgent: string;
}
