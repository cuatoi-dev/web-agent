import { authHeaders } from "./auth-headers";
import { originPattern } from "./origin";
import { compareModels, parseModelsResponse, PERMISSION_DENIED_ERROR } from "./provider-form-rules";
import type { HeaderPair, ModelsDiff, ProviderDialogDeps, ProviderFormModelRow } from "./types";

export const NOTHING_CHANGED_TEXT = "Nothing was changed.";
export const UNREACHABLE_ENDPOINT_ERROR = "The endpoint could not be reached.";
export const INVALID_MODELS_LIST_ERROR = "The endpoint did not return a model list.";

function showDialog(dialog: HTMLDialogElement): void {
  if (typeof dialog.showModal === "function") {
    dialog.showModal();
  } else {
    dialog.setAttribute("open", "");
  }
}

/** Shows the Refresh error dialog with the failure message and "Nothing was changed." */
export function openRefreshErrorDialog(detail: string): Promise<void> {
  return new Promise<void>((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "confirm-dialog refresh-error-dialog";

    const heading = document.createElement("h2");
    heading.textContent = "Could not load /models";

    const msg = document.createElement("p");
    msg.className = "refresh-error-detail";
    msg.textContent = detail;

    const note = document.createElement("p");
    note.className = "hint refresh-error-unchanged";
    note.textContent = NOTHING_CHANGED_TEXT;

    const actions = document.createElement("div");
    actions.className = "actions dialog-actions";

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "btn close-btn";
    closeBtn.textContent = "Close";
    actions.append(closeBtn);

    dialog.append(heading, msg, note, actions);
    document.body.append(dialog);

    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      if (typeof dialog.close === "function" && dialog.open) dialog.close();
      dialog.remove();
      resolve();
    };

    closeBtn.addEventListener("click", () => finish());
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      finish();
    });
    dialog.addEventListener("close", () => finish());

    showDialog(dialog);
    closeBtn.focus();
  });
}

function appendDiffGroup(
  parent: HTMLElement,
  groupClass: string,
  pillClass: string,
  pillText: string,
  suffixText: string,
  ids: string[],
): void {
  if (ids.length === 0) return;
  const wrap = document.createElement("div");
  wrap.className = `diff-group ${groupClass}`;

  const title = document.createElement("div");
  title.className = "diff-group-title";
  const pill = document.createElement("span");
  pill.className = `pill ${pillClass}`;
  pill.textContent = pillText;
  title.append(pill);
  if (suffixText) title.append(document.createTextNode(` ${suffixText}`));

  const list = document.createElement("ul");
  list.className = "diff-list";
  for (const id of ids) {
    const li = document.createElement("li");
    li.className = "mid";
    li.textContent = id;
    list.append(li);
  }
  wrap.append(title, list);
  parent.append(wrap);
}

/** Opens the "Update models from /models?" comparison dialog (mockup state 5)
 *  and resolves `true` on "Apply changes" or `false` on "Cancel". */
export function openRefreshCompareDialog(diff: ModelsDiff): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "confirm-dialog diff-dialog";

    const heading = document.createElement("h2");
    heading.textContent = "Update models from /models?";

    const summary = document.createElement("p");
    summary.className = "hint diff-summary";
    summary.textContent =
      diff.returnedCount === 1
        ? "The endpoint returned 1 model."
        : `The endpoint returned ${diff.returnedCount} models.`;

    const groups = document.createElement("div");
    groups.className = "diff-groups";
    appendDiffGroup(groups, "diff-add", "add", `Add ${diff.add.length}`, "", diff.add);
    appendDiffGroup(
      groups,
      "diff-remove",
      "remove",
      `Remove ${diff.remove.length}`,
      "— not returned by the endpoint",
      diff.remove,
    );
    appendDiffGroup(groups, "diff-keep", "", `Keep ${diff.keep.length}`, "", diff.keep);

    const actions = document.createElement("div");
    actions.className = "actions dialog-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn cancel-btn";
    cancelBtn.textContent = "Cancel";

    const applyBtn = document.createElement("button");
    applyBtn.type = "button";
    applyBtn.className = "btn primary apply-btn";
    applyBtn.textContent = "Apply changes";

    actions.append(cancelBtn, applyBtn);
    dialog.append(heading, summary, groups, actions);
    document.body.append(dialog);

    let settled = false;
    const finish = (applied: boolean): void => {
      if (settled) return;
      settled = true;
      if (typeof dialog.close === "function" && dialog.open) dialog.close();
      dialog.remove();
      resolve(applied);
    };

    cancelBtn.addEventListener("click", () => finish(false));
    applyBtn.addEventListener("click", () => finish(true));
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      finish(false);
    });
    dialog.addEventListener("close", () => finish(false));

    showDialog(dialog);
    applyBtn.focus();
  });
}

/** Runs the full `Refresh from /models` flow from inside the button's click
 *  handler. Calls `requestPermission` synchronously before the first `await`,
 *  fetches `<endpoint>/models`, and returns the confirmed `ModelsDiff` when
 *  the user clicks "Apply changes", or `null` when cancelled or on error. */
export async function runRefreshFromModels(
  input: {
    endpoint: string;
    apiKey: string;
    headers: HeaderPair[];
    rows: ProviderFormModelRow[];
  },
  deps: ProviderDialogDeps = {},
): Promise<ModelsDiff | null> {
  const origin = originPattern(input.endpoint);
  if (!origin) {
    await openRefreshErrorDialog(UNREACHABLE_ENDPOINT_ERROR);
    return null;
  }
  const requestPerm =
    deps.requestPermission ?? ((o: string) => chrome.permissions.request({ origins: [o] }));
  // Called synchronously before the first await so the user gesture is active.
  const permPromise = requestPerm(origin);
  const granted = await permPromise;
  if (!granted) {
    await openRefreshErrorDialog(PERMISSION_DENIED_ERROR);
    return null;
  }

  const url = `${input.endpoint.trim().replace(/\/+$/, "")}/models`;
  const cleanHeaders = input.headers
    .map((h) => ({ name: h.name.trim(), value: h.value.trim() }))
    .filter((h) => h.name !== "");
  const headers = authHeaders(
    {
      id: "",
      kind: "custom",
      name: "",
      endpoint: input.endpoint.trim(),
      wireFormat: "openai",
      apiKey: input.apiKey.trim(),
      headers: cleanHeaders,
    },
  );

  const fetchFn = deps.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await fetchFn(url, { method: "GET", headers });
  } catch {
    await openRefreshErrorDialog(UNREACHABLE_ENDPOINT_ERROR);
    return null;
  }

  if (!res.ok) {
    const statusLine = res.statusText ? `${res.status} ${res.statusText}` : `${res.status}`;
    await openRefreshErrorDialog(
      `The endpoint answered ${statusLine}. Check the API key and headers, then try again.`,
    );
    return null;
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    await openRefreshErrorDialog(INVALID_MODELS_LIST_ERROR);
    return null;
  }

  const ids = parseModelsResponse(body);
  if (ids === null) {
    await openRefreshErrorDialog(INVALID_MODELS_LIST_ERROR);
    return null;
  }

  const diff = compareModels(input.rows, ids);
  const applied = await openRefreshCompareDialog(diff);
  return applied ? diff : null;
}
