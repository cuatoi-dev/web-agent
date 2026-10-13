import { describe, it, expect } from "vitest";
import { FileListBackend } from "./file-list.js";

function file(path: string, body: string | Uint8Array, type: string, lastModified = 1000): File {
  const f = new File([body], path.split("/").pop()!, { type, lastModified });
  Object.defineProperty(f, "webkitRelativePath", { value: path });
  return f;
}

describe("FileListBackend", () => {
  it("keeps text and image files, drops other types and skipped folders", async () => {
    const files = [
      file("reports/a.csv", "x,y\n1,2", "text/csv"),
      file("reports/b.xlsx", "bin", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
      file("reports/.git/config", "[core]", ""),
      file("reports/node_modules/x/y.js", "1", "text/javascript"),
      file("reports/sub/c.md", "# C", "text/markdown"),
      file("reports/pic.png", new Uint8Array([137, 80, 78, 71]), "image/png"),
    ];
    const b = await FileListBackend(files);
    const paths = (await b.list("/")).map((e) => e.path).sort();
    expect(paths).toEqual(["/a.csv", "/pic.png", "/sub/c.md"]);
  });

  it("get returns the copied content", async () => {
    const files = [
      file("reports/a.csv", "x,y\n1,2", "text/csv"),
      file("reports/b.xlsx", "bin", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
      file("reports/.git/config", "[core]", ""),
      file("reports/pic.png", new Uint8Array([137, 80, 78, 71]), "image/png"),
    ];
    const b = await FileListBackend(files);
    expect(await b.get("/a.csv")).toEqual({
      content: "x,y\n1,2",
      encoding: "utf8",
      mimeType: "text/csv",
      mtimeMs: 1000,
    });
    const pic = await b.get("/pic.png");
    expect(pic?.encoding).toBe("base64");
    expect(pic?.content).toBe("iVBORw==");
    expect(await b.get("/b.xlsx")).toBeUndefined();
    expect(await b.get("/.git/config")).toBeUndefined();
  });

  it("list under a sub-folder", async () => {
    const files = [
      file("reports/a.csv", "x,y\n1,2", "text/csv"),
      file("reports/sub/c.md", "# C", "text/markdown"),
    ];
    const b = await FileListBackend(files);
    const subEntries = await b.list("/sub");
    expect(subEntries.map((e) => e.path)).toEqual(["/sub/c.md"]);
    expect(subEntries[0].size).toBe(3);
  });

  it("is read-only", async () => {
    const b = await FileListBackend([]);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(b.set).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(b.delete).toBeUndefined();
  });

  it("an empty list gives an empty backend", async () => {
    const b = await FileListBackend([]);
    expect(await b.list("/")).toEqual([]);
  });
});
