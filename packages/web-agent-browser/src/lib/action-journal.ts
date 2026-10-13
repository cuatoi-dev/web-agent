// 124/004 — the action journal (one per chat session of one agent panel, in
// memory) and the Playwright code each journaled tool adds. Imports types
// only, so bridge-act-by-ref.ts can use readJournalTarget without pulling any
// DOM code into the bridge bundle.
import type { FileSpec } from "./act-by-ref-tools.types";
import type { RecordedStep } from "./recorder.types";
import type {
  ActionJournal,
  JournalEmulation,
  JournalEntry,
  JournalTarget,
  NewJournalEntry,
} from "./action-journal.types";

export function createActionJournal(activeSessionId: () => string = () => ""): ActionJournal {
  let sessionId = activeSessionId();
  let list: JournalEntry[] = [];
  /** A new chat or a session switch starts an empty journal. */
  const sync = () => {
    const now = activeSessionId();
    if (now !== sessionId) {
      sessionId = now;
      list = [];
    }
  };
  return {
    append(entries) {
      sync();
      return entries.map((e) => {
        const entry: JournalEntry = { ...e, id: list.length + 1 };
        list.push(entry);
        return entry.id;
      });
    },
    entries() {
      sync();
      return [...list];
    },
  };
}

/** A single-quoted JavaScript string literal. Escapes `\`, `'`, CR and LF. */
export function quote(s: string): string {
  return `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\r/g, "\\r").replace(/\n/g, "\\n")}'`;
}

/** " (journal #3)" or " (journal #3–#5)"; "" when nothing was appended. */
export function journalSuffix(ids: number[]): string {
  if (ids.length === 0) return "";
  return ids.length === 1 ? ` (journal #${ids[0]})` : ` (journal #${ids[0]}–#${ids[ids.length - 1]})`;
}

/** User decision 2026-09-18 (2). */
export function notJournaledSuffix(label: string): string {
  return ` (not journaled: no stable locator for ${label})`;
}

/** Reads a `target` off a bridge reply defensively. */
export function readJournalTarget(value: unknown): JournalTarget {
  const t = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  return {
    role: typeof t.role === "string" ? t.role : "",
    name: typeof t.name === "string" ? t.name : "",
    label: typeof t.label === "string" ? t.label : "",
    ...(typeof t.locator === "string" ? { locator: t.locator } : {}),
    isPassword: t.isPassword === true,
  };
}

const action = (text: string, code: string[], password = false, frames: string[] = []): NewJournalEntry => ({
  kind: "action",
  text,
  code,
  password,
  ...(frames.length > 0 ? { frames } : {}),
});
const check = (text: string, code: string[], frames: string[] = []): NewJournalEntry => ({
  kind: "check",
  text,
  code,
  password: false,
  ...(frames.length > 0 ? { frames } : {}),
});
const named = (t: JournalTarget) => `${t.role} "${t.name}"`;

/** 131/003 — `page`, or `page.frameLocator('iframe#pay')…` for a step inside
 *  one or more iframes. `frameLocator` takes a SELECTOR string, which is what
 *  the helper's `iframeSelector` builds (playwright-core 1.58.2,
 *  types.d.ts:2758-2774). */
export function frameRoot(frames: string[]): string {
  return frames.reduce((acc, selector) => `${acc}.frameLocator(${quote(selector)})`, "page");
}

export function clickEntry(t: JournalTarget, locator: string, frames: string[] = []): NewJournalEntry {
  return action(`click ${named(t)}`, [`await ${frameRoot(frames)}.${locator}.click();`], false, frames);
}

export function hoverEntry(t: JournalTarget, locator: string, frames: string[] = []): NewJournalEntry {
  return action(`hover ${named(t)}`, [`await ${frameRoot(frames)}.${locator}.hover();`], false, frames);
}

/** A password value never enters the entry. */
export function fillEntry(t: JournalTarget, locator: string, value: string, frames: string[] = []): NewJournalEntry {
  if (t.isPassword) {
    return action(
      `fill ${named(t)} <password>`,
      [`await ${frameRoot(frames)}.${locator}.fill(process.env.TEST_PASSWORD ?? '');`],
      true,
      frames,
    );
  }
  return action(`fill ${named(t)} "${value}"`, [`await ${frameRoot(frames)}.${locator}.fill(${quote(value)});`], false, frames);
}

export function selectEntry(t: JournalTarget, locator: string, values: string[], frames: string[] = []): NewJournalEntry {
  const arg = values.length === 1 ? quote(values[0]) : `[${values.map(quote).join(", ")}]`;
  return action(
    `select ${named(t)} ${values.map((v) => `"${v}"`).join(", ")}`,
    [`await ${frameRoot(frames)}.${locator}.selectOption(${arg});`],
    false,
    frames,
  );
}

/** `combo` is "<Mod>+…+<Key>", for example "Control+Enter". */
export function pressKeyEntry(combo: string): NewJournalEntry {
  return action(`press ${combo}`, [`await page.keyboard.press(${quote(combo)});`]);
}

