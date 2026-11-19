# @cuatoi/web-agent-vfs

Virtual file system tools for the web-agent in-app browser agent — a mounted file
tree with `read_file`, `write_file`, `edit_file`, `glob_files`, `search_files`,
`delete_file`, `move_file`, `json_get`, `json_edit` and `bundle_html`, backed by browser storage
so files survive a page reload.

## Install

```bash
pnpm add @cuatoi/web-agent-vfs
# or
npm install @cuatoi/web-agent-vfs
```

The `@cuatoi/web-agent-vfs/lit` subpath (the Files screen, `filesScreen`) also
needs the optional peer dependencies `@cuatoi/web-agent-lit` and `lit-html`:

```bash
npm install @cuatoi/web-agent-lit lit-html
```

## Usage

```ts
import { createAgentSession } from "@cuatoi/web-agent-core";
import { vfsTools } from "@cuatoi/web-agent-vfs";

const session = createAgentSession({
  // …the rest of your SessionConfig…
  toolProviders: [vfsTools()],
});

await session.initPromise; // required: false, so a bad mount never blocks startup
```

`vfsTools(options)` returns one `ToolProvider`. With no options, it mounts the
default layout below. Pass `mounts` to add more mount points, or `tmp`/`home`/
`shared` to replace a default backend.

## Long tool results

A tool result longer than 12,000 characters is saved in full under
`/tmp/tool-results/`, and the model receives a short preview: the first and last
2,000 characters, the omitted count, and the path. Use `read_file` with
`offset` and `limit`, or `search_files`, to read the rest. A valid JSON result
is saved byte for byte as a `.json` file, and the preview names `json_get`.

Both thresholds are configurable:

```ts
vfsTools({ toolResults: { maxChars: 5000, previewChars: 500 } });
```

`read_file`, `glob_files` and `search_files` results are never saved — they are
already bounded. A tool that throws is treated the same way: its error message
is saved when it is too long, with no stack trace. If the save fails — for
example, `/tmp` is full — the model gets the preview with `saved="false"` and
the turn continues. Starting a new chat deletes every file under
`/tmp/tool-results/`; the rest of `/tmp` is not touched.

## The file tree

| Mount | Default backend | Notes |
|---|---|---|
| `/tmp` | `sessionStorage` | Cleared when the browser tab closes. |
| `/home/agent` | `localStorage` | The agent's own files, kept across reloads. |
| `/home/shared` | `localStorage` | Same persistence as `/home/agent`; a separate namespace for files a host wants to share with the agent. |

Every other path is read-only until a host mounts it: a write outside the
writable mounts fails with
`Error: <path> is read-only. Writable paths: /tmp, /home/agent, /home/shared.`
The list names every writable mount, including a folder attached at run time.

A host adds its own mount with the `mounts` option:

```ts
vfsTools({ mounts: { "/project": myBackend } });
```

A mount that overlaps an existing one (equal, or nested inside it) makes
`load()` reject, and the session runs with no file tools rather than a broken
tree.

## Memory

Turn on memory to give the agent two files it sees at the start of every chat:

- `/home/shared/USER.md` — about the user. Every agent on the origin shares it.
- `/home/agent/MEMORY.md` — what this agent learned.

```ts
vfsTools({ memory: true });
```

Memory is off when you leave out `memory` or pass `false`. `memory: true` is the
same as `memory: {}` and uses every default:

| Option | Default | What it does |
|---|---|---|
| `userPath` | `/home/shared/USER.md` | The user file. |
| `memoryPath` | `/home/agent/MEMORY.md` | The agent's memory file. |
| `userMaxChars` | `2000` | The most characters of the user file the agent sees. |
| `memoryMaxChars` | `4000` | The most characters of the memory file the agent sees. |
| `onboarding` | `true` | When the user file is missing, tell the agent to offer onboarding. |

When memory is on:

- The first message of a chat carries each file in a `<memory path="…">`
  block, after any `<agents-md>` blocks. Later messages do not.
- A file longer than its limit is cut. A note at the cut tells the agent to
  merge or remove entries. The file itself does not change.
- When the user file is missing and `onboarding` is on, the first message
  carries `<memory path="…" missing="true">`. A missing memory file adds
  nothing.
- The system prompt gains one line that tells the agent to change the files
  only when the user asks, or agrees when the agent offers.
- The files are read once per chat. A change made during a chat appears in the
  next chat.

### Memory skills

The package also ships two skills that tell the agent how to change the files.
Add them to the host's skills only when memory is on:

```ts
import { memorySkills, vfsTools } from "@cuatoi/web-agent-vfs";

const vfs = vfsTools({ memory: true });
const skills = [...hostSkills, ...memorySkills(vfs)];
```

`memorySkills(vfs)` returns `remember` and `onboarding` when memory is on. It
returns an empty array when memory is off, so the host needs no extra check.
The text of each skill names the configured paths and limits, so the agent
writes to the files the host configured.

| Skill | What it does |
|---|---|
| `remember` | Saves, changes or forgets one entry in the user file or the memory file. Stamps each entry with the local date and time. |
| `onboarding` | Builds the user file in a short conversation, when the file does not exist yet. Offers once per chat. |

Both skills are model-invoked. Neither adds a slash command.

## The tools

- **`read_file(file_path, offset?, limit?)`** — returns numbered text lines, or
  an image the model can see. `offset` is a 1-based line number; `limit`
  defaults to 2000 lines. A read whose numbered output exceeds the same
  12,000-character budget returns a PARTIAL view of the longest whole-line
  prefix; a read with an explicit `offset` or `limit` over the budget fails with
  an error that names the limit. A read with no `offset` or `limit` whose first
  line alone is over the budget fails with an error that names that line's raw
  length.
- **`write_file(file_path, content, encoding?, mime_type?)`** — creates a file,
  or overwrites one already read in this chat (see below). `encoding` is
  `"utf8"` (default) or `"base64"` for an image; `base64` writes require
  `mime_type` to be one of `image/png`, `image/jpeg`, `image/gif`,
  `image/webp`.
- **`edit_file(file_path, old_string, new_string, replace_all?)`** — replaces
  exact text in a file already read in this chat. `old_string` must match
  exactly once unless `replace_all` is set.
- **`glob_files(pattern, path?)`** — finds files matching a glob pattern across
  mounts. Lists newest files first, up to 100 paths. `path` defaults to `/home/agent`.
- **`search_files(pattern, path?, glob?, output_mode?, ...)`** — searches text
  files using regular expressions. Modes: `files_with_matches` (default), `content`
  (with line numbers and context lines `-A`/`-B`/`-C`), or `count`. A
  content-mode line longer than 500 characters is omitted whole as
  `[line omitted: N characters, over 500]`; use `-o` to print only the matched
text.
- **`delete_file(file_path)`** — removes one file from a writable mount (`/tmp`,
  `/home/agent`, `/home/shared`, or an attached folder that is not read only).
  A file on the user's disk needs the user's confirmation first.
- **`move_file(source_path, destination_path)`** — moves or renames a file across
  mounts. Fails if the destination exists. A move between internal mounts keeps
  the stored modification time. A move that touches an attached folder needs
  the user's confirmation, and a file written there takes the disk's own
  modification time.
- **`json_get(file_path, path?, where?, fields?, offset?, limit?)`** — reads a
  JSON file by path instead of as text. `path` uses the lodash form
  (`users[3].email`, `settings.retries`); omit it for the whole document. On a
  list, `where` keeps the items whose fields all equal the given pairs (deep
  equality, dotted keys allowed), `fields` shows only the listed top-level keys,
  and `offset`/`limit` page through the matches — 50 items by default. The
  output names each item's real index.
- **`json_edit(file_path, changes)`** — applies a list of changes to a JSON
  file: `set`, `delete`, `append`, `insert`, `update`, `remove` and `upsert`.
  The changes apply in order, and the file is written only when all of them
  succeed, so a failed change leaves the file exactly as it was. Every save
  rewrites the file as `JSON.stringify(document, null, 2)`, keeping key order.
  `update` and `remove` take an optional `expect` count, which fails the call
  when it does not match. `json_edit` needs no earlier read.
- **`bundle_html(src, out)`** — copies an HTML file and replaces every
  `<img src="/path">` with the image's bytes as a `data:` URI, so the result is
  one self-contained file. `.png`, `.jpg`, `.jpeg`, `.gif` and `.webp` are
  supported. A `src` that does not start with `/` is left unchanged. A missing
  image fails the call with `Error: Images not found: <paths>` and writes
  nothing. The result line is `Saved <out> (<N> images inlined, <KB> KB)`.
  The output path is overwritten, and needs no earlier read.

Both `json_*` tools mark the file as read for the session, so a `write_file` or
`edit_file` on it right after needs no `read_file` first.

## Writing your own backend

A mount is any object that implements `VfsBackend`:

