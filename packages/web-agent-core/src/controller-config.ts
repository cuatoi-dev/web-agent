// Building the resolved `AgentConfig` from the host's `SessionConfig`, and
// (re)building the agent, the tool context and the command list from it. Moved
// out of `controller.ts` unchanged — each former closure variable is now read
// from the `SessionRuntime` passed in.
import { ContextManager } from "./loop/context-manager.js";
import { createPageAgent } from "./loop/agent.js";
import { IdbSessionStore } from "./loop/session-store.js";
import { AgentConfig, DEFAULT_CONFIG, defaultBaseURLFor } from "./config.js";
import { ToolContext } from "./tools/build-tools.js";
import { defaultTools } from "./tools/builders.js";
import { coreSkills } from "./skills/default-skills.js";
import { mergeSkills } from "./skills/skill-registry.js";
import { buildCommandList } from "./commands/slash-commands.js";
import { schedulerSkills } from "./skills/scheduler-skills.js";
import { createDataSourceProvider } from "./datasource/provider.js";
import { toHookArray } from "./hooks/run-hooks.js";
import type { HookHandler, PostToolPayload, PostToolResult, UserPromptPayload, UserPromptResult } from "./hooks/types.js";
import type { ProviderFallbackNotice } from "./transport/fallback-provider.types.js";
import type { SessionRuntime } from "./controller-runtime.types.js";
import { effectiveAttachmentProviders, emitEvent, notifyListeners } from "./controller-state.js";
import { coreCommandDefs } from "./controller-queue.js";
import { toAvailableTools } from "./controller-tools.js";

export function buildConfig(st: SessionRuntime) {
  const endpointType = st.currentConfig.endpointType || DEFAULT_CONFIG.endpointType;
  const baseURL = st.currentConfig.baseURL ||
    (endpointType === "mock" ? "" : defaultBaseURLFor(endpointType as "anthropic" | "openai"));
  // Attachment and loaded tool providers run before the host's prompt hooks.
  // The same order applies to post-tool hooks: loaded provider handlers run
  // before the host's, so a host handler sees a provider's replaced outcome.
  // Composed into agentConfig ONLY — buildConfig()
  // re-runs on every updateConfig(), and mutating currentConfig.hooks here would
  // append the same handlers again on each call.
  const attachmentProviders = effectiveAttachmentProviders(st);
  const toolProviderHooks = st.loadedProviders
    .map((p) => p.hooks?.onUserPrompt)
    .filter((h): h is HookHandler<UserPromptPayload, UserPromptResult | void> => typeof h === "function");
  const hostHooks = toHookArray(st.currentConfig.hooks?.onUserPrompt) as HookHandler<UserPromptPayload, UserPromptResult | void>[];
  const onUserPromptHandlers: HookHandler<UserPromptPayload, UserPromptResult | void>[] = [
    ...attachmentProviders.map((p) => p.onUserPrompt),
    ...toolProviderHooks,
    ...hostHooks,
  ];
  const onPostToolHandlers: HookHandler<PostToolPayload, PostToolResult | void>[] = [
    ...st.loadedProviders
      .map((p) => p.hooks?.onPostTool)
      .filter((h): h is HookHandler<PostToolPayload, PostToolResult | void> => typeof h === "function"),
    ...toHookArray(st.currentConfig.hooks?.onPostTool) as HookHandler<PostToolPayload, PostToolResult | void>[],
  ];
  const hooks = onUserPromptHandlers.length === 0 && onPostToolHandlers.length === 0
    ? st.currentConfig.hooks
    : {
        ...st.currentConfig.hooks,
        ...(onUserPromptHandlers.length ? { onUserPrompt: onUserPromptHandlers } : {}),
        ...(onPostToolHandlers.length ? { onPostTool: onPostToolHandlers } : {}),
      };
  st.agentConfig = {
    ...DEFAULT_CONFIG,
    ...st.currentConfig,
    baseURL,
    endpointType,
    hooks,
    thinking: st.currentConfig.thinking ?? DEFAULT_CONFIG.thinking,
    generation: {
      ...DEFAULT_CONFIG.generation,
      ...st.currentConfig.generation,
      ...(st.currentConfig.maxRetries !== undefined && st.currentConfig.generation?.maxRetries === undefined
        ? { maxRetries: st.currentConfig.maxRetries }
        : {}),
    },
    cues: st.currentConfig.cues ?? DEFAULT_CONFIG.cues,
    imageInput: st.currentConfig.imageInput ?? DEFAULT_CONFIG.imageInput,
    persist: st.currentConfig.persist ?? DEFAULT_CONFIG.persist,
    streaming: st.currentConfig.streaming ?? DEFAULT_CONFIG.streaming,
    fetch: st.currentConfig.fetch,
    onRetryAttempt: (attempt: number, maxRetries: number, error: unknown) => {
      // A retry that fires AFTER a stream-idle-timeout (006) can follow a
      // partial answer already shown live — the failed attempt is thrown
      // away, not appended to, so its partial text must not survive into
      // the next attempt's preview. A pre-content retry (a dead/empty
      // stream) finds this already empty, so clearing it here is a no-op
      // in that case and the fix in the case that matters.
      st.streamingText = "";
      const errorMsg = error instanceof Error ? error.message : String(error);
      emitEvent(st, {
        type: "auto-retry:attempt",
        attempt,
        maxRetries,
        error: { message: errorMsg },
      });
      notifyListeners(st);
    },
    onProviderFallback: (notice: ProviderFallbackNotice) => {
      emitEvent(st, {
        type: "provider:fallback",
        failed: notice.failed,
        ...(notice.answered ? { answered: notice.answered } : {}),
      });
    },
    // `model` is genuinely optional at this point — SessionConfig extends
    // Partial<AgentConfig>, so a caller can omit it — and the check right
    // below throws before any code reads agentConfig.model as a string.
    // The cast documents that gap instead of hiding it behind `any`.
  } as AgentConfig & { fetch?: typeof fetch };

  if (!st.agentConfig.model) {
    throw new Error(
      '[web-agent] Missing required config: "model". Core ships no default ' +
        'model — set `model` on the session config (for example ' +
        'panel.model = "your-model-id").',
    );
  }

  if (st.agentConfig.persist) {
    st.sessionStore = st.currentConfig.sessionStore ?? st.agentConfig.sessionStore ?? new IdbSessionStore(st.currentConfig.sessionNamespace);
  } else {
    st.sessionStore = undefined;
  }
}

