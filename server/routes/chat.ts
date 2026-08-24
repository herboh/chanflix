import {
  AiChatConcurrencyGate,
  AiChatSseParser,
  AiChatValidationError,
  validateAiChatMessages,
} from "@server/lib/aiChat";
import logger from "@server/logger";
import { isAuthenticated } from "@server/middleware/auth";
import { Router } from "express";
import rateLimit from "express-rate-limit";

const chatRoutes = Router();
const concurrency = new AiChatConcurrencyGate(3);

const SYSTEM_MESSAGE =
  "You are a helpful assistant. Answer directly and accurately. Use Markdown structure and fenced code blocks when they improve clarity.";
const GATEWAY_TIMEOUT_MS = 5_000;
const FIRST_RESPONSE_TIMEOUT_MS = 180_000;
const IDLE_TIMEOUT_MS = 90_000;
const TOTAL_TIMEOUT_MS = 600_000;
const HEARTBEAT_INTERVAL_MS = 15_000;

type PublicErrorCode =
  | "busy"
  | "cancelled"
  | "timeout"
  | "unavailable"
  | "upstream";

const writeEvent = (
  res: Parameters<Middleware>[1],
  event: string,
  data: Record<string, unknown>
) => {
  if (!res.destroyed && !res.writableEnded) {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }
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

chatRoutes.post(
  "/",
  isAuthenticated(),
  (req, res, next) => {
    if (!req.session?.userId) {
      return res.status(403).json({
        status: 403,
        error: "AI chat requires an authenticated browser session.",
      });
    }
    return next();
  },
  chatRateLimit,
  async (req, res) => {
    const startedAt = Date.now();
    const userId = req.user?.id;
    const baseUrl = process.env.AI_BASE_URL?.replace(/\/$/, "");
    const model = process.env.AI_MODEL ?? "qwen-main";

    if (!userId || !baseUrl) {
      return res.status(503).json({
        status: 503,
        error: "AI chat is not configured.",
      });
    }

    let messages;
    try {
      messages = validateAiChatMessages(req.body?.messages);
    } catch (error) {
      if (error instanceof AiChatValidationError) {
        return res.status(error.status).json({
          status: error.status,
          error: error.message,
        });
      }
      throw error;
    }

    const release = concurrency.acquire(userId);
    if (!release) {
      res.setHeader("Retry-After", "5");
      return res.status(429).json({
        status: 429,
        error: "Qwen is busy. Please try again in a moment.",
      });
    }

    const controller = new AbortController();
    const decoder = new TextDecoder();
    const parser = new AiChatSseParser();
    let abortCode: PublicErrorCode = "cancelled";
    let finished = false;
    let finishReason = "unknown";
    let idleTimer: NodeJS.Timeout | undefined;
    let firstResponseTimer: NodeJS.Timeout | undefined;

    const abort = (code: PublicErrorCode) => {
      abortCode = code;
      controller.abort();
    };
    const totalTimer = setTimeout(() => abort("timeout"), TOTAL_TIMEOUT_MS);
    const gatewayTimer = setTimeout(
      () => abort("unavailable"),
      GATEWAY_TIMEOUT_MS
    );
    const heartbeat = setInterval(() => {
      if (!res.destroyed && !res.writableEnded) {
        res.write(": keepalive\n\n");
      }
    }, HEARTBEAT_INTERVAL_MS);
    const resetIdleTimer = () => {
      if (idleTimer) {
        clearTimeout(idleTimer);
      }
      idleTimer = setTimeout(() => abort("timeout"), IDLE_TIMEOUT_MS);
    };

    res.on("close", () => {
      if (!finished) {
        abort("cancelled");
      }
    });
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    writeEvent(res, "status", { phase: "connecting" });

    try {
      const gatewayBaseUrl = baseUrl.endsWith("/v1")
        ? baseUrl.slice(0, -3)
        : baseUrl;
      const health = await fetch(`${gatewayBaseUrl}/health`, {
        signal: controller.signal,
      });
      clearTimeout(gatewayTimer);
      if (!health.ok) {
        writeEvent(res, "error", {
          code: "unavailable",
          message: "Qwen is currently unavailable.",
        });
        return;
      }

      firstResponseTimer = setTimeout(
        () => abort("timeout"),
        FIRST_RESPONSE_TIMEOUT_MS
      );
      const upstream = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "system", content: SYSTEM_MESSAGE }, ...messages],
          stream: true,
          max_tokens: 4096,
        }),
        signal: controller.signal,
      });

      clearTimeout(firstResponseTimer);

      if (!upstream.ok) {
        const code: PublicErrorCode =
          upstream.status === 429 ? "busy" : "upstream";
        writeEvent(res, "error", {
          code,
          message:
            code === "busy"
              ? "Qwen is busy. Please try again in a moment."
              : "Qwen could not start this request.",
        });
        logger.warn("AI chat upstream rejected a request", {
          label: "AI Chat",
          userId,
          upstreamStatus: upstream.status,
        });
        return;
      }

      if (!upstream.body) {
        writeEvent(res, "error", {
          code: "upstream",
          message: "Qwen returned an empty response.",
        });
        return;
      }

      const reader = upstream.body.getReader();
      resetIdleTimer();

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        resetIdleTimer();
        const events = parser.push(decoder.decode(value, { stream: true }));
        for (const event of events) {
          if (event.error) {
            writeEvent(res, "error", {
              code: "upstream",
              message: event.error,
            });
          }
          if (event.reasoning) {
            writeEvent(res, "reasoning", { delta: event.reasoning });
          }
          if (event.content) {
            writeEvent(res, "content", { delta: event.content });
          }
          if (event.finishReason) {
            finishReason = event.finishReason;
          }
          if (event.done) {
            finished = true;
          }
        }
      }

      for (const event of parser.finish()) {
        if (event.reasoning) {
          writeEvent(res, "reasoning", { delta: event.reasoning });
        }
        if (event.content) {
          writeEvent(res, "content", { delta: event.content });
        }
        if (event.finishReason) {
          finishReason = event.finishReason;
        }
      }

      finished = true;
      writeEvent(res, "done", { finishReason });
      logger.info("AI chat generation completed", {
        label: "AI Chat",
        userId,
        durationMs: Date.now() - startedAt,
        finishReason,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        if (abortCode !== "cancelled") {
          writeEvent(res, "error", {
            code: abortCode,
            message:
              abortCode === "timeout"
                ? "Qwen took too long to respond."
                : "Qwen is currently unavailable.",
          });
        }
      } else {
        writeEvent(res, "error", {
          code: "unavailable",
          message: "Qwen is currently unavailable.",
        });
        logger.error("AI chat proxy failed", {
          label: "AI Chat",
          userId,
          errorMessage:
            error instanceof Error ? error.message : "Unknown error",
        });
      }
    } finally {
      finished = true;
      clearTimeout(gatewayTimer);
      if (firstResponseTimer) {
        clearTimeout(firstResponseTimer);
      }
      clearTimeout(totalTimer);
      clearInterval(heartbeat);
      if (idleTimer) {
        clearTimeout(idleTimer);
      }
      release();
      if (!res.writableEnded) {
        res.end();
      }
    }
  }
);

export default chatRoutes;
