// Turning the context-manager journal into the `SessionMessage[]` a host
// renders. Moved out of `controller.ts` unchanged: the same grouping by turn,
// the same per-turn cache, and the same in-progress handling.
import type { AuditEntry, JournalEntry } from "./loop/context-manager.js";
import type { RenderableBlock } from "./ui-blocks/types.js";
import type { ContentPart, ModelMessage, TextPart } from "./types.js";
import type { SessionMessage, SessionMessagePart } from "./controller.types.js";
import type { BuildMessagesParams } from "./controller-messages.types.js";

/** 003: shown when a turn completed and produced no content at all. */
export const EMPTY_TURN_NOTICE = "The model ended its turn without a reply.";

/** 003: true when this turn has an assistant entry and not one of its
 *  assistant entries carries any content. That is a completed turn the model
 *  ended with nothing — distinct from a turn still in progress (no assistant
 *  entry yet) and from a turn that produced tool calls or blocks. */
export function isEmptyCompletedTurn(turnEntries: JournalEntry[]): boolean {
  let sawAssistant = false;
  for (const e of turnEntries) {
    if (e.msg.role !== "assistant") continue;
    sawAssistant = true;
    const len = typeof e.msg.content === "string" ? e.msg.content.length : e.msg.content.length;
    if (len > 0) return false;
  }
  return sawAssistant;
}

export function getMessageText(msg: ModelMessage): string {
  if (typeof msg.content === "string") {
    return msg.content;
  }
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((part): part is TextPart => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("\n");
  }
  return "";
}

export function getAssistantParts(
  tid: string,
  journal: JournalEntry[],
  turnAudit: AuditEntry[],
  toolBlocks: Map<string, RenderableBlock>,
): SessionMessagePart[] {
  const parts: SessionMessagePart[] = [];
  let textAcc = "";
  let auditIdx = 0;
  const seenToolCallIds = new Set<string>();

  const flushText = () => {
    if (textAcc) {
      parts.push({ kind: "text", text: textAcc });
      textAcc = "";
    }
  };

  for (const entry of journal) {
    if (entry.meta.turnId !== tid) continue;
    if (entry.msg.role !== "assistant") continue;

    const stepText = getMessageText(entry.msg);
    if (stepText) {
      textAcc += (textAcc ? "\n" : "") + stepText;
    }

    const content: ContentPart[] = Array.isArray(entry.msg.content) ? entry.msg.content : [];
    for (const part of content) {
      if (part.type === "tool-call") {
        const callKey = part.toolCallId || `${part.toolName}-${entry.meta.stepNo}`;
        if (seenToolCallIds.has(callKey)) continue;
        seenToolCallIds.add(callKey);

        // Match this call to its audit entry by name, in order.
        let audit: AuditEntry | undefined;
        for (let k = auditIdx; k < turnAudit.length; k++) {
          if (turnAudit[k].name === part.toolName) {
            audit = turnAudit[k];
            auditIdx = k + 1;
            break;
          }
        }
        const block = toolBlocks.get(part.toolCallId);
        flushText();
        if (block) {
          parts.push({ kind: "block", block });
        } else if (audit?.unknownTool) {
          // 003 — the tool was never offered and never ran; core refused the
          // call as `Unknown tool`. It must not appear in the thread as a
          // completed tool step. The model's own text reply (already flushed)
          // still records the attempt.
        } else {
          parts.push({
            kind: "tool",
            audit: audit ?? {
              ts: Date.now(),
              name: part.toolName,
              input: part.input,
              outcomeSummary: "",
              failed: false,
            },
          });
        }
      }
    }
  }

  flushText();
  return parts;
}

/** The message list `getState()` shows. Every closure variable the original
 *  loop read is now a field of `params`; the body is otherwise unchanged. */
