import { type AgentConfig } from "../config.js";
import { AgentError, agentErrorLabel, mapToAgentError } from "./errors.js";
import { buildTools } from "../tools/build-tools.js";
import type { ToolContext, AppContext } from "../tools/types.js";
import { argumentsUnparsable } from "../tools/error-messages.js";
import { defaultTools } from "../tools/builders.js";
import { coreSkills } from "../skills/default-skills.js";
import { modelVisibleSkills } from "../skills/skill-registry.js";
import { ContextManager } from "./context-manager.js";
import type { AuditEntry, StepToolResult } from "./types.js";
import { buildSystemPromptParts } from "../prompt/system-prompt.js";
import type { ModelMessage, ContentPart, ToolResultPart, ToolImage } from "../types.js";
import { providerRegistry } from "../transport/registry.js";
import type { LanguageModel, ProviderCallOptions } from "../transport/provider.types.js";
import type { AnthropicLanguageModel } from "../transport/anthropic-provider.js";
import { imageReachesModel, modelSupportsVision } from "../transport/vision.js";

// ---------------------------------------------------------------------------
// Helper: build the standard generation settings from config + app.
// Used by BOTH runBareTurn and createPageAgent.
// ---------------------------------------------------------------------------
export function buildGenerateSettings(
  cfg: AgentConfig,
  app?: AppContext,
  toolSnippets?: string[],
  toolNames?: string[],
): {
  model: string;
  instructions: string;
  maxRetries: number;
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  stopSequences?: string[];
  frequencyPenalty?: number;
  presencePenalty?: number;
  seed?: number;
  /** Anthropic STATIC block (byte-stable, cache breakpoint A). undefined when no app. */
  systemStatic?: string;
  /** Anthropic DYNAMIC block (route, cache breakpoint B). undefined when no app. */
  systemDynamic?: string;
} {
  const gen = cfg.generation || {};

  // Build system instructions: base prompt + optional appended prompt
  // P8: the `# Skills` prompt section is model-facing, so opted-out skills
  // are not listed.
  const skills = modelVisibleSkills(cfg.skills ?? coreSkills());
  const append = cfg.appendSystemPrompt ? "\n\n" + cfg.appendSystemPrompt : "";
  const parts = app
    ? buildSystemPromptParts(app, {
        blockGuidelines: cfg.blockGuidelines,
        imageInput: cfg.imageInput,
        toolSnippets,
        skills,
        toolNames,
      })
    : undefined;
  const instructions = parts ? parts.full + append : (cfg.appendSystemPrompt || "");

  return {
    model: cfg.model,
    instructions,
    // Anthropic cache split (append belongs in the STATIC block — it is stable)
    systemStatic: parts ? parts.static + append : undefined,
    systemDynamic: parts ? parts.dynamic : undefined,
    // Generation knobs
    temperature: gen.temperature,
    topP: gen.topP,
    topK: gen.topK,
    maxOutputTokens: gen.maxOutputTokens,
    stopSequences: gen.stopSequences,
    frequencyPenalty: gen.frequencyPenalty,
    presencePenalty: gen.presencePenalty,
    seed: gen.seed,
    maxRetries: gen.maxRetries ?? 3,
  };
}

// Helper to derive audits from step result
function deriveAudit(step: { toolResults: StepToolResult[] }): AuditEntry[] {
  const list: AuditEntry[] = [];
  const ts = Date.now();
  if (step.toolResults && Array.isArray(step.toolResults)) {
    for (const tr of step.toolResults) {
      let outputVal = "";
      if (tr.output !== undefined && tr.output !== null) {
        if (typeof tr.output === "string") {
          outputVal = tr.output;
        } else if (typeof tr.output === "object") {
          if ("value" in tr.output) {
            outputVal = String((tr.output as { value: unknown }).value);
          } else if ("content" in tr.output) {
            outputVal = String((tr.output as { content: unknown }).content);
          } else {
            outputVal = JSON.stringify(tr.output);
          }
        } else {
          outputVal = String(tr.output);
        }
      }

      list.push({
        ts,
        name: tr.toolName,
        input: tr.input,
        outcomeSummary: outputVal,
        failed: tr.failed ?? false,
        unknownTool: tr.unknownTool,
      });
    }
  }
  return list;
}

