import { KEY_HEADER, TOKEN_HEADER } from "./constants";
import type { AgentSettings } from "./settings";

/** Which auth header leaves the browser.
 *  Empty key  -> the shared team token, as before this task.
 *  Filled key -> the user's key, in the header the chosen wire format uses,
 *  and the shared token is NOT sent (idea 093: the key is sent "instead"), so
 *  the team token never reaches a stranger's endpoint. */
export function buildAuthHeaders(
  settings: AgentSettings,
  sharedToken: string,
): Record<string, string> {
  const key = settings.apiKey.trim();
  if (!key) return { [TOKEN_HEADER]: sharedToken };
  const header = KEY_HEADER[settings.wireFormat];
  return { [header]: settings.wireFormat === "openai" ? `Bearer ${key}` : key };
}
