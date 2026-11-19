// The panel side of page_screenshot's css/xpath targets and
// highlight. Every page-side call goes through `Runtime.callFunctionOn` with
// value arguments, so selector text never becomes executable source.
import { errorMessage, thrownFromDetails } from "./error-message";
import type { DebuggerSession } from "./debugger-tools.types";
import type {
  ScreenshotHighlightHandle,
  ScreenshotHighlightResult,
  ScreenshotTargetResult,
} from "./debugger-helper-world.types";
import type { ScreenshotWorldAccess } from "./debugger-screenshot.types";
import type { ScreenshotOutline } from "./helper-screenshot.types";

const UNRESOLVED = "Could not resolve screenshot target.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function exceptionError(result: unknown): string | undefined {
  if (isRecord(result) && isRecord(result.exceptionDetails)) return thrownFromDetails(result.exceptionDetails).message;
  return undefined;
}

function objectIdOf(result: unknown): string | undefined {
  return isRecord(result) && isRecord(result.result) && typeof result.result.objectId === "string"
    ? result.result.objectId
    : undefined;
}

export function createScreenshotBridge(
  session: DebuggerSession,
  access: ScreenshotWorldAccess,
  staleRef: (ref: string) => string,
): {
  selectScreenshotTarget(tabId: number, kind: "css" | "xpath", selector: string): Promise<ScreenshotTargetResult>;
  highlightScreenshotRef(tabId: number, ref: string): Promise<ScreenshotHighlightResult>;
} {
  const release = (tabId: number, objectId: string, sessionId: string | undefined): Promise<void> =>
    session.send(tabId, "Runtime.releaseObject", { objectId }, sessionId).then(
      () => undefined,
      () => undefined,
    );

  async function selectScreenshotTarget(
    tabId: number,
    kind: "css" | "xpath",
    selector: string,
  ): Promise<ScreenshotTargetResult> {
    const owned: string[] = [];
    try {
      const frameId = session.state.get(tabId)?.topFrameId ?? "";
      const executionContextId = await access.context(tabId, { frameId });
      const found = await session.send(tabId, "Runtime.callFunctionOn", {
        executionContextId,
        functionDeclaration:
          "function(kind, selector) { return globalThis.__waHelper.screenshotSelect(document.documentElement, kind, selector); }",
        arguments: [{ value: kind }, { value: selector }],
        returnByValue: false,
      });
      const foundError = exceptionError(found);
      if (foundError !== undefined) return { ok: false, error: foundError };
      const selectionId = objectIdOf(found);
      if (selectionId === undefined) return { ok: false, error: UNRESOLVED };
      owned.push(selectionId);

      const meta = await session.send(tabId, "Runtime.callFunctionOn", {
        objectId: selectionId,
        functionDeclaration: "function() { return { ok: this.ok, error: this.error, count: this.count }; }",
        returnByValue: true,
      });
      const metaError = exceptionError(meta);
      if (metaError !== undefined) return { ok: false, error: metaError };
      const value = isRecord(meta) && isRecord(meta.result) ? meta.result.value : undefined;
      if (!isRecord(value)) return { ok: false, error: UNRESOLVED };
      if (value.ok !== true) {
        return { ok: false, error: typeof value.error === "string" ? value.error : UNRESOLVED };
      }
      if (typeof value.count !== "number") return { ok: false, error: UNRESOLVED };

      const element = await session.send(tabId, "Runtime.callFunctionOn", {
        objectId: selectionId,
        functionDeclaration: "function() { return this.element; }",
        returnByValue: false,
      });
      const elementError = exceptionError(element);
      if (elementError !== undefined) return { ok: false, error: elementError };
      const elementId = objectIdOf(element);
      if (elementId === undefined) return { ok: false, error: UNRESOLVED };
      owned.push(elementId);

      const described = await session.send(tabId, "DOM.describeNode", { objectId: elementId });
      const backendNodeId =
        isRecord(described) && isRecord(described.node) && typeof described.node.backendNodeId === "number"
          ? described.node.backendNodeId
          : undefined;
      if (backendNodeId === undefined) return { ok: false, error: UNRESOLVED };
      const ref = String(backendNodeId);
      session.frames.rememberRefs(tabId, [{ ref, frameId }]);
      return { ok: true, ref, count: value.count };
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    } finally {
      await Promise.all(owned.map((objectId) => release(tabId, objectId, undefined)));
    }
  }

  async function highlightScreenshotRef(tabId: number, ref: string): Promise<ScreenshotHighlightResult> {
    const resolved = access.resolve(tabId, ref);
    if (!resolved.ok) return { ok: false, error: resolved.error };
    const { at } = resolved;
    let objectId: string | undefined;
    try {
      const executionContextId = await access.context(tabId, at);
      let node: unknown;
      try {
        node = await session.send(
          tabId,
          "DOM.resolveNode",
          { backendNodeId: at.backendNodeId, executionContextId },
          at.sessionId,
        );
      } catch {
        return { ok: false, error: staleRef(ref) };
      }
      objectId =
        isRecord(node) && isRecord(node.object) && typeof node.object.objectId === "string"
          ? node.object.objectId
          : undefined;
      if (objectId === undefined) return { ok: false, error: staleRef(ref) };

      const connected = await session.send(
        tabId,
        "Runtime.callFunctionOn",
        { objectId, functionDeclaration: "function() { return this.isConnected; }", returnByValue: true },
        at.sessionId,
      );
      const connectedError = exceptionError(connected);
      if (connectedError !== undefined) throw new Error(connectedError);
      const isConnected = isRecord(connected) && isRecord(connected.result) ? connected.result.value : undefined;
      if (isConnected !== true) {
        await release(tabId, objectId, at.sessionId);
        objectId = undefined;
        return { ok: false, error: staleRef(ref) };
      }

      const marked = await session.send(
        tabId,
        "Runtime.callFunctionOn",
        {
          objectId,
          functionDeclaration: "function() { return globalThis.__waHelper.screenshotHighlight(this); }",
          returnByValue: true,
        },
        at.sessionId,
      );
      const markedError = exceptionError(marked);
      if (markedError !== undefined) throw new Error(markedError);
      const saved = (isRecord(marked) && isRecord(marked.result) ? marked.result.value : undefined) as
        | ScreenshotOutline
        | undefined;
      if (!isRecord(saved) || !Array.isArray(saved.declarations)) throw new Error(UNRESOLVED);

      const held = objectId;
      let restored = false;
      const handle: ScreenshotHighlightHandle = {
        async scroll() {
          const result = await session.send(
            tabId,
            "Runtime.callFunctionOn",
            {
              objectId: held,
              functionDeclaration: "function() { return globalThis.__waHelper.screenshotScroll(this); }",
              returnByValue: true,
            },
            at.sessionId,
          );
          const error = exceptionError(result);
          if (error !== undefined) throw new Error(error);
        },
        async restore() {
          if (restored) return;
          restored = true;
          try {
            const result = await session.send(
              tabId,
              "Runtime.callFunctionOn",
              {
                objectId: held,
                functionDeclaration: "function(saved) { return globalThis.__waHelper.screenshotRestore(this, saved); }",
                arguments: [{ value: saved }],
                returnByValue: true,
              },
              at.sessionId,
            );
            const error = exceptionError(result);
            if (error !== undefined) throw new Error(error);
          } finally {
            await release(tabId, held, at.sessionId);
          }
        },
      };
      objectId = undefined;
      return { ok: true, handle };
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    } finally {
      if (objectId !== undefined) await release(tabId, objectId, at.sessionId);
    }
  }

  return { selectScreenshotTarget, highlightScreenshotRef };
}
