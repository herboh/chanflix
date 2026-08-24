import { MediaType } from "@server/constants/media";
import {
  DuplicateMediaRequestError,
  MediaRequest,
  NoSeasonsAvailableError,
  QuotaRestrictedError,
  RequestPermissionError,
} from "@server/entity/MediaRequest";
import {
  consumeRequestConfirmation,
  pruneRequestConfirmations,
} from "@server/lib/aiAgent";
import {
  AiChatConcurrencyGate,
  AiChatValidationError,
  validateAiChatMessages,
} from "@server/lib/aiChat";
import {
  getAiRunModelConfig,
  runAiAgent,
  type AiRunEventName,
} from "@server/lib/aiRunner";
import { summarizeAiTrace } from "@server/lib/aiTrace";
import {
  AiTraceFeedbackValidationError,
  persistAiTrace,
  updateAiTraceFeedback,
} from "@server/lib/aiTraceStore";
import { getMediaRatings } from "@server/lib/mediaRatings";
import logger from "@server/logger";
import { isAuthenticated } from "@server/middleware/auth";
import { Router } from "express";
import rateLimit from "express-rate-limit";

const chatRoutes = Router();
const concurrency = new AiChatConcurrencyGate(3);
const HEARTBEAT_INTERVAL_MS = 15_000;

const writeEvent = (
  res: Parameters<Middleware>[1],
  event: AiRunEventName,
  data: Record<string, unknown>
) => {
  if (!res.destroyed && !res.writableEnded) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
};

const sessionOnly: Middleware = (req, res, next) => {
  if (!req.session?.userId) {
    res.status(403).json({
      status: 403,
      error: "AI chat requires an authenticated browser session.",
    });
    return;
  }
  next();
};

const chatRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user?.id ?? req.ip),
  handler: (_req, res) => {
    res.setHeader("Retry-After", "30");
    return res.status(429).json({
      status: 429,
      error: "Too many AI requests. Please wait before trying again.",
    });
  },
});

const requestRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user?.id ?? req.ip),
});

const ratingsRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user?.id ?? req.ip),
});

const feedbackRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user?.id ?? req.ip),
});

chatRoutes.get(
  "/ratings",
  isAuthenticated(),
  sessionOnly,
  ratingsRateLimit,
  async (req, res) => {
    const rawItems = typeof req.query.items === "string" ? req.query.items : "";
    const values = rawItems.split(",").filter(Boolean);
    if (!values.length || values.length > 4 || rawItems.length > 160) {
      return res
        .status(400)
        .json({ status: 400, error: "Invalid media list." });
    }

    const items = values.map((value) => {
      const match = /^(movie|tv):([1-9]\d{0,9})$/u.exec(value);
      const tmdbId = match ? Number(match[2]) : 0;
      return match && Number.isSafeInteger(tmdbId)
        ? { key: value, mediaType: match[1] as "movie" | "tv", tmdbId }
        : undefined;
    });
    if (items.some((item) => !item)) {
      return res
        .status(400)
        .json({ status: 400, error: "Invalid media list." });
    }

    const uniqueItems = [
      ...new Map(items.map((item) => [item?.key, item] as const)).values(),
    ].filter((item): item is NonNullable<typeof item> => !!item);
    const resolved = await Promise.all(
      uniqueItems.map(
        async (item) =>
          [
            item.key,
            (await getMediaRatings(item.mediaType, item.tmdbId)) ?? null,
          ] as const
      )
    );

    res.setHeader("Cache-Control", "private, max-age=1800");
    return res.status(200).json({ ratings: Object.fromEntries(resolved) });
  }
);

