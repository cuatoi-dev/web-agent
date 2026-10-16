import { resolveTabState, toggleTab } from "./panel-toggle";
import type { QueryTabs, SendToTab, TabState } from "./types";
export type {
  EventSource,
  GetPanelWindowId,
  TabEventSources,
} from "./tab-state-sync.types";
import type {
  GetPanelWindowId,
  TabEventSources,
} from "./tab-state-sync.types";

export function watchActiveTab(options: {
  events: TabEventSources;
  getPanelWindowId: GetPanelWindowId;
  refresh: () => Promise<void>;
  debounceMs?: number;
}): () => void {
  const { events, getPanelWindowId, refresh, debounceMs = 100 } = options;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let panelWindowId: number | undefined;

  void getPanelWindowId()
    .then((id) => {
      if (!disposed) {
        panelWindowId = id;
      }
    })
    .catch(() => {});

  const schedule = (): void => {
    if (disposed) return;
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = undefined;
      void refresh();
    }, debounceMs);
  };

  const onActivatedListener = (): void => {
    schedule();
  };

  const onFocusChangedListener = (): void => {
    schedule();
  };

  const onUpdatedListener = (
    _tabId: number,
    changeInfo: { status?: string; url?: string },
    tab: { active?: boolean; windowId?: number },
  ): void => {
    const relevant = changeInfo.status === "complete" || changeInfo.url !== undefined;
    const inPanelWindow = panelWindowId === undefined || tab.windowId === panelWindowId;
    if (relevant && tab.active === true && inPanelWindow) {
      schedule();
    }
  };

  events.onActivated.addListener(onActivatedListener);
  events.onUpdated.addListener(onUpdatedListener);
  events.onFocusChanged.addListener(onFocusChangedListener);

  return (): void => {
    disposed = true;
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    events.onActivated.removeListener(onActivatedListener);
    events.onUpdated.removeListener(onUpdatedListener);
    events.onFocusChanged.removeListener(onFocusChangedListener);
  };
}

export function createTabStateActions(options: {
  query: QueryTabs;
  send: SendToTab;
  apply: (state: TabState | null) => void;
}): {
  refresh: () => Promise<void>;
  toggleCurrent: () => Promise<void>;
} {
  const { query, send, apply } = options;
  let seq = 0;

  const refresh = async (): Promise<void> => {
    const mine = ++seq;
    const next = await resolveTabState(query, send);
    if (mine !== seq) return;
    apply(next);
  };

  const toggleCurrent = async (): Promise<void> => {
    const mine = ++seq;
    const fresh = await resolveTabState(query, send);
    if (fresh === null) {
      if (mine === seq) {
        apply(null);
      }
      return;
    }
    const toggled = await toggleTab(send, fresh);
    if (mine === seq) {
      apply(toggled);
    }
  };

  return { refresh, toggleCurrent };
}
