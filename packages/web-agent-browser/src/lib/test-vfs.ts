// 127/003 — a real, isolated VfsHandle for the page-tool unit tests. Every
// call site gets its own instance, so one test's files never appear in
// another's. Real VfsHandle and real MemoryBackend: only the Chrome/CDP
// seams are faked. Not imported by any production module.
import { MemoryBackend, vfsTools } from "@cuatoi/web-agent-vfs";

export function testVfs() {
  return vfsTools({
    tmp: MemoryBackend(),
    home: MemoryBackend(),
    shared: MemoryBackend(),
  }).vfs;
}