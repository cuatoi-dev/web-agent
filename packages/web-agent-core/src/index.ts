export { createPageAgent, runBareTurn, buildGenerateSettings } from "./loop/agent.js";
export { runTurn } from "./loop/run-turn.js";
export type { UserMessageInput, ImageAttachment } from "./utils/types.js";
export { normaliseInput, buildUserContent } from "./utils/types.js";
export {
  downscaleImage,
  downscaleToolImage,
  mediaTypeOf,
  TOOL_IMAGE_LIMITS,
  hasImagePayload,
  assertImagePayload,
} from "./utils/image.js";
export type { ImageLimits } from "./utils/image.js";
export type { ImageConfig, CueKind, CuesConfig, SpeedPreset, ModelOption } from "./config.js";
export { SPEED_PRESETS, resolveModelLabel } from "./config.js";
export { ContextManager } from "./loop/context-manager.js";
export type { JournalEntry, AuditEntry } from "./loop/context-manager.js";
export type { SessionStore, SessionMeta } from "./loop/session-store.js";
export { IdbSessionStore } from "./loop/session-store.js";
export type { TurnFlushRecord } from "./loop/session-lifecycle.js";
export { buildFlushRecord, reconstructState } from "./loop/session-lifecycle.js";

export { buildTools } from "./tools/build-tools.js";
export { runQueryData } from "./tools/query-data.js";
export type {
  ToolContext,
  CustomToolDef,
  ToolRenderer,
  SkillDef,
  ToolOutcome,
  ToolInputSchema,
  JsonSchemaObject,
  ToolStepPhraseInput,
} from "./tools/build-tools.js";
export type { CompactionRequestOutcome } from "./tools/compaction-messages.js";
export type { ConfirmInteractionDetail, ToolImage } from "./types.js";
export { runHooks } from "./hooks/run-hooks.js";
export { SAVED_OUTPUT_TAG, parseSavedOutput } from "./saved-output.js";
export type {
  AgentHooks,
  HookEvent,
  HookHandler,
  HookEntry,
  HookPayloads,
  HookResults,
  PreToolPayload,
  PreToolResult,
  PreToolDecision,
  PostToolPayload,
  PostToolResult,
  UserPromptPayload,
  UserPromptResult,
  UserPromptMerged,
  TurnEndPayload,
  PreCompactPayload,
  PreCompactResult,
  PostCompactPayload,
  SessionStartPayload,
} from "./hooks/types.js";
export { toHookArray } from "./hooks/run-hooks.js";
export type { AttachmentProvider, AttachmentProviderView, AttachmentChip } from "./attachments/types.js";
export { ATTACHMENT_CHIPS_KEY, attachmentChipsMeta, readAttachmentChips } from "./attachments/types.js";
export { imageAttachmentProvider } from "./attachments/image-provider.js";
export type { ImageAttachmentProviderOptions } from "./attachments/image-provider.js";
export {
  defaultTools,
  waitTools,
  timeTools,
  dataTools,
  genuiTools,
  skillTools,
  compactionTools,
  schedulerTools,
  todoTools,
} from "./tools/builders.js";
export {
  createScheduler,
  parseEvery,
  formatMs, formatHumanDuration, formatHumanEvery,
  type ScheduleEntry,
  type SchedulerRegistry,
  type PendingCounts,
  type SetScheduleInput,
  type SchedulerDependencies,
} from "./scheduler.js";
export {
  createTodoStore,
  type TodoItem,
  type TodoStatus,
  type TodoControllerSeam,
  type TodoStore,
} from "./todo.js";
export {
  TOOL_DEFS,
  GET_FIELD_DETAILS_DEF,
  SAMPLE_FIELD_VALUES_DEF,
  getFieldDetailsSchema,
  sampleFieldValuesSchema,
} from "./tools/definitions.js";
export { sampleGreetingTool, sampleQuickReplyTool } from "./tools/sample-tools.js";
export { calcTool, calcInputSchema, runCalc, MAX_CALC_EXPRESSION_LENGTH, MAX_CALC_OUTPUT_LENGTH, MAX_CALC_TIMEOUT_MS } from "./tools/calc.js";
export { getTimeTool, getTimeInputSchema, runGetTime, unknownTimezoneMessage } from "./tools/get-time.js";
export { loadToolProviders, RequiredToolProviderError } from "./tools/tool-provider.js";
export type {
  ToolProvider,
  ToolProviderFailure,
  LoadToolProvidersResult,
} from "./tools/tool-provider.js";
// Shared helpers: used by core AND by the extracted @cuatoi/web-agent-openapi
// and @cuatoi/web-agent-mcp packages, so they are exported rather than copied.
export { resolveRelativeUrl } from "./utils/resolve-url.js";
export { sanitizeName } from "./utils/sanitize-name.js";