export function buildSessionMessages(params: BuildMessagesParams): SessionMessage[] {
  const {
    journal,
    inProgressTurnId,
    compactionRows,
    turnCache,
    toolBlocks,
    toolBlocksVersion,
    running,
  } = params;
  const audit = params.audit;

  const turnIdsOrder: string[] = [];
  const turnEntriesMap = new Map<string, JournalEntry[]>();
  const turnAudits: { [turnId: string]: AuditEntry[] } = {};
  const turnFailedMap = new Map<string, { message: string; retryable: boolean }>();

  let auditIdx = 0;
  for (const entry of journal) {
    const tid = entry.meta.turnId;
    let list = turnEntriesMap.get(tid);
    if (!list) {
      list = [];
      turnEntriesMap.set(tid, list);
      turnIdsOrder.push(tid);
    }
    list.push(entry);

    if (entry.meta.failed) {
      turnFailedMap.set(tid, entry.meta.failed);
    }

    if (entry.msg.role === "tool" && Array.isArray(entry.msg.content)) {
      for (const part of entry.msg.content) {
        if (part.type === "tool-result") {
          const toolName = part.toolName;
          let foundAudit: AuditEntry | null = null;
          for (let k = auditIdx; k < audit.length; k++) {
            if (audit[k].name === toolName) {
              foundAudit = audit[k];
              auditIdx = k + 1;
              break;
            }
          }
          if (foundAudit) {
            const hasError = (part as { isError?: boolean }).isError === true;
            if (foundAudit.failed === undefined) {
              foundAudit = { ...foundAudit, failed: hasError };
            }
            // 003: put the call's saved images on a COPY of its audit entry, so
            // the tool part carries them and the stored audit stays image-free.
            const imgs = entry.meta.toolImages?.[part.toolCallId];
            if (imgs) {
              foundAudit = { ...foundAudit, images: imgs };
            }
            if (!turnAudits[tid]) {
              turnAudits[tid] = [];
            }
            turnAudits[tid].push(foundAudit);
          }
        }
      }
    }
  }

  const messages: SessionMessage[] = [];
  for (const tid of turnIdsOrder) {
    const turnEntries = turnEntriesMap.get(tid) || [];
    const turnCompactions = compactionRows.filter((r) => r.afterTurnId === tid);
    const turnCompactionKey = turnCompactions.map((r) => `${r.id}:${r.status}`).join(",");
    const turnFailed = turnFailedMap.get(tid);
    const isCompletedTurn = tid !== inProgressTurnId;

    if (isCompletedTurn) {
      const cached = turnCache.get(tid);
      const isCacheValid =
        cached !== undefined &&
        cached.isCompleted === true &&
        cached.journalLength === turnEntries.length &&
        cached.compactionKey === turnCompactionKey &&
        cached.toolBlocksVersion === toolBlocksVersion &&
        cached.failed === turnFailed;

      if (isCacheValid) {
        if (cached.userMessage) messages.push(cached.userMessage);
        if (cached.completedAssistantMessage) messages.push(cached.completedAssistantMessage);
      } else {
        let userText = "";
        const userImages: { dataUrl: string; mediaType: string }[] = [];
        let userPromptMeta: Record<string, unknown> | undefined;
        let assistantText = "";

        for (const entry of turnEntries) {
          const text = getMessageText(entry.msg);
          if (entry.msg.role === "user") {
            const shown = entry.meta.userDisplayText !== undefined
              ? entry.meta.userDisplayText
              : text;
            if (shown) {
              userText += (userText ? "\n" : "") + shown;
            }
            if (entry.meta.promptMeta !== undefined) {
              userPromptMeta = entry.meta.promptMeta;
            }
            if (Array.isArray(entry.msg.content)) {
              for (const part of entry.msg.content) {
                if (part.type === "image" && typeof part.image === "string") {
                  userImages.push({
                    dataUrl: part.image,
                    mediaType: (part.mediaType) || "image/jpeg",
                  });
                }
              }
            }
          } else if (entry.msg.role === "assistant") {
            assistantText += (assistantText ? "\n" : "") + text;
          }
        }

        const hasUserContent = !!userText || userImages.length > 0 || userPromptMeta !== undefined;
        let userMessage: SessionMessage | undefined;
        if (hasUserContent) {
          userMessage = {
            role: "user",
            text: userText || undefined,
            images: userImages.length > 0 ? userImages : undefined,
            promptMeta: userPromptMeta,
          };
        }

        let completedAssistantMessage: SessionMessage | undefined;
        if (
          assistantText ||
          (turnAudits[tid] && turnAudits[tid].length > 0) ||
          turnCompactions.length > 0
        ) {
          const parts = getAssistantParts(tid, journal, turnAudits[tid] || [], toolBlocks);
          for (const r of turnCompactions) {
            parts.push({
              kind: "compaction",
              compaction: {
                status: r.status,
                ...(r.stats ? { stats: r.stats } : {}),
              },
            });
          }
          const textParts = parts.filter((p): p is { kind: "text"; text: string } => p.kind === "text");
          const blockParts = parts.filter((p): p is { kind: "block"; block: RenderableBlock } => p.kind === "block");

          completedAssistantMessage = {
            role: "assistant",
            text: textParts.map((p) => p.text).join(""),
            parts,
            blocks: blockParts.map((p) => p.block),
            trace: turnAudits[tid] || [],
          };
        }

        if (turnFailed) {
          if (completedAssistantMessage) {
            completedAssistantMessage.failed = turnFailed;
          } else if (userMessage) {
            userMessage.failed = turnFailed;
          }
        } else if (!completedAssistantMessage && isEmptyCompletedTurn(turnEntries) && userMessage) {
          // 003: the turn finished and said nothing. The gate above leaves
          // `completedAssistantMessage` undefined here, so the panel would
          // otherwise show the user's message and nothing after it. The
          // notice rides on the USER message — exactly where `failed` goes
          // when a turn has no assistant message — so no empty assistant
          // bubble is created.
          userMessage.notice = { message: EMPTY_TURN_NOTICE, retryable: true };
        }

        turnCache.set(tid, {
          isCompleted: true,
          userMessage,
          completedAssistantMessage,
          journalLength: turnEntries.length,
          compactionKey: turnCompactionKey,
          toolBlocksVersion,
          failed: turnFailed,
        });

        if (userMessage) messages.push(userMessage);
        if (completedAssistantMessage) messages.push(completedAssistantMessage);
      }
    } else {
      // In-progress turn (tid === inProgressTurnId)
      const cached = turnCache.get(tid);
      let userMessage = cached?.userMessage;
      if (!userMessage) {
        let userText = "";
        const userImages: { dataUrl: string; mediaType: string }[] = [];
        let userPromptMeta: Record<string, unknown> | undefined;

        for (const entry of turnEntries) {
          const text = getMessageText(entry.msg);
          if (entry.msg.role === "user") {
            const shown = entry.meta.userDisplayText !== undefined
              ? entry.meta.userDisplayText
              : text;
            if (shown) {
              userText += (userText ? "\n" : "") + shown;
            }
            if (entry.meta.promptMeta !== undefined) {
              userPromptMeta = entry.meta.promptMeta;
            }
            if (Array.isArray(entry.msg.content)) {
              for (const part of entry.msg.content) {
                if (part.type === "image" && typeof part.image === "string") {
                  userImages.push({
                    dataUrl: part.image,
                    mediaType: (part.mediaType) || "image/jpeg",
                  });
                }
              }
            }
          }
        }

        const hasUserContent = !!userText || userImages.length > 0 || userPromptMeta !== undefined;
        if (hasUserContent) {
          userMessage = {
            role: "user",
            text: userText || undefined,
            images: userImages.length > 0 ? userImages : undefined,
            promptMeta: userPromptMeta,
          };
          if (turnFailed) {
            userMessage.failed = turnFailed;
          }
        }

        turnCache.set(tid, {
          isCompleted: false,
          userMessage,
          journalLength: turnEntries.length,
          compactionKey: turnCompactionKey,
          toolBlocksVersion,
          failed: turnFailed,
        });
      }

      if (userMessage) messages.push(userMessage);

      let assistantText = "";
      for (const entry of turnEntries) {
        if (entry.msg.role === "assistant") {
          const text = getMessageText(entry.msg);
          assistantText += (assistantText ? "\n" : "") + text;
        }
      }

      let inProgressAssistantMessage: SessionMessage | undefined;
      if (
        assistantText ||
        (turnAudits[tid] && turnAudits[tid].length > 0) ||
        turnCompactions.length > 0
      ) {
        const parts = getAssistantParts(tid, journal, turnAudits[tid] || [], toolBlocks);
        for (const r of turnCompactions) {
          parts.push({
            kind: "compaction",
            compaction: {
              status: r.status,
              ...(r.stats ? { stats: r.stats } : {}),
            },
          });
        }
        const textParts = parts.filter((p): p is { kind: "text"; text: string } => p.kind === "text");
        const blockParts = parts.filter((p): p is { kind: "block"; block: RenderableBlock } => p.kind === "block");

        inProgressAssistantMessage = {
          role: "assistant",
          text: textParts.map((p) => p.text).join(""),
          parts,
          blocks: blockParts.map((p) => p.block),
          trace: turnAudits[tid] || [],
          pending: true,
        };
        if (turnFailed) {
          inProgressAssistantMessage.failed = turnFailed;
        }
        messages.push(inProgressAssistantMessage);
      }
    }
  }

  let lastAssistantIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") {
      lastAssistantIdx = i;
      break;
    }
  }

  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === "assistant") {
      messages[i].disabled = running ? true : i !== lastAssistantIdx;
    }
  }

  return messages;
}
