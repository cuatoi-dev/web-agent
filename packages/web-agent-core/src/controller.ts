import { loadToolProviders, type LoadToolProvidersResult } from "./tools/tool-provider.js";
import type { SkillDef } from "./tools/skill-def.types.js";
import { loadRegistrySkills } from "./skills/skill-registry.js";
import { buildCommandList } from "./commands/slash-commands.js";
import { createScheduler } from "./scheduler.js";
import { createTodoStore } from "./todo.js";
import type { SessionRuntime } from "./controller-runtime.types.js";
import {
  abort,
  effectiveAttachmentProviders,
  getState,
  notifyListeners,
} from "./controller-state.js";
import {
  autoTitle,
  clearAllSessions,
  createCompactionObserver,
  createSession,
  deleteSession,
  openOrCreateActiveSession,
  persistTodos,
  refreshSessions,
  setTitle,
  switchSession,
} from "./controller-sessions.js";
import { buildConfig, initAgent } from "./controller-config.js";
import { compact, retryLast, send } from "./controller-turn.js";
import {
  cancelQueued,
  clearQueue,
  dropQueuedFromSchedule,
  enqueueCommand,
  enqueueInput,
  maybeDrainQueue,
  popLastQueued,
  runCommand,
} from "./controller-queue.js";
import type {
  AgentSession,
  SessionConfig,
} from "./controller.types.js";
export { buildTitleTranscript } from "./controller-sessions.js";
export type { MessagePart } from "./types.js";
export type {
  AgentSession,
  AvailableTool,
  CompactionRowStatus,
  QueuedMessage,
  SessionConfig,
  SessionEvent,
  SessionMessage,
  SessionMessagePart,
  SessionState,
} from "./controller.types.js";