export { createDataSourceProvider } from "./datasource/provider.js";
export type { DataSourceProvider, ProviderOptions } from "./datasource/provider.js";
export { SourceRegistry, summarizeSource } from "./datasource/registry.js";
export type { SourceEntry } from "./datasource/registry.js";
export { runQuery, serializeResult } from "./datasource/query-engine.js";
export { assertNoTopLevelSortOrSelect } from "./datasource/aggregate-guard.js";

export type {
  FieldType,
  FieldSchema,
  FieldAllowEntry,
  UnsupportedField,
  FieldDetailsQuery,
  FieldDetailsResult,
  FieldSampleQuery,
  FieldSampleResult,
  SourceInfo,
  SourceSummary,
  Scalar,
  Condition,
  FilterExpr,
  Dimension,
  MeasureOp,
  Measure,
  Aggregation,
  DataQuery,
  QueryResult,
} from "./datasource/types.js";
export { DataQuerySchema, validateDataQuery } from "./datasource/types.js";
export { selectRequiredForWideSource } from "./tools/error-messages.js";

export {
  DEFAULT_CONFIG,
  DEFAULT_WIDE_SOURCE_FIELD_THRESHOLD,
  defaultBaseURLFor,
} from "./config.js";
export { coreSkills, DEFAULT_SKILLS } from "./skills/default-skills.js";
export { schedulerSkills } from "./skills/scheduler-skills.js";
export type { SkillRegistry } from "./skills/skill-registry.js";
export { LocalStorageSkillRegistry, mergeSkills } from "./skills/skill-registry.js";
export type {
  AgentConfig,
  GenerationConfig,
  ContextConfig,
} from "./config.js";


export { createMockProvider, ECHO_SCRIPT } from "./transport/mock-provider.js";
export type { MockResponse, MockScript } from "./transport/mock-provider.js";
export { wrapProvider, withRetry, isRetryableError } from "./transport/middleware.js";
export type { LanguageModelMiddleware } from "./transport/middleware.js";
export { providerRegistry, setMockScript } from "./transport/registry.js";
export type { ProviderFactory } from "./transport/registry.js";
export { createFallbackProviderFactory } from "./transport/fallback-provider.js";
export type {
  FallbackChainEntry,
  ProviderFallbackNotice,
} from "./transport/fallback-provider.js";
export { createAnthropicLanguageModel } from "./transport/anthropic-provider.js";
export { createOpenAILanguageModel } from "./transport/openai-provider.js";
export { createGeminiLanguageModel } from "./transport/gemini-provider.js";
export type { LanguageModel, ProviderCallOptions, ProviderResult } from "./transport/provider.types.js";
export { modelSupportsVision, imageReachesModel } from "./transport/vision.js";

export {
  runCompaction,
  summariseInCachedConversation,
  hasUnansweredToolUse,
  SUMMARY_INSTRUCTION,
  CompactionError,
} from "./loop/compaction.js";
export type {
  CompactionOutcome,
  CompactionResult,
  CompactionObserver,
  CompactionStats,
  SummarizeFn,
  PageAgent,
} from "./loop/compaction.js";

export { buildSystemPrompt, buildSystemPromptParts } from "./prompt/system-prompt.js";
export type { SystemPromptParts } from "./prompt/system-prompt.js";

export * from "./ui-blocks/schema.js";

export { buttonToMessage, formSubmitToMessage, isInteractive } from "./ui-blocks/bridge.js";

export { parseSlashInput, buildCommandList } from "./commands/slash-commands.js";
export type { CommandEntry } from "./commands/slash-commands.js";

export {
  createAgentSession,
  type MessagePart,
  type SessionMessagePart,
  type CompactionRowStatus,
  type SessionMessage,
  type SessionState,
  type SessionConfig,
  type AgentSession,
  type AvailableTool,
  type SessionEvent,
  type QueuedMessage,
} from "./controller.js";
