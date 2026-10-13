const AGENT_TAGS = ["web-agent-bubble", "agent-chat-panel"];

/**
 * Finds an agent element the extension does not own, anywhere in the document
 * or in any OPEN shadow root beneath it.
 *
 * `own` is the extension's own bubble. The walk never descends into it, so the
 * `agent-chat-panel` the bubble creates when it opens can never be mistaken for
 * a host's agent.
 */
export function findForeignAgent(root: ParentNode, own: Element | null): Element | null {
  const walk = (el: Element): Element | null => {
    if (el === own) return null;
    if (AGENT_TAGS.includes(el.tagName.toLowerCase())) return el;
    if (el.shadowRoot) {
      for (const child of Array.from(el.shadowRoot.children)) {
        const hit = walk(child);
        if (hit) return hit;
      }
    }
    for (const child of Array.from(el.children)) {
      const hit = walk(child);
      if (hit) return hit;
    }
    return null;
  };
  for (const child of Array.from(root.children)) {
    const hit = walk(child);
    if (hit) return hit;
  }
  return null;
}
