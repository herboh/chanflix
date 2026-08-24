import { getRepository } from "@server/datasource";
import AiChatTrace from "@server/entity/AiChatTrace";
import { User } from "@server/entity/User";
import { redactAiTrace, type AiTraceV1 } from "@server/lib/aiTrace";
import { LessThan } from "typeorm";

export const AI_FEEDBACK_REASONS = [
  "flagged",
  "wrong_tool",
  "wrong_entity",
  "missing_tool",
  "unsupported_claim",
  "recommendation_or_cards",
  "request_or_safety",
  "formatting",
  "other",
] as const;

export type AiFeedbackReason = (typeof AI_FEEDBACK_REASONS)[number];

export interface AiTraceFeedback {
  rating: "up" | "down";
  reasons: AiFeedbackReason[];
  comment?: string;
}

export class AiTraceFeedbackValidationError extends Error {}

const retentionDays = () => {
  const parsed = Number(process.env.AI_TRACE_RETENTION_DAYS ?? "30");
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 365 ? parsed : 30;
};

export const getAiTraceRetentionCutoff = (
  now = new Date(),
  days = retentionDays()
): Date => new Date(now.getTime() - days * 24 * 60 * 60 * 1_000);

export const validateAiTraceFeedback = (value: unknown): AiTraceFeedback => {
  if (!value || typeof value !== "object") {
    throw new AiTraceFeedbackValidationError("Feedback must be an object.");
  }
  const input = value as Record<string, unknown>;
  if (input.rating !== "up" && input.rating !== "down") {
    throw new AiTraceFeedbackValidationError("Invalid feedback rating.");
  }
  if (!Array.isArray(input.reasons) || input.reasons.length > 4) {
    throw new AiTraceFeedbackValidationError("Invalid feedback reasons.");
  }
  const validReasons = new Set<string>(AI_FEEDBACK_REASONS);
  const reasons = [...new Set(input.reasons)];
  if (
    reasons.some(
      (reason): reason is Exclude<typeof reason, string> =>
        typeof reason !== "string" || !validReasons.has(reason)
    )
  ) {
    throw new AiTraceFeedbackValidationError("Invalid feedback reasons.");
  }
  if (input.rating === "up" && reasons.length) {
    throw new AiTraceFeedbackValidationError(
      "Positive feedback cannot include failure reasons."
    );
  }
  if (input.rating === "down" && !reasons.length) {
    throw new AiTraceFeedbackValidationError(
      "Negative feedback requires a reason."
    );
  }
  if (input.comment !== undefined && typeof input.comment !== "string") {
    throw new AiTraceFeedbackValidationError("Invalid feedback comment.");
  }
  const comment =
    typeof input.comment === "string" ? input.comment.trim() : undefined;
  if (comment && comment.length > 1_000) {
    throw new AiTraceFeedbackValidationError(
      "Feedback comments are limited to 1,000 characters."
    );
  }
  return {
    rating: input.rating,
    reasons: reasons as AiFeedbackReason[],
    ...(comment ? { comment } : {}),
  };
};

export const persistAiTrace = async (
  trace: AiTraceV1,
  user: User
): Promise<void> => {
  const redacted = redactAiTrace(trace);
  await getRepository(AiChatTrace).save(
    new AiChatTrace({
      id: trace.traceId,
      user,
      schemaVersion: trace.schemaVersion,
      model: trace.model.alias,
      finishReason: trace.finishReason,
      durationMs: trace.durationMs,
      payload: JSON.stringify(redacted),
      feedbackReasons: "[]",
    })
  );
};

export const updateAiTraceFeedback = async (
  traceId: string,
  userId: number,
  value: unknown
): Promise<AiTraceFeedback | undefined> => {
  const feedback = validateAiTraceFeedback(value);
  const repository = getRepository(AiChatTrace);
  const trace = await repository.findOne({
    where: { id: traceId, user: { id: userId } },
  });
  if (!trace) return;
  trace.feedbackRating = feedback.rating;
  trace.feedbackReasons = JSON.stringify(feedback.reasons);
  trace.feedbackComment = feedback.comment ?? null;
  trace.feedbackAt = new Date();
  await repository.save(trace);
  return feedback;
};

export const cleanupExpiredAiTraces = async (
  now = new Date()
): Promise<number> => {
  const result = await getRepository(AiChatTrace).delete({
    createdAt: LessThan(getAiTraceRetentionCutoff(now)),
  });
  return result.affected ?? 0;
};

export interface ExportedAiTrace {
  trace: AiTraceV1;
  feedback: AiTraceFeedback;
  feedbackAt?: string;
}

export const getNegativeAiTraceExports = async (
  limit = 500
): Promise<ExportedAiTrace[]> => {
  const rows = await getRepository(AiChatTrace).find({
    where: { feedbackRating: "down" },
    order: { feedbackAt: "DESC" },
    take: Math.min(Math.max(limit, 1), 5_000),
  });
  return rows.flatMap((row) => {
    try {
      return [
        {
          trace: JSON.parse(row.payload) as AiTraceV1,
          feedback: {
            rating: "down" as const,
            reasons: JSON.parse(row.feedbackReasons) as AiFeedbackReason[],
            ...(row.feedbackComment ? { comment: row.feedbackComment } : {}),
          },
          ...(row.feedbackAt
            ? { feedbackAt: row.feedbackAt.toISOString() }
            : {}),
        },
      ];
    } catch (_error) {
      return [];
    }
  });
};
