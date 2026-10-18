import { describe, it, expect, afterEach } from "vitest";
import { AgentFilesScreen } from "../src/lit/files-screen.js";
import { MemoryBackend } from "../src/backends/memory.js";
import { StorageBackend } from "../src/backends/storage.js";
import { vfsTools } from "../src/index.js";
import type { VfsBackend, VfsFile, VfsHandle } from "../src/types.js";

describe("AgentFilesScreen (DOM tier)", () => {
  let screen: AgentFilesScreen;
  /** The real backends behind the handle of the latest `createMockVfs`. */
  let backends: { tmp: VfsBackend; home: VfsBackend; shared: VfsBackend; extra: Record<string, VfsBackend> };

  afterEach(() => {
    screen.remove();
    sessionStorage.clear();
  });

  /** A real `vfsTools` handle over real backends, seeded with `files`.
   *  `/tmp` keeps its default (session storage) backend so the "this tab"
   *  badge shows. `readOnlyMounts` adds mounts that expose only get/list.
   *  `throwOnList` and `throwOnDelete` wrap ONE method of the backend at that
   *  prefix, for a deliberate failure. */
  async function createMockVfs(options: {
    readOnlyMounts?: string[];
    files?: Record<string, VfsFile>;
    throwOnList?: string; // prefix whose list rejects
    throwOnDelete?: string; // prefix whose delete rejects
  } = {}): Promise<VfsHandle> {
    const full: Record<string, VfsBackend> = {
      "/tmp": StorageBackend(sessionStorage, "web-agent-vfs:tmp:"),
      "/home/agent": MemoryBackend(),
      "/home/shared": MemoryBackend(),
    };
    for (const prefix of options.readOnlyMounts ?? []) full[prefix] = MemoryBackend();
    for (const [abs, file] of Object.entries(options.files ?? {})) {
      const prefix = Object.keys(full).find((x) => abs === x || abs.startsWith(x + "/"));
      if (!prefix) throw new Error(`fixture: no mount covers ${abs}`);
      await full[prefix].set!(abs.slice(prefix.length), file);
    }
    const exposed = (prefix: string): VfsBackend => {
      const b = full[prefix];
      if ((options.readOnlyMounts ?? []).includes(prefix)) {
        return { get: (r) => b.get(r), list: (r) => b.list(r) };
      }
      return {
        ...b,
        list: prefix === options.throwOnList
          ? () => Promise.reject(new Error("Failed to read mount storage"))
          : (r) => b.list(r),
        delete: prefix === options.throwOnDelete
          ? () => Promise.reject(new Error("locked"))
          : (r) => b.delete!(r),
      };
    };
    const mounts: Record<string, VfsBackend> = {};
    for (const prefix of options.readOnlyMounts ?? []) mounts[prefix] = exposed(prefix);
    backends = {
      tmp: full["/tmp"],
      home: full["/home/agent"],
      shared: full["/home/shared"],
      extra: Object.fromEntries((options.readOnlyMounts ?? []).map((x) => [x, full[x]])),
    };
    return vfsTools({
      home: exposed("/home/agent"),
      shared: exposed("/home/shared"),
      mounts,
    }).vfs;
  }

  async function mountScreen(vfs: VfsHandle): Promise<AgentFilesScreen> {
    if (!customElements.get("agent-files-screen")) {
      customElements.define("agent-files-screen", AgentFilesScreen);
    }
    const s = new AgentFilesScreen();
    document.body.appendChild(s);
    s.vfs = vfs;
    await s.treePromise;
    await s.updateComplete;
    return s;
  }

  function query(sel: string): HTMLElement | null {
    return screen.querySelector(sel);
  }

  function queryAll(sel: string): HTMLElement[] {
    return Array.from(screen.querySelectorAll(sel));
  }

  it("mounts and expands /, /tmp, /home, /home/agent, /home/shared initially; nested deck starts closed", async () => {
    const vfs = await createMockVfs({
      files: {
        "/tmp/deck/logo.png": { content: "AAAA", encoding: "base64", mimeType: "image/png", mtimeMs: Date.now() },
        "/home/agent/notes.md": { content: "Notes content", encoding: "utf8", mimeType: "text/markdown", mtimeMs: Date.now() },
        "/home/shared/USER.md": { content: "User", encoding: "utf8", mimeType: "text/markdown", mtimeMs: Date.now() },
      },
    });

    screen = await mountScreen(vfs);

    const rowNames = queryAll(".wa-ftree-row-name").map(
      (el) => el.textContent?.trim(),
    );
    expect(rowNames).toContain("/");
    expect(rowNames).toContain("tmp");
    expect(rowNames).toContain("home");
    expect(rowNames).toContain("agent");
    expect(rowNames).toContain("shared");
    expect(rowNames).toContain("deck");
    expect(rowNames).toContain("notes.md");
    expect(rowNames).toContain("USER.md");
    // deck starts closed, so logo.png should not be visible yet
    expect(rowNames).not.toContain("logo.png");

    // Clicking deck row expands it and reveals logo.png
    const deckRow = queryAll(".wa-ftree-row").find((r) =>
      r.querySelector(".wa-ftree-row-name")?.textContent?.trim() === "deck",
    ) as HTMLElement;
    expect(deckRow).toBeDefined();
    deckRow.click();
    await screen.updateComplete;

    const updatedRowNames = queryAll(".wa-ftree-row-name").map(
      (el) => el.textContent?.trim(),
    );
    expect(updatedRowNames).toContain("logo.png");

    // Clicking deck row again collapses it
    deckRow.click();
    await screen.updateComplete;
    const collapsedRowNames = queryAll(".wa-ftree-row-name").map(
      (el) => el.textContent?.trim(),
    );
    expect(collapsedRowNames).not.toContain("logo.png");
  });

  it("renders 'this tab' badge on /tmp and lock badge on read-only mounts", async () => {
    const vfs = await createMockVfs({
      readOnlyMounts: ["/data"],
    });

    screen = await mountScreen(vfs);

    const badges = queryAll(".wa-badge").map((b) => b.textContent?.trim());
    expect(badges).toContain("this tab");
    expect(badges.some((b) => b?.includes("read-only"))).toBe(true);
  });

  it("displays empty label on empty mounts and empty notice when no files exist anywhere", async () => {
    const vfs = await createMockVfs({ files: {} });
    screen = await mountScreen(vfs);

    const metas = queryAll(".wa-meta").map((m) => m.textContent?.trim());
    expect(metas).toContain("empty");

    const emptyNotice = query(".wa-empty-notice");
    expect(emptyNotice).not.toBeNull();
    expect(emptyNotice?.textContent).toContain("No files yet. Files the agent writes appear here.");
  });

  it("displays error message for failing mount while other mounts render normally", async () => {
    const vfs = await createMockVfs({
      throwOnList: "/home/agent",
      files: {
        "/tmp/file.txt": { content: "hi", encoding: "utf8", mimeType: "text/plain", mtimeMs: Date.now() },
      },
    });

    screen = await mountScreen(vfs);

    // The failing mount displays its error message
    const errorMeta = queryAll(".wa-meta").find((el) =>
      el.textContent?.includes("Failed to read mount storage"),
    );
    expect(errorMeta).toBeDefined();

    // Other mounts still show their files
    const rowNames = queryAll(".wa-ftree-row-name").map(
      (el) => el.textContent?.trim(),
    );
    expect(rowNames).toContain("tmp");
    expect(rowNames).toContain("file.txt");
  });

  it("clicking text file displays breadcrumb, text content in <pre>, and escapes HTML tags", async () => {
    const vfs = await createMockVfs({
      files: {
        "/home/agent/notes.md": {
          content: "# Notes\n<b>Bold text</b> in markdown",
          encoding: "utf8",
          mimeType: "text/markdown",
          mtimeMs: Date.now(),
        },
      },
    });

    screen = await mountScreen(vfs);

    const fileRow = queryAll(".wa-ftree-row").find((r) =>
      r.querySelector(".wa-ftree-row-name")?.textContent?.trim() === "notes.md",
    ) as HTMLElement;
    expect(fileRow).toBeDefined();
    fileRow.click();
    await screen.filePromise;
    await screen.updateComplete;

    // Breadcrumb: / › home › agent › notes.md
    const breadcrumb = query(".wa-file-breadcrumb");
    expect(breadcrumb).not.toBeNull();
    expect(breadcrumb?.textContent?.replace(/\s+/g, " ").trim()).toBe("/ › home › agent › notes.md");
    expect(breadcrumb?.querySelector("strong")?.textContent).toBe("notes.md");

    // Text in <pre>
    const pre = query("pre.wa-file-text");
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toContain("<b>Bold text</b> in markdown");
    // Confirm <b> is rendered as characters, NOT bold HTML element
    expect(pre?.querySelector("b")).toBeNull();
  });

  it("truncates text files exceeding 2,000 lines and displays notice", async () => {
    const lines = Array.from({ length: 2500 }, (_, i) => `Line ${i + 1}`).join("\n");
    const vfs = await createMockVfs({
      files: {
        "/home/agent/large.log": {
          content: lines,
          encoding: "utf8",
          mimeType: "text/plain",
          mtimeMs: Date.now(),
        },
      },
    });

    screen = await mountScreen(vfs);

    const fileRow = queryAll(".wa-ftree-row").find((r) =>
      r.querySelector(".wa-ftree-row-name")?.textContent?.trim() === "large.log",
    ) as HTMLElement;
    fileRow.click();
    await screen.filePromise;
    await screen.updateComplete;

    const pre = query("pre.wa-file-text");
    expect(pre).not.toBeNull();
    const visibleLines = pre?.textContent?.split("\n");
    expect(visibleLines?.length).toBe(2000);

    const truncationNotice = query(".wa-truncation-notice");
    expect(truncationNotice).not.toBeNull();
    expect(truncationNotice?.textContent).toBe(
      "Showing 2,000 of 2,500 lines. Download the file to see all of it.",
    );
  });

  it("clicking image file displays <img> tag with data URL and metadata subtitle", async () => {
    const base64Data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const vfs = await createMockVfs({
      files: {
        "/tmp/deck/logo.png": {
          content: base64Data,
          encoding: "base64",
          mimeType: "image/png",
          mtimeMs: Date.now(),
        },
      },
    });

    screen = await mountScreen(vfs);

    // Expand deck
    const deckRow = queryAll(".wa-ftree-row").find((r) =>
      r.querySelector(".wa-ftree-row-name")?.textContent?.trim() === "deck",
    ) as HTMLElement;
    deckRow.click();
    await screen.updateComplete;

    const logoRow = queryAll(".wa-ftree-row").find((r) =>
      r.querySelector(".wa-ftree-row-name")?.textContent?.trim() === "logo.png",
    ) as HTMLElement;
    logoRow.click();
    await screen.filePromise;
    await screen.updateComplete;

    const img = query("img.wa-file-img") as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.src).toContain(`data:image/png;base64,${base64Data}`);
    expect(img.alt).toBe("logo.png");

    const metaRow = query(".wa-file-meta-row");
    expect(metaRow).not.toBeNull();
    expect(metaRow?.textContent).toContain("image/png");
    expect(metaRow?.textContent).toContain("0.1 KB");
    expect(metaRow?.textContent).toContain("modified");
  });

  it("displays decoded byte count (81.8 KB) for 83,779 byte base64 image", async () => {
    // 83,779 bytes encode to 111,708 chars with "==" padding
    const rainbowB64 = "A".repeat(111706) + "==";
    const vfs = await createMockVfs({
      files: {
        "/home/agent/rainbow.png": {
          content: rainbowB64,
          encoding: "base64",
          mimeType: "image/png",
          mtimeMs: Date.now(),
        },
      },
    });

    screen = await mountScreen(vfs);

    const rainbowRow = queryAll(".wa-ftree-row").find((r) =>
      r.querySelector(".wa-ftree-row-name")?.textContent?.trim() === "rainbow.png",
    ) as HTMLElement;
    expect(rainbowRow.textContent).toContain("81.8 KB");
    expect(rainbowRow.textContent).not.toContain("109.1 KB");

    rainbowRow.click();
    await screen.filePromise;
    await screen.updateComplete;

    const metaRow = query(".wa-file-meta-row");
    expect(metaRow?.textContent).toContain("81.8 KB");
    expect(metaRow?.textContent).not.toContain("109.1 KB");
  });

  it("shows 'This file no longer exists.' when file is missing at open time and refreshes tree", async () => {
    const vfs = await createMockVfs({
      files: {
        "/home/agent/ghost.txt": { content: "ghost", encoding: "utf8", mimeType: "text/plain", mtimeMs: Date.now() },
      },
    });

    screen = await mountScreen(vfs);

    // The file disappears from the backend after the tree was built.
    await backends.home.delete!("/ghost.txt");

    const row = queryAll(".wa-ftree-row").find((r) =>
      r.querySelector(".wa-ftree-row-name")?.textContent?.trim() === "ghost.txt",
    ) as HTMLElement;
    row.click();
    await screen.filePromise;
    await screen.updateComplete;

    expect(query(".wa-file-error")?.textContent).toBe(
      "This file no longer exists.",
    );
  });

  it("renders Download button and Delete button for file on deletable mount", async () => {
    const vfs = await createMockVfs({
      files: {
        "/home/agent/notes.md": { content: "hello", encoding: "utf8", mimeType: "text/markdown", mtimeMs: Date.now() },
      },
    });
    screen = await mountScreen(vfs);
    const fileRow = queryAll(".wa-ftree-row").find((r) =>
      r.querySelector(".wa-ftree-row-name")?.textContent?.trim() === "notes.md",
    ) as HTMLElement;
    fileRow.click();
    await screen.filePromise;
    await screen.updateComplete;
    expect(screen.querySelector('button[aria-label="Download"]')).not.toBeNull();
    expect(screen.querySelector('button[aria-label="Delete"]')).not.toBeNull();
  });

  // 003410-005 round 2: Stage A found the red rule reaching the outer
  // <wa-icon-button> host but not the glyph a real browser paints (a
  // Material-backed registry draws it in shadow DOM from its own
  // --md-icon-button-icon-color, not inherited "color" — jsdom cannot
  // resolve var() or inherit custom properties across elements, so that
  // half of the fix is only provable live; see the task's Outcome). This
  // checks the half jsdom CAN prove for the default registry: the colour
  // actually reaches the rendered SVG glyph, not just the button host, and
  // differs from a button the rule does not target.
  it("the Delete button's red rule reaches the rendered glyph, not just the host", async () => {
    const vfs = await createMockVfs({
      files: {
        "/home/agent/notes.md": { content: "hello", encoding: "utf8", mimeType: "text/markdown", mtimeMs: Date.now() },
      },
    });
    screen = await mountScreen(vfs);
    const fileRow = queryAll(".wa-ftree-row").find((r) =>
      r.querySelector(".wa-ftree-row-name")?.textContent?.trim() === "notes.md",
    ) as HTMLElement;
    fileRow.click();
    await screen.filePromise;
    await screen.updateComplete;

    const deleteHost = screen.querySelector("wa-icon-button.danger") as HTMLElement;
    const deleteGlyph = screen.querySelector('button[aria-label="Delete"] svg') as SVGElement;
    const downloadGlyph = screen.querySelector('button[aria-label="Download"] svg') as SVGElement;
    expect(deleteHost).not.toBeNull();
    expect(deleteGlyph).not.toBeNull();

    const hostColor = getComputedStyle(deleteHost).color;
    const glyphColor = getComputedStyle(deleteGlyph).color;
    expect(glyphColor).toBe(hostColor);
    expect(glyphColor).not.toBe(getComputedStyle(downloadGlyph).color);
  });

  it("renders Download button but NO Delete button for file on non-deletable mount", async () => {
    const vfs = await createMockVfs({
      readOnlyMounts: ["/store"],
      files: {
        "/store/latest-promotion.md": { content: "gift", encoding: "utf8", mimeType: "text/markdown", mtimeMs: Date.now() },
      },
    });
    screen = await mountScreen(vfs);
    const fileRow = queryAll(".wa-ftree-row").find((r) =>
      r.querySelector(".wa-ftree-row-name")?.textContent?.trim() === "latest-promotion.md",
    ) as HTMLElement;
    fileRow.click();
    await screen.filePromise;
    await screen.updateComplete;
    expect(screen.querySelector('button[aria-label="Download"]')).not.toBeNull();
    expect(screen.querySelector('button[aria-label="Delete"]')).toBeNull();
  });

  it("clicking Delete prompts confirmation dialog; canceling leaves file open", async () => {
    const vfs = await createMockVfs({
      files: {
        "/home/agent/notes.md": { content: "hello", encoding: "utf8", mimeType: "text/markdown", mtimeMs: Date.now() },
      },
    });
    screen = await mountScreen(vfs);
    let confirmDetail: Record<string, unknown> | null = null;
    screen.screenContext = {
      close: () => {},
      confirm: (detail) => { confirmDetail = detail as Record<string, unknown>; return Promise.resolve(false); },
    };
    const fileRow = queryAll(".wa-ftree-row").find((r) =>
      r.querySelector(".wa-ftree-row-name")?.textContent?.trim() === "notes.md",
    ) as HTMLElement;
    fileRow.click();
    await screen.filePromise;
    await screen.updateComplete;
    (screen.querySelector('button[aria-label="Delete"]') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));
    await screen.updateComplete;
    expect(confirmDetail).not.toBeNull();
    expect((confirmDetail as Record<string, unknown>).title).toBe("Delete /home/agent/notes.md?");
    expect((confirmDetail as Record<string, unknown>).message).toBe("This cannot be undone.");
    // File view stays open and file remains
    expect(query("pre.wa-file-text")).not.toBeNull();
    expect(await backends.home.get("/notes.md")).toBeDefined();
  });

  it("confirming Delete calls vfs.delete, closes open view, and removes file from tree", async () => {
    const vfs = await createMockVfs({
      files: {
        "/home/agent/notes.md": { content: "hello", encoding: "utf8", mimeType: "text/markdown", mtimeMs: Date.now() },
        "/home/agent/other.md": { content: "other", encoding: "utf8", mimeType: "text/markdown", mtimeMs: Date.now() },
      },
    });
    screen = await mountScreen(vfs);
    screen.screenContext = { close: () => {}, confirm: () => Promise.resolve(true) };
    const fileRow = queryAll(".wa-ftree-row").find((r) =>
      r.querySelector(".wa-ftree-row-name")?.textContent?.trim() === "notes.md",
    ) as HTMLElement;
    fileRow.click();
    await screen.filePromise;
    await screen.updateComplete;
    (screen.querySelector('button[aria-label="Delete"]') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 20));
    await screen.updateComplete;
    expect(await backends.home.get("/notes.md")).toBeUndefined();
    // View closes
    expect(query("pre.wa-file-text")).toBeNull();
    expect(screen.querySelector(".wa-file-op-error")).toBeNull();
    // Tree no longer lists it
    const names = queryAll(".wa-ftree-row-name").map((el) => el.textContent?.trim());
    expect(names).not.toContain("notes.md");
    expect(names).toContain("other.md");
  });

  it("delete failure displays error message under breadcrumb and keeps file open", async () => {
    const vfs = await createMockVfs({
      throwOnDelete: "/home/agent",
      files: {
        "/home/agent/notes.md": { content: "hello", encoding: "utf8", mimeType: "text/markdown", mtimeMs: Date.now() },
      },
    });
    screen = await mountScreen(vfs);
    screen.screenContext = { close: () => {}, confirm: () => Promise.resolve(true) };
    const fileRow = queryAll(".wa-ftree-row").find((r) =>
      r.querySelector(".wa-ftree-row-name")?.textContent?.trim() === "notes.md",
    ) as HTMLElement;
    fileRow.click();
    await screen.filePromise;
    await screen.updateComplete;
    (screen.querySelector('button[aria-label="Delete"]') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 20));
    await screen.updateComplete;
    const err = query(".wa-file-op-error");
    expect(err).not.toBeNull();
    expect(err?.textContent).toContain("Could not delete /home/agent/notes.md: locked");
    // File stays open
    expect(query("pre.wa-file-text")).not.toBeNull();
  });

  // 127/003 — the screen subscribes to the handle, so a file a tool saved
  // appears without the user reopening the screen.
  describe("refresh on change (127/003)", () => {
    function rowNames(): (string | undefined)[] {
      return queryAll(".wa-ftree-row-name").map((el) => el.textContent?.trim());
    }

    async function expand(name: string): Promise<void> {
      const row = queryAll(".wa-ftree-row").find((r) =>
        r.querySelector(".wa-ftree-row-name")?.textContent?.trim() === name,
      );
      row?.click();
      await screen.updateComplete;
    }

    it("a file written while the screen is open appears after expanding its folder", async () => {
      const vfs = await createMockVfs({ files: {} });
      screen = await mountScreen(vfs);
      const handle = screen.vfs;

      await vfs.write("/home/agent/deck/report.md", "body");
      await screen.treePromise;
      await screen.updateComplete;

      expect(rowNames()).toContain("deck");
      await expand("deck");
      expect(rowNames()).toContain("report.md");
      expect(screen.vfs).toBe(handle);
    });

    it("overwriting a file and reopening it shows the new content", async () => {
      const vfs = await createMockVfs({
        files: {
          "/home/agent/notes.md": { content: "first", encoding: "utf8", mimeType: "text/markdown", mtimeMs: 1 },
        },
      });
      screen = await mountScreen(vfs);
      (queryAll(".wa-ftree-row").find((r) =>
        r.querySelector(".wa-ftree-row-name")?.textContent?.trim() === "notes.md",
      ) as HTMLElement).click();
      await screen.filePromise;
      await screen.updateComplete;
      expect(query("pre.wa-file-text")?.textContent).toBe("first");

      await vfs.write("/home/agent/notes.md", "second");
      await screen.treePromise;
      await screen.updateComplete;
      (queryAll(".wa-ftree-row").find((r) =>
        r.querySelector(".wa-ftree-row-name")?.textContent?.trim() === "notes.md",
      ) as HTMLElement).click();
      await screen.filePromise;
      await screen.updateComplete;

      expect(query("pre.wa-file-text")?.textContent).toBe("second");
    });

    it("replacing the handle stops the old one from notifying", async () => {
      const first = await createMockVfs({ files: {} });
      screen = await mountScreen(first);
      const second = await createMockVfs({ files: {} });
      screen.vfs = second;
      await screen.treePromise;
      await screen.updateComplete;

      await first.write("/home/agent/stale.md", "x");
      await new Promise((r) => setTimeout(r, 10));
      await screen.updateComplete;

      expect(rowNames()).not.toContain("stale.md");
    });

    it("one subscription survives a disconnect and reconnect", async () => {
      const vfs = await createMockVfs({ files: {} });
      screen = await mountScreen(vfs);
      let live = 0;
      const realSubscribe = vfs.subscribe.bind(vfs);
      vfs.subscribe = (listener) => {
        live += 1;
        return realSubscribe(listener);
      };

      screen.remove();
      await screen.updateComplete;
      document.body.appendChild(screen);
      await screen.updateComplete;

      expect(live).toBe(1);
    });

    it("a refresh that fails shows the error and rejects nothing", async () => {
      const vfs = await createMockVfs({ files: {} });
      let broken = false;
      const flaky: VfsHandle = {
        ...vfs,
        mounts: () => {
          if (broken) throw new Error("mount table unavailable");
          return vfs.mounts();
        },
      };
      screen = await mountScreen(flaky);

      broken = true;
      await vfs.write("/home/agent/report.md", "body");
      await new Promise((r) => setTimeout(r, 10));
      await screen.updateComplete;

      expect(query(".wa-file-error")?.textContent).toBe("mount table unavailable");
    });
  });
});
