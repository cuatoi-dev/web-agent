---
title: Image support (vision & attachment)
---

# Image support (vision & attachment)

The agent supports image input for both user attachments (files, paste, drop)
and the built-in `see` tool (screenshot). A single capability toggle and an
optional image-processing config control everything.

---

## Capability toggle

`AgentConfig.imageInput?: boolean` — default `true`.

When set to `false`:

- The "Attach image" icon is absent because the built-in provider is not registered.
- Paste and drag-drop image ingestion is disabled.
- The `see` tool is not offered. `see` ships with `@cuatoi/web-agent-dom`,
  which omits it when the host passes `domTools({ images: false })`. Core's
  `buildTools()` performs no image gating of its own.
- With `see` absent, its prompt snippet never reaches the system prompt.

---

## User-initiated attachment

When `imageInput` is `true`, the panel registers the built-in
`imageAttachmentProvider()`. The composer renders one `<wa-icon-button>` per
registered attachment provider — for images, `icon="attach_file"` with the
accessible name "Attach image". Clicking it calls the provider's
`pick()`, which clicks a hidden `<input type="file" accept="image/*">` that
`imageAttachmentProvider()` creates and owns internally
(`packages/web-agent-core/src/attachments/image-provider.ts:33`).

A provider can also offer `choices()`. When it returns one or more
entries, a press opens a menu of them instead, and the chosen entry's `id`
goes to `pick(id)`. The folder button in `@cuatoi/web-agent-vfs` works this
way.

Selected files are queued as `{ dataUrl, mediaType }` entries in the
provider's closure-local `pending` array
(`packages/web-agent-core/src/attachments/image-provider.ts:22`). The panel
never sees the queue directly — only `provider.hasPending()`. Thumbnails are
shown in a strip above the composer. All pending images are bundled with the
next user message when submitted.

---

## Paste and drag-drop

The chat panel intercepts `paste` and `drop` events on the composer area. Image
files from either source go through the same provider `pending` queue and
thumbnail strip.

---

## ImageConfig

`AgentConfig.images?: ImageConfig` — controls downscaling applied before images
enter a message. These limits apply to user attachments only. Tool images use TOOL_IMAGE_LIMITS (1536 px, 1 MB) and keep their format where they can.

From `packages/web-agent-core/src/config.types.ts:46-53`:

```ts
interface ImageConfig {
  maxDimension?: number;   // default 1024 — longest edge in px
  maxBytes?: number;       // default 524288 (512 KB) — max encoded size
  quality?: number;        // default 0.82 — JPEG/WebP re-encode quality 0–1
}
```

Processing order:

1. If the image's longest edge exceeds `maxDimension`, downscale while
   preserving aspect ratio.
2. Re-encode as JPEG/WebP at `quality`.
3. If the result still exceeds `maxBytes`, lower quality and re-encode again.

---

## see tool

The `see` tool takes a screenshot of the current page and injects it as an
image message for the model to analyse. It ships with
`@cuatoi/web-agent-dom`, not with core; core owns only its schema
(`SEE_DEF` in `packages/web-agent-core/src/tools/definitions.ts:218`).

- Offered unless the host passes `domTools({ images: false })`.
- The executor calls `domAdapter.screenshot(ref?)` to capture the viewport or
  a single element.
- Returns `"Screenshot captured. A screenshot has been added as a user image message for visual analysis."` as text to the model. When a scoped element is hidden or fully transparent, a warning sentence is appended and the image is still sent.
- The image data flows separately: the `see` executor returns
  `ToolOutcome.images`, `wrapExecutor()` downscales each image with
  `downscaleToolImage` (`TOOL_IMAGE_LIMITS`: 1536 px, 1 MB) and returns them
  on the executor result (`src/tools/build-tools.ts`), and the agent loop
  sends them in one user message on the next step, each after the label
  `Image from tool <name>:` (`src/loop/agent.ts`). The images are saved on the
  tool's journal entry (`meta.toolImages`) and come back on the rebuilt tool
  part as `audit.images`.

---

## Vision models

The configured model must accept image input. Each built-in transport decides,
for every image part in a user message, whether to send it or to drop it
(`src/transport/vision.ts`):

- `imageInput: false` — the image is dropped.
- `imageInput: true` — the image is sent, whatever the model name.
- `imageInput` not set — core guesses from the model name with
  `modelSupportsVision(endpointType, model)`, and drops the image when the
  guess is `false`.

A dropped image adds an `unsupported` provider warning with the feature
`image-input`. The text of the message is still sent
(`src/transport/message-converter.ts:65-74`).

`modelSupportsVision()` returns `true` when:

| `endpointType` | The model name, in lower case, contains |
|---|---|
| `"anthropic"` or `"openai"` | `claude-3`, `gemma-4`, `gemma4`, `gpt-4o`, `gpt-4-turbo`, `vision` or `sonnet` |
| `"gemini"` | `gemini` |

Any other `endpointType`, such as a custom fallback chain, returns `false`.
`sonnet` is on the list so the gateway's `sonnet` router alias counts as a
vision model (`src/transport/vision.ts:6-17`).

A session from `createAgentSession()` always sets `imageInput`, because
`DEFAULT_CONFIG.imageInput` is `true` (`src/controller-config.ts:56`). So in a
session the name guess does not apply, and a model without vision receives the
image. What happens then depends on the model provider. The guess applies when
you call a provider factory directly with a config that has no `imageInput`.

Both functions are exported, so a host can use the same test before it offers
an image tool:

```ts
import { imageReachesModel, modelSupportsVision } from "@cuatoi/web-agent-core";

const offerScreenshot = imageReachesModel(
  config.imageInput,
  modelSupportsVision(config.endpointType, config.model),
);
```

An image with an empty base64 payload never reaches a provider. Each message
converter checks the payload with `assertImagePayload()` and throws
`Invalid image: base64 payload is empty` (`src/utils/image.ts:27-31`).

---

## Cross-links

- [Custom tools](./custom-tool.md) — `ToolContext.imageInput` field
