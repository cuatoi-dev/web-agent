// Core's own slash commands and the pending-message queue. Moved out of
// `controller.ts` unchanged — each former closure variable is now read from
// the `SessionRuntime` passed in.
import { NOTHING_TO_COMPACT } from "./tools/compaction-messages.js";
import type { CommandEntry, CoreCommandDef } from "./commands/types.js";
import type { ImageAttachment } from "./utils/types.js";
import type { UserMessageInput } from "./utils/types.js";
import { ATTACHMENT_CHIPS_KEY } from "./attachments/types.js";
import type { QueuedMessage } from "./controller.types.js";
import type { SessionRuntime } from "./controller-runtime.types.js";
import { notifyListeners } from "./controller-state.js";
import { createSession } from "./controller-sessions.js";
import { compact, runUserTurn, send } from "./controller-turn.js";


/** 105/001 — core's own commands. `compact` returns false when there is
 *  nothing to compact or a turn or compaction is running, and `new` always
 *  acts. Neither is ever exposed to the model: an agent that can reset its
 *  own session can restart itself out of an instruction it dislikes. */
export function coreCommandDefs(st: SessionRuntime): CoreCommandDef[] {
  return [
    {
      name: "compact",
      aliases: [],
      description: "Summarise to free up context",
      unavailableMessage: NOTHING_TO_COMPACT,
      action: async () => {
        if (st.running || st.compacting) return false;
        if (!st.cm.hasCompactableTurns()) return false;
        await compact(st);
        return true;
      },
    },
    {
      name: "new",
      aliases: ["clear"],
      description: "Start a fresh session",
      unavailableMessage: "Could not start a new session.",
      action: async () => {
        await createSession(st);
        return true;
      },
    },
  ];
}

/** P5 — run one resolved entry. The caller owns any user-visible notice:
 *  core has no UI, so a false `ran` is reported back rather than rendered. */
export async function runCommand(
  st: SessionRuntime,
  entry: CommandEntry,
  argument: string,
): Promise<{ ran: boolean; startedTurn: boolean }> {
  if (entry.kind === "skill") {
    const prompt = argument
      ? `${entry.definition ?? ""}\n\n${argument}`
      : (entry.definition ?? "");
    await send(
      st,
      [{ type: "text", text: prompt }],
      {
        userDisplayText: `/${entry.displayName}${argument ? ` ${argument}` : ""}`,
      },
    );
    return { ran: true, startedTurn: true };
  }

  const ok = entry.action ? await entry.action() : false;
  if (!ok) return { ran: false, startedTurn: false };
  // Do the thing and stop: no turn, no model call.
  if (!argument) return { ran: true, startedTurn: false };
  if (entry.name === "new") {
    // The old transcript is gone, so a "/new …" bubble would describe
    // something the user can no longer see. Send the argument alone.
    await send(st, [{ type: "text", text: argument }]);
  } else {
    await send(
      st,
      [{ type: "text", text: argument }],
      { userDisplayText: `/${entry.displayName} ${argument}` },
    );
  }
  return { ran: true, startedTurn: true };
}

export function enqueueInput(
  st: SessionRuntime,
  input: string | { text: string; images?: ImageAttachment[]; userDisplayText?: string; promptMeta?: Record<string, unknown> },
  images?: ImageAttachment[],
  source?: QueuedMessage["source"],
): void {
  let text: string;
  let imgs: ImageAttachment[] | undefined;
  let userDisplayText: string | undefined;
  let promptMeta: Record<string, unknown> | undefined;
  if (typeof input === "string") {
    text = input;
    imgs = images && images.length > 0 ? images : undefined;
  } else {
    text = input.text;
    imgs = input.images && input.images.length > 0 ? input.images : (images && images.length > 0 ? images : undefined);
    userDisplayText = input.userDisplayText;
    promptMeta = input.promptMeta;
  }
  st.queuedMessages.push({
    id: crypto.randomUUID(),
    text,
    images: imgs,
    userDisplayText,
    promptMeta,
    source,
  });
  notifyListeners(st);
}

export function enqueueCommand(
  st: SessionRuntime,
  name: string,
  argument: string,
  text: string,
  source?: QueuedMessage["source"],
): void {
  st.queuedMessages.push({
    id: crypto.randomUUID(),
    text,
    command: { name, argument },
    source,
  });
  notifyListeners(st);
}

