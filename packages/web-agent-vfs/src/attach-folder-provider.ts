// The composer's folder button. Attaches a folder on the user's
// disk (or, where the browser has no folder API, a read-only copy) as a
// run-time mount at /share/<name>, shows a chip per folder, and tells the
// model in the next message.
// A host FolderStore remembers folders across page loads. Writable folders
// without AGENTS.md receive the host starter.
import type { AttachmentChip } from "@cuatoi/web-agent-core";
import { attachmentChipsMeta } from "@cuatoi/web-agent-core";
import type { VfsBackend, VfsHandle } from "./types.js";
import { DirectoryBackend } from "./backends/directory-handle.js";
import { FileListBackend } from "./backends/file-list.js";
import type { AttachFolderOptions, Attached, FolderProvider, DirectoryPicker, FolderStore, Mode, PendingLine, PermissionHandle, SavedFolder, Waiting } from "./attach-folder-provider.types.js";

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
.wa-folder-chip .wa-folder-allow {
  font-size: var(--wa-font-size-s, 12px);
  font-weight: 600;
  text-decoration: underline;
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

function permissionMode(mode: Mode): "read" | "readwrite" {
  return mode === "read and write" ? "readwrite" : "read";
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export type { FolderProvider } from "./attach-folder-provider.types.js";

export function attachFolderProvider(vfs: VfsHandle, options: AttachFolderOptions = {}): FolderProvider {
  const store: FolderStore | undefined = options.store;
  let waiting: Waiting[] = [];
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
    if (attached.length > 0 || waiting.length > 0) {
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
        remove.addEventListener("click", () => { void removeFolder(a.prefix); });
        chip.append(icon, label, remove);
        chips.append(chip);
      }
      for (const w of waiting) {
        const chip = document.createElement("span");
        chip.className = "wa-folder-chip";
        chip.setAttribute("data-folder-name", w.name);
        chip.setAttribute("data-folder-state", w.state);
        const icon = document.createElement("wa-icon");
        icon.setAttribute("name", "folder");
        const label = document.createElement("span");
        label.textContent = `${w.name} · ${w.state}`;
        chip.append(icon, label);
        if (w.state === "needs permission") {
          const allowBtn = document.createElement("button");
          allowBtn.type = "button";
          allowBtn.className = "wa-folder-allow";
          allowBtn.setAttribute("aria-label", `Allow access to ${w.name}`);
          allowBtn.textContent = "Allow";
          allowBtn.addEventListener("click", () => { void allow(w); });
          chip.append(allowBtn);
        }
        const remove = document.createElement("button");
        remove.type = "button";
        remove.setAttribute("aria-label", `Remove ${w.name}`);
        remove.textContent = "×";
        remove.addEventListener("click", () => { void forget(w); });
        chip.append(remove);
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

  function freePrefix(base: string): string {
    let name = base;
    let n = 1;
    while (vfs.mounts().some((m) => m.prefix === `/share/${name}`)) {
      n += 1;
      name = `${base}-${n}`;
    }
    return `/share/${name}`;
  }

  async function attach(base: string, backend: VfsBackend, mode: Mode, handle?: FileSystemDirectoryHandle): Promise<string> {
    const prefix = freePrefix(base);
    vfs.mount(prefix, backend, { external: true });
    const count = (await backend.list("/")).length;
    pending.push({ prefix, kind: "attach", mode,
      text: `The user attached the folder ${prefix} (${mode}, ${count} files).` });
    attached.push({ prefix, mode, lineSent: false, ...(handle ? { handle } : {}) });
    render();
    return prefix;
  }

  /** Saves every folder that has a handle: mounted ones under the name they
   *  are mounted at, then the waiting ones. A failure is warned; the folder
   *  stays attached for this page load. */
  async function persist(): Promise<void> {
    if (!store) return;
    const folders: SavedFolder[] = [
      ...attached.flatMap((a) => a.handle
        ? [{ name: a.prefix.slice("/share/".length), mode: a.mode, handle: a.handle }]
        : []),
      ...waiting.map((w) => ({ name: w.name, mode: w.mode, handle: w.handle })),
    ];
    try {
      await store.save(folders);
    } catch (err) {
      console.warn(`[web-agent] could not save the attached folders: ${messageOf(err)}`);
    }
  }

  /** Writes the starter into a read-and-write folder that has no AGENTS.md.
   *  An existing file is never touched. A failure is warned; the attach stays. */
  async function seedIfMissing(prefix: string): Promise<void> {
    if (!options.seedAgentsMd) return;
    const path = `${prefix}/AGENTS.md`;
    try {
      if (await vfs.get(path)) return;
      await vfs.write(path, options.seedAgentsMd);
    } catch (err) {
      console.warn(`[web-agent] could not seed ${path}: ${messageOf(err)}`);
    }
  }

  /** Mounts each saved folder again at the same name when access is still
   *  granted. The others become waiting chips. */
  async function restore(s: FolderStore): Promise<void> {
    let saved: SavedFolder[];
    try {
      saved = await s.load();
      vfs.mounts();                 // a bad mount table throws here, before anything mounts
    } catch (err) {
      console.warn(`[web-agent] could not restore the attached folders: ${messageOf(err)}`);
      return;
    }
    let renamed = false;
    for (const f of saved) {
      let perm: PermissionState;
      try {
        perm = await (f.handle as PermissionHandle).queryPermission({ mode: permissionMode(f.mode) });
      } catch {
        waiting.push({ ...f, state: "unavailable" });
        continue;
      }
      if (perm === "prompt") {
        waiting.push({ ...f, state: "needs permission" });
        continue;
      }
      if (perm !== "granted") {
        waiting.push({ ...f, state: "unavailable" });
        continue;
      }
      const backend = DirectoryBackend(f.handle, { writable: f.mode === "read and write" });
      try {
        await backend.list("/");    // a moved or deleted folder throws here
      } catch {
        waiting.push({ ...f, state: "unavailable" });
        continue;
      }
      const prefix = freePrefix(f.name);
      if (prefix !== `/share/${f.name}`) renamed = true;
      vfs.mount(prefix, backend, { external: true });
      attached.push({ prefix, mode: f.mode, lineSent: true, handle: f.handle });
    }
    if (renamed) await persist();
    if (saved.length > 0) render();
  }

  /** The Allow button. `requestPermission` is the first call, before any
   *  await, so it runs inside the user's click. */
  async function allow(w: Waiting): Promise<void> {
    const asked = (w.handle as PermissionHandle).requestPermission({ mode: permissionMode(w.mode) });
    notice = null;
    let perm: PermissionState;
    try {
      perm = await asked;
    } catch {
      perm = "denied";
    }
    if (perm !== "granted") {
      notice = `Access to ${w.name} was not allowed.`;
      render();
      return;
    }
    const backend = DirectoryBackend(w.handle, { writable: w.mode === "read and write" });
    try {
      await backend.list("/");
    } catch {
      w.state = "unavailable";
      render();
      return;
    }
    waiting = waiting.filter((x) => x !== w);
    await attach(w.name, backend, w.mode, w.handle);
    await persist();
  }

  /** × on a waiting or unavailable chip: nothing is mounted, so the model is
   *  told nothing; the folder is dropped from the store. */
  async function forget(w: Waiting): Promise<void> {
    waiting = waiting.filter((x) => x !== w);
    await persist();
    render();
  }

  const ready: Promise<void> = store ? restore(store) : Promise.resolve();

  async function removeFolder(prefix: string): Promise<void> {
    vfs.unmount(prefix);
    const a = attached.find((x) => x.prefix === prefix);
    attached = attached.filter((x) => x.prefix !== prefix);
    if (a && !a.lineSent) {
      pending = pending.filter((l) => !(l.kind === "attach" && l.prefix === prefix));
    } else {
      pending.push({ prefix, kind: "remove", text: `The user removed the folder ${prefix}.` });
    }
    // Keep the chip until the saved removal is durable, including on reload.
    if (a?.handle && store) await persist();
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
      await ready;
      const prefix = await attach(handle.name, DirectoryBackend(handle, { writable }), writable ? "read and write" : "read only", handle);
      await persist();
      if (writable) await seedIfMissing(prefix);
    },
    hasPending: () => false,
    ready,
    mountedFolders: () => attached.map((a) => ({ prefix: a.prefix, mode: a.mode })),
    slot: () => ensureRoot(),
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    async onUserPrompt({ parts, displayText, firstInChat }) {
      await ready;
      const start = firstInChat === true
        ? [
            ...attached.map((a) => `Attached folder: ${a.prefix} (${a.mode}).`),
            ...waiting
              .filter((w) => w.state === "needs permission")
              .map((w) => `Folder ${w.name} needs the user to allow access.`),
          ]
        : [];
      if (pending.length === 0 && start.length === 0) return;
      const chips: AttachmentChip[] = pending
        .filter((l) => l.kind === "attach")
        .map((l) => ({ providerId: "folder", label: `${l.prefix} · ${l.mode}` }));
      const lines = [...start, ...pending.map((l) => l.text)];
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
