import type { User } from "@server/entity/User";
import {
  AI_AGENT_MAX_TOOL_CALLS,
  AI_AGENT_MAX_TOOL_ROUNDS,
  AI_AGENT_TOOLS,
  executeAiTool,
  finalizeAiMediaCards,
  stageAiMediaCards,
  type AiMediaCard,
  type AiToolCall,
  type AiToolResult,
} from "@server/lib/aiAgent";
import {
  AiChatSseParser,
  AI_CHAT_DEFAULT_CONTEXT_TOKENS,
  AI_CHAT_OUTPUT_RESERVE_TOKENS,
  estimateAiChatTokens,
  trimAiChatMessagesToBudget,
  type AiChatMessage,
} from "@server/lib/aiChat";
import { AI_SYSTEM_MESSAGE } from "@server/lib/aiSystemPrompts";
import {
  AI_TRACE_SCHEMA_VERSION,
  classifyAiToolOutcome,
  createAiTraceId,
  fingerprintAiValue,
  parseAiTraceJson,
  type AiRoundTrace,
  type AiToolTrace,
  type AiTraceCard,
  type AiTraceV1,
} from "@server/lib/aiTrace";
import { getAppVersion, getCommitTag } from "@server/utils/appVersion";

export { AI_SYSTEM_MESSAGE } from "@server/lib/aiSystemPrompts";

const GATEWAY_TIMEOUT_MS = 5_000;
const FIRST_RESPONSE_TIMEOUT_MS = 180_000;
const IDLE_TIMEOUT_MS = 90_000;
const TOTAL_TIMEOUT_MS = 600_000;
const MAX_TOOL_CALLS_PER_ROUND = 2;
const MAX_TOOL_RESULT_CHARS = 12_000;

export type AiRunEventName =
  | "status"
  | "meta"
  | "context"
  | "reasoning"
  | "content"
  | "cards"
  | "error"
  | "done";

export type AiRunPublicErrorCode =
  | "busy"
  | "cancelled"
  | "timeout"
  | "unavailable"
  | "upstream";

export interface AiRunModelConfig {
  baseUrl: string;
  model: string;
  modelName: string;
  gpu: string;
  modelRevision?: string;
  inferenceProfile: string;
  contextWindowTokens: number;
  maxTokens: number;
  reasoningEffort: string;
  enableThinking: boolean;
}

export interface AiRunInput {
  messages: AiChatMessage[];
  user: User;
  config: AiRunModelConfig;
  traceId?: string;
  signal?: AbortSignal;
}

export interface AiRunCallbacks {
  emit?: (event: AiRunEventName, data: Record<string, unknown>) => void;
}

export interface AiRunDependencies {
  fetch?: typeof fetch;
  executeTool?: (call: AiToolCall, user: User) => Promise<AiToolResult>;
  now?: () => number;
  onTrace?: (trace: AiTraceV1) => void | Promise<void>;
}

export interface AiRunResult {
  answer: string;
  cards: AiMediaCard[];
  finishReason: string;
  errorCode?: string;
  trace: AiTraceV1;
}

type UpstreamMessage =
  | { role: "system" | "user" | "assistant"; content: string }
  | {
      role: "assistant";
      content: null;
      tool_calls: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    }
  | { role: "tool"; tool_call_id: string; content: string };

const boundedInteger = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 8_192 && parsed <= 1_000_000
    ? parsed
    : fallback;
};

export const getAiRunModelConfig = (): AiRunModelConfig | undefined => {
  const baseUrl = process.env.AI_BASE_URL?.replace(/\/$/u, "");
  if (!baseUrl) return;
  return {
    baseUrl,
    model: process.env.AI_MODEL ?? "qwen-main",
    modelName:
      process.env.AI_MODEL_DISPLAY_NAME ??
      "gittensor-model-hub/Qwen3.8-27B-NVFP4-RTX5090",
    gpu: process.env.AI_MODEL_GPU ?? "NVIDIA RTX 5090",
    modelRevision: process.env.AI_MODEL_REVISION,
    inferenceProfile:
      process.env.AI_INFERENCE_PROFILE ?? "llama-swap/vllm-qwen3",
    contextWindowTokens: boundedInteger(
      process.env.AI_CONTEXT_WINDOW_TOKENS,
      AI_CHAT_DEFAULT_CONTEXT_TOKENS
    ),
    maxTokens: AI_CHAT_OUTPUT_RESERVE_TOKENS,
    reasoningEffort: "medium",
    enableThinking: true,
  };
};

