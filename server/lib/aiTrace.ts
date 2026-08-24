import type { AiMediaCard } from "@server/lib/aiAgent";
import type { AiChatMessage } from "@server/lib/aiChat";
import { createHash, randomUUID } from "crypto";

export const AI_TRACE_SCHEMA_VERSION = 1 as const;

export type AiTraceJson =
  | null
  | boolean
  | number
  | string
  | AiTraceJson[]
  | { [key: string]: AiTraceJson };

export interface AiTraceCard {
  mediaType: "movie" | "tv";
  tmdbId: number;
  title: string;
  year?: string;
  status: AiMediaCard["status"];
}

export interface AiToolTrace {
  round: number;
  callId: string;
  name: string;
  arguments: AiTraceJson;
  result: AiTraceJson;
  durationMs: number;
  outcome: string;
  cards: AiTraceCard[];
}

export interface AiRoundTrace {
  round: number;
  modelDurationMs: number;
  promptTokens?: number;
  completionTokens?: number;
  finishReason?: string;
  content?: string;
  toolCallCount: number;
}

export interface AiTraceModelConfig {
  alias: string;
  displayName: string;
  revision?: string;
  inferenceProfile: string;
  contextWindowTokens: number;
  requested: {
    maxTokens: number;
    reasoningEffort: string;
    enableThinking: boolean;
  };
}

export interface AiTraceV1 {
  schemaVersion: typeof AI_TRACE_SCHEMA_VERSION;
  traceId: string;
  startedAt: string;
  appVersion: string;
  commitTag: string;
  promptHash: string;
  toolSchemaHash: string;
  model: AiTraceModelConfig;
  inputMessages: AiChatMessage[];
  fittedMessages: AiChatMessage[];
  inputMessageCount: number;
  inputChars: number;
  droppedMessages: number;
  initialEstimatedTokens: number;
  rounds: AiRoundTrace[];
  tools: AiToolTrace[];
  finalAnswer: string;
  cards: AiTraceCard[];
  totalCompletionTokens: number;
  durationMs: number;
  timeToFirstOutputMs?: number;
  finishReason: string;
  errorCode?: string;
}

export type AiTraceSummary = Pick<
  AiTraceV1,
  | "traceId"
  | "inputMessageCount"
  | "inputChars"
  | "droppedMessages"
  | "initialEstimatedTokens"
  | "rounds"
  | "totalCompletionTokens"
  | "durationMs"
  | "timeToFirstOutputMs"
  | "finishReason"
  | "errorCode"
> & {
  model: string;
  presentedCardCount: number;
  tools: Array<{
    round: number;
    name: string;
    durationMs: number;
    outcome: string;
    cardCount: number;
  }>;
};

const SECRET_KEY =
  /(?:authorization|cookie|password|secret|session|api[_-]?key|access[_-]?token|refresh[_-]?token|confirmation[_-]?token|plex[_-]?token|\btoken\b)/iu;
const IDENTITY_KEY = /^(?:userId|user_id|email|plexId|plex_id|sessionId)$/iu;
const REDACTED = "[REDACTED]";

const redactString = (value: string): string =>
  value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/giu, `Bearer ${REDACTED}`)
    .replace(
      /([?&](?:api[_-]?key|token|X-Plex-Token)=)[^&#\s]+/giu,
      `$1${REDACTED}`
    )
    .replace(
      /("(?:api[_-]?key|token|secret|password|authorization)"\s*:\s*")[^"]*(")/giu,
      `$1${REDACTED}$2`
    );

export const redactAiValue = (
  value: unknown,
  key = "",
  seen = new WeakSet<object>()
): AiTraceJson => {
  if (SECRET_KEY.test(key) || IDENTITY_KEY.test(key)) return REDACTED;
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) {
    const redacted = value.map((item) => redactAiValue(item, key, seen));
    seen.delete(value);
    return redacted;
  }
  const redacted = Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(
      ([childKey, child]) => [childKey, redactAiValue(child, childKey, seen)]
    )
  );
  seen.delete(value);
  return redacted;
};

export const parseAiTraceJson = (value: string): AiTraceJson => {
  try {
    return redactAiValue(JSON.parse(value));
  } catch (_error) {
    return redactString(value);
  }
};

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)])
    );
  }
  return value;
};

export const fingerprintAiValue = (value: unknown): string =>
  createHash("sha256")
    .update(JSON.stringify(stableValue(value)))
    .digest("hex");

export const redactAiTrace = (trace: AiTraceV1): AiTraceV1 =>
  redactAiValue(trace) as unknown as AiTraceV1;

export const summarizeAiTrace = (trace: AiTraceV1): AiTraceSummary => ({
  traceId: trace.traceId,
  model: trace.model.alias,
  inputMessageCount: trace.inputMessageCount,
  inputChars: trace.inputChars,
  droppedMessages: trace.droppedMessages,
  initialEstimatedTokens: trace.initialEstimatedTokens,
  rounds: trace.rounds.map(({ content: _content, ...round }) => round),
  tools: trace.tools.map((tool) => ({
    round: tool.round,
    name: tool.name,
    durationMs: tool.durationMs,
    outcome: tool.outcome,
    cardCount: tool.cards.length,
  })),
  totalCompletionTokens: trace.totalCompletionTokens,
  presentedCardCount: trace.cards.length,
  durationMs: trace.durationMs,
  ...(trace.timeToFirstOutputMs !== undefined
    ? { timeToFirstOutputMs: trace.timeToFirstOutputMs }
    : {}),
  finishReason: trace.finishReason,
  ...(trace.errorCode ? { errorCode: trace.errorCode } : {}),
});

export const createAiTraceId = (): string => randomUUID();

export const classifyAiToolOutcome = (content: string): string => {
  try {
    const value = JSON.parse(content) as Record<string, unknown>;
    if (typeof value.code === "string" && /^[a-z_]{2,40}$/u.test(value.code)) {
      return value.code;
    }
    if (value.ok === false || value.error) return "error";
    if (value.refused) return "refused";
    if (value.requiresClarification || value.ambiguous) return "clarification";
    if (value.prepared) return "prepared";
    if (value.ok === true) return "ok";
    return "success";
  } catch (_error) {
    return "invalid_result";
  }
};