export function uploadEntry(t: JournalTarget, locator: string, files: FileSpec[], frames: string[] = []): NewJournalEntry {
  const buffer = (f: FileSpec) =>
    typeof f.text === "string"
      ? `Buffer.from(${quote(f.text)})`
      : typeof f.base64 === "string"
        ? `Buffer.from(${quote(f.base64)}, 'base64')`
        : `Buffer.alloc(${f.size ?? 0}, ${quote(f.fill ?? "")})`;
  const n = files.length;
  return action(
    `upload ${n} ${n === 1 ? "file" : "files"} to ${named(t)}`,
    [
      `await ${frameRoot(frames)}.${locator}.setInputFiles([`,
      ...files.map((f) => `  { name: ${quote(f.name)}, mimeType: ${quote(f.mimeType)}, buffer: ${buffer(f)} },`),
      "]);",
    ],
    false,
    frames,
  );
}

export function dialogEntry(accept: boolean, promptText: string | undefined): NewJournalEntry {
  const code = !accept
    ? "page.once('dialog', dialog => dialog.dismiss());"
    : promptText !== undefined
      ? `page.once('dialog', dialog => dialog.accept(${quote(promptText)}));`
      : "page.once('dialog', dialog => dialog.accept());";
  return action(`answer the next dialog: ${accept ? "accept" : "dismiss"}`, [code]);
}

export function emulateEntry(e: JournalEmulation): NewJournalEntry {
  const text = e.preset !== undefined ? `emulate ${e.preset}` : `emulate ${e.width} × ${e.height}`;
  return { kind: "emulate", text, code: [], password: false, emulation: e };
}

export function emulateResetEntry(): NewJournalEntry {
  return { kind: "emulate-reset", text: "emulate reset", code: [], password: false };
}

/** A PASS page_verify. Undefined when the check needs a locator and `t` has none. */
export function checkEntry(
  input: Record<string, unknown>,
  t: JournalTarget | undefined,
  frames: string[] = [],
): NewJournalEntry | undefined {
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  if (input.kind === "text_visible") {
    const text = str(input.text);
    return check(`verify text "${text}"`, [`await expect(page.getByText(${quote(text)})).toBeVisible();`]);
  }
  if (!t || t.locator === undefined) return undefined;
  const loc = `${frameRoot(frames)}.${t.locator}`;
  if (input.kind === "element_visible") {
    return check(`verify ${named(t)} visible`, [`await expect(${loc}).toBeVisible();`], frames);
  }
  if (input.kind === "value") {
    const value = str(input.value);
    return check(`verify ${named(t)} value "${value}"`, [`await expect(${loc}).toHaveValue(${quote(value)});`], frames);
  }
  const items = Array.isArray(input.items) ? input.items.filter((i): i is string => typeof i === "string") : [];
  return check(
    `verify list "${t.name}" ${items.map((i) => `"${i}"`).join(", ")}`,
    items.map((i) => `await expect(${loc}.getByText(${quote(i)})).toBeVisible();`),
    frames,
  );
}

/** 124/005 — the journal entry for one recorded step. The entry's text IS the
 *  step's own readable line, so the `stop_recording` list and an exported
 *  spec's step comments can never drift apart.
 *
 *  `undefined` when the step needs a locator and the recorder found none —
 *  the caller reports it with `notJournaledSuffix`, exactly as page_fill_form
 *  does (panel-page-tools-act-by-ref.ts:304, :328). */
export function recordedStepEntry(step: RecordedStep): NewJournalEntry | undefined {
  const frames = step.frames ?? [];
  if (step.kind === "scroll") {
    return action(step.line, [`await page.mouse.wheel(0, ${Math.round(step.deltaY ?? 0)});`]);
  }
  if (step.kind === "route") {
    return action(step.line, [`await page.waitForURL(${quote(`**${step.path ?? ""}`)});`]);
  }
  const locator = step.target?.locator;
  if (step.kind === "press" && locator === undefined) {
    return action(step.line, [`await page.keyboard.press(${quote(step.key ?? "")});`]);
  }
  if (locator === undefined) return undefined;
  const loc = `${frameRoot(frames)}.${locator}`;
  switch (step.kind) {
    case "click":
      return action(step.line, [`await ${loc}.click();`], false, frames);
    case "hover":
      return action(step.line, [`await ${loc}.hover();`], false, frames);
    case "check":
      return action(step.line, [`await ${loc}.check();`], false, frames);
    case "uncheck":
      return action(step.line, [`await ${loc}.uncheck();`], false, frames);
    case "press":
      return action(step.line, [`await ${loc}.press(${quote(step.key ?? "")});`], false, frames);
    case "select": {
      const values = step.values ?? [];
      const arg = values.length === 1 ? quote(values[0]) : `[${values.map(quote).join(", ")}]`;
      return action(step.line, [`await ${loc}.selectOption(${arg});`], false, frames);
    }
    default:
      // fill
      if (step.masked) {
        return action(step.line, [`await ${loc}.fill(process.env.TEST_PASSWORD ?? '');`], true, frames);
      }
      return action(step.line, [`await ${loc}.fill(${quote(step.value ?? "")});`], false, frames);
  }
}
