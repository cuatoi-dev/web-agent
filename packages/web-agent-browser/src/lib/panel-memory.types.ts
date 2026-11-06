export interface PanelMemorySessionState {
  activeSessionId?: string;
  messages: readonly unknown[];
  running: boolean;
}

export interface PanelMemorySyncOptions {
  initialOn: boolean;
  /** True only when the panel's active session is open, idle, and has 0 messages. */
  isCurrentChatFresh: () => boolean;
  /** Rebuilds VFS, skills, screens, and tool providers for `on`. */
  apply: (on: boolean) => void;
}

export interface PanelMemorySync {
  active: () => boolean;
  desired: () => boolean;
  setDesired: (on: boolean) => void;
  onSessionState: (state: PanelMemorySessionState) => void;
}
