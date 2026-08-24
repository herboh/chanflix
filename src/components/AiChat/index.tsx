import {
  ArrowUpIcon,
  ClipboardDocumentIcon,
  StopIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

type ChatRole = "user" | "assistant";

interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
}

interface StreamPayload {
  phase?: "connecting" | "thinking" | "answering";
  delta?: string;
  finishReason?: string;
  code?: string;
  message?: string;
}

const STORAGE_KEY = "chanflix.ai.chat.v1";
const MAX_MESSAGE_CHARS = 16_000;

const createId = () =>
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const getCsrfToken = (): string | undefined => {
  const cookie = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith("XSRF-TOKEN="));

  return cookie
    ? decodeURIComponent(cookie.slice("XSRF-TOKEN=".length))
    : undefined;
};

const restoreMessages = (): ChatMessage[] => {
  try {
    const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(stored)) {
      return [];
    }

    const messages = stored.filter(
      (message): message is ChatMessage =>
        !!message &&
        typeof message.id === "string" &&
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string" &&
        !!message.content.trim()
    );

    return messages.length % 2 === 0 ? messages : [];
  } catch (_error) {
    return [];
  }
};

const saveMessages = (messages: ChatMessage[]) => {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
};

const Markdown = ({ content }: { content: string }) => (
  <ReactMarkdown
    skipHtml
    className="prose prose-invert max-w-none break-words text-sm text-gray-200 prose-headings:text-gray-100 prose-a:text-indigo-400 prose-code:text-yellow-400 prose-pre:overflow-x-auto prose-pre:border prose-pre:border-gray-700 prose-pre:bg-gray-900 sm:text-base"
    components={{
      a: ({ node: _node, ...props }) => (
        <a {...props} target="_blank" rel="noreferrer" />
      ),
    }}
  >
    {content}
  </ReactMarkdown>
);

const Message = ({ message }: { message: ChatMessage }) => {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  if (message.role === "user") {
    return (
      <article className="ml-auto max-w-3xl border-r-2 border-indigo-500 bg-gray-800 px-4 py-3 text-right text-sm text-gray-100 sm:text-base">
        <div className="whitespace-pre-wrap break-words">{message.content}</div>
      </article>
    );
  }

  return (
    <article className="group max-w-3xl border-l-2 border-gray-600 bg-gray-900 px-4 py-3">
      <Markdown content={message.content} />
      <button
        type="button"
        onClick={copy}
        className="mt-2 flex items-center gap-1 text-xs uppercase tracking-wide text-gray-500 opacity-100 hover:text-gray-300 sm:opacity-0 sm:focus:opacity-100 sm:group-hover:opacity-100"
        aria-label="Copy answer"
      >
        <ClipboardDocumentIcon className="h-4 w-4" />
        {copied ? "Copied" : "Copy"}
      </button>
    </article>
  );
};

