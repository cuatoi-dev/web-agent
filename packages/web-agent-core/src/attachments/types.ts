import type { HookHandler, UserPromptPayload, UserPromptResult } from "../hooks/user-prompt.types.js";
import type { MessagePart } from "../types.js";
import type { ImageLimits } from "../utils/types.js";

/** One chip shown under the sent user message. Core never interprets `label`. */
export interface AttachmentChip {
  /** `id` of the provider that produced the chip. */
  providerId: string;
  /** Display text, already human-readable. */
  label: string;
}

/** The single key an attachment provider writes into the `onUserPrompt` `meta`. */
export const ATTACHMENT_CHIPS_KEY = "attachmentChips";

/** Build the `meta` object for a provider's chips. */
export function attachmentChipsMeta(chips: AttachmentChip[]): Record<string, unknown> {
  return { [ATTACHMENT_CHIPS_KEY]: chips };
}

/** Read chips back out of a message's `promptMeta`. Returns [] when absent/malformed. */
export function readAttachmentChips(meta: Record<string, unknown> | undefined): AttachmentChip[] {
  const raw = meta?.[ATTACHMENT_CHIPS_KEY];
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[]).filter(
    (c): c is AttachmentChip =>
      !!c &&
      typeof (c as { providerId?: unknown }).providerId === "string" &&
      typeof (c as { label?: unknown }).label === "string",
  );
}

/**
 * A provider's dynamic button presentation, evaluated on mount and whenever
 * the provider notifies a change. Every field falls back to the provider's own
 * static `icon`/`label`, `false`, or no tooltip — a provider with no `view`
 * behaves exactly as one whose `view()` always returns `{}`.
 */
export interface AttachmentProviderView {
  /** Overrides `icon` for this render, e.g. "stop" while recording. */
  icon?: string;
  /** Overrides `label` (the accessible name) for this render. */
  label?: string;
  /** Disables the icon button. */
  disabled?: boolean;
  /** Sets the button's `title` attribute. Undefined removes it. */
  tooltip?: string;
}

/**
 * One entry in the composer's attachment icon array. The binding renders
 * `icon`/`label` and calls `pick()`; everything the attachment MEANS stays
 * inside the provider and reaches the model through `onUserPrompt`.
 */
export interface AttachmentProvider {
  /** Stable, unique id. The binding puts it on the icon as `data-attachment-provider`. */
  id: string;
  /** Accessible name for the icon button. */
  label: string;
  /** Registry icon name, e.g. "attach_file". */
  icon: string;
  /** Dynamic button presentation, re-evaluated on mount and on `subscribe` notifications. */
  view?(): AttachmentProviderView;
  /**
   * When present and non-empty, a press of the icon opens a menu of these
   * entries instead of calling `pick()`. The chosen entry's `id` is passed to
   * `pick()`, inside the menu item's click, so the browser still sees a user
   * action (a file or folder picker needs one).
   */
  choices?(): { id: string; label: string }[];
  /** User activated the icon, or chose `choiceId` from `choices()`. */
  pick(choiceId?: string): void | Promise<void>;
  /** True while the provider holds data the next Send would contribute. */
  hasPending(): boolean;
  /**
   * Contributes this provider's `MessagePart[]` (and its chips, via
   * `attachmentChipsMeta`) to the outgoing message, then clears its own
   * pending data. Merged into `hooks.onUserPrompt` by core.
   */
  onUserPrompt: HookHandler<UserPromptPayload, UserPromptResult | void>;
  /**
   * A stable element the binding mounts above the composer — previews,
   * hidden inputs, anything the provider owns. Same element on every call.
   */
  slot?(): HTMLElement | null;
  /** Notifies the binding that `hasPending()`/`slot()` changed. Returns an unsubscribe fn. */
  subscribe?(listener: () => void): () => void;
  /** Composer event participation. Return true when the provider consumed the event. */
  onPaste?(e: ClipboardEvent): boolean;
  onDragOver?(e: DragEvent): boolean;
  onDrop?(e: DragEvent): boolean;
  /** Re-adopt parts from a queued message the user pulled back into the composer. */
  restorePending?(parts: MessagePart[]): void;
  /** Released from the session's dispose(). */
  dispose?(): void;
}

export interface ImageAttachmentProviderOptions {
  /** Read live so a host changing `images` mid-session takes effect. */
  limits?: () => ImageLimits | undefined;
  /** Toast sink. Optional — no notifications when omitted. */
  onNotify?: (message: string, type: "error" | "info") => void;
}
