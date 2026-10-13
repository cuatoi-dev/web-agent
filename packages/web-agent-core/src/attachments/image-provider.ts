import type { AttachmentProvider, AttachmentChip, ImageAttachmentProviderOptions } from "./types.js";
export type { ImageAttachmentProviderOptions } from "./types.js";
import { attachmentChipsMeta } from "./types.js";
import type { MessagePart } from "../types.js";
import { downscaleImage } from "../utils/image.js";

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => {
      const err = reader.error as Error;
      reject(err);
    };
    reader.readAsDataURL(file);
  });
}

export function imageAttachmentProvider(
  opts: ImageAttachmentProviderOptions = {},
): AttachmentProvider {
  let pending: { dataUrl: string; mediaType: string }[] = [];
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const l of listeners) l();
  };

  const root = document.createElement("div");
  root.setAttribute("data-attachment-slot", "image");

  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*";
  fileInput.multiple = true;
  fileInput.style.display = "none";
  fileInput.addEventListener("change", () => {
    void ingest(Array.from(fileInput.files || []));
  });

  const strip = document.createElement("div");
  strip.className = "wa-thumb-strip";
  strip.style.display = "none";

  root.appendChild(fileInput);
  root.appendChild(strip);

  async function ingest(files: File[]) {
    const limits = opts.limits?.() ?? {};
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;
      try {
        const rawDataUrl = await readFileAsDataUrl(file);
        const scaled = await downscaleImage(rawDataUrl, limits);
        const originalBytes = (rawDataUrl.length - rawDataUrl.indexOf(",") - 1) * 0.75;
        const scaledBytes = (scaled.length - scaled.indexOf(",") - 1) * 0.75;
        if (scaledBytes < originalBytes * 0.99) {
          opts.onNotify?.("Image resized to fit size limits", "info");
        }
        pending.push({ dataUrl: scaled, mediaType: "image/jpeg" });
      } catch (err) {
        opts.onNotify?.(`Image rejected: ${(err as Error).message || String(err)}`, "error");
      }
    }
    renderStrip();
    notify();
  }

  function renderStrip() {
    strip.innerHTML = "";
    if (pending.length === 0) {
      strip.style.display = "none";
      return;
    }
    strip.style.display = "flex";
    pending.forEach((img, idx) => {
      const wrap = document.createElement("div");
      wrap.className = "wa-thumb-wrap";
      wrap.style.cssText = "position:relative; width:56px; height:56px;";

      const imgEl = document.createElement("img");
      imgEl.src = img.dataUrl;
      imgEl.alt = `Attachment ${idx + 1}`;
      // 56x56 is the OUTER footprint. `border-box` pins it whatever the host
      // theme resolves the mat padding to, so the composer row cannot shift.
      // The mat is the panel's raised chrome surface (same token as the header
      // and as the remove button below), so the thumbnail reads as a card.
      imgEl.style.cssText =
        "box-sizing:border-box; width:56px; height:56px; object-fit:cover;" +
        " border-radius: 6px; padding:var(--wa-padding-s, 4px);" + // eslint-disable-line wa/no-raw-spacing -- 6px is not on the theme border-radius ladder (between --wa-border-radius-m 4px and --wa-border-radius-l 8px); tokenizing would snap the rendered value and change the layout.
        " background:var(--wa-background-color-900, #444);" +
        " border:1px solid var(--wa-border-color, #ddd);";

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.setAttribute("aria-label", `Remove attachment ${idx + 1}`);
      removeBtn.textContent = "×";
      removeBtn.style.cssText =
        "position:absolute; top:-6px; right:-6px; width:18px; height:18px;" +
        " border-radius:50%; border:none; background:var(--wa-background-color-900, #444);" +
        " color:var(--wa-text-color, #fff);" +
        " font-size:12px; line-height:1; cursor:pointer; padding:0;" +
        " display:flex; align-items:center; justify-content:center;";
      removeBtn.addEventListener("click", () => {
        pending.splice(idx, 1);
        renderStrip();
        notify();
      });

      wrap.appendChild(imgEl);
      wrap.appendChild(removeBtn);
      strip.appendChild(wrap);
    });
  }

  function clear() {
    pending = [];
    fileInput.value = "";
    renderStrip();
    notify();
  }

  return {
    id: "image",
    label: "Attach image",
    icon: "attach_file",
    pick: () => fileInput.click(),
    hasPending: () => pending.length > 0,
    slot: () => root,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onPaste(e) {
      if (!e.clipboardData) return false;
      const imageFiles: File[] = [];
      for (const item of Array.from(e.clipboardData.items)) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const f = item.getAsFile();
          if (f) imageFiles.push(f);
        }
      }
      if (imageFiles.length > 0) {
        void ingest(imageFiles);
        return true;
      }
      return false;
    },
    onDragOver(e) {
      if (!e.dataTransfer) return false;
      const hasImage = Array.from(e.dataTransfer.items).some(
        (it) => it.kind === "file" && it.type.startsWith("image/"),
      );
      if (hasImage) {
        e.dataTransfer.dropEffect = "copy";
        return true;
      }
      return false;
    },
    onDrop(e) {
      if (!e.dataTransfer) return false;
      const files = Array.from(e.dataTransfer.files).filter((f) =>
        f.type.startsWith("image/"),
      );
      if (files.length > 0) {
        void ingest(files);
        return true;
      }
      return false;
    },
    restorePending(parts: MessagePart[]) {
      const imgs = parts.filter(
        (p): p is Extract<MessagePart, { type: "image" }> => p.type === "image",
      );
      if (imgs.length === 0) return;
      pending = imgs.map((p) => ({ dataUrl: p.dataUrl, mediaType: p.mediaType }));
      renderStrip();
      notify();
    },
    onUserPrompt(payload) {
      if (pending.length === 0) return;
      const taken = pending;
      const chips: AttachmentChip[] = [
        {
          providerId: "image",
          label: taken.length === 1 ? "1 image" : `${taken.length} images`,
        },
      ];
      clear();
      return {
        parts: [
          ...payload.parts,
          ...taken.map((i) => ({
            type: "image" as const,
            dataUrl: i.dataUrl,
            mediaType: i.mediaType,
          })),
        ],
        meta: attachmentChipsMeta(chips),
      };
    },
    dispose() {
      listeners.clear();
      root.remove();
    },
  };
}
