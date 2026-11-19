import {
  READ_MESSAGE,
  RELAY_PORT,
  SEND_MESSAGE,
  STATE_MESSAGE,
  TOGGLE_MESSAGE,
} from "./lib/constants";
import type { RelayToPage } from "./lib/relay-protocol";
import { getSettings, isOriginEnabled, setOriginEnabled } from "./lib/settings";
import { listModels, readModelStore, resolveDefault } from "./lib/model-store";
import { pageBrand, toPublicModels } from "./lib/public-models";
import type { BubblePayload } from "./lib/types";
import { requestBrand } from "./lib/brand-request";
import { readBridgeMessage } from "./lib/bridge-protocol";
import { errorMessage } from "./lib/error-message";
import { handlePageSkillsRequest, SKILLS_MESSAGE_PREFIX, SKILLS_RESULT_MESSAGE } from "./lib/skill-registry";
import type {
  TabAgentConversationMessage,
  TabAgentReadResult,
  TabAgentSendResult,
  TabAgentState,
  TabAgentToggleResult,
} from "./types";
import type { SkillsRequestMessage } from "./lib/types";

export type {
  TabAgentConversationMessage,
  TabAgentReadResult,
  TabAgentSendResult,
  TabAgentState,
  TabAgentToggleResult,
} from "./types";

/** True when `value` is a plain object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const ORIGIN = location.origin;
const activePorts = new Map<string, chrome.runtime.Port>();

// The brand takes the same route as the settings, and for the same reason the
// comment below gives. Asked for once at module load, so it is already in hand
// by the time either message goes out; the promise is reused, never re-sent.
const brandPromise = requestBrand();

/** What the bubble needs, read fresh for each message: the enabled models
 *  (PublicModel — never a key or a header value), the default model, the
 *  theme and the brand without any `apiKey`. */
async function bubblePayload(): Promise<BubblePayload> {
  const [settings, brand, store] = await Promise.all([getSettings(), brandPromise, readModelStore()]);
  const entries = listModels(brand, store);
  const current = (resolveDefault(entries, store) ?? entries[0]).ref;
  return { models: toPublicModels(entries), current, theme: settings.theme, brand: pageBrand(brand) };
}

// 1. Initial state check
// The MAIN world cannot read chrome.storage, so the model list travels with
// the message. It is read fresh each time, so a change on the options page
// is picked up on the next mount with no reinstall.
void isOriginEnabled(ORIGIN).then(async (on) => {
  if (on) {
    window.postMessage({ type: "wa-bridge-enable", ...(await bubblePayload()) }, "*");
  }
});

const toState = (data: unknown): TabAgentState => {
  const d = isRecord(data) ? data : {};
  return { origin: ORIGIN, mounted: !!d.mounted, foreign: !!d.foreign };
};

const toToggleResult = (data: unknown): TabAgentToggleResult => {
  const d = isRecord(data) ? data : {};
  return { ...toState(data), requested: d.requested === "on" ? "on" : "off" };
};

const toSendResult = (data: unknown): TabAgentSendResult => {
  const d = isRecord(data) ? data : {};
  return {
    ...toState(data),
    delivered: !!d.delivered,
    ranCommand: !!d.ranCommand,
    ...(typeof d.command === "string" ? { command: d.command } : {}),
  };
};

const toReadResult = (data: unknown): TabAgentReadResult => {
  const d = isRecord(data) ? data : {};
  return {
    ...toState(data),
    messages: Array.isArray(d.messages) ? (d.messages as TabAgentConversationMessage[]) : [],
    running: !!d.running,
  };
};

/** Post a request into the MAIN world and wait for its one reply. The MAIN
 *  world is the only place that knows whether the bubble is really mounted, and
 *  the ISOLATED world cannot read its variables. The timeout is a safety net
 *  for a page where content.js never ran; it resolves rather than rejects, so
 *  the panel gets a not-mounted state instead of an error. */
function askMainWorld<T>(
  request: Record<string, unknown> & { type: string },
  replyType: string,
  fromReply: (data: unknown) => T,
  timeoutMs = 2000,
): Promise<T> {
  return new Promise((resolve) => {
    const done = (data: unknown) => {
      window.clearTimeout(timer);
      window.removeEventListener("message", onReply);
      resolve(fromReply(data));
    };
    const onReply = (event: MessageEvent) => {
      const msg = readBridgeMessage(event);
      if (!msg || msg.type !== replyType) return;
      done(msg);
    };
    const timer = window.setTimeout(() => done({}), timeoutMs);
    window.addEventListener("message", onReply);
    window.postMessage(request, "*");
  });
}

