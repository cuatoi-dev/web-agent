export interface TextPart             { type: "text";              text: string }
export interface ImagePart            { type: "image";             image: string; mediaType: string }
export interface FilePart             { type: "file";              data: string;  mediaType: string }
export interface ToolCallPart         { type: "tool-call";         toolCallId: string; toolName: string; input: Record<string, unknown>; extra_content?: Record<string, unknown> }
export interface ToolResultPart       { type: "tool-result";       toolCallId: string; toolName: string; output: unknown; isError?: boolean; redacted?: true }
export interface ThinkingPart         { type: "thinking";          thinking: string; signature: string }
export interface RedactedThinkingPart { type: "redacted_thinking"; data: string }
export type ContentPart          = TextPart | ImagePart | FilePart | ToolCallPart | ToolResultPart | ThinkingPart | RedactedThinkingPart;

export type ModelMessage =
  | { role: "user";      content: string | ContentPart[]; providerOptions?: Record<string, unknown> }
  | { role: "assistant"; content: string | ContentPart[]; providerOptions?: Record<string, unknown> }
  | { role: "tool";      content: ContentPart[];          providerOptions?: Record<string, unknown> }
  | { role: "system";    content: string | ContentPart[]; providerOptions?: Record<string, unknown> };

export interface Tool {
  name: string;
  description: string;
  input_schema: { type: "object"; [key: string]: unknown };
}

/**
 * Detail passed to a host's `confirmInteraction` gate before a sensitive
 * action runs (an "ask"-tier DOM interaction, or `create_skill` /
 * `delete_skill` writing to the skill registry, or `delete_file` / `move_file`
 * on a folder from the user's disk). `ref` is present for DOM actions and
 * absent for the skill and file tools. The optional `title`, `message`,
 * `confirmLabel`, `cancelLabel` and `danger` set the dialog's wording. Shared so core and every
 * downstream package (`@cuatoi/web-agent-dom`, `@cuatoi/web-agent-lit`)
 * agree on one shape.
 */
export interface ConfirmInteractionDetail {
  action: string;
  ref?: string;
  name?: string;
  reason?: string;
  summary?: string;
  title?: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

/**
 * What a wrapped tool executor hands back to the loop. `isError` is the tool's
 * own verdict on its result; the loop copies it onto the `tool-result` part and
 * `message-converter.ts` turns it into `is_error` on the Anthropic wire.
 * Absent means success — the field is omitted, never set to `false`.
 */
/** One image a tool returned (003). `dataUrl` is a `data:<type>;base64,…` URL;
 *  `mediaType` is the type in its header. */
export interface ToolImage {
  dataUrl: string;
  mediaType: string;
}

export interface ToolExecutorResult {
  content: string;
  isError?: boolean;
  /** 003: every image the tool returned, already downscaled by `wrapExecutor`.
   *  Absent when the tool returned none or every image was dropped. */
  images?: ToolImage[];
}

export type ToolExecutor = (
  input: Record<string, unknown>,
  options: { abortSignal?: AbortSignal; toolCallId: string },
) => Promise<ToolExecutorResult>;

export interface TextBlock             { type: "text";              text: string }
export interface ThinkingBlock         { type: "thinking";          thinking: string; signature?: string }
/** Why `input` is `{}` rather than what the model sent. `"empty"` = no argument
 *  JSON arrived; `"unparsable"` = a payload arrived and JSON.parse rejected it.
 *  Absent when the arguments parsed normally. The tool argument parser
 *  reports this issue. A custom provider can attach it to a tool-use block.
 *
 *  `"unparsable"` is read by the loop's tool dispatch (`loop/agent.ts`), which
 *  answers the model with `argumentsUnparsable(...)` instead of running the
 *  tool. `"empty"` is NOT read: `{}` is a faithful reading of "the model sent
 *  no arguments", so it goes through normal schema validation. The marker
 *  itself never reaches the model — it is not copied onto the assistant
 *  `ContentPart`. */
export type ToolArgumentIssue = "empty" | "unparsable";
export interface ToolUseBlock          { type: "tool_use";          id: string; name: string; input: Record<string, unknown>; extra_content?: Record<string, unknown>; argumentsIssue?: ToolArgumentIssue }
export interface RedactedThinkingBlock { type: "redacted_thinking"; data: string }
export type ResponseBlock = TextBlock | ThinkingBlock | ToolUseBlock | RedactedThinkingBlock;

export type StopReason = "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" | "error";

export interface GenerateResult {
  content: ResponseBlock[];
  stopReason: StopReason;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
  };
}

export interface ToolResultRecord {
  toolCallId: string;
  toolName: string;
  output: string;
  isError?: boolean;
}

/**
 * A raw JSON Schema object describing a tool's arguments. MCP servers advertise
 * tool schemas in draft-07; core converts them to draft 2020-12 for the model
 * (see {@link draft07ToDraft2020}) and validates arguments against the converted
 * schema before `execute` runs.
 */
export interface JsonSchemaObject { type: "object"; [key: string]: unknown }

/** One part of what a user sends. The framework bindings compose these;
 *  the controller turns them into the model-facing user message. */
export type MessagePart =
  | { type: "text"; text: string }
  | { type: "image"; dataUrl: string; mediaType: string }
  | { type: "tool"; name: string; data: unknown };
