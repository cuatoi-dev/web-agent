// 127/005 — one page_screenshot capture: resolve the target, outline the
// highlighted refs, scroll, measure and capture. The caller restores the
// handles it collected in `handles`, whatever this returns or throws.
import { STALE_REF } from "./debugger-helper-world";
import type { HelperWorlds, ScreenshotHighlightHandle } from "./debugger-helper-world.types";
import type { DebuggerSession } from "./debugger-tools.types";
import type { HelperDescribe } from "./helper-api";
import type { Captured, PageRect } from "./page-screenshot-tool.types";

function intersects(a: PageRect, b: PageRect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

export async function capture(
  session: DebuggerSession,
  helper: HelperWorlds,
  tabId: number,
  input: Record<string, unknown>,
  handles: ScreenshotHighlightHandle[],
): Promise<Captured> {
  const fullPage = input.fullPage === true;
  const selectorKind = typeof input.css === "string" ? "css" : typeof input.xpath === "string" ? "xpath" : undefined;
  const selector = typeof input.css === "string" ? input.css : typeof input.xpath === "string" ? input.xpath : "";

  // The target: a snapshot ref, or the ref of the first CSS/XPath match.
  let ref: string | undefined;
  let desc = "";
  let matchCount = 1;
  if (input.ref !== undefined) {
    ref = typeof input.ref === "string" ? input.ref : "";
    const d = await helper.call<HelperDescribe>(tabId, ref, "describe", [ref]);
    if (!d.ok) return { error: d.error };
    if (!d.value.connected) return { error: STALE_REF(ref) };
    if (d.value.refusal !== undefined) return { error: d.value.refusal };
    desc = `[${ref}] ${d.value.desc}`;
  } else if (selectorKind !== undefined) {
    const found = await helper.selectScreenshotTarget(tabId, selectorKind, selector);
    if (!found.ok) return { error: found.error };
    ref = found.ref;
    matchCount = found.count;
    desc = `${selectorKind === "css" ? "CSS" : "XPath"} ${selector}`;
  }

  const highlightRefs = Array.isArray(input.highlight)
    ? [...new Set(input.highlight.filter((h): h is string => typeof h === "string"))]
    : [];
  for (const h of highlightRefs) {
    const outlined = await helper.highlightScreenshotRef(tabId, h);
    if (!outlined.ok) return { error: outlined.error };
    handles.push(outlined.handle);
  }

  const viewportMode = ref === undefined && !fullPage;
  if (viewportMode) await handles[0]?.scroll();

  let area: PageRect | undefined;
  let shotData: string;
  let caption: string;

  if (ref !== undefined) {
    const b = await helper.box(tabId, ref);
    if (!b.ok) return { error: b.error };
    area = { x: b.x + b.scrollX, y: b.y + b.scrollY, width: b.width, height: b.height };
    // b.x/b.y are already in the TOP page's viewport, frame offsets
    // included (131/003), so the clip stays in top-page coordinates and
    // the capture keeps going to the top target.
    const boxes = await measureHighlights(helper, tabId, highlightRefs);
    if ("error" in boxes) return boxes;
    const res = (await session.send(tabId, "Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      clip: { ...area, scale: 1 },
    })) as { data?: string };
    shotData = res?.data ?? "";
    caption = `Screenshot of ${desc}, ${b.width} × ${b.height}.`;
    if (selectorKind !== undefined && matchCount > 1) caption += `\n${matchCount} elements match; captured the first.`;
    caption += outsideLines(boxes.rects, area);
  } else if (fullPage) {
    const m = (await session.send(tabId, "Page.getLayoutMetrics")) as {
      cssContentSize?: { width: number; height: number };
    };
    const width = m?.cssContentSize?.width ?? 0;
    const height = m?.cssContentSize?.height ?? 0;
    area = { x: 0, y: 0, width, height };
    const boxes = await measureHighlights(helper, tabId, highlightRefs);
    if ("error" in boxes) return boxes;
    const res = (await session.send(tabId, "Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
      clip: { ...area, scale: 1 },
    })) as { data?: string };
    shotData = res?.data ?? "";
    caption = `Full-page screenshot, ${width} × ${height}.${outsideLines(boxes.rects, area)}`;
  } else {
    const m = (await session.send(tabId, "Page.getLayoutMetrics").catch(() => ({}))) as {
      cssVisualViewport?: { clientWidth: number; clientHeight: number };
      cssLayoutViewport?: { clientWidth: number; clientHeight: number; pageX?: number; pageY?: number };
    };
    const width = Math.round(m?.cssVisualViewport?.clientWidth ?? m?.cssLayoutViewport?.clientWidth ?? 0);
    const height = Math.round(m?.cssVisualViewport?.clientHeight ?? m?.cssLayoutViewport?.clientHeight ?? 0);
    area = {
      x: m?.cssLayoutViewport?.pageX ?? 0,
      y: m?.cssLayoutViewport?.pageY ?? 0,
      width: m?.cssLayoutViewport?.clientWidth ?? width,
      height: m?.cssLayoutViewport?.clientHeight ?? height,
    };
    const boxes = await measureHighlights(helper, tabId, highlightRefs);
    if ("error" in boxes) return boxes;
    const res = (await session.send(tabId, "Page.captureScreenshot", { format: "png" })) as { data?: string };
    shotData = res?.data ?? "";
    caption = width > 0 && height > 0 ? `Viewport screenshot, ${width} × ${height}.` : `Viewport of tab #${tabId} captured.`;
    caption += outsideLines(boxes.rects, area);
  }

  if (!shotData || shotData.length === 0) return { error: EMPTY_CAPTURE };
  return { shotData, caption };
}

/** A zero-size capture yields "data:," which model APIs reject with
 *  `invalid_image`. Same guard as
 *  `packages/web-agent-dom/src/adapters/screenshot.ts`. */
export const EMPTY_CAPTURE =
  "The screenshot came back empty and was discarded, so no image was sent. The tab may be mid-navigation; try again.";

async function measureHighlights(
  helper: HelperWorlds,
  tabId: number,
  refs: string[],
): Promise<{ rects: { ref: string; rect: PageRect }[] } | { error: string }> {
  const rects: { ref: string; rect: PageRect }[] = [];
  for (const h of refs) {
    const b = await helper.box(tabId, h);
    if (!b.ok) return { error: b.error };
    rects.push({ ref: h, rect: { x: b.x + b.scrollX, y: b.y + b.scrollY, width: b.width, height: b.height } });
  }
  return { rects };
}

function outsideLines(rects: { ref: string; rect: PageRect }[], area: PageRect): string {
  return rects
    .filter((r) => !intersects(r.rect, area))
    .map((r) => `\nHighlighted element ${r.ref} is outside the screenshot.`)
    .join("");
}
