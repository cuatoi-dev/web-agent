// 128/003 — the composer's folder button. Attaches a folder on the user's
// disk (or, where the browser has no folder API, a read-only copy) as a
// run-time mount at /share/<name>, shows a chip per folder, and tells the
// model in the next message.
import type { AttachmentChip, AttachmentProvider } from "@cuatoi/web-agent-core";
import { attachmentChipsMeta } from "@cuatoi/web-agent-core";
import type { VfsBackend, VfsHandle } from "./types.js";
import { DirectoryBackend } from "./backends/directory-handle.js";
import { FileListBackend } from "./backends/file-list.js";
import type { Attached, DirectoryPicker, Mode, PendingLine } from "./attach-folder-provider.types.js";

const STRIP_CSS = `
.wa-folder-strip { display: flex; flex-direction: column; gap: var(--wa-padding-s, 4px); }
.wa-folder-chips { display: flex; flex-wrap: wrap; gap: var(--wa-padding-s, 4px); padding: var(--wa-padding-s, 4px) var(--wa-padding-m, 8px) 0; }
.wa-folder-chip {
  display: inline-flex; align-items: center; gap: var(--wa-padding-s, 4px);
  padding: var(--wa-padding-xs, 2px) var(--wa-padding-m, 8px);
  border-radius: var(--wa-border-radius-m, 4px);
  background: var(--wa-background-color-100, #eee);
  color: var(--wa-text-color, #222);
  font-family: var(--wa-font-family, system-ui);
  font-size: var(--wa-font-size-s, 12px);
}
.wa-folder-chip wa-icon svg { width: 14px; height: 14px; }
.wa-folder-chip button {
  border: none; background: none; cursor: pointer; color: inherit;
  font-size: var(--wa-font-size-m, 14px); line-height: 1; padding: 0;
}
.wa-folder-notice {
  color: var(--wa-text-color, #222);
  font-family: var(--wa-font-family, system-ui);
  font-size: var(--wa-font-size-s, 12px);
  padding: 0 var(--wa-padding-m, 8px);
}
`;

function picker(): DirectoryPicker | undefined {
  const w = window as unknown as { showDirectoryPicker?: unknown; isSecureContext?: boolean };
  return typeof w.showDirectoryPicker === "function" && w.isSecureContext === true
    ? (w.showDirectoryPicker as DirectoryPicker).bind(window)
    : undefined;
}

