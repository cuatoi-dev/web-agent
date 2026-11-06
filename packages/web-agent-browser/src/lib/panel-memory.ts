import type { BrandAgent } from "./types";
import type {
  PanelMemorySessionState,
  PanelMemorySync,
  PanelMemorySyncOptions,
} from "./panel-memory.types";

export type {
  PanelMemorySessionState,
  PanelMemorySync,
  PanelMemorySyncOptions,
} from "./panel-memory.types";

/** 104/003 — two gates: the brand allows memory in `.yml`, and the user
 *  switched it on in Options. */
export function isAgentMemoryOn(
  agent: Pick<BrandAgent, "id" | "memory">,
  memoryEnabled: Record<string, boolean>,
): boolean {
  return agent.memory === true && memoryEnabled[agent.id] === true;
}

/** Applies a Memory switch change immediately when the current chat is fresh
 *  (open, idle, 0 messages), or holds it until the next empty chat opens so an
 *  active chat keeps the files and skills it started with. */
export function createPanelMemorySync(opts: PanelMemorySyncOptions): PanelMemorySync {
  let activeOn = opts.initialOn;
  let desiredOn = opts.initialOn;

  const commit = (): void => {
    activeOn = desiredOn;
    opts.apply(activeOn);
  };

  return {
    active: () => activeOn,
    desired: () => desiredOn,
    setDesired(nextOn: boolean): void {
      desiredOn = nextOn;
      if (desiredOn !== activeOn && opts.isCurrentChatFresh()) {
        commit();
      }
    },
    onSessionState(state: PanelMemorySessionState): void {
      const readyEmpty =
        Boolean(state.activeSessionId)
        && !state.running
        && state.messages.length === 0;
      if (readyEmpty && desiredOn !== activeOn) {
        commit();
      }
    },
  };
}