chatRoutes.post(
  "/request",
  isAuthenticated(),
  sessionOnly,
  requestRateLimit,
  async (req, res) => {
    const user = req.user;
    const token = typeof req.body?.token === "string" ? req.body.token : "";
    if (!user || !/^[A-Za-z0-9_-]{32}$/u.test(token)) {
      return res
        .status(400)
        .json({ status: 400, error: "Invalid request confirmation." });
    }

    pruneRequestConfirmations();
    const pending = consumeRequestConfirmation(token, user.id);
    if (!pending) {
      return res.status(410).json({
        status: 410,
        error: "This confirmation expired or was already used.",
      });
    }

    try {
      const request = await MediaRequest.request(
        {
          mediaType:
            pending.mediaType === "movie" ? MediaType.MOVIE : MediaType.TV,
          mediaId: pending.tmdbId,
          seasons:
            pending.mediaType === "tv" ? pending.seasons ?? [1] : undefined,
          is4k: false,
        },
        user,
        { forcePending: pending.forcePending }
      );
      logger.info("AI-assisted media request confirmed", {
        label: "AI Chat",
        userId: user.id,
        requestId: request.id,
        mediaType: pending.mediaType,
        tmdbId: pending.tmdbId,
      });
      return res.status(201).json({
        requestId: request.id,
        status: request.status,
        message:
          request.status === 1
            ? "Request submitted for approval."
            : "Request approved and submitted.",
      });
    } catch (error) {
      logger.warn("AI-assisted media request rejected", {
        label: "AI Chat",
        userId: user.id,
        mediaType: pending.mediaType,
        tmdbId: pending.tmdbId,
        errorMessage: error instanceof Error ? error.message : "Unknown error",
      });
      const safeError =
        error instanceof RequestPermissionError ||
        error instanceof QuotaRestrictedError ||
        error instanceof DuplicateMediaRequestError ||
        error instanceof NoSeasonsAvailableError;
      const status =
        error instanceof RequestPermissionError ||
        error instanceof QuotaRestrictedError
          ? 403
          : error instanceof DuplicateMediaRequestError
          ? 409
          : safeError
          ? 400
          : 500;
      return res.status(status).json({
        status,
        error:
          safeError && error instanceof Error
            ? error.message
            : "Chanflix could not create this request.",
      });
    }
  }
);

chatRoutes.put(
  "/:traceId/feedback",
  isAuthenticated(),
  sessionOnly,
  feedbackRateLimit,
  async (req, res) => {
    const userId = req.user?.id;
    const traceId = req.params.traceId;
    if (
      !userId ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        traceId
      )
    ) {
      return res.status(400).json({ status: 400, error: "Invalid trace ID." });
    }
    try {
      const feedback = await updateAiTraceFeedback(traceId, userId, req.body);
      if (!feedback) {
        return res
          .status(404)
          .json({ status: 404, error: "AI answer not found." });
      }
      return res.status(200).json({ feedback });
    } catch (error) {
      if (error instanceof AiTraceFeedbackValidationError) {
        return res.status(400).json({ status: 400, error: error.message });
      }
      throw error;
    }
  }
);

chatRoutes.post(
  "/",
  isAuthenticated(),
  sessionOnly,
  chatRateLimit,
  async (req, res) => {
    const user = req.user;
    const config = getAiRunModelConfig();
    if (!user || !config) {
      return res
        .status(503)
        .json({ status: 503, error: "AI chat is not configured." });
    }

    let messages;
    try {
      messages = validateAiChatMessages(req.body?.messages);
    } catch (error) {
      if (error instanceof AiChatValidationError) {
        return res
          .status(error.status)
          .json({ status: error.status, error: error.message });
      }
      throw error;
    }

    const release = concurrency.acquire(user.id);
    if (!release) {
      res.setHeader("Retry-After", "5");
      return res.status(429).json({
        status: 429,
        error: "Qwen is busy. Please try again in a moment.",
      });
    }

    const controller = new AbortController();
    let finished = false;
    const heartbeat = setInterval(() => {
      if (!res.destroyed && !res.writableEnded) res.write(": keepalive\n\n");
    }, HEARTBEAT_INTERVAL_MS);
    res.on("close", () => {
      if (!finished) controller.abort();
    });
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    writeEvent(res, "status", { phase: "connecting" });

    try {
      const result = await runAiAgent(
        { messages, user, config, signal: controller.signal },
        { emit: (event, data) => writeEvent(res, event, data) },
        {
          onTrace: async (trace) => {
            try {
              await persistAiTrace(trace, user);
            } catch (error) {
              logger.warn("AI chat trace could not be persisted", {
                label: "AI Chat",
                userId: user.id,
                traceId: trace.traceId,
                errorMessage:
                  error instanceof Error ? error.message : "Unknown error",
              });
            }
          },
        }
      );
      logger.info("AI chat agent trace", {
        label: "AI Chat",
        userId: user.id,
        ...summarizeAiTrace(result.trace),
      });
    } catch (error) {
      writeEvent(res, "error", {
        code: "unavailable",
        message: "Qwen is currently unavailable.",
      });
      logger.error("AI chat runner failed", {
        label: "AI Chat",
        userId: user.id,
        errorMessage: error instanceof Error ? error.message : "Unknown error",
      });
    } finally {
      finished = true;
      clearInterval(heartbeat);
      release();
      if (!res.writableEnded) res.end();
    }
  }
);

export default chatRoutes;
