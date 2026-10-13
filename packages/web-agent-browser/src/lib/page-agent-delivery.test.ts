import { describe, it, expect } from "vitest";
import { reachedPageAgentSession } from "./page-agent-delivery";

describe("reachedPageAgentSession", () => {
  it("{ delivered: false, ranCommand: false } when the send rejects before the turn starts", async () => {
    await expect(reachedPageAgentSession(Promise.reject(new Error("no model"))))
      .resolves.toEqual({ delivered: false, ranCommand: false });
  });

  it("{ delivered: false, ranCommand: false } when the rejection is several awaits deep", async () => {
    const deep = async (depth: number): Promise<never> => {
      if (depth <= 0) throw new Error("deep failure");
      // `return` so the end of this arrow is unreachable — a function declared
      // `Promise<never>` may not fall through to an implicit return.
      return await deep(depth - 1);
    };
    await expect(reachedPageAgentSession(deep(10) as never))
      .resolves.toEqual({ delivered: false, ranCommand: false });
  });

  it("{ delivered: true, ranCommand: false } while the send is still awaiting the model turn", async () => {
    const start = Date.now();
    const sending = new Promise<{ ran: "message" }>((resolve) =>
      setTimeout(() => resolve({ ran: "message" }), 3000),
    );
    await expect(reachedPageAgentSession(sending))
      .resolves.toEqual({ delivered: true, ranCommand: false });
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it("{ delivered: true, ranCommand: false } for { ran: 'message' }", async () => {
    await expect(reachedPageAgentSession(Promise.resolve({ ran: "message" })))
      .resolves.toEqual({ delivered: true, ranCommand: false });
  });

  it("{ delivered: true, ranCommand: true, command: 'new' } for { ran: 'command', command: 'new' }", async () => {
    await expect(reachedPageAgentSession(Promise.resolve({ ran: "command", command: "new" })))
      .resolves.toEqual({ delivered: true, ranCommand: true, command: "new" });
  });

  it("{ delivered: false, ranCommand: false } for { ran: 'none' }", async () => {
    await expect(reachedPageAgentSession(Promise.resolve({ ran: "none" })))
      .resolves.toEqual({ delivered: false, ranCommand: false });
  });
});
