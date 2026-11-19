import { describe, expect, it, vi } from "vitest";
import { MemoryBackend, vfsTools, type VfsBackend } from "@cuatoi/web-agent-vfs";
import { seedHomeAgentsMd, HOME_AGENTS_MD } from "./seed-home-agents-md";
import { testVfs } from "./test-vfs";

describe("seedHomeAgentsMd", () => {
  it("writes the starter text when the file is missing", async () => {
    const vfs = testVfs();
    const warn = vi.fn();
    await seedHomeAgentsMd(vfs, "# Starter\n", warn);
    expect(warn).not.toHaveBeenCalled();
    expect(await vfs.get(HOME_AGENTS_MD)).toMatchObject({
      content: "# Starter\n",
      encoding: "utf8",
    });
  });

  it("never overwrites an existing file", async () => {
    const vfs = testVfs();
    await vfs.write(HOME_AGENTS_MD, "edited by the user\n");
    const warn = vi.fn();
    await seedHomeAgentsMd(vfs, "# Starter\n", warn);
    expect(warn).not.toHaveBeenCalled();
    expect(await vfs.get(HOME_AGENTS_MD)).toMatchObject({ content: "edited by the user\n" });
  });

  it("does nothing when the agent has no starter text", async () => {
    const vfs = testVfs();
    const warn = vi.fn();
    await seedHomeAgentsMd(vfs, undefined, warn);
    expect(warn).not.toHaveBeenCalled();
    expect(await vfs.list("/home/agent")).toEqual([]);
  });

  it("does nothing for an empty starter text", async () => {
    const vfs = testVfs();
    const warn = vi.fn();
    await seedHomeAgentsMd(vfs, "", warn);
    expect(warn).not.toHaveBeenCalled();
    expect(await vfs.list("/home/agent")).toEqual([]);
  });

  it("warns and resolves when the write fails", async () => {
    const home: VfsBackend = {
      get: () => Promise.resolve(undefined),
      list: () => Promise.resolve([]),
      set: () => Promise.reject(new Error("quota exceeded")),
    };
    const vfs = vfsTools({ tmp: MemoryBackend(), home, shared: MemoryBackend() }).vfs;
    const warn = vi.fn();
    await expect(seedHomeAgentsMd(vfs, "starter\n", warn)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      "[web-agent] could not seed AGENTS.md: quota exceeded",
    );
  });

  it("warns and resolves when the existence check fails", async () => {
    const home: VfsBackend = {
      get: () => Promise.reject(new Error("storage unavailable")),
      list: () => Promise.resolve([]),
    };
    const vfs = vfsTools({ tmp: MemoryBackend(), home, shared: MemoryBackend() }).vfs;
    const warn = vi.fn();
    await expect(seedHomeAgentsMd(vfs, "starter\n", warn)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      "[web-agent] could not seed AGENTS.md: storage unavailable",
    );
  });
});
