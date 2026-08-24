import { randomUUID } from "crypto";

export interface AiToolTrace {
  round: number;
  name: string;
  durationMs: number;
  outcome: string;
  cardCount: number;
}

export interface AiRoundTrace {
  round: number;
  modelDurationMs: number;
  promptTokens?: number;
  completionTokens?: number;
  finishReason?: string;
}

export interface AiTraceSummary {
  traceId: string;
  model: string;
  inputMessageCount: number;
  inputChars: number;
  droppedMessages: number;
  initialEstimatedTokens: number;
  rounds: AiRoundTrace[];
  tools: AiToolTrace[];
  totalCompletionTokens: number;
  presentedCardCount: number;
  durationMs: number;
  timeToFirstOutputMs?: number;
  finishReason: string;
  errorCode?: string;
}

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
