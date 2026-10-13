import { STATE_MESSAGE, TOGGLE_MESSAGE } from "./constants";
import type { QueryTabs, SendToTab, TabState, ToggleView } from "./types";

export type { QueryTabs, SendToTab, TabState, ToggleView } from "./types";

/**
 * The visited tab, or null when there is none to act on.
 *
 * The side panel is not a tab, so in normal use the active tab of the current
 * window IS the visited page. Under Playwright the panel page is itself a tab
 * and can be the active one — but an extension page runs no content script, so
 * the message below rejects and this returns null. That is why the target is
 * resolved by asking the tab rather than by reading `tab.url`.
 */
export async function resolveTabState(query: QueryTabs, send: SendToTab): Promise<TabState | null> {
  const [tab] = await query({ active: true, currentWindow: true });
  if (!tab || tab.id == null) return null;
  try {
    const res = (await send(tab.id, { type: STATE_MESSAGE })) as Partial<TabState> | undefined;
    if (!res || typeof res.origin !== "string") return null;
    return { tabId: tab.id, origin: res.origin, mounted: !!res.mounted, foreign: !!res.foreign };
  } catch {
    return null;
  }
}

/** Press the control: toggle the bubble in that tab and return the state the
 *  tab reports afterwards, so the label is never a guess. */
export async function toggleTab(send: SendToTab, state: TabState): Promise<TabState> {
  try {
    const res = (await send(state.tabId, { type: TOGGLE_MESSAGE })) as Partial<TabState> | undefined;
    if (!res || typeof res.origin !== "string") return state;
    return { tabId: state.tabId, origin: res.origin, mounted: !!res.mounted, foreign: !!res.foreign };
  } catch {
    return state;
  }
}

export function toggleView(state: TabState | null): ToggleView {
  if (!state) {
    return {
      label: "Turn on the agent in this tab",
      status: "Open a website in a tab to use this control.",
      pressed: false,
      disabled: true,
    };
  }
  if (state.mounted) {
    return {
      label: "Turn off the agent in this tab",
      status: `The in-page agent is on for ${state.origin}.`,
      pressed: true,
      disabled: false,
    };
  }
  if (state.foreign) {
    return {
      label: "Turn on the agent in this tab",
      status: "This page already has its own agent, so nothing was added.",
      pressed: false,
      disabled: true,
    };
  }
  return {
    label: "Turn on the agent in this tab",
    status: `The in-page agent is off for ${state.origin}.`,
    pressed: false,
    disabled: false,
  };
}
