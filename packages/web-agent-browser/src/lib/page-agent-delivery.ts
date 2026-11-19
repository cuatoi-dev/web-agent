import type { SendOutcome } from "@cuatoi/web-agent-lit";
import type { PageAgentDelivery } from "./types";

/** `delivered` answers one question: did the message REACH the in-page panel's
 *  session? It never means the page agent has finished answering.
 *
 *  Everything `delivered` claims — the bubble is here, its container exists,
 *  the panel is open, the session is created — happens synchronously inside
 *  `WebAgentBubble.send()` before its first await (`web-agent-embed.ts` send()
 *  → `chat-panel-session.ts` send() → `_ensureSession()`), so a failure in any of them
 *  rejects the returned promise inside the microtask drain.
 *
 *  The promise itself settles only when the page agent's whole turn has
 *  finished: `chat-panel-session.ts` awaits `_session.send()`, which awaits
 *  `controller-turn.ts` `runUserTurn`, which awaits the model. That is seconds, far
 *  past the 2000 ms `bridge.ts`'s `askMainWorld` allows this reply — so
 *  awaiting the promise would report `delivered: false` for every successful
 *  send and make the tool answer "the web agent is not on in this tab".
 *
 *  So this yields exactly one macrotask. A macrotask runs only after the
 *  microtask queue is exhausted, so a rejection from the delivery steps has
 *  already set the flag, while a send that reached the model turn is still
 *  pending and counts as delivered. The `catch` also keeps a later turn failure
 *  from surfacing as an unhandled rejection.
 *
 *  The same helper now also reports whether the panel RAN a slash
 *  command. A command settles immediately (synchronously before the first
 *  await), so `settled` holds the outcome before the setTimeout fires.
 *
 *  This is what the tool already promises: `send_to_page_agent` says it "does
 *  not wait for the in-page agent's answer; it delivers the message and
 *  returns" (`page-agent-tools.ts`). */
export function reachedPageAgentSession(
  sending: Promise<SendOutcome>,
): Promise<PageAgentDelivery> {
  let failed = false;
  let settled: SendOutcome | undefined;
  void sending.then((outcome) => { settled = outcome; }, () => { failed = true; });
  return new Promise<PageAgentDelivery>((resolve) => {
    setTimeout(() => {
      if (failed || settled?.ran === "none") {
        resolve({ delivered: false, ranCommand: false });
        return;
      }
      if (settled?.ran === "command") {
        resolve({ delivered: true, ranCommand: true, command: settled.command });
        return;
      }
      // Still pending: the send reached the session and is waiting on the
      // model turn. That is the ordinary message case and counts as delivered,
      // exactly as it did before.
      resolve({ delivered: true, ranCommand: false });
    }, 0);
  });
}