export function attachFolderProvider(vfs: VfsHandle): AttachmentProvider {
  let attached: Attached[] = [];
  let pending: PendingLine[] = [];
  let notice: string | null = null;
  const listeners = new Set<() => void>();
  let root: HTMLElement | null = null;
  let input: HTMLInputElement | null = null;

  /** Built on first use, so creating the provider needs no `document`. */
  function ensureRoot(): HTMLElement {
    if (root) return root;
    root = document.createElement("div");
    root.setAttribute("data-attachment-slot", "folder");
    const style = document.createElement("style");
    style.setAttribute("data-wa-styles", "vfs-folder-strip");
    style.textContent = STRIP_CSS;
    input = document.createElement("input");
    input.type = "file";
    input.setAttribute("webkitdirectory", "");
    input.multiple = true;
    input.hidden = true;
    input.addEventListener("change", () => { void onCopyChosen(); });
    const strip = document.createElement("div");
    strip.className = "wa-folder-strip";
    root.append(style, input, strip);
    return root;
  }

  function render(): void {
    const strip = ensureRoot().querySelector<HTMLElement>(".wa-folder-strip")!;
    strip.replaceChildren();
    if (attached.length > 0) {
      const chips = document.createElement("div");
      chips.className = "wa-folder-chips";
      for (const a of attached) {
        const chip = document.createElement("span");
        chip.className = "wa-folder-chip";
        chip.setAttribute("data-folder-prefix", a.prefix);
        const icon = document.createElement("wa-icon");
        icon.setAttribute("name", "folder");
        const label = document.createElement("span");
        label.textContent = `${a.prefix} · ${a.mode}`;
        const remove = document.createElement("button");
        remove.type = "button";
        remove.setAttribute("aria-label", `Remove ${a.prefix}`);
        remove.textContent = "×";
        remove.addEventListener("click", () => removeFolder(a.prefix));
        chip.append(icon, label, remove);
        chips.append(chip);
      }
      strip.append(chips);
    }
    if (notice !== null) {
      const p = document.createElement("div");
      p.className = "wa-folder-notice";
      p.setAttribute("role", "status");
      p.textContent = notice;
      strip.append(p);
    }
    for (const l of listeners) l();
  }

  async function attach(base: string, backend: VfsBackend, mode: Mode): Promise<void> {
    let name = base;
    let n = 1;
    while (vfs.mounts().some((m) => m.prefix === `/share/${name}`)) {
      n += 1;
      name = `${base}-${n}`;
    }
    const prefix = `/share/${name}`;
    vfs.mount(prefix, backend, { external: true });
    const count = (await backend.list("/")).length;
    pending.push({ prefix, kind: "attach", mode,
      text: `The user attached the folder ${prefix} (${mode}, ${count} files).` });
    attached.push({ prefix, mode, lineSent: false });
    render();
  }

  function removeFolder(prefix: string): void {
    vfs.unmount(prefix);
    const a = attached.find((x) => x.prefix === prefix);
    attached = attached.filter((x) => x.prefix !== prefix);
    if (a && !a.lineSent) {
      pending = pending.filter((l) => !(l.kind === "attach" && l.prefix === prefix));
    } else {
      pending.push({ prefix, kind: "remove", text: `The user removed the folder ${prefix}.` });
    }
    render();
  }

  async function onCopyChosen(): Promise<void> {
    const el = input!;
    const files = Array.from(el.files ?? []);
    el.value = "";
    if (files.length === 0) {
      notice = "Nothing attached: the folder has no files.";
      render();
      return;
    }
    const name = files[0].webkitRelativePath.split("/")[0];
    await attach(name, await FileListBackend(files), "read only");
  }

  return {
    id: "folder",
    label: "Attach folder",
    icon: "folder",
    choices() {
      return picker()
        ? [{ id: "ro", label: "Attach folder (read only)" },
           { id: "rw", label: "Attach folder (read and write)" }]
        : [{ id: "copy", label: "Attach folder (read-only copy)" }];
    },
    async pick(choiceId?: string) {
      notice = null;
      render();
      if (choiceId === "copy") {
        ensureRoot();
        input!.click();             // synchronous: still inside the user's click
        return;
      }
      if (choiceId !== "ro" && choiceId !== "rw") return;
      const show = picker();
      if (!show) return;
      let handle: FileSystemDirectoryHandle;
      try {
        handle = await show({ mode: choiceId === "rw" ? "readwrite" : "read" });   // called before any await
      } catch (err) {
        const name = (err as { name?: string } | null)?.name;
        if (name === "AbortError" || name === "NotAllowedError") {
          notice = "No folder was attached.";
          render();
          return;
        }
        throw err;
      }
      const writable = choiceId === "rw";
      await attach(handle.name, DirectoryBackend(handle, { writable }), writable ? "read and write" : "read only");
    },
    hasPending: () => false,
    slot: () => ensureRoot(),
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    onUserPrompt({ parts, displayText }) {
      if (pending.length === 0) return;
      const chips: AttachmentChip[] = pending
        .filter((l) => l.kind === "attach")
        .map((l) => ({ providerId: "folder", label: `${l.prefix} · ${l.mode}` }));
      const lines = pending.map((l) => l.text);
      pending = [];
      for (const a of attached) a.lineSent = true;
      return {
        parts: [{ type: "text", text: lines.join("\n") + "\n\n" }, ...parts],
        userDisplayText: displayText,
        ...(chips.length > 0 ? { meta: attachmentChipsMeta(chips) } : {}),
      };
    },
  };
}
