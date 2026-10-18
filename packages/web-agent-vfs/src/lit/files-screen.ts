import { Component, html, nothing } from "@cuatoi/web-agent-lit";
import type { PanelScreen, PanelScreenContext } from "@cuatoi/web-agent-lit";
import type { VfsFile, VfsHandle, VfsMountInfo, VfsResolvedEntry } from "../types.js";
import { FILES_SCREEN_STYLES } from "./files-screen-styles.js";
import { createFilesScreenElement } from "./files-screen-factory.js";
import type { TreeNode } from "./types.js";

/** Formats a timestamp into a human-readable relative time string. */
export function relativeTime(ms: number, nowMs: number = Date.now()): string {
  const diffSec = Math.max(0, Math.floor((nowMs - ms) / 1000));
  if (diffSec < 60) return "just now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} min ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} h ago`;
  return `${Math.floor(diffSec / 86400)} d ago`;
}

/** Computes decoded byte length from a base64 string. */
export function base64ByteLength(b64: string): number {
  const clean = b64.trim();
  if (!clean) return 0;
  let padding = 0;
  if (clean.endsWith("==")) padding = 2;
  else if (clean.endsWith("=")) padding = 1;
  return Math.max(0, Math.floor((clean.length * 3) / 4) - padding);
}

/** Saves a local file download using an object URL. */
export function downloadFile(absPath: string, f: VfsFile): void {
  const lastSlash = absPath.lastIndexOf("/");
  const fileName = lastSlash >= 0 ? absPath.slice(lastSlash + 1) : absPath;
  let blob: Blob;
  if (f.encoding === "base64") {
    const binary = atob(f.content);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    blob = new Blob([bytes], { type: f.mimeType || "application/octet-stream" });
  } else {
    const bytes = new TextEncoder().encode(f.content);
    blob = new Blob([bytes], { type: f.mimeType || "text/plain;charset=utf-8" });
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName || "download";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Returns true if the file's mount allows deletion. */
export function isDeletable(vfs: VfsHandle, absPath: string): boolean {
  const mounts = vfs.mounts();
  let matched: VfsMountInfo | undefined;
  for (const m of mounts) {
    if (absPath === m.prefix || absPath.startsWith(m.prefix + "/")) {
      if (!matched || m.prefix.length > matched.prefix.length) {
        matched = m;
      }
    }
  }
  return matched ? matched.deletable : false;
}

/** Assembles the virtual file system tree starting at `/`. */
export async function buildTree(vfs: VfsHandle): Promise<TreeNode> {
  const root: TreeNode = {
    kind: "folder",
    name: "/",
    path: "/",
    children: new Map(),
  };

  function ensureFolder(fullPath: string): TreeNode {
    if (fullPath === "/" || fullPath === "") return root;
    const parts = fullPath.split("/").filter(Boolean);
    let curr = root;
    let currPath = "";
    for (const p of parts) {
      currPath += "/" + p;
      let next = curr.children.get(p);
      if (!next) {
        next = {
          kind: "folder",
          name: p,
          path: currPath,
          children: new Map(),
        };
        curr.children.set(p, next);
      }
      curr = next;
    }
    return curr;
  }

  const mounts = vfs.mounts();
  for (const m of mounts) {
    const node = ensureFolder(m.prefix);
    node.mount = m;
    let entries: VfsResolvedEntry[];
    try {
      entries = await vfs.list(m.prefix);
    } catch (e) {
      node.error = e instanceof Error ? e.message : String(e);
      continue;
    }
    for (const e of entries) {
      const lastSlash = e.abs.lastIndexOf("/");
      const dir = e.abs.slice(0, lastSlash) || "/";
      const name = e.abs.slice(lastSlash + 1);
      const folder = ensureFolder(dir);
      folder.children.set(name, {
        kind: "file",
        name,
        path: e.abs,
        file: e,
        children: new Map(),
      });
    }
  }

  return root;
}

/** Set of initial folder paths to expand when opening the Files screen. */
export function initialExpandedSet(mounts: VfsMountInfo[]): Set<string> {
  const set = new Set<string>(["/", "/home"]);
  for (const m of mounts) {
    set.add(m.prefix);
    let p = m.prefix;
    while (p.includes("/")) {
      p = p.slice(0, p.lastIndexOf("/"));
      if (p) set.add(p);
    }
  }
  return set;
}

function countTotalFiles(node: TreeNode): number {
  let count = node.kind === "file" ? 1 : 0;
  for (const c of node.children.values()) {
    count += countTotalFiles(c);
  }
  return count;
}

/** Full-panel screen displaying the agent's files as a tree from `/`. */
export class AgentFilesScreen extends Component {
  private _vfs?: VfsHandle;
  private _unsubscribeVfs?: () => void;
  private _screenContext?: PanelScreenContext;

  private _root: TreeNode | null = null;
  private _expanded: Set<string> = new Set();
  private _selectedPath: string | null = null;
  private _activeFile: { path: string; file: VfsFile } | null = null;
  private _fileError: string | null = null;
  private _fileOpError: string | null = null;

  get vfs(): VfsHandle | undefined {
    return this._vfs;
  }

  private _treePromise: Promise<void> | null = null;
  get treePromise(): Promise<void> | null {
    return this._treePromise;
  }

  private _filePromise: Promise<void> | null = null;
  get filePromise(): Promise<void> | null {
    return this._filePromise;
  }

  set vfs(val: VfsHandle | null) {
    this._vfs = val ?? undefined;
    this._activeFile = null;
    this._fileError = null;
    this._syncSubscription();
    if (val) {
      this._treePromise = this._initTree();
    } else {
      this._root = null;
      this._expanded = new Set();
      this._treePromise = null;
      this.requestUpdate();
    }
  }

  get screenContext(): PanelScreenContext | undefined {
    return this._screenContext;
  }

  set screenContext(val: PanelScreenContext | undefined) {
    this._screenContext = val;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // 127/003 — subscribe whether the handle was set before or after the
    // element entered the DOM.
    this._syncSubscription();
    if (!this._root && this._vfs) {
      this._treePromise = this._initTree();
    }
  }

/** No `super` call: the lit-html `Component` base has no disconnect hook. */
  disconnectedCallback(): void {
    this._unsubscribeVfs?.();
    this._unsubscribeVfs = undefined;
  }

  /** One subscription per connected screen, so a file a tool saved appears
   *  without the user reopening the Files screen. The setter and
   *  connectedCallback both come here, so neither can double subscribe. */
  private _syncSubscription(): void {
    this._unsubscribeVfs?.();
    this._unsubscribeVfs = undefined;
    if (!this.isConnected || !this._vfs) return;
    this._unsubscribeVfs = this._vfs.subscribe(() => {
      // An open preview stays as it is; only the tree is rebuilt.
      this._fileError = null;
      this._treePromise = this._initTree().catch((e) => {
        this._fileError = e instanceof Error ? e.message : String(e);
        this.requestUpdate();
      });
    });
  }

  private async _initTree(): Promise<void> {
    if (!this._vfs) return;
    try {
      this._root = await buildTree(this._vfs);
      this._expanded = initialExpandedSet(this._vfs.mounts());
    } finally {
      this.requestUpdate();
    }
  }

  private async _openFile(absPath: string): Promise<void> {
    if (!this._vfs) return;
    this._fileError = null;
    this._fileOpError = null;
    const f = await this._vfs.get(absPath);
    if (!f) {
      this._fileError = "This file no longer exists.";
      this._activeFile = null;
      this._treePromise = this._initTree();
      await this._treePromise;
      return;
    }
    this._activeFile = { path: absPath, file: f };
    this.requestUpdate();
  }

  private _toggleFolder(path: string, e?: Event): void {
    if (e) e.stopPropagation();
    if (this._expanded.has(path)) {
      this._expanded.delete(path);
    } else {
      this._expanded.add(path);
    }
    this.requestUpdate();
  }

  private _selectFile(path: string, e?: Event): void {
    if (e) e.stopPropagation();
    this._selectedPath = path;
    this._fileOpError = null;
    this._filePromise = this._openFile(path);
  }

  private async _deleteFile(absPath: string): Promise<void> {
    if (!this._vfs) return;
    const ctx = this._screenContext;
    if (ctx?.confirm) {
      const ok = await ctx.confirm({
        title: `Delete ${absPath}?`,
        message: "This cannot be undone.",
        confirmLabel: "Delete",
        cancelLabel: "Cancel",
        danger: true,
      });
      if (!ok) return;
    }
    try {
      await this._vfs.delete(absPath);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this._fileOpError = `Could not delete ${absPath}: ${msg}`;
      this.requestUpdate();
      return;
    }
    this._fileOpError = null;
    this._activeFile = null;
    this._selectedPath = null;
    this._treePromise = this._initTree();
    await this._treePromise;
    this.requestUpdate();
  }

  private _getSortedChildren(node: TreeNode): TreeNode[] {
    const children = Array.from(node.children.values());
    children.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return children;
  }

  private _renderNode(node: TreeNode, depth: number): unknown {
    if (node.path === "/") {
      const isOpen = this._expanded.has("/");
      const children = this._getSortedChildren(node);
      return html`
        <div
          class="wa-ftree-row"
          style="padding-left: var(--wa-padding-m, 8px);"
          role="treeitem"
          aria-expanded=${isOpen ? "true" : "false"}
          @click=${(e: Event) => this._toggleFolder("/", e)}
        >
          <wa-icon .name=${isOpen ? "expand_more" : "chevron_right"}></wa-icon>
          <wa-icon .name=${isOpen ? "folder_open" : "folder"}></wa-icon>
          <span class="wa-ftree-row-name">/</span>
        </div>
        ${isOpen ? children.map((c) => this._renderNode(c, depth + 1)) : nothing}
      `;
    }

    if (node.kind === "folder") {
      const isOpen = this._expanded.has(node.path);
      const children = this._getSortedChildren(node);
      const isMount = !!node.mount;
      const isTabScoped = node.mount?.tabScoped;
      const isReadOnly = node.mount && !node.mount.writable;
      const isEmpty = isMount && node.children.size === 0;

      return html`
        <div
          class="wa-ftree-row"
          style="padding-left: calc(var(--wa-padding-m, 8px) + ${depth} * var(--wa-padding-l, 12px));"
          role="treeitem"
          aria-expanded=${isOpen ? "true" : "false"}
          @click=${(e: Event) => this._toggleFolder(node.path, e)}
        >
          <wa-icon .name=${isOpen ? "expand_more" : "chevron_right"}></wa-icon>
          <wa-icon .name=${isOpen ? "folder_open" : "folder"}></wa-icon>
          <span class="wa-ftree-row-name">${node.name}</span>
          ${isTabScoped ? html`<span class="wa-badge">this tab</span>` : nothing}
          ${isReadOnly ? html`<span class="wa-badge"><wa-icon .name=${"lock"}></wa-icon> read-only</span>` : nothing}
          ${node.mount?.external && node.mount.writable
            ? html`<span class="wa-badge"><wa-icon .name=${"folder"}></wa-icon> your disk</span>`
            : nothing}
          ${node.error ? html`<span class="wa-meta">${node.error}</span>` : isEmpty ? html`<span class="wa-meta">empty</span>` : nothing}
        </div>
        ${isOpen ? children.map((c) => this._renderNode(c, depth + 1)) : nothing}
      `;
    }

    // File
    const isSelected = this._selectedPath === node.path;
    const isImage = node.file?.encoding === "base64" || /\.(png|jpe?g|gif|webp|svg)$/i.test(node.name);
    const iconName = isImage ? "image" : "description";
    const modTime = node.file?.mtimeMs ? relativeTime(node.file.mtimeMs) : "";
    let byteCount = node.file?.size;
    if (byteCount !== undefined && node.file?.encoding === "base64" && !node.file.mount.external) {
      byteCount = Math.max(0, Math.floor((byteCount * 3) / 4));
    }
    const sizeKb = byteCount !== undefined ? (byteCount / 1024).toFixed(1) + " KB" : "";
    const metaText = isImage && sizeKb ? `${sizeKb} · ${modTime}` : modTime;

    return html`
      <div
        class="wa-ftree-row ${isSelected ? "selected" : ""}"
        style="padding-left: calc(var(--wa-padding-m, 8px) + ${depth} * var(--wa-padding-l, 12px) + var(--wa-padding-l, 12px));"
        role="treeitem"
        aria-selected=${isSelected ? "true" : "false"}
        @click=${(e: Event) => this._selectFile(node.path, e)}
      >
        <wa-icon .name=${iconName}></wa-icon>
        <span class="wa-ftree-row-name">${node.name}</span>
        ${metaText ? html`<span class="wa-meta">${metaText}</span>` : nothing}
      </div>
    `;
  }

  private _renderFileActions(absPath: string, f: VfsFile): unknown {
    let deleteBtn: unknown = nothing;
    if (this._vfs && isDeletable(this._vfs, absPath)) {
      deleteBtn = html`<wa-icon-button icon="delete" label="Delete" class="danger"
        @press=${() => void this._deleteFile(absPath)}></wa-icon-button>`;
    }
    return html`<div class="wa-file-actions">
      <wa-icon-button icon="download" label="Download"
        @press=${() => downloadFile(absPath, f)}></wa-icon-button>
      ${deleteBtn}
    </div>`;
  }

  private _renderFileView(): unknown {
    if (this._fileError) {
      return html`
        <div class="wa-fileview">
          <div class="wa-file-error">${this._fileError}</div>
        </div>
      `;
    }

    if (!this._activeFile) return nothing;

    const { path: absPath, file: f } = this._activeFile;
    const segments = absPath.split("/").filter(Boolean);
    const fileName = segments[segments.length - 1] ?? "";
    const dirSegments = segments.slice(0, -1);

    if (f.encoding === "base64") {
      const mimeType = f.mimeType || "image/png";
      const bytes = base64ByteLength(f.content);
      const sizeKb = (bytes / 1024).toFixed(1);
      const modTime = relativeTime(f.mtimeMs);
      return html`
        <div class="wa-fileview">
          <div class="wa-file-header">
            <div class="wa-file-breadcrumb">
              / › ${dirSegments.map((s) => html`<span>${s}</span> › `)}<strong>${fileName}</strong>
            </div>
            ${this._renderFileActions(absPath, f)}
          </div>
          ${this._fileOpError ? html`<div class="wa-file-op-error">${this._fileOpError}</div>` : nothing}
          <img class="wa-file-img" src="data:${mimeType};base64,${f.content}" alt=${fileName} />
          <div class="wa-file-meta-row">${mimeType} · ${sizeKb} KB · modified ${modTime}</div>
        </div>
      `;
    }

    const lines = f.content.split("\n");
    const visibleLines = lines.slice(0, 2000).join("\n");
    const isTruncated = lines.length > 2000;
    return html`
      <div class="wa-fileview">
        <div class="wa-file-header">
          <div class="wa-file-breadcrumb">
            / › ${dirSegments.map((s) => html`<span>${s}</span> › `)}<strong>${fileName}</strong>
          </div>
          ${this._renderFileActions(absPath, f)}
        </div>
        ${this._fileOpError ? html`<div class="wa-file-op-error">${this._fileOpError}</div>` : nothing}
        <pre class="wa-file-text">${visibleLines}</pre>
        ${isTruncated
          ? html`<div class="wa-truncation-notice">Showing 2,000 of ${lines.length.toLocaleString()} lines. Download the file to see all of it.</div>`
          : nothing}
      </div>
    `;
  }

  override template(): unknown {
    if (!this._root) {
      return html`
        ${FILES_SCREEN_STYLES}
        <div class="wa-files-screen">
          <div class="wa-empty-notice">Loading files...</div>
        </div>
      `;
    }

    const totalFiles = countTotalFiles(this._root);

    return html`
      ${FILES_SCREEN_STYLES}
      <div class="wa-files-screen">
        <div class="wa-ftree" role="tree">
          ${this._renderNode(this._root, 0)}
        </div>
        ${totalFiles === 0
          ? html`<div class="wa-empty-notice">No files yet. Files the agent writes appear here.</div>`
          : nothing}
        ${this._renderFileView()}
      </div>
    `;
  }
}

if (typeof customElements !== "undefined" && !customElements.get("agent-files-screen")) {
  customElements.define("agent-files-screen", AgentFilesScreen);
}

/** Factory creating a PanelScreen for the Files screen. */
export function filesScreen(vfs: VfsHandle): PanelScreen {
  return {
    id: "files",
    label: "Files",
    render(ctx: PanelScreenContext): HTMLElement {
      return createFilesScreenElement(vfs, ctx);
    },
  };
}
