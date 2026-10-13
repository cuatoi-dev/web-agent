// packages/web-agent-core/src/todo.types.ts
export type TodoStatus = "pending" | "in_progress" | "done";

export interface TodoItem {
  id: string;
  text: string;
  status: TodoStatus;
}

export interface TodoControllerSeam {
  write(input: Record<string, unknown>): { content: string; isError?: boolean };
  read(): { content: string; isError?: boolean };
  items(): TodoItem[];
}

export interface TodoStore extends TodoControllerSeam {
  reset(items?: TodoItem[]): void;
}

export interface CreateTodoStoreOptions {
  initial?: TodoItem[];
  onChange?: (items: TodoItem[]) => void;
  onNotify?: () => void;
}

export interface TodoItemInput {
  text?: unknown;
  status?: unknown;
}

export interface TodoUpdateInput {
  id?: unknown;
  text?: unknown;
  status?: unknown;
}

export interface TodoWriteInput {
  items?: TodoItemInput[];
  updates?: TodoUpdateInput[];
}