export function createAgentSession(config: SessionConfig): AgentSession {
  // Every field below was a `let`/`const` in this closure before the split.
  // The parts of the controller now live in sibling modules and share exactly
  // this one object, so the state and its behaviour are unchanged.
  const initialState: Omit<
    SessionRuntime,
    | "agentConfig"
    | "sessionStore"
    | "cm"
    | "ctx"
    | "agent"
    | "compactionObserver"
    | "scheduler"
    | "todoStore"
  > = {
    currentConfig: { ...config },
    providerTools: [],
    resolvedTools: [],
    loadedProviders: [],
    registrySkills: [],

    activeSessionId: "",
    sessionTransition: undefined,
    sessionEpoch: 0,
    running: false,
    streamingText: "",
    queuedMessages: [],
    error: undefined,
    usage: { input: 0, output: 0 },
    sessions: [],
    toolBlocks: new Map(),
    toolBlocksVersion: 0,

    turnCache: new Map(),
    cachedStateMessages: null,
    cachedStateKey: "",
    cachedContextWindow: null,
    cachedContextWindowUsage: null,

    controller: undefined,
    flushedJournalLength: 0,
    flushedSeq: 0,
    lastRecordEntryCount: 0,
    listeners: new Set(),
    eventListeners: new Set(),

    compactionRows: [],
    compactionRowSeq: 0,
    activeCompactionRowId: undefined,
    compactionAbort: undefined,
    compacting: false,
    commandList: buildCommandList([], []),
    compactionRequested: false,
    compactionUnconfirmedAttempts: 0,
    compactionFollowUp: undefined,

    enqueueInput: (input, images, source) => enqueueInput(st, input, images, source),
    maybeDrainQueue: (opts) => maybeDrainQueue(st, opts),
    initAgent: (opts) => initAgent(st, opts),
  };
  const st = initialState as SessionRuntime;

  st.compactionObserver = createCompactionObserver(st);

  st.scheduler = createScheduler({
    isEnabled: () => Boolean(st.currentConfig.scheduler?.enabled),
    enqueueCommand: (name, argument, text, source) =>
      enqueueCommand(st, name, argument, text, source),
    enqueueInput: (text, images, source) => enqueueInput(st, text, images, source),
    isRunning: () => st.running,
    dropQueuedFromSchedule: (name) => dropQueuedFromSchedule(st, name),
    maybeDrainQueue: (opts) => maybeDrainQueue(st, opts),
    notifyListeners: () => notifyListeners(st),
  });

  st.todoStore = createTodoStore({
    initial: [],
    onChange: (items) => persistTodos(st, items),
    onNotify: () => notifyListeners(st),
  });

  buildConfig(st);
  initAgent(st);

  // Each counter numbers the loads of one kind. A load that finishes after a
  // newer one started is stale — `updateConfig()` replaced the list it was
  // loading — so its result is dropped instead of overwriting the newer one.
  let providerLoadSeq = 0;
  let registryLoadSeq = 0;

  /** Loads `st.agentConfig.toolProviders`. Resolves `true` when the result was
   *  applied, `false` when a newer load superseded it. */
  async function loadConfiguredToolProviders(): Promise<boolean> {
    const seq = ++providerLoadSeq;
    let result: LoadToolProvidersResult;
    try {
      result = await loadToolProviders(st.agentConfig.toolProviders);
    } catch (err) {
      // A superseded load's failure no longer describes this session.
      if (seq !== providerLoadSeq) return false;
      throw err;
    }
    if (seq !== providerLoadSeq) {
      void Promise.allSettled(result.loaded.map((p) => p.dispose?.()) as Promise<void>[]);
      return false;
    }
    st.providerTools = result.tools;
    st.loadedProviders = result.loaded;
    // Providers can also register attachmentProviders (006) — rebuild agentConfig
    // so their onUserPrompt handlers are composed into hooks before turn 1.
    // buildConfig() ran once synchronously (before providers were loaded), so
    // effectiveAttachmentProviders() only sees them from here.
    buildConfig(st);
    if (st.providerTools.length > 0) {
      // Same reason: rebuild so turn 1 already has these tools and their
      // prompt snippets, and do it BEFORE openOrCreateActiveSession(). 001/113
      // — `preserveJournal: true` because a send() invoked in this startup
      // window must not be orphaned onto a `cm` this rebuild throws away.
      initAgent(st, { preserveJournal: true });
    }
    return true;
  }

  /** Applies a registry read. Resolves `false` and changes nothing when a newer
   *  read (from `updateConfig({ skillRegistry })`) superseded this one. */
  async function loadConfiguredSkillRegistry(skills: SkillDef[], seq: number): Promise<boolean> {
    // `require-await`: initAgent() below can throw synchronously, so dropping
    // `async` would turn that into a synchronous throw instead of a rejection.
    await Promise.resolve();
    if (seq !== registryLoadSeq) return false;
    st.registrySkills = skills;
    if (st.registrySkills.length > 0) {
      // Rebuild so turn 1 already has these skills in ctx.skills and in the
      // `# Skills` prompt section, and do it BEFORE openOrCreateActiveSession().
      // 001/113 — `preserveJournal: true`, same reason as the tool-provider
      // rebuild above: this read is a real `chrome.storage.local` round trip,
      // wide enough for a send() to land on the pre-rebuild `cm` and be
      // silently orphaned when this call replaced it.
      initAgent(st, { preserveJournal: true });
    }
    return true;
  }

  const initPromise = (async () => {
    // Started in the same tick as the tool-provider loads so a slow registry
    // never serialises behind them. loadRegistrySkills() never rejects, so a
    // required-provider failure below can abandon this promise safely.
    const registrySeq = ++registryLoadSeq;
    const registryPromise = loadRegistrySkills(st.currentConfig.skillRegistry);
    try {
      await loadConfiguredToolProviders();
    } catch (err) {
      // required: true failed — a hard startup error, surfaced loudly.
      const message = err instanceof Error ? err.message : String(err);
      console.error("[tools] tool provider startup failed:", err);
      st.error = message;
      notifyListeners(st);
      throw err;
    }
    await loadConfiguredSkillRegistry(await registryPromise, registrySeq);
    await openOrCreateActiveSession(st);
  })();
  // Mark the rejection handled so a host that never awaits initPromise does not
  // trip an unhandled-rejection warning. Awaiters still receive the rejection.
  initPromise.catch(() => {});

  /** Disposes the loaded tool providers and the attachment providers they
   *  registered, and forgets their tools. `dispose()` below does the same for
   *  the whole session. */
  function disposeLoadedToolProviders(): void {
    const toDispose = st.loadedProviders;
    st.loadedProviders = [];
    st.providerTools = [];
    for (const p of toDispose.flatMap((tp) => tp.attachmentProviders ?? [])) {
      try { p.dispose?.(); } catch (err) { console.error("[attachments] dispose failed:", err); }
    }
    void Promise.allSettled(toDispose.map((p) => p.dispose?.()) as Promise<void>[]);
  }

  /** Loads a replaced `toolProviders` list through the same path session start
   *  uses. A `required: true` failure is reported the way startup reports it,
   *  but nothing rejects: `updateConfig()` is synchronous. */
  async function reloadToolProviders(): Promise<void> {
    try {
      if (!(await loadConfiguredToolProviders())) return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[tools] tool provider reload failed:", err);
      st.error = message;
      notifyListeners(st);
      return;
    }
    // Rebuild even when the new list produced no tools: buildConfig() inside
    // the load re-composed the attachment-provider hooks, and the agent must
    // be rebuilt to use them.
    initAgent(st, { preserveJournal: true });
    notifyListeners(st);
  }

  /** Reads a replaced `skillRegistry` through the same path session start uses. */
  async function reloadSkillRegistry(): Promise<void> {
    const seq = ++registryLoadSeq;
    const skills = await loadRegistrySkills(st.currentConfig.skillRegistry);
    if (!(await loadConfiguredSkillRegistry(skills, seq))) return;
    notifyListeners(st);
  }

  function doUpdateConfig(patch: Partial<SessionConfig>) {
    const prev = st.currentConfig;
    st.currentConfig = { ...prev, ...patch };
    const providersChanged =
      "toolProviders" in patch && patch.toolProviders !== prev.toolProviders;
    const registryChanged =
      "skillRegistry" in patch && patch.skillRegistry !== prev.skillRegistry;
    // Drop the old lists BEFORE the rebuild below, so the agent built here
    // never offers a tool from a provider that is being disposed, or a skill
    // from a registry that was replaced.
    if (providersChanged) disposeLoadedToolProviders();
    if (registryChanged) st.registrySkills = [];
    buildConfig(st);
    // A config change never resets the conversation. A new conversation is
    // an explicit createSession() / reset().
    initAgent(st, { preserveJournal: true });
    notifyListeners(st);
    if (providersChanged) {
      reloadToolProviders().catch((err: unknown) => {
        console.error("[tools] tool provider reload failed:", err);
      });
    }
    if (registryChanged) {
      reloadSkillRegistry().catch((err: unknown) => {
        console.error("[skills] skill registry reload failed:", err);
      });
    }
  }

  function doSetModel(id: string) {
    if (!id || id === st.agentConfig.model) return;
    // In place: mutate the live agent + configs so the NEXT turn, compaction
    // (summariseInCachedConversation), and autoTitle all use `id`, WITHOUT
    // calling buildConfig()/initAgent(). The transport instance and the turn
    // caches stay as they are. The conversation survives either way, because
    // doUpdateConfig() keeps the journal too.
    st.agent.setModel(id);
    st.agentConfig.model = id;
    st.currentConfig.model = id;
    notifyListeners(st);
  }

  async function reset(): Promise<void> {
    await createSession(st);
  }

  return {
    getState: () => getState(st),
    subscribe(listener) {
      st.listeners.add(listener);
      listener(getState(st));
      return () => {
        st.listeners.delete(listener);
      };
    },
    subscribeEvents(listener) {
      st.eventListeners.add(listener);
      return () => {
        st.eventListeners.delete(listener);
      };
    },
    send: (parts, opts) => send(st, parts, opts),
    retryLast: () => retryLast(st),
    abort: () => abort(st),
    compact: () => compact(st),
    reset,
    createSession: () => createSession(st),
    switchSession: (id) => switchSession(st, id),
    deleteSession: (id) => deleteSession(st, id),
    clearAllSessions: () => clearAllSessions(st),
    setTitle: (id, t) => setTitle(st, id, t),
    refreshSessions: () => refreshSessions(st),
    updateConfig: doUpdateConfig,
    setModel: doSetModel,
    dispose() {
      abort(st);
      st.scheduler.clearAll();
      st.listeners.clear();
      st.eventListeners.clear();
      const attachmentProvidersToDispose = effectiveAttachmentProviders(st);
      const toDispose = st.loadedProviders;
      st.loadedProviders = [];
      void Promise.allSettled(toDispose.map((p) => p.dispose?.()) as Promise<void>[]);
      for (const p of attachmentProvidersToDispose) {
        try { p.dispose?.(); } catch (err) { console.error("[attachments] dispose failed:", err); }
      }
    },
    initPromise,
    autoTitle: () => autoTitle(st),
    cancelQueued: (id) => cancelQueued(st, id),
    popLastQueued: () => popLastQueued(st),
    clearQueue: () => clearQueue(st),
    commands: () => st.commandList.entries,
    resolveCommand: (typedName: string) => st.commandList.resolve(typedName),
    enqueueCommand: (name, argument, text, source) =>
      enqueueCommand(st, name, argument, text, source),
    runCommand: (entry, argument) => runCommand(st, entry, argument),
    pendingCounts: () => st.scheduler.pendingCounts(),
    todos: () => st.todoStore.items(),
    getAttachmentProviders: () => effectiveAttachmentProviders(st),
    availableTools: () => st.resolvedTools.map((t) => ({ ...t })),
  };
}