// 2. Toggle and state requests from the side panel (and from a test that sends
// the same message to the tab). Both reply, so the panel's control can show
// what actually happened rather than what it asked for. Returning true keeps
// the message channel open for the async sendResponse.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // @types/chrome types `msg` as `any`, so it is narrowed once here rather
  // than at every read below.
  const req: unknown = msg;
  if (!isRecord(req) || typeof req.type !== "string") return undefined;

  if (req.type === TOGGLE_MESSAGE) {
    void (async () => {
      sendResponse(await askMainWorld({ type: "wa-bridge-toggle", ...(await bubblePayload()) }, "wa-bridge-toggle-result", toToggleResult));
    })();
    return true;
  }

  if (req.type === STATE_MESSAGE) {
    void (async () => {
      sendResponse(await askMainWorld({ type: "wa-bridge-state-request" }, "wa-bridge-state", toState));
    })();
    return true;
  }

  if (req.type === SEND_MESSAGE) {
    void (async () => {
      const text = typeof req.text === "string" ? req.text : "";
      sendResponse(
        await askMainWorld({ type: "wa-bridge-send", text }, "wa-bridge-send-result", toSendResult),
      );
    })();
    return true;
  }

  if (req.type === READ_MESSAGE) {
    void (async () => {
      sendResponse(
        await askMainWorld({ type: "wa-bridge-read" }, "wa-bridge-read-result", toReadResult),
      );
    })();
    return true;
  }

  // `return undefined` for a message we do not recognise is what this
  // listener already did for a message with no `type` — no new behaviour.
  return undefined;
});

// 3. Messages from MAIN world
window.addEventListener("message", (event) => {
  const msg = readBridgeMessage(event);
  if (!msg) return;

  // The MAIN world's skill registry asking this world to touch
  // chrome.storage.local, which it cannot reach itself. One reply per request,
  // correlated by `id`. A storage call that throws posts nothing and the MAIN
  // world's 2000 ms timeout resolves it empty — the same degradation core
  // applies to a registry whose list() rejects (skill-registry.ts:92-106).
  // Any script on the page can post here, so the request is handled
  // as the in-page bubble's: handlePageSkillsRequest removes `agentId`.
  if (msg.type.startsWith(SKILLS_MESSAGE_PREFIX) && msg.type !== SKILLS_RESULT_MESSAGE) {
    const request = msg as SkillsRequestMessage;
    void (async () => {
      try {
        const reply = await handlePageSkillsRequest(request, {
          get: (key) => chrome.storage.local.get(key),
          set: (items) => chrome.storage.local.set(items),
        });
        window.postMessage(reply, "*");
      } catch (e) {
        console.warn(`[skills] ${request.type} failed: ${errorMessage(e)}`, e);
      }
    })();
    return;
  }

  if (msg.type === "wa-bridge-set-origin-enabled") {
    const { origin, enabled } = msg;
    if (typeof origin === "string" && typeof enabled === "boolean") {
      void setOriginEnabled(origin, enabled);
    }
    return;
  }

  if (msg.type === "wa-relay-req") {
    const { reqId, request } = msg;
    if (!reqId || !request) return;

    try {
      const port = chrome.runtime.connect({ name: RELAY_PORT });
      activePorts.set(reqId, port);

      let ended = false;
      port.onMessage.addListener((relayMsg: RelayToPage) => {
        if (relayMsg.type === "end" || relayMsg.type === "error") {
          ended = true;
        }
        window.postMessage({ type: "wa-relay-res", reqId, msg: relayMsg }, "*");
      });

      port.onDisconnect.addListener(() => {
        activePorts.delete(reqId);
        if (!ended) {
          window.postMessage({
            type: "wa-relay-res",
            reqId,
            msg: { type: "error", message: "Web agent relay disconnected." } as RelayToPage,
          }, "*");
        }
      });

      port.postMessage(request);
    } catch (e) {
      window.postMessage({
        type: "wa-relay-res",
        reqId,
        msg: { type: "error", message: errorMessage(e) } as RelayToPage,
      }, "*");
    }
    return;
  }

  if (msg.type === "wa-relay-abort") {
    const { reqId } = msg;
    const port = activePorts.get(reqId);
    if (port) {
      port.postMessage({ type: "abort" });
      activePorts.delete(reqId);
    }
    return;
  }
});