const AiChat = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamingAnswer, setStreamingAnswer] = useState("");
  const [reasoning, setReasoning] = useState("");
  const [phase, setPhase] = useState<"connecting" | "thinking" | "answering">(
    "connecting"
  );
  const [waking, setWaking] = useState(false);
  const [error, setError] = useState("");
  const scrollerRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const controllerRef = useRef<AbortController>();
  const followStreamRef = useRef(true);
  const mountedRef = useRef(true);
  const answerTextRef = useRef("");
  const answerBufferRef = useRef("");
  const reasoningBufferRef = useRef("");
  const frameRef = useRef<number>();
  const hasAnswerRef = useRef(false);

  useEffect(() => {
    setMessages(restoreMessages());
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);

  const flushBuffers = useCallback(() => {
    frameRef.current = undefined;
    if (reasoningBufferRef.current && !hasAnswerRef.current) {
      const next = reasoningBufferRef.current;
      reasoningBufferRef.current = "";
      setReasoning((current) => current + next);
    }
    if (answerBufferRef.current) {
      const next = answerBufferRef.current;
      answerBufferRef.current = "";
      setStreamingAnswer((current) => current + next);
    }
  }, []);

  const scheduleFlush = useCallback(() => {
    if (!frameRef.current) {
      frameRef.current = requestAnimationFrame(flushBuffers);
    }
  }, [flushBuffers]);

  const scrollToBottom = useCallback(() => {
    if (followStreamRef.current && scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    requestAnimationFrame(scrollToBottom);
  }, [messages, reasoning, streamingAnswer, error, scrollToBottom]);

  const processEvent = useCallback(
    (eventName: string, payload: StreamPayload) => {
      if (eventName === "status" && payload.phase) {
        setPhase(payload.phase);
        return;
      }

      if (eventName === "reasoning" && payload.delta && !hasAnswerRef.current) {
        setPhase("thinking");
        reasoningBufferRef.current += payload.delta;
        scheduleFlush();
        return;
      }

      if (eventName === "content" && payload.delta) {
        if (!hasAnswerRef.current) {
          hasAnswerRef.current = true;
          reasoningBufferRef.current = "";
          setReasoning("");
          setPhase("answering");
        }
        answerTextRef.current += payload.delta;
        answerBufferRef.current += payload.delta;
        scheduleFlush();
      }
    },
    [scheduleFlush]
  );

  const startStream = useCallback(
    async (requestMessages: ChatMessage[]) => {
      const controller = new AbortController();
      controllerRef.current = controller;
      answerTextRef.current = "";
      answerBufferRef.current = "";
      reasoningBufferRef.current = "";
      hasAnswerRef.current = false;
      followStreamRef.current = true;
      setStreaming(true);
      setStreamingAnswer("");
      setReasoning("");
      setError("");
      setPhase("connecting");
      setWaking(false);

      const wakingTimer = window.setTimeout(() => {
        if (!hasAnswerRef.current && mountedRef.current) {
          setWaking(true);
        }
      }, 1200);

      try {
        const csrfToken = getCsrfToken();
        const response = await fetch("/api/v1/chat", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            ...(csrfToken ? { "X-XSRF-TOKEN": csrfToken } : {}),
          },
          body: JSON.stringify({
            messages: requestMessages.map(({ role, content }) => ({
              role,
              content,
            })),
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error ?? "Qwen could not start this request.");
        }
        if (!response.body) {
          throw new Error("Qwen returned an empty response.");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let streamError = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          buffer = (buffer + decoder.decode(value, { stream: true })).replace(
            /\r\n/g,
            "\n"
          );
          const blocks = buffer.split("\n\n");
          buffer = blocks.pop() ?? "";

          for (const block of blocks) {
            const eventName =
              block
                .split("\n")
                .find((line) => line.startsWith("event:"))
                ?.slice(6)
                .trim() ?? "";
            const data = block
              .split("\n")
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trimStart())
              .join("\n");

            if (!eventName || !data) {
              continue;
            }

            const payload = JSON.parse(data) as StreamPayload;
            if (eventName === "error") {
              streamError =
                payload.message ?? "Qwen could not complete this request.";
              break;
            }
            processEvent(eventName, payload);
          }

          if (streamError) {
            await reader.cancel();
            throw new Error(streamError);
          }
        }

        flushBuffers();
        const answer = answerTextRef.current.trim();
        if (!answer) {
          throw new Error("Qwen returned no final answer.");
        }

        const completed = [
          ...requestMessages,
          { id: createId(), role: "assistant" as const, content: answer },
        ];
        if (mountedRef.current) {
          setMessages(completed);
          saveMessages(completed);
        }
      } catch (streamError) {
        if (mountedRef.current) {
          setError(
            controller.signal.aborted
              ? "Generation stopped."
              : streamError instanceof Error
              ? streamError.message
              : "Qwen is currently unavailable."
          );
        }
      } finally {
        window.clearTimeout(wakingTimer);
        if (mountedRef.current) {
          setStreaming(false);
          setWaking(false);
          setReasoning("");
          setStreamingAnswer("");
        }
        controllerRef.current = undefined;
      }
    },
    [flushBuffers, processEvent]
  );

  const send = async () => {
    const content = draft.trim();
    if (
      !content ||
      streaming ||
      messages[messages.length - 1]?.role === "user"
    ) {
      return;
    }

    const nextMessages = [
      ...messages,
      { id: createId(), role: "user" as const, content },
    ];
    setMessages(nextMessages);
    setDraft("");
    if (composerRef.current) {
      composerRef.current.style.height = "auto";
    }
    await startStream(nextMessages);
  };

  const retry = () => {
    if (!streaming && messages[messages.length - 1]?.role === "user") {
      startStream(messages);
    }
  };

  const stop = () => controllerRef.current?.abort();

  const newChat = () => {
    controllerRef.current?.abort();
    sessionStorage.removeItem(STORAGE_KEY);
    setMessages([]);
    setDraft("");
    setError("");
    setReasoning("");
    setStreamingAnswer("");
    composerRef.current?.focus();
  };

  const onScroll = () => {
    const scroller = scrollerRef.current;
    if (scroller) {
      followStreamRef.current =
        scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 96;
    }
  };

  const statusText =
    phase === "thinking"
      ? "Thinking…"
      : phase === "answering"
      ? "Answering…"
      : waking
      ? "Waking Qwen…"
      : "Connecting…";
  const blockedByFailedTurn =
    !streaming && messages[messages.length - 1]?.role === "user";

  return (
    <div className="mx-auto flex h-[calc(100vh-10rem)] max-w-5xl flex-col sm:h-[calc(100vh-7rem)]">
      <header className="flex items-center justify-between border-b-2 border-gray-700 py-3">
        <div>
          <h1 className="text-lg font-bold uppercase tracking-wider text-indigo-400">
            &gt; Qwen
          </h1>
          <p className="text-xs uppercase tracking-wide text-gray-500">
            Local AI · session-only history
          </p>
        </div>
        <button
          type="button"
          onClick={newChat}
          className="flex items-center gap-2 border border-gray-700 bg-gray-900 px-3 py-2 text-xs font-bold uppercase tracking-wide text-gray-300 hover:border-gray-500 hover:text-white"
        >
          <TrashIcon className="h-4 w-4" />
          New chat
        </button>
      </header>

      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className="flex-1 space-y-5 overflow-y-auto py-5 pr-1"
        aria-live="polite"
      >
        {messages.length === 0 && !streaming && (
          <div className="flex h-full min-h-[14rem] items-center justify-center text-center">
            <div>
              <div className="mb-2 text-2xl text-indigo-400">_</div>
              <p className="font-bold uppercase tracking-wider text-gray-300">
                Ask anything
              </p>
              <p className="mt-1 text-sm text-gray-500">
                One private, session-only conversation with Qwen.
              </p>
            </div>
          </div>
        )}

        {messages.map((message) => (
          <Message key={message.id} message={message} />
        ))}

        {streaming && (
          <article className="max-w-3xl border-l-2 border-indigo-500 bg-gray-900 px-4 py-3">
            {!streamingAnswer && (
              <div className="mb-2 text-xs font-bold uppercase tracking-wide text-indigo-400">
                {statusText}
              </div>
            )}
            {reasoning && !streamingAnswer && (
              <div className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-sm text-gray-500">
                {reasoning}
                <span className="ml-1 animate-pulse text-indigo-400">_</span>
              </div>
            )}
            {streamingAnswer && <Markdown content={streamingAnswer} />}
          </article>
        )}

        {error && (
          <div className="max-w-3xl border-l-2 border-red-500 bg-gray-900 px-4 py-3 text-sm text-red-400">
            <p>{error}</p>
            {blockedByFailedTurn && (
              <button
                type="button"
                onClick={retry}
                className="mt-3 border border-red-700 px-3 py-1 text-xs font-bold uppercase tracking-wide hover:border-red-400"
              >
                Retry
              </button>
            )}
          </div>
        )}
      </div>

      <form
        className="border-2 border-gray-700 bg-gray-900 p-2 focus-within:border-indigo-500"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <div className="flex items-end gap-2">
          <textarea
            ref={composerRef}
            value={draft}
            maxLength={MAX_MESSAGE_CHARS}
            rows={1}
            disabled={streaming || blockedByFailedTurn}
            placeholder={
              blockedByFailedTurn
                ? "Retry the failed message or start a new chat"
                : "Message Qwen…"
            }
            className="max-h-40 min-h-[2.75rem] flex-1 resize-none border-0 bg-transparent px-2 py-3 text-sm text-gray-100 placeholder:text-gray-600 focus:ring-0 disabled:cursor-not-allowed disabled:opacity-60 sm:text-base"
            onChange={(event) => {
              setDraft(event.target.value);
              event.target.style.height = "auto";
              event.target.style.height = `${Math.min(
                event.target.scrollHeight,
                160
              )}px`;
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                send();
              }
            }}
            aria-label="Message Qwen"
          />
          {streaming ? (
            <button
              type="button"
              onClick={stop}
              className="flex h-11 w-11 items-center justify-center border border-red-700 text-red-400 hover:border-red-400 hover:text-red-300"
              aria-label="Stop generation"
            >
              <StopIcon className="h-5 w-5" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!draft.trim() || blockedByFailedTurn}
              className="flex h-11 w-11 items-center justify-center border border-indigo-600 bg-indigo-700 text-gray-900 hover:bg-indigo-500 disabled:cursor-not-allowed disabled:border-gray-700 disabled:bg-gray-800 disabled:text-gray-600"
              aria-label="Send message"
            >
              <ArrowUpIcon className="h-5 w-5" />
            </button>
          )}
        </div>
      </form>
      <p className="py-2 text-center text-[10px] uppercase tracking-wide text-gray-600">
        Enter to send · Shift+Enter for newline
      </p>
    </div>
  );
};

export default AiChat;
