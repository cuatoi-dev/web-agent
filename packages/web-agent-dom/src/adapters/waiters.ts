// waiters.ts — the `waitForIdle` / `waitForText` settle checks behind the
// matching `DomAdapter` methods. Split out of dom-adapter.ts; the code is
// unchanged, with the adapter state it reads passed in as `ctx`.

import type { WaitContext } from "./adapter-contexts.types.js";

/** Walk DOM to collect text, skipping agent UI subtrees. */
function getNonAgentUiText(root: Node, agentUiSelector: string): string {
  let text = "";
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += (node.textContent || "") + " ";
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as Element;
      if (el.closest(agentUiSelector)) {
        return;
      }
      if (el.shadowRoot) {
        for (let i = 0; i < el.shadowRoot.childNodes.length; i++) {
          walk(el.shadowRoot.childNodes[i]);
        }
      }
      for (let i = 0; i < el.childNodes.length; i++) {
        walk(el.childNodes[i]);
      }
    }
  };
  walk(root);
  return text.trim();
}

export async function waitForIdle(ctx: WaitContext, timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) {
    return false;
  }

  return new Promise<boolean>((resolve) => {
    let timer: NodeJS.Timeout | null = null;
    let timeoutTimer: NodeJS.Timeout | null = null;
    let observer: MutationObserver | null = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (observer) observer.disconnect();
      signal?.removeEventListener("abort", onAbort);
    };

    const onAbort = () => {
      cleanup();
      resolve(false);
    };

    if (signal) {
      signal.addEventListener("abort", onAbort);
    }

    const resetTimer = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        cleanup();
        resolve(true);
      }, 300);
    };

    timeoutTimer = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);

    resetTimer();

    const target = ctx.root instanceof Document ? ctx.root.body : (ctx.root as HTMLElement);
    if (typeof MutationObserver !== "undefined" && target) {
      observer = new MutationObserver((mutations) => {
        let hasExternalMutation = false;
        
        for (const mutation of mutations) {
          const node = mutation.target;
          if (node instanceof Element) {
            const insideAgentUi = node.closest(ctx.agentUiSelector) !== null;
            if (!insideAgentUi) {
              hasExternalMutation = true;
              break;
            }
          } else {
            const parent = node.parentElement;
            if (parent) {
              const insideAgentUi = parent.closest(ctx.agentUiSelector) !== null;
              if (!insideAgentUi) {
                hasExternalMutation = true;
                break;
              }
            } else {
              hasExternalMutation = true;
              break;
            }
          }
        }

        if (hasExternalMutation) {
          resetTimer();
        }
      });

      observer.observe(target, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
    }
  });
}

export async function waitForText(ctx: WaitContext, text: string, timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) {
    return false;
  }

  return new Promise<boolean>((resolve) => {
    let intervalTimer: NodeJS.Timeout | null = null;
    let timeoutTimer: NodeJS.Timeout | null = null;

    const cleanup = () => {
      if (intervalTimer) clearInterval(intervalTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      signal?.removeEventListener("abort", onAbort);
    };

    const onAbort = () => {
      cleanup();
      resolve(false);
    };

    if (signal) {
      signal.addEventListener("abort", onAbort);
    }

    const check = () => {
      const body = ctx.root instanceof Document ? ctx.root.body : (ctx.root as HTMLElement);
      if (!body) return;
      const pageText = getNonAgentUiText(body, ctx.agentUiSelector);
      if (pageText.includes(text)) {
        cleanup();
        resolve(true);
      }
    };

    timeoutTimer = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);

    check();

    intervalTimer = setInterval(check, 250);
  });
}