const percentOfContext = (tokens: number, contextWindowTokens: number) =>
  Math.min(100, Math.max(0, (tokens / contextWindowTokens) * 100));

const traceCards = (cards: AiMediaCard[]): AiTraceCard[] =>
  cards.map((card) => ({
    mediaType: card.mediaType,
    tmdbId: card.tmdbId,
    title: card.title,
    ...(card.year ? { year: card.year } : {}),
    status: card.status,
  }));

export const runAiAgent = async (
  input: AiRunInput,
  callbacks: AiRunCallbacks = {},
  dependencies: AiRunDependencies = {}
): Promise<AiRunResult> => {
  const fetchFn = dependencies.fetch ?? fetch;
  const executeTool = dependencies.executeTool ?? executeAiTool;
  const now = dependencies.now ?? Date.now;
  const emit = callbacks.emit ?? (() => undefined);
  const traceId = input.traceId ?? createAiTraceId();
  const startedAt = now();
  const controller = new AbortController();
  let abortCode: AiRunPublicErrorCode = "cancelled";
  const abort = (code: AiRunPublicErrorCode) => {
    if (!controller.signal.aborted) {
      abortCode = code;
      controller.abort();
    }
  };
  const externalAbort = () => abort("cancelled");
  input.signal?.addEventListener("abort", externalAbort, { once: true });

  const traceRounds: AiRoundTrace[] = [];
  const traceTools: AiToolTrace[] = [];
  let fittedMessages: AiChatMessage[] = [];
  let droppedMessages = 0;
  let initialEstimatedTokens = 0;
  let totalCompletionTokens = 0;
  let timeToFirstOutputMs: number | undefined;
  let errorCode: string | undefined;
  let finishReason = "unknown";
  let finalAnswer = "";
  let finalCards: AiMediaCard[] = [];
  let firstResponseTimer: NodeJS.Timeout | undefined;
  let idleTimer: NodeJS.Timeout | undefined;
  const totalTimer = setTimeout(() => abort("timeout"), TOTAL_TIMEOUT_MS);
  const gatewayTimer = setTimeout(
    () => abort("unavailable"),
    GATEWAY_TIMEOUT_MS
  );
  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => abort("timeout"), IDLE_TIMEOUT_MS);
  };

  try {
    const gatewayBaseUrl = input.config.baseUrl.endsWith("/v1")
      ? input.config.baseUrl.slice(0, -3)
      : input.config.baseUrl;
    const health = await fetchFn(`${gatewayBaseUrl}/health`, {
      signal: controller.signal,
    });
    clearTimeout(gatewayTimer);
    if (!health.ok) {
      errorCode = "unavailable";
      finishReason = "unavailable";
      emit("error", {
        code: "unavailable",
        message: "Qwen is currently unavailable.",
      });
    } else {
      const systemMessage = `${AI_SYSTEM_MESSAGE}\n\nCurrent date: ${new Date(
        now()
      )
        .toISOString()
        .slice(0, 10)}.`;
      const maxInputTokens =
        input.config.contextWindowTokens - input.config.maxTokens;
      const fitted = trimAiChatMessagesToBudget(
        input.messages,
        { system: systemMessage, tools: AI_AGENT_TOOLS },
        maxInputTokens
      );
      fittedMessages = fitted.messages;
      droppedMessages = fitted.droppedMessages;
      const upstreamMessages: UpstreamMessage[] = [
        { role: "system", content: systemMessage },
        ...fitted.messages.map(({ role, content }) => ({ role, content })),
      ];
      let pendingCards: AiMediaCard[] = [];
      const mediaContext =
        fitted.messages[fitted.messages.length - 1]?.mediaContext;
      if (mediaContext) {
        emit("status", { phase: "thinking" });
        const contextCall: AiToolCall = {
          id: `media-context-${traceId}`,
          name: "lookup_media",
          arguments: JSON.stringify({
            operation: "details",
            items: [
              {
                media_type: mediaContext.mediaType,
                tmdb_id: mediaContext.tmdbId,
              },
            ],
            include_credits: true,
          }),
        };
        const toolStartedAt = now();
        const contextResult = await executeTool(contextCall, input.user);
        traceTools.push({
          round: 0,
          callId: contextCall.id,
          name: contextCall.name,
          arguments: parseAiTraceJson(contextCall.arguments),
          result: parseAiTraceJson(contextResult.content),
          durationMs: now() - toolStartedAt,
          outcome: classifyAiToolOutcome(contextResult.content),
          cards: traceCards(contextResult.cards ?? []),
        });
        upstreamMessages.push({
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: contextCall.id,
              type: "function",
              function: {
                name: contextCall.name,
                arguments: contextCall.arguments,
              },
            },
          ],
        });
        upstreamMessages.push({
          role: "tool",
          tool_call_id: contextCall.id,
          content: contextResult.content.slice(0, MAX_TOOL_RESULT_CHARS),
        });
        pendingCards = stageAiMediaCards(
          pendingCards,
          contextResult.cards ?? []
        );
      }

      initialEstimatedTokens = estimateAiChatTokens(
        JSON.stringify({ messages: upstreamMessages, tools: AI_AGENT_TOOLS })
      );
      emit("meta", {
        traceId,
        model: input.config.model,
        modelName: input.config.modelName,
        gpu: input.config.gpu,
        contextWindowTokens: input.config.contextWindowTokens,
        contextUsedPercent: percentOfContext(
          initialEstimatedTokens,
          input.config.contextWindowTokens
        ),
      });
      if (fitted.droppedMessages) {
        emit("context", {
          message: `${fitted.droppedMessages} older messages were trimmed to keep this answer reliable.`,
        });
      }

      let totalToolCalls = 0;
      let latestPromptTokens = fitted.estimatedTokens;
      let latestCompletionTokens = 0;
      let modelStreamMs = 0;

      for (let round = 0; round <= AI_AGENT_MAX_TOOL_ROUNDS; round += 1) {
        const estimatedRoundTokens = estimateAiChatTokens(
          JSON.stringify({ messages: upstreamMessages, tools: AI_AGENT_TOOLS })
        );
        if (estimatedRoundTokens > maxInputTokens) {
          finishReason = "context_limit";
          timeToFirstOutputMs ??= now() - startedAt;
          const message =
            "This conversation reached its safe context limit, so I stopped cleanly. Start a new chat to continue.";
          finalAnswer += message;
          emit("content", { delta: message });
          emit("meta", {
            traceId,
            model: input.config.model,
            modelName: input.config.modelName,
            gpu: input.config.gpu,
            contextWindowTokens: input.config.contextWindowTokens,
            contextUsedPercent: percentOfContext(
              estimatedRoundTokens,
              input.config.contextWindowTokens
            ),
          });
          emit("done", { finishReason });
          break;
        }

        const roundStartedAt = now();
        firstResponseTimer = setTimeout(
          () => abort("timeout"),
          FIRST_RESPONSE_TIMEOUT_MS
        );
        const upstream = await fetchFn(
          `${input.config.baseUrl}/chat/completions`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: input.config.model,
              messages: upstreamMessages,
              tools: AI_AGENT_TOOLS,
              tool_choice:
                round === AI_AGENT_MAX_TOOL_ROUNDS ||
                totalToolCalls >= AI_AGENT_MAX_TOOL_CALLS
                  ? "none"
                  : "auto",
              stream: true,
              max_tokens: input.config.maxTokens,
              reasoning_effort: input.config.reasoningEffort,
              chat_template_kwargs: {
                enable_thinking: input.config.enableThinking,
                reasoning_effort: input.config.reasoningEffort,
              },
              stream_options: { include_usage: true },
            }),
            signal: controller.signal,
          }
        );
        clearTimeout(firstResponseTimer);

        if (!upstream.ok) {
          const code: AiRunPublicErrorCode =
            upstream.status === 429 ? "busy" : "upstream";
          errorCode = code;
          finishReason = code;
          emit("error", {
            code,
            message:
              code === "busy"
                ? "Qwen is busy. Please try again in a moment."
                : "Qwen could not start this request.",
          });
          break;
        }
        if (!upstream.body) {
          errorCode = "upstream";
          finishReason = "upstream";
          emit("error", {
            code: "upstream",
            message: "Qwen returned an empty response.",
          });
          break;
        }

        const parser = new AiChatSseParser();
        const decoder = new TextDecoder();
        const toolCalls = new Map<number, AiToolCall>();
        let emittedContent = false;
        let roundContent = "";
        let sentThinkingStatus = false;
        let roundOutputStartedAt: number | undefined;
        let roundPromptTokens: number | undefined;
        let roundCompletionTokens: number | undefined;
        let roundFinishReason: string | undefined;
        const handleEvents = (events: ReturnType<AiChatSseParser["push"]>) => {
          for (const event of events) {
            if (
              !roundOutputStartedAt &&
              (event.reasoning || event.content || event.toolCall)
            ) {
              roundOutputStartedAt = now();
              timeToFirstOutputMs ??= roundOutputStartedAt - startedAt;
            }
            if (event.error) {
              errorCode = "upstream";
              emit("error", { code: "upstream", message: event.error });
            }
            if (event.reasoning && !emittedContent) {
              if (!sentThinkingStatus) {
                sentThinkingStatus = true;
                emit("status", { phase: "thinking" });
              }
              emit("reasoning", { delta: event.reasoning });
            }
            if (event.toolCall && !emittedContent) {
              const current = toolCalls.get(event.toolCall.index) ?? {
                id: "",
                name: "",
                arguments: "",
              };
              current.id += event.toolCall.id ?? "";
              current.name += event.toolCall.name ?? "";
              current.arguments += event.toolCall.arguments ?? "";
              toolCalls.set(event.toolCall.index, current);
            }
            if (event.content && toolCalls.size === 0) {
              emittedContent = true;
              roundContent += event.content;
              finalAnswer += event.content;
              emit("content", { delta: event.content });
            }
            if (event.finishReason) {
              finishReason = event.finishReason;
              roundFinishReason = event.finishReason;
            }
            if (event.usage) {
              roundPromptTokens = event.usage.promptTokens;
              roundCompletionTokens = event.usage.completionTokens;
            }
          }
        };

        const reader = upstream.body.getReader();
        resetIdleTimer();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          resetIdleTimer();
          handleEvents(parser.push(decoder.decode(value, { stream: true })));
        }
        handleEvents(parser.finish());
        const roundFinishedAt = now();
        modelStreamMs +=
          roundFinishedAt - (roundOutputStartedAt ?? roundStartedAt);
        if (roundPromptTokens !== undefined) {
          latestPromptTokens = roundPromptTokens;
        }
        if (roundCompletionTokens !== undefined) {
          latestCompletionTokens = roundCompletionTokens;
          totalCompletionTokens += roundCompletionTokens;
        }

        const calls = [...toolCalls.values()]
          .filter((call) => call.id && call.name)
          .slice(
            0,
            Math.min(
              MAX_TOOL_CALLS_PER_ROUND,
              AI_AGENT_MAX_TOOL_CALLS - totalToolCalls
            )
          );
        traceRounds.push({
          round: round + 1,
          modelDurationMs: roundFinishedAt - roundStartedAt,
          ...(roundPromptTokens !== undefined
            ? { promptTokens: roundPromptTokens }
            : {}),
          ...(roundCompletionTokens !== undefined
            ? { completionTokens: roundCompletionTokens }
            : {}),
          ...(roundFinishReason ? { finishReason: roundFinishReason } : {}),
          ...(roundContent ? { content: roundContent } : {}),
          toolCallCount: calls.length,
        });

        if (!calls.length || emittedContent) {
          if (!roundContent.trim()) {
            const fallback =
              "I could not produce a reliable answer. Try rephrasing that.";
            finalAnswer += fallback;
            emit("content", { delta: fallback });
          }
          finalCards = finalizeAiMediaCards(pendingCards);
          if (finalCards.length) emit("cards", { cards: finalCards });
          emit("meta", {
            traceId,
            model: input.config.model,
            modelName: input.config.modelName,
            gpu: input.config.gpu,
            contextWindowTokens: input.config.contextWindowTokens,
            contextUsedPercent: percentOfContext(
              latestPromptTokens + latestCompletionTokens,
              input.config.contextWindowTokens
            ),
            ...(totalCompletionTokens > 0 && modelStreamMs > 0
              ? {
                  tokensPerSecond:
                    totalCompletionTokens / (modelStreamMs / 1_000),
                }
              : {}),
          });
          emit("done", { finishReason });
          break;
        }

        emit("status", { phase: "thinking" });
        totalToolCalls += calls.length;
        upstreamMessages.push({
          role: "assistant",
          content: null,
          tool_calls: calls.map((call) => ({
            id: call.id,
            type: "function",
            function: { name: call.name, arguments: call.arguments },
          })),
        });
        const toolRuns = await Promise.all(
          calls.map(async (call) => {
            const toolStartedAt = now();
            const result = await executeTool(call, input.user);
            return { result, durationMs: now() - toolStartedAt };
          })
        );
        const cards: AiMediaCard[] = [];
        toolRuns.forEach(({ result, durationMs }, index) => {
          const call = calls[index];
          traceTools.push({
            round: round + 1,
            callId: call.id,
            name: call.name,
            arguments: parseAiTraceJson(call.arguments),
            result: parseAiTraceJson(result.content),
            durationMs,
            outcome: classifyAiToolOutcome(result.content),
            cards: traceCards(result.cards ?? []),
          });
          upstreamMessages.push({
            role: "tool",
            tool_call_id: call.id,
            content: result.content.slice(0, MAX_TOOL_RESULT_CHARS),
          });
          cards.push(...(result.cards ?? []));
        });
        pendingCards = stageAiMediaCards(pendingCards, cards);
      }
    }
  } catch (_error) {
    if (controller.signal.aborted) {
      errorCode = abortCode;
      if (finishReason === "unknown") finishReason = abortCode;
      if (abortCode !== "cancelled") {
        emit("error", {
          code: abortCode,
          message:
            abortCode === "timeout"
              ? "Qwen took too long to respond."
              : "Qwen is currently unavailable.",
        });
      }
    } else {
      errorCode = "unavailable";
      if (finishReason === "unknown") finishReason = "error";
      emit("error", {
        code: "unavailable",
        message: "Qwen is currently unavailable.",
      });
    }
  } finally {
    clearTimeout(gatewayTimer);
    if (firstResponseTimer) clearTimeout(firstResponseTimer);
    clearTimeout(totalTimer);
    if (idleTimer) clearTimeout(idleTimer);
    input.signal?.removeEventListener("abort", externalAbort);
  }

  const trace: AiTraceV1 = {
    schemaVersion: AI_TRACE_SCHEMA_VERSION,
    traceId,
    startedAt: new Date(startedAt).toISOString(),
    appVersion: getAppVersion(),
    commitTag: getCommitTag(),
    promptHash: fingerprintAiValue(AI_SYSTEM_MESSAGE),
    toolSchemaHash: fingerprintAiValue(AI_AGENT_TOOLS),
    model: {
      alias: input.config.model,
      displayName: input.config.modelName,
      ...(input.config.modelRevision
        ? { revision: input.config.modelRevision }
        : {}),
      inferenceProfile: input.config.inferenceProfile,
      contextWindowTokens: input.config.contextWindowTokens,
      requested: {
        maxTokens: input.config.maxTokens,
        reasoningEffort: input.config.reasoningEffort,
        enableThinking: input.config.enableThinking,
      },
    },
    inputMessages: input.messages,
    fittedMessages,
    inputMessageCount: input.messages.length,
    inputChars: input.messages.reduce(
      (total, message) => total + message.content.length,
      0
    ),
    droppedMessages,
    initialEstimatedTokens,
    rounds: traceRounds,
    tools: traceTools,
    finalAnswer: finalAnswer.trim(),
    cards: traceCards(finalCards),
    totalCompletionTokens,
    durationMs: now() - startedAt,
    ...(timeToFirstOutputMs !== undefined ? { timeToFirstOutputMs } : {}),
    finishReason,
    ...(errorCode ? { errorCode } : {}),
  };

  try {
    await dependencies.onTrace?.(trace);
  } catch (_error) {
    // Trace persistence is deliberately best-effort and cannot break chat.
  }

  return {
    answer: trace.finalAnswer,
    cards: finalCards,
    finishReason,
    ...(errorCode ? { errorCode } : {}),
    trace,
  };
};
