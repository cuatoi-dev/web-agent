// Type shapes for tab-state-sync.ts. Split out per wa/types-in-types-file.

export interface EventSource<F> {
  addListener(listener: F): void;
  removeListener(listener: F): void;
}

export interface TabEventSources {
  onActivated: EventSource<(info: { tabId: number; windowId: number }) => void>;
  onUpdated: EventSource<(
    tabId: number,
    changeInfo: { status?: string; url?: string },
    tab: { active?: boolean; windowId?: number },
  ) => void>;
  onFocusChanged: EventSource<(windowId: number) => void>;
}

export type GetPanelWindowId = () => Promise<number | undefined>;