export function initAgent(st: SessionRuntime, opts?: { preserveJournal?: boolean }) {
  // 001/113 live-proof finding — `initAgent()` used to replace `st.cm`
  // unconditionally on every call. `loadConfiguredToolProviders()` and
  // `loadConfiguredSkillRegistry()` (controller.ts) both call this again,
  // asynchronously, after session creation, to fold in tools/skills that
  // were not ready yet. A `send()` invoked in that startup window (e.g. a
  // programmatic send arriving the instant a bubble mounts) runs against the
  // FIRST `st.cm`; when the async re-run then swaps in a brand-new empty one,
  // the turn keeps writing to the now-orphaned old `cm` and the session
  // silently shows zero messages forever, while the send's own promise
  // never resolves either way — a real defect, not a flaky test, caught by
  // this task's live proof (which seeds a skill registry entry, widening the
  // window past a real `chrome.storage.local` round trip). Both of those two
  // startup call sites pass `preserveJournal: true` so an in-flight or
  // already-recorded turn is never orphaned. `doUpdateConfig` passes it too:
  // a config change never resets the conversation. Only the first call, from
  // createAgentSession(), builds `st.cm` here; a new conversation is an
  // explicit createSession() / reset().
  if (!opts?.preserveJournal || !st.cm) {
    st.cm = new ContextManager(st.agentConfig.context);
  }
  st.turnCache.clear();
  st.cachedStateMessages = null;
  st.cachedStateKey = "";
  st.cachedContextWindow = null;
  st.cachedContextWindowUsage = null;

  const dataSource = createDataSourceProvider({
    getState: () => (st.currentConfig.store?.getState?.() ?? {}) as Record<string, unknown>,
    sources: st.currentConfig.sources || [],
  });

  st.ctx = {
    dataSource,
    // 069/001 — a GETTER, not a field. `switchSession()` reassigns
    // `st.activeSessionId` without rebuilding `st.ctx`, so a field written here
    // would keep reporting the chat that was active when the agent was
    // built. Getter-only on purpose: nothing assigns `ctx.sessionId`.
    get sessionId() {
      return st.activeSessionId;
    },
    app: {
      appName: st.currentConfig.appContext?.appName || "Web Application",
      appDescription: st.currentConfig.appContext?.appDescription || "An interactive web application.",
      // Read by `buildSystemPromptParts` to render the `# App instructions`
      // section (prompt/system-prompt.ts:121). This field was missing from
      // this literal, so a host's `appContext.appInstructions` was silently
      // dropped here and that section was never emitted — both ends were
      // unit-tested, only this seam was not.
      appInstructions: st.currentConfig.appContext?.appInstructions,
      route: (st.currentConfig.store?.getState?.() as { ui?: { route?: string } } | undefined)?.ui?.route || "/",
      userName: st.currentConfig.appContext?.userName,
      userInfo: st.currentConfig.appContext?.userInfo,
    },
    signal: new AbortController().signal,
    queryResultMaxChars: st.agentConfig.queryResultMaxChars,
    wideSourceFieldThreshold: st.agentConfig.wideSourceFieldThreshold,
    skillRegistry: st.currentConfig.skillRegistry,
    confirmInteraction: st.currentConfig.confirmInteraction,
    _onToolBlock: (toolCallId, block) => {
      st.toolBlocks.set(toolCallId, block);
      st.toolBlocksVersion++;
      notifyListeners(st);
    },
    // 108/001 — ONE decision point. This is the only place that can see the
    // confirmation counter, whether a compaction is already running, whether
    // this turn already asked, and whether anything is eligible, so the
    // verdict is computed here and the tool only renders it.
    _requestCompaction: (confirmed, followUp) => {
      // The confirmation gate comes FIRST and changes no state but its own
      // counter. An unconfirmed call is a question, not an attempt: it must
      // not set compactionRequested, must not record a follow-up, and must
      // not reveal whether there is anything to compact.
      if (!confirmed) {
        st.compactionUnconfirmedAttempts++;
        return st.compactionUnconfirmedAttempts > 1
          ? "unconfirmed-repeat"
          : "needs-confirmation";
      }
      if (st.compacting) return "in-progress";
      if (st.compactionRequested) return "already-requested";
      if (!st.cm.hasCompactableTurns()) return "nothing-to-compact";
      st.compactionRequested = true;
      // A follow-up is recorded ONLY on an accepted request. Attached to a
      // refused one it would either run the long process without the room it
      // asked for, or run twice once the model retried with confirmation.
      st.compactionFollowUp = followUp?.trim() || undefined;
      return "requested";
    },
    _scheduler: st.currentConfig.scheduler?.enabled ? st.scheduler : undefined,
    _todos: st.currentConfig.todo?.enabled ? st.todoStore : undefined,
  };

  // Tool-provider tools are appended to whatever the host's factory returns.
  // A shallow copy (not a mutation of agentConfig.tools) keeps this idempotent
  // — initAgent() runs again after each load step and on every updateConfig().
  // Provider tools go last so that buildTools' first-wins duplicate handling
  // leaves a built-in tool of the same name in place.
  const baseToolsFactory = st.agentConfig.tools ?? defaultTools;
  // Registry skills are merged OVER the host's list, so a stored skill with
  // the same name replaces the host's definition. Skipped entirely when the
  // registry produced nothing, so a session with no registry passes
  // agentConfig through untouched and `cfg.skills ?? coreSkills()` in
  // createPageAgent still decides.
  const mergedSkills =
    st.registrySkills.length > 0
      ? mergeSkills(st.agentConfig.skills ?? coreSkills(), st.registrySkills)
      : undefined;

  // 105/001 — the command list is built from the SAME merged list the agent
  // gets, but the FULL one: `disableModelInvocation` hides a skill from the
  // model, never from the person typing.
  // 109/004 — scheduler commands are added when scheduler is enabled.
  const schedulerCmdSkills = st.currentConfig.scheduler?.enabled ? schedulerSkills() : [];
  st.commandList = buildCommandList(
    coreCommandDefs(st),
    [
      ...(mergedSkills ?? st.agentConfig.skills ?? coreSkills()),
      ...schedulerCmdSkills,
    ],
  );
  const cfgForAgent =
    st.providerTools.length > 0 || mergedSkills
      ? {
          ...st.agentConfig,
          ...(st.providerTools.length > 0
            ? {
                tools: (c: ToolContext) => [
                  ...baseToolsFactory(c),
                  ...st.providerTools,
                ],
              }
            : {}),
          ...(mergedSkills ? { skills: mergedSkills } : {}),
        }
      : st.agentConfig;
  st.agent = createPageAgent(cfgForAgent, st.ctx, st.cm);
  // 069/001 — seed resolvedTools from the agent just built, so a saved step
  // line's own phrase resolves right after session construction/restore
  // (a page reload), before any turn runs. Without this, session.availableTools()
  // stayed [] until driveTurn()'s per-turn snapshot (controller-turn.ts), and a
  // restored history line fell back to "used the tool <name>".
  st.resolvedTools = toAvailableTools(st.agent.customToolDefs);
}