export function createPageAgent(cfg: AgentConfig, ctx: ToolContext, cm: ContextManager) {
  // P8: ctx.skills is what search_skills and load_skill read, so opted-out
  // skills are absent from both. The user-facing command list is built in the
  // controller from the FULL list and is unaffected.
  const skills = modelVisibleSkills(cfg.skills ?? coreSkills());
  ctx.imageInput = ctx.imageInput ?? cfg.imageInput;
  ctx.skills = skills;
  ctx.hooks = ctx.hooks ?? cfg.hooks;
  ctx.queryResultMaxChars = ctx.queryResultMaxChars ?? cfg.queryResultMaxChars;
  ctx.wideSourceFieldThreshold = ctx.wideSourceFieldThreshold ?? cfg.wideSourceFieldThreshold;
  ctx.skillRegistry = ctx.skillRegistry ?? cfg.skillRegistry;
  ctx.confirmInteraction = ctx.confirmInteraction ?? cfg.confirmInteraction;
  const defs = (cfg.tools ?? defaultTools)(ctx);
  const toolSnippets = defs
    .map((d) => d.promptSnippet)
    .filter((s): s is string => !!s);
  const toolNames = defs.map((d) => d.name);
  const settings = buildGenerateSettings(cfg, ctx.app, toolSnippets, toolNames);
  const { tools: toolDefs, executors } = buildTools(ctx, defs);

  // Provider model — swappable at runtime for tests (_client / _model seams).
  let _model: LanguageModel = providerRegistry.get(cfg, { fetch: cfg.fetch });
  // Runtime-swappable active model id. Initialised from config; changed
  // via setModel() for the NEXT turn without rebuilding the transport/session.
  let _modelId: string = cfg.model;

  let prevMsgCount = 0;

  /**
   * Build the exact `ProviderCallOptions` a live turn sends for `messages` —
   * same `tools`, same `systemPrompt`/`providerOptions` (so cache breakpoints
   * A/B land on identical blocks), same model. `overrides`
   * may replace `maxOutputTokens` and `abortSignal` — nothing else, since any
   * other difference breaks Anthropic's tools→system→messages cache prefix.
   *
   * Compaction (`loop/compaction.ts`) calls this with the composed history
   * plus one appended user turn, so its request reads that same cached
   * prefix instead of a from-scratch prompt. One builder, every caller — a
   * hand-rebuilt copy would silently drift the moment a turn-only field is
   * added here.
   */
  function buildCallOptions(
    messages: ModelMessage[],
    overrides?: { maxOutputTokens?: number; abortSignal?: AbortSignal },
  ): ProviderCallOptions {
    const thinkingEnabled = !!cfg.thinking?.enabled;
    const anthropicPO: Record<string, unknown> = {};
    if (settings.systemStatic) {
      anthropicPO.systemStatic = settings.systemStatic;
      if (settings.systemDynamic) anthropicPO.systemDynamic = settings.systemDynamic;
    }
    if (thinkingEnabled) {
      anthropicPO.thinking = { type: "enabled", budget_tokens: cfg.thinking?.budgetTokens ?? 1024 };
    }
    return {
      messages,
      systemPrompt: settings.instructions || "",
      model: _modelId,
      tools: toolDefs.length > 0 ? toolDefs : undefined,
      maxOutputTokens: overrides?.maxOutputTokens ?? settings.maxOutputTokens ?? 4096,
      ...(Object.keys(anthropicPO).length ? { providerOptions: { anthropic: anthropicPO } } : {}),
      ...(thinkingEnabled
        ? {}
        : { temperature: settings.temperature, topP: settings.topP, topK: settings.topK }),
      stopSequences: settings.stopSequences,
      abortSignal: overrides?.abortSignal,
    };
  }

  const agent = {
    // Backward-compat seam: tests set (agent as any)._client directly.
    // Forward the get/set to the underlying AnthropicLanguageModel._client.
    get _client() { return (_model as AnthropicLanguageModel)._client; },
    set _client(c: AnthropicLanguageModel["_client"]) { (_model as AnthropicLanguageModel)._client = c; },
    // Advanced seam: swap the entire model (e.g. mock LanguageModel in unit tests).
    get _model() { return _model; },
    set _model(m: LanguageModel) { _model = m; },
    // Runtime model swap: read the active id, or change it for the next turn.
    get modelId() { return _modelId; },
    setModel(id: string) { _modelId = id; },
    // Exposed so compaction (loop/compaction.ts) can build a request that
    // reads the identical cached tools/system/messages prefix — see the
    // buildCallOptions doc comment above.
    buildCallOptions,
    // The tool definitions this agent was built with. The controller
    // hands them to cm.redactExpiredResults(), so the context manager reads
    // `ttl`/`uttl` off the definition instead of knowing any tool by name.
    // `defs` is built at :139 from `(cfg.tools ?? defaultTools)(ctx)`, and the
    // controller rebuilds the whole agent whenever the tool list changes.
    customToolDefs: defs,
    async callModel(opts: ProviderCallOptions) { return _model.generate(opts); },

    async generate(opts: { messages: ModelMessage[]; abortSignal: AbortSignal; onStep?: () => void }) {
      const { abortSignal } = opts;
      const workingMessages: ModelMessage[] = [...opts.messages];
      const accumulatedMessages: ModelMessage[] = [];
      const steps: Array<{
        finishReason: "tool-calls" | "stop";
        usage: {
          inputTokens: number;
          outputTokens: number;
          cacheReadTokens?: number;
          cacheCreationTokens?: number;
        };
      }> = [];

      prevMsgCount = 0; // reset per generate() call (prepareStep stepNumber===0 equiv)

      // Every image a tool returned in the previous step, in call order.
      // Replaces ctx._pendingImage. Sent once, on the next model call only.
      let pendingImages: Array<ToolImage & { toolName: string }> = [];

      for (let i = 0; i < cfg.maxIterations; i++) {
        // ---- prepareStep equivalent ----
        // Send every image the previous step's tools returned as one user
        // message, each after its own label. The message lives in stepMessages
        // only, so it is never journaled and each image is sent once.
        let stepMessages = workingMessages;
        if (pendingImages.length > 0 && workingMessages.length > 0) {
          const content: ContentPart[] = [];
          if (imageReachesModel(cfg.imageInput, modelSupportsVision(cfg.endpointType, _modelId))) {
            for (const p of pendingImages) {
              content.push({ type: "text", text: `Image from tool ${p.toolName}:` });
              content.push({ type: "image", image: p.dataUrl, mediaType: p.mediaType });
            }
          }
          if (content.length > 0) {
            stepMessages = [...workingMessages, { role: "user" as const, content }];
          }
          pendingImages = [];
        }

        // Convert our messages to Anthropic format via the shared builder —
        // same tools/system/providerOptions compaction reuses (see
        // buildCallOptions above), so this is the one place that shape is
        // assembled.
        const callOpts: ProviderCallOptions = buildCallOptions(stepMessages, { abortSignal });

        let genResult: import("../transport/provider.types.js").ProviderResult;
        try {
          if (abortSignal.aborted) {
            throw new DOMException("The user aborted a request.", "AbortError");
          }
          genResult = await _model.generate(callOpts);
        } catch (err) {
          throw mapToAgentError(err);
        }

        const stepUsage = {
          inputTokens: genResult.usage.inputTokens,
          outputTokens: genResult.usage.outputTokens,
          cacheReadTokens: genResult.usage.cachedInputTokens,   // normalized rename
          cacheCreationTokens: genResult.usage.cacheCreationTokens,
        };
        cm.recordUsage(stepUsage);

        // ---- Build assistant message ----
        const assistantContent: ContentPart[] = [];
        for (const block of genResult.content) {
          if (block.type === "text") {
            assistantContent.push({ type: "text", text: block.text });
          } else if (block.type === "tool_use") {
            assistantContent.push({
              type: "tool-call",
              toolCallId: block.id,
              toolName: block.name,
              input: block.input,
              ...(block.extra_content ? { extra_content: block.extra_content } : {}),
            });
          } else if (block.type === "thinking") {
            assistantContent.push({
              type: "thinking",
              thinking: block.thinking,
              signature: block.signature ?? "",
            });
          } else if (block.type === "redacted_thinking") {
            assistantContent.push({
              type: "redacted_thinking",
              data: block.data,
            });
          }
        }
        const assistantMsg: ModelMessage = { role: "assistant", content: assistantContent };
        const stepNewMessages: ModelMessage[] = [assistantMsg];
        const stepToolResults: StepToolResult[] = [];
        const imagesByCallId: Record<string, ToolImage[]> = {};

        // ---- Execute tools if finishReason === "tool-calls" ----
        if (genResult.finishReason === "tool-calls") {
          const toolResultParts: ToolResultPart[] = [];
          const executedCallIds = new Set<string>();
          for (const block of genResult.content) {
            if (block.type !== "tool_use") continue;
            if (executedCallIds.has(block.id)) continue;
            executedCallIds.add(block.id);
            const executor = executors[block.name];
            let output: string;
            let isError: boolean;
            let unknownTool = false;
            if (block.argumentsIssue === "unparsable") {
              // Transport could not parse the arguments the model sent and
              // substituted `{}` (the `argumentsIssue` marker). Running the tool on `{}`
              // would be running a call the model never made, and letting `{}`
              // reach schema validation would answer "missing required
              // property" for an argument the model DID send. Answer with the
              // parse failure instead, and never enter the tool.
              //
              // `argumentsIssue === "empty"` deliberately does NOT take this
              // branch: it means the model sent no argument JSON at all, so `{}`
              // is a faithful reading — valid for an all-optional schema, and
              // honestly reported as a missing property otherwise.
              output = argumentsUnparsable(block.name);
              isError = true;
            } else if (executor) {
              const result = await executor(block.input, {
                abortSignal,
                toolCallId: block.id,
              });
              output = result.content;
              isError = result.isError === true;
              if (result.images && result.images.length > 0) {
                imagesByCallId[block.id] = result.images;
                for (const img of result.images) {
                  pendingImages.push({ toolName: block.name, dataUrl: img.dataUrl, mediaType: img.mediaType });
                }
              }
            } else {
              output = `Unknown tool: ${block.name}`;
              isError = true;
              unknownTool = true;
            }
            toolResultParts.push({
              type: "tool-result",
              toolCallId: block.id,
              toolName: block.name,
              output,
              ...(isError ? { isError: true } : {}),
            });
            stepToolResults.push({
              toolCallId: block.id,
              toolName: block.name,
              input: block.input,
              output,
              failed: isError,
              unknownTool,
            });
          }
          stepNewMessages.push({ role: "tool", content: toolResultParts });
        }

        // Append new messages to the working conversation (feeds next iteration)
        workingMessages.push(...stepNewMessages);
        // Track all new messages accumulated this turn (for response.messages + delta)
        accumulatedMessages.push(...stepNewMessages);

        // ---- onStepFinish equivalent: delta-slice + cm.recordStep ----
        const delta = accumulatedMessages.slice(prevMsgCount);
        prevMsgCount = accumulatedMessages.length;
        cm.recordStep(delta, deriveAudit({ toolResults: stepToolResults }), imagesByCallId);
        // Live repaint seam: let the host repaint the transcript the moment
        // this step's messages are journaled, instead of waiting for turn end.
        opts.onStep?.();

        steps.push({
          finishReason: genResult.finishReason === "tool-calls" ? "tool-calls" : "stop",
          usage: stepUsage,
        });

        if (genResult.finishReason !== "tool-calls") break;
      }

      // Extract final text from the last assistant message in workingMessages
      const lastMsg = workingMessages[workingMessages.length - 1];
      let text = "";
      if (lastMsg?.role === "assistant") {
        const parts = Array.isArray(lastMsg.content) ? (lastMsg.content) : [];
        text = parts
          .filter((p): p is Extract<ContentPart, { type: "text" }> => p.type === "text")
          .map((p) => p.text)
          .join("");
      }

      return {
        text,
        response: { messages: accumulatedMessages },
        steps,
      };
    },
  };

  return agent;
}

