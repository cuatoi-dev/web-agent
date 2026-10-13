// packages/web-agent-core/src/todo.ts
import type {
  CreateTodoStoreOptions,
  TodoItem,
  TodoStatus,
  TodoStore,
} from "./todo.types.js";
export type {
  CreateTodoStoreOptions,
  TodoControllerSeam,
  TodoItem,
  TodoStatus,
  TodoStore,
} from "./todo.types.js";

function parseMaxId(items: TodoItem[]): number {
  let max = 0;
  for (const it of items) {
    const match = it.id.match(/^t([0-9]+)$/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > max) max = num;
    }
  }
  return max;
}

function glyph(status: TodoStatus): string {
  switch (status) {
    case "in_progress":
      return "~";
    case "done":
      return "x";
    case "pending":
    default:
      return " ";
  }
}

/** Coerces an `updates[].id` value to a string for comparison against real
 *  (always-string) ids. A string passes through; a number or boolean
 *  stringifies predictably; anything else (object, array, null, undefined)
 *  becomes "" — never a real id, so it always fails the id lookup below. */
function updateIdOf(u: Record<string, unknown>): string {
  if (typeof u.id === "string") return u.id;
  if (typeof u.id === "number" || typeof u.id === "boolean") return String(u.id);
  return "";
}

function renderList(list: TodoItem[]): string {
  return list
    .map(
      (entry, index) =>
        `${index + 1}. [${glyph(entry.status)}] ${entry.text}  (id: ${entry.id})`
    )
    .join("\n");
}

/** createTodoStore — the session-owned store behind `TodoControllerSeam`.
 *  Mirrors `createScheduler`'s shape: in-memory state, an `onChange` callback
 *  for persistence, and an `onNotify` callback so the panel can re-render. */
export function createTodoStore(options: CreateTodoStoreOptions = {}): TodoStore {
  let list: TodoItem[] = (options.initial ?? []).map((it) => ({ ...it }));
  let seq = parseMaxId(list);

  function newId(): string {
    seq++;
    return `t${seq}`;
  }

  function commit(next: TodoItem[]): void {
    list = next;
    options.onChange?.(list.map((it) => ({ ...it })));
    options.onNotify?.();
  }

  return {
    write(input: Record<string, unknown>): { content: string; isError?: boolean } {
      if (!input || typeof input !== "object") {
        return {
          content: "Send items to set the plan, or updates to change it.",
          isError: true,
        };
      }

      const hasItems = "items" in input && input.items !== undefined;
      const hasUpdates = "updates" in input && input.updates !== undefined;

      if (hasItems && hasUpdates) {
        return { content: "Send either items or updates, not both.", isError: true };
      }

      if (hasItems) {
        if (!Array.isArray(input.items)) {
          return {
            content: "Send items to set the plan, or updates to change it.",
            isError: true,
          };
        }
        const nextList: TodoItem[] = [];
        for (const raw of input.items) {
          const itemObj = (raw && typeof raw === "object" ? raw : {}) as Record<
            string,
            unknown
          >;
          const text = typeof itemObj.text === "string" ? itemObj.text : "";
          const statusRaw = itemObj.status;
          const status: TodoStatus =
            statusRaw === "in_progress" || statusRaw === "done" ? statusRaw : "pending";
          nextList.push({
            id: newId(),
            text,
            status,
          });
        }
        commit(nextList);
        return { content: renderList(nextList) };
      }

      if (hasUpdates) {
        if (!Array.isArray(input.updates)) {
          return {
            content: "Send items to set the plan, or updates to change it.",
            isError: true,
          };
        }
        const currentIds = new Set(list.map((it) => it.id));
        const unknown: string[] = [];
        for (const raw of input.updates) {
          const u = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
          const idStr = updateIdOf(u);
          if (!currentIds.has(idStr)) {
            unknown.push(idStr);
          }
        }
        if (unknown.length > 0) {
          return {
            content: `No todo with id ${unknown.join(", ")}. Call todo_read for the current ids.`,
            isError: true,
          };
        }

        const nextList = list.map((it) => ({ ...it }));
        for (const raw of input.updates) {
          const u = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
          const idStr = updateIdOf(u);
          const target = nextList.find((it) => it.id === idStr);
          if (target) {
            if (typeof u.text === "string") {
              target.text = u.text;
            }
            if (u.status === "pending" || u.status === "in_progress" || u.status === "done") {
              target.status = u.status;
            }
          }
        }
        commit(nextList);
        return { content: renderList(nextList) };
      }

      return {
        content: "Send items to set the plan, or updates to change it.",
        isError: true,
      };
    },

    read(): { content: string; isError?: boolean } {
      if (list.length === 0) {
        return { content: "No todos." };
      }
      return { content: renderList(list) };
    },

    items(): TodoItem[] {
      return list.map((it) => ({ ...it }));
    },

    reset(items?: TodoItem[]): void {
      list = (items ?? []).map((it) => ({ ...it }));
      const maxId = parseMaxId(list);
      if (maxId > seq) {
        seq = maxId;
      }
    },
  };
}