```ts
interface VfsBackend {
  get(rel: string): Promise<VfsFile | undefined>;
  list(relDir: string): Promise<VfsEntry[]>;
  set?(rel: string, file: VfsFile): Promise<void>;   // absent = read-only
  delete?(rel: string): Promise<void>;                // absent = cannot delete
}
```

The package ships three: `MemoryBackend()` (an in-memory store, useful for tests
or a scratch mount), `StorageBackend(storage, prefix)` (a `Storage` object,
namespaced by `prefix` so two mounts on the same storage never collide) and
`DirectoryBackend(handle, { writable })` (a folder on the user's disk, see
below).

## Read before write

An agent must read a file with `read_file` before it can overwrite it with
`write_file` or change it with `edit_file`. This catches an agent editing a
file blind, from stale knowledge of its content. The read is tracked per chat
and does not survive a page reload, so a new chat — or the same chat after a
reload — must read the file again first.

On an attached folder the rule is stricter. The file can change on disk while
the chat runs, so `write_file` and `edit_file` need a read made after the
file's last change on disk. If the file changed since the agent read it, the
tool fails with `<path> changed on disk since you read it. Read it again with
read_file.` Internal mounts keep the rule above: any earlier read in the chat
is enough.

## Attach a folder at run time

The host passes an already-authorized `FileSystemDirectoryHandle` (for example
from `showDirectoryPicker()`) and mounts it while the session runs. The tools
loaded earlier see the new mount on their next call.

```ts
import { vfsTools, DirectoryBackend } from "@cuatoi/web-agent-vfs";

const provider = vfsTools();
provider.vfs.mount("/share/reports", DirectoryBackend(directoryHandle, { writable: false }), { external: true });
const unsubscribe = provider.vfs.subscribe(() => refreshFiles());
provider.vfs.unmount("/share/reports");
unsubscribe();
```

- **Filtering.** Only text files and PNG, JPEG, GIF and WebP images are
  visible. `.git` and `node_modules` folders are skipped. Other files do not
  exist for the tools.
- **Read only.** With `writable: false` the backend has no `set` and no
  `delete`. Each change fails with `Error: <path> is read-only. The user attached
  <prefix> read only. Writable paths: …`.
- **Confirms.** `delete_file` and `move_file` ask the user through the tool
  context's `confirmInteraction` when either end is on the user's disk. Your
  host must wire it, as `agent-chat-panel` does. Without it the tools return an
  error and change nothing. `write_file` and `edit_file` never ask.
- **Lifetime.** `mount` throws a `ConfigError` when the prefix is `/` or
  overlaps a mount. `unmount` removes only a mount added by `mount` and returns
  `false` for any other path. It also clears the agent's read records under that
  prefix. `subscribe` calls the listener once after each mount, unmount, or
  successful `vfs.write`.

### The folder button

`vfsTools()` also registers a folder button in the chat composer. You need
no extra code: any `agent-chat-panel` that loads the provider shows it.

- **Where the browser has `showDirectoryPicker`** (a secure context in
  Chrome or Edge), the button opens a menu: "Attach folder (read only)" and
  "Attach folder (read and write)".
- **Elsewhere**, the menu has one entry, "Attach folder (read-only copy)".
  It opens the browser's folder upload dialog and copies the text and image
  files into memory. A later change on disk is not seen.
- The folder mounts at `/share/<name>`. A second folder with the same name
  mounts at `/share/<name>-2`.
- A chip above the composer shows each folder and its mode. × removes it.
- The next message tells the model what was attached or removed, in front
  of the typed text. The chat shows only the typed text and the chip.
- Without a folder store, a page reload removes every folder.
- Pass `folderStore` to remember folders across page loads. Each saved folder
  mounts again at the same `/share/<name>` when the browser still allows
  access. Otherwise its chip reads `<name> · needs permission` with an Allow
  button, or `<name> · unavailable` when the folder was moved or deleted.
  A folder from the read-only copy is never remembered.
- Pass `seedAgentsMd` to write that text to `AGENTS.md` in a folder the user
  attaches read and write when the folder has no `AGENTS.md`. An existing file
  is never changed, and a read-only folder is never written.
- The first message of every chat lists each attached folder
  (`Attached folder: /share/<name> (<mode>).`) and carries each folder's root
  `AGENTS.md` in an `<agents-md>` block, after the one for
  `/home/agent/AGENTS.md`.

```ts
const provider = vfsTools({
  folderStore: {
    load: () => db.get("folders"),            // resolves SavedFolder[]
    save: (folders) => db.put("folders", folders),
  },
  seedAgentsMd: "# Workspace\n",
});
```

## License

Apache-2.0 — see [LICENSE](./LICENSE).
