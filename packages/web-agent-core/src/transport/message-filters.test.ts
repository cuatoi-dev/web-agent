import { describe, it, expect } from "vitest";
import { dropEmptyAssistantMessages } from "./message-filters.js";
import type { ModelMessage } from "../types.js";

const user = (text: string): ModelMessage => ({ role: "user", content: text });

describe("dropEmptyAssistantMessages", () => {
  it("drops an assistant message with an empty content array", () => {
    const out = dropEmptyAssistantMessages([
      user("hi"),
      { role: "assistant", content: [] },
      user("still there?"),
    ]);
    expect(out).toHaveLength(2);
    expect(out.every((m) => m.role === "user")).toBe(true);
  });

  it("drops an assistant message with an empty string content", () => {
    const out = dropEmptyAssistantMessages([{ role: "assistant", content: "" }]);
    expect(out).toHaveLength(0);
  });

  it("keeps an assistant message with any content", () => {
    const msgs: ModelMessage[] = [
      { role: "assistant", content: [{ type: "text", text: "hi" }] },
      { role: "assistant", content: [{ type: "tool-call", toolCallId: "t1", toolName: "n", input: {} }] },
      { role: "assistant", content: [{ type: "thinking", thinking: "hmm", signature: "s" }] },
      { role: "assistant", content: "plain string" },
    ];
    expect(dropEmptyAssistantMessages(msgs)).toHaveLength(4);
  });

  it("never drops a user or tool message, even an empty one", () => {
    const msgs: ModelMessage[] = [
      { role: "user", content: [] },
      { role: "tool", content: [] },
    ];
    expect(dropEmptyAssistantMessages(msgs)).toHaveLength(2);
  });

  it("returns the messages in their original order", () => {
    const msgs: ModelMessage[] = [
      user("one"),
      { role: "assistant", content: [] },
      user("two"),
      { role: "assistant", content: "three" },
      user("four"),
    ];
    const out = dropEmptyAssistantMessages(msgs);
    expect(out.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))).toEqual([
      "one",
      "two",
      "three",
      "four",
    ]);
  });
});
