export interface AgentsMdTracker {
  seen(sessionId: string | undefined, absPath: string): number | undefined;
  record(sessionId: string | undefined, absPath: string, mtimeMs: number): void;
}
