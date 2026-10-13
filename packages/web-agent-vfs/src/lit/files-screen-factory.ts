// ---------------------------------------------------------------------------
// files-screen-factory
//
// Creates the `<agent-files-screen>` element for the Files panel. The
// construction used to sit inside `filesScreen().render`, where
// `wa/no-widget-factory-in-render` reports it: a render method must not
// create nodes, because the element would exist before lit-html renders the
// template. This helper has no render scope, so the render method only calls it.
//
// `AgentFilesScreen` is imported as a type only, so this module has no runtime
// import of `files-screen.ts`.
// ---------------------------------------------------------------------------

import type { PanelScreenContext } from "@cuatoi/web-agent-lit";
import type { VfsHandle } from "../types.js";

/** Builds the Files screen element with its VFS handle and screen context. */
export function createFilesScreenElement(
  vfs: VfsHandle,
  ctx: PanelScreenContext,
): HTMLElement {
  const el = document.createElement("agent-files-screen") as HTMLElement & {
    vfs: VfsHandle;
    screenContext: PanelScreenContext | undefined;
  };
  el.vfs = vfs;
  el.screenContext = ctx;
  return el;
}
