import type { VfsHandle } from "@cuatoi/web-agent-vfs";
import { errorMessage } from "./error-message";

/** The one path a brand's starter text seeds (127/004). */
export const HOME_AGENTS_MD = "/home/agent/AGENTS.md";

/** Writes the brand's starter `AGENTS.md` into an agent's `/home/agent` once.
 *
 *  An existing file is never touched, so the user's or the agent's edits
 *  survive every panel reload and extension update. A failure is warned and
 *  swallowed: the chat starts without a starter file rather than not at all. */
export async function seedHomeAgentsMd(
  vfs: Pick<VfsHandle, "get" | "write">,
  homeAgentsMd: string | undefined,
  warn: (message: string) => void = (message) => console.warn(message),
): Promise<void> {
  if (!homeAgentsMd) return;
  try {
    if (await vfs.get(HOME_AGENTS_MD)) return;
    await vfs.write(HOME_AGENTS_MD, homeAgentsMd);
  } catch (err) {
    warn(`[web-agent] could not seed AGENTS.md: ${errorMessage(err)}`);
  }
}
