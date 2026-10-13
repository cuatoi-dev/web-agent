// Shapes returned by the system-prompt builder.

export interface SystemPromptParts {
  /** STATIC block: byte-stable across turns; cached (breakpoint A). */
  static: string;
  /** DYNAMIC block: the per-turn route (breakpoint B). */
  dynamic: string;
  /** Byte-identical to buildSystemPrompt(app, opts) — the OpenAI/Ollama string. */
  full: string;
}