export async function maybeDrainQueue(
  st: SessionRuntime,
  opts?: { clearStaleError?: boolean },
): Promise<void> {
  // 110/005 P1. Never re-enter while a turn runs. `fire()` already checks
  // isRunning() before calling, but the guard belongs here so no future
  // caller can re-enter mid-turn.
  if (st.running) return;
  if (st.error !== undefined) {
    // Unchanged for the turn's own finally (controller-turn.ts:195), which
    // passes no options: an errored turn still does not drain. That is the ONLY
    // thing stopping an errored turn from re-draining into another
    // errored turn with no delay, so it must stay.
    if (!opts?.clearStaleError) return;
    // A scheduler tick is a fresh, time-separated attempt, not a loop. It
    // arrives one interval later, so it may clear the stale error and
    // retry. The banner clears as the retry begins.
    st.error = undefined;
    notifyListeners(st);
  }
  if (st.queuedMessages.length === 0) return;

  // P6 — a command is its own thing, never text joined into a prompt.
  if (st.queuedMessages[0].command) {
    const item = st.queuedMessages[0];
    st.queuedMessages = st.queuedMessages.slice(1);
    notifyListeners(st);
    const entry = st.commandList.resolve(item.command!.name);
    // The list changed while it sat in the queue: drop it. Never fall back
    // to sending it as text — the user asked for a command, not a prompt.
    if (!entry) return;
    const { startedTurn } = await runCommand(st, entry, item.command!.argument);
    // A command that started a turn drains the rest from that turn's
    // finally; one that did not must keep the queue moving itself.
    if (!startedTurn) await maybeDrainQueue(st);
    return;
  }

  // Text items up to (not including) the first command run as one joined
  // turn, exactly as the whole queue did before.
  const firstCommand = st.queuedMessages.findIndex((q) => q.command);
  const items =
    firstCommand === -1 ? st.queuedMessages : st.queuedMessages.slice(0, firstCommand);
  st.queuedMessages =
    firstCommand === -1 ? [] : st.queuedMessages.slice(firstCommand);
  notifyListeners(st);

  const text = items.map((i) => i.text).filter((t) => t.length > 0).join("\n");
  const images = items.flatMap((i) => i.images ?? []);
  const anyDisplayText = items.some((i) => i.userDisplayText !== undefined);
  const userDisplayText = anyDisplayText
    ? items.map((i) => i.userDisplayText ?? i.text).filter((t) => t.length > 0).join("\n")
    : undefined;
  let promptMeta: Record<string, unknown> | undefined;
  for (const item of items) {
    if (item.promptMeta) {
      if (!promptMeta) {
        promptMeta = { ...item.promptMeta };
      } else {
        for (const [key, value] of Object.entries(item.promptMeta)) {
          if (key === ATTACHMENT_CHIPS_KEY && Array.isArray(promptMeta[key]) && Array.isArray(value)) {
            promptMeta[key] = [...(promptMeta[key] as unknown[]), ...(value as unknown[])];
          } else {
            promptMeta[key] = value;
          }
        }
      }
    }
  }
  const userInput: string | UserMessageInput =
    (images.length > 0 || userDisplayText !== undefined || promptMeta !== undefined)
      ? { text, images, userDisplayText, promptMeta }
      : text;

  await runUserTurn(st, userInput);
}

export function cancelQueued(st: SessionRuntime, id: string): void {
  const before = st.queuedMessages.length;
  st.queuedMessages = st.queuedMessages.filter((q) => q.id !== id);
  if (st.queuedMessages.length !== before) notifyListeners(st);
}

export function popLastQueued(
  st: SessionRuntime,
): { text: string; images?: ImageAttachment[] } | undefined {
  const item = st.queuedMessages.pop();
  if (!item) return undefined;
  notifyListeners(st);
  return { text: item.text, images: item.images };
}

export function clearQueue(st: SessionRuntime): void {
  if (st.queuedMessages.length === 0) return;
  st.queuedMessages = [];
  notifyListeners(st);
}

/** 110/005 P2. Drops this schedule's own undelivered message so a schedule
 *  holds at most one pending item. Matched on `source.name`, never
 *  globally: a second schedule keeps its own item, and a user-typed
 *  message has no `source` and is never touched. */
export function dropQueuedFromSchedule(st: SessionRuntime, name: string): void {
  const before = st.queuedMessages.length;
  st.queuedMessages = st.queuedMessages.filter((q) => q.source?.name !== name);
  if (st.queuedMessages.length !== before) notifyListeners(st);
}
