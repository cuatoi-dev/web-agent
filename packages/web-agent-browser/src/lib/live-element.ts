/** The element, but only while it is really in a document.
 *
 *  A page can remove what the extension appended — a framework that owns
 *  `document.body` does it on every re-render — without the extension being
 *  told. The reference then points at a detached node that still answers
 *  every question as if it were mounted: `WebAgentBubble.send()`
 *  (`packages/web-agent-lit/src/embed/web-agent-embed.ts:253-262`) returns
 *  early only when there is no `containerEl`, and `containerEl` is assigned
 *  in `connectedCallback` and never cleared. So the send opens a
 *  detached panel and reports success for a message nobody can see.
 *
 *  `isConnected` is the one question that separates the two. */
export function inPage<T extends Element>(el: T | null): T | null {
  return el && el.isConnected ? el : null;
}