/**
 * Run a bare, zero-tool single turn.
 * Returns the assistant text reply.
 */
export async function runBareTurn(
  prompt: string,
  cfg: AgentConfig,
  opts?: { fetch?: typeof fetch; signal?: AbortSignal },
): Promise<string> {
  const settings = buildGenerateSettings(cfg, undefined);
  const model = providerRegistry.get(cfg, { fetch: opts?.fetch ?? cfg.fetch });
  const thinkingEnabled = !!cfg.thinking?.enabled;

  if (opts?.signal?.aborted) {
    throw new AgentError(agentErrorLabel("aborted"), "aborted");
  }

  const callOpts: ProviderCallOptions = {
    messages: [{ role: "user", content: prompt }],
    model: cfg.model,
    maxOutputTokens: settings.maxOutputTokens ?? 4096,
    ...(settings.instructions ? { systemPrompt: settings.instructions } : {}),
    ...(thinkingEnabled
      ? { providerOptions: { anthropic: { thinking: { type: "enabled", budget_tokens: cfg.thinking?.budgetTokens ?? 1024 } } } }
      : {
          temperature: settings.temperature,
          topP: settings.topP,
          topK: settings.topK,
        }),
    stopSequences: settings.stopSequences,
    abortSignal: opts?.signal,
  };

  try {
    const result = await model.generate(callOpts);
    return result.content
      .filter((b): b is import("../types.js").TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
  } catch (err: unknown) {
    throw mapToAgentError(err);
  }
}
