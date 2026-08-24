import CachedImage from "@app/components/Common/CachedImage";
import {
  ArrowUpIcon,
  ClipboardDocumentIcon,
  FilmIcon,
  StopIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

type ChatRole = "user" | "assistant";

interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  cards?: MediaCardData[];
}

interface MediaCardData {
  kind: "media";
  mediaType: "movie" | "tv";
  tmdbId: number;
  title: string;
  year?: string;
  overview?: string;
  posterPath?: string;
  voteAverage?: number;
  voteCount?: number;
  status: "available" | "partial" | "processing" | "pending" | "unknown";
  href: string;
  request?: { token: string; label: string; expiresAt: string; note: string };
}

interface StreamPayload {
  phase?: "connecting" | "thinking" | "answering";
  delta?: string;
  finishReason?: string;
  code?: string;
  message?: string;
  cards?: MediaCardData[];
  model?: string;
  modelName?: string;
  gpu?: string;
  contextWindowTokens?: number;
  contextUsedPercent?: number;
  tokensPerSecond?: number;
}

interface ModelInfo {
  model: string;
  modelName: string;
  gpu: string;
  contextWindowTokens: number;
  contextUsedPercent?: number;
  tokensPerSecond?: number;
}

interface PromptSuggestion {
  text: string;
  parts: { text: string; variable: boolean }[];
}

const variable = (text: string) => ({ text });

const suggestion = (
  ...parts: (string | ReturnType<typeof variable>)[]
): PromptSuggestion => ({
  text: parts
    .map((part) => (typeof part === "string" ? part : part.text))
    .join(""),
  parts: parts.map((part) => ({
    text: typeof part === "string" ? part : part.text,
    variable: typeof part !== "string",
  })),
});

const AI_CHAT_SUGGESTIONS: PromptSuggestion[] = [
  suggestion("Is ", variable("Megalopolis"), " ready to watch on the server?"),
  suggestion(
    "Show me the metadata and poster for ",
    variable("Heat (1995)"),
    "."
  ),
  suggestion("Who directed ", variable("The Thing (1982)"), "?"),
  suggestion("Who stars in ", variable("Phantom Thread"), "?"),
  suggestion("What is the IMDb ID for ", variable("Mulholland Drive"), "?"),
  suggestion("Is ", variable("Severance"), " on Plex?"),
  suggestion(
    "Compare availability for ",
    variable("Dune (1984)"),
    " and ",
    variable("Dune (2021)"),
    "."
  ),
  suggestion(
    "Which ",
    variable("Paul Thomas Anderson"),
    " movies are on Plex?"
  ),
  suggestion("Show me ", variable("Robert De Niro"), " movies ready to watch."),
  suggestion("What movies did ", variable("Céline Sciamma"), " direct?"),
  suggestion(
    "What are the best films written by ",
    variable("Charlie Kaufman"),
    "?"
  ),
  suggestion(
    "Look up ",
    variable("Tilda Swinton"),
    " and show her essential films and biography."
  ),
  suggestion("Which ", variable("David Lynch"), " series do we have?"),
  suggestion("Is ", variable("Tom Cruise"), " in ", variable("Magnolia"), "?"),
  suggestion("How many ", variable("movies and series"), " are ready on Plex?"),
  suggestion("What was added to the server ", variable("recently"), "?"),
  suggestion(
    "Show me three ",
    variable("highly rated dramas"),
    " ready on Plex."
  ),
  suggestion(
    "Show me a few ",
    variable("series ready to watch"),
    " right now."
  ),
  suggestion(
    "Find three ",
    variable("horror movies rated 7+"),
    " on the server."
  ),
  suggestion(
    "Find a great ",
    variable("comedy under 110 minutes"),
    " on Plex."
  ),
  suggestion(
    "Show me some ",
    variable("high-brow science fiction"),
    " ready to watch on Plex."
  ),
  suggestion(
    "Help me choose a movie; ask ",
    variable("one question at a time"),
    "."
  ),
  suggestion(
    "Tonight I want something ",
    variable("tense, under two hours, no superheroes"),
    "."
  ),
  suggestion(
    "Recommend three movies like ",
    variable("Parasite"),
    " that are on the server."
  ),
  suggestion(
    "Pick one ",
    variable("foreign-language adventure movie"),
    " from Plex that is ready to watch."
  ),
  suggestion("Request ", variable("Megalopolis"), " for me."),
  suggestion("Download ", variable("Heat (1995)"), "."),
  suggestion("Add ", variable("season 1 of Severance"), "."),
  suggestion("Request ", variable("The Thing"), "—ask me which one if needed."),
  suggestion("What is the status of ", variable("my recent requests"), "?"),
  suggestion("What is ", variable("downloading right now"), "?"),
  suggestion("Is ", variable("Dune"), " still downloading?"),
  suggestion(
    "Show posters for the three best ",
    variable("PTA movies on Plex"),
    "."
  ),
  suggestion(
    variable("“Bush did 9/11…” is a terrible movie pitch."),
    " Is ",
    variable("Fahrenheit 9/11"),
    " on Plex?"
  ),
  suggestion(variable("The downloads yearn for freedom"), "—what is stuck?"),
];

const STORAGE_KEY = "chanflix.ai.chat.v1";
const MAX_MESSAGE_CHARS = 16_000;
const DEFAULT_MODEL_INFO: ModelInfo = {
  model: "qwen-main",
  modelName: "gittensor-model-hub/Qwen3.8-27B-NVFP4-RTX5090",
  gpu: "NVIDIA RTX 5090",
  contextWindowTokens: 80_000,
};

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

    const messages = stored
      .filter(
        (message): message is ChatMessage =>
          !!message &&
          typeof message.id === "string" &&
          (message.role === "user" || message.role === "assistant") &&
          typeof message.content === "string" &&
          !!message.content.trim()
      )
      .map((message) => ({
        id: message.id,
        role: message.role,
        content: message.content,
        cards: Array.isArray(message.cards)
          ? message.cards
              .filter(
                (card) =>
                  card &&
                  card.kind === "media" &&
                  (card.mediaType === "movie" || card.mediaType === "tv") &&
                  Number.isInteger(card.tmdbId) &&
                  card.tmdbId > 0 &&
                  typeof card.title === "string"
              )
              .slice(0, 5)
              .map((card) => ({
                ...card,
                href: `/${card.mediaType}/${card.tmdbId}`,
                request:
                  card.request &&
                  typeof card.request.token === "string" &&
                  typeof card.request.label === "string" &&
                  typeof card.request.expiresAt === "string" &&
                  typeof card.request.note === "string"
                    ? card.request
                    : undefined,
              }))
          : undefined,
      }));

    return messages.length % 2 === 0 ? messages : [];
  } catch (_error) {
    return [];
  }
};

const saveMessages = (messages: ChatMessage[]) => {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
};

const MediaCard = ({ card }: { card: MediaCardData }) => {
  const [requestState, setRequestState] = useState<
    "idle" | "submitting" | "done" | "error"
  >("idle");
  const [requestMessage, setRequestMessage] = useState("");

  const submitRequest = async () => {
    if (!card.request || requestState !== "idle") return;
    setRequestState("submitting");
    try {
      const csrfToken = getCsrfToken();
      const response = await fetch("/api/v1/chat/request", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "X-XSRF-TOKEN": csrfToken } : {}),
        },
        body: JSON.stringify({ token: card.request.token }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(body.error ?? "Request failed.");
      setRequestMessage(body.message ?? "Request submitted.");
      setRequestState("done");
    } catch (error) {
      setRequestMessage(
        error instanceof Error ? error.message : "Request failed."
      );
      setRequestState("error");
    }
  };

  const statusLabel =
    card.status === "available"
      ? "Ready to watch"
      : card.status === "partial"
      ? "Partially available"
      : card.status === "processing"
      ? "Downloading"
      : card.status === "pending"
      ? "Requested"
      : "Not requested";

  return (
    <article className="flex min-h-[9rem] overflow-hidden border-2 border-gray-700 bg-gray-900">
      <Link href={card.href}>
        <a className="relative block w-24 shrink-0 bg-gray-800 sm:w-28">
          {card.posterPath ? (
            <CachedImage
              src={`https://image.tmdb.org/t/p/w300_and_h450_face${card.posterPath}`}
              alt=""
              layout="fill"
              objectFit="cover"
            />
          ) : (
            <span className="flex h-full items-center justify-center text-gray-600">
              <FilmIcon className="h-8 w-8" />
            </span>
          )}
        </a>
      </Link>
      <div className="min-w-0 flex-1 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <Link href={card.href}>
              <a className="font-bold text-gray-100 hover:text-indigo-400">
                {card.title}
                {card.year ? ` (${card.year})` : ""}
              </a>
            </Link>
            <div className="mt-1 text-xs uppercase tracking-wide text-gray-500">
              {card.mediaType === "movie" ? "Movie" : "Series"} · {statusLabel}
              {typeof card.voteAverage === "number"
                ? ` · ${card.voteAverage.toFixed(1)}/10`
                : ""}
            </div>
          </div>
        </div>
        {card.overview && (
          <p className="line-clamp-3 mt-2 text-sm text-gray-400">
            {card.overview}
          </p>
        )}
        {card.request && requestState !== "done" && (
          <>
            <p className="mt-2 text-xs text-gray-500">{card.request.note}</p>
            <button
              type="button"
              onClick={submitRequest}
              disabled={
                requestState === "submitting" || requestState === "error"
              }
              className="mt-3 border border-indigo-500 px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-indigo-400 hover:bg-indigo-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {requestState === "submitting"
                ? "Submitting…"
                : card.request.label}
            </button>
          </>
        )}
        {requestMessage && (
          <p
            className={`mt-2 text-xs ${
              requestState === "error" ? "text-red-400" : "text-green-400"
            }`}
          >
            {requestMessage}
          </p>
        )}
      </div>
    </article>
  );
};

const MediaCards = ({ cards }: { cards?: MediaCardData[] }) =>
  cards?.length ? (
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      {cards.map((card) => (
        <MediaCard
          key={`${card.mediaType}:${card.tmdbId}:${card.request?.token ?? ""}`}
          card={card}
        />
      ))}
    </div>
  ) : null;

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
      <MediaCards cards={message.cards} />
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
  const [streamingCards, setStreamingCards] = useState<MediaCardData[]>([]);
  const [reasoning, setReasoning] = useState("");
  const [phase, setPhase] = useState<"connecting" | "thinking" | "answering">(
    "connecting"
  );
  const [waking, setWaking] = useState(false);
  const [error, setError] = useState("");
  const [contextNotice, setContextNotice] = useState("");
  const [modelInfo, setModelInfo] = useState<ModelInfo>(DEFAULT_MODEL_INFO);
  const [suggestionOrder, setSuggestionOrder] = useState(() =>
    AI_CHAT_SUGGESTIONS.map((_, index) => index)
  );
  const [suggestionOffset, setSuggestionOffset] = useState(0);
  const [suggestionsPaused, setSuggestionsPaused] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const reasoningRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const controllerRef = useRef<AbortController>();
  const followStreamRef = useRef(true);
  const mountedRef = useRef(true);
  const answerTextRef = useRef("");
  const answerBufferRef = useRef("");
  const reasoningBufferRef = useRef("");
  const frameRef = useRef<number>();
  const hasAnswerRef = useRef(false);
  const cardsRef = useRef<MediaCardData[]>([]);
  const blockedByFailedTurn =
    !streaming && messages[messages.length - 1]?.role === "user";

  useEffect(() => {
    setMessages(restoreMessages());
    setSuggestionOrder((current) => {
      const shuffled = [...current];
      for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const swapWith = Math.floor(Math.random() * (index + 1));
        [shuffled[index], shuffled[swapWith]] = [
          shuffled[swapWith],
          shuffled[index],
        ];
      }
      return shuffled;
    });
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (messages.length || streaming || suggestionsPaused) return;
    const timer = window.setInterval(() => {
      setSuggestionOffset(
        (current) => (current + 4) % AI_CHAT_SUGGESTIONS.length
      );
    }, 12_000);
    return () => window.clearInterval(timer);
  }, [messages.length, streaming, suggestionsPaused]);

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

  useEffect(() => {
    if (reasoningRef.current) {
      reasoningRef.current.scrollTop = reasoningRef.current.scrollHeight;
    }
  }, [reasoning]);

  useEffect(() => {
    if (!streaming && !blockedByFailedTurn) {
      requestAnimationFrame(() =>
        composerRef.current?.focus({ preventScroll: true })
      );
    }
  }, [blockedByFailedTurn, streaming]);

  useEffect(() => {
    const focusComposer = (event: KeyboardEvent) => {
      if (
        streaming ||
        blockedByFailedTurn ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) {
        return;
      }
      const target = event.target as HTMLElement | null;
      const isEditable =
        target?.isContentEditable ||
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLButtonElement;
      if (!isEditable && (event.key === "/" || event.key === "Enter")) {
        event.preventDefault();
        composerRef.current?.focus({ preventScroll: true });
      }
    };
    window.addEventListener("keydown", focusComposer);
    return () => window.removeEventListener("keydown", focusComposer);
  }, [blockedByFailedTurn, streaming]);

  const processEvent = useCallback(
    (eventName: string, payload: StreamPayload) => {
      if (eventName === "status" && payload.phase) {
        setPhase(payload.phase);
        return;
      }

      if (
        eventName === "meta" &&
        payload.model &&
        payload.modelName &&
        payload.gpu &&
        typeof payload.contextWindowTokens === "number"
      ) {
        setModelInfo({
          model: payload.model,
          modelName: payload.modelName,
          gpu: payload.gpu,
          contextWindowTokens: payload.contextWindowTokens,
          contextUsedPercent: payload.contextUsedPercent,
          tokensPerSecond: payload.tokensPerSecond,
        });
        return;
      }

      if (eventName === "context" && payload.message) {
        setContextNotice(payload.message);
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
        return;
      }

      if (eventName === "cards" && Array.isArray(payload.cards)) {
        const cards = payload.cards.filter(
          (card) =>
            card &&
            card.kind === "media" &&
            (card.mediaType === "movie" || card.mediaType === "tv") &&
            typeof card.tmdbId === "number" &&
            typeof card.title === "string"
        );
        const merged = new Map(
          cardsRef.current.map((card) => [
            `${card.mediaType}:${card.tmdbId}`,
            card,
          ])
        );
        cards.forEach((card) => {
          merged.set(`${card.mediaType}:${card.tmdbId}`, card);
        });
        cardsRef.current = Array.from(merged.values()).slice(0, 5);
        setStreamingCards(cardsRef.current);
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
      cardsRef.current = [];
      followStreamRef.current = true;
      setStreaming(true);
      setStreamingAnswer("");
      setStreamingCards([]);
      setReasoning("");
      setError("");
      setContextNotice("");
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
          {
            id: createId(),
            role: "assistant" as const,
            content: answer,
            cards: cardsRef.current.length ? cardsRef.current : undefined,
          },
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
          setStreamingCards([]);
        }
        controllerRef.current = undefined;
      }
    },
    [flushBuffers, processEvent]
  );

  const sendContent = async (rawContent: string) => {
    const content = rawContent.trim();
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

  const send = () => sendContent(draft);

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
    setContextNotice("");
    setReasoning("");
    setStreamingAnswer("");
    setStreamingCards([]);
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
  const visibleSuggestions = Array.from({ length: 4 }, (_, index) => {
    const orderedIndex =
      suggestionOrder[(suggestionOffset + index) % suggestionOrder.length];
    return AI_CHAT_SUGGESTIONS[orderedIndex];
  });
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
            <div className="w-full max-w-3xl">
              <div className="mb-2 text-2xl text-indigo-400">_</div>
              <p className="font-bold uppercase tracking-wider text-gray-300">
                Ask anything
              </p>
              <p className="mt-1 text-sm text-gray-500">
                One private, session-only conversation with Qwen.
              </p>
              <div
                className="mt-7"
                onMouseEnter={() => setSuggestionsPaused(true)}
                onMouseLeave={() => setSuggestionsPaused(false)}
                onFocusCapture={() => setSuggestionsPaused(true)}
                onBlurCapture={() => setSuggestionsPaused(false)}
              >
                <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.22em] text-gray-600">
                  Try asking
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {visibleSuggestions.map((item, index) => (
                    <button
                      key={`${
                        suggestionOrder[
                          (suggestionOffset + index) % suggestionOrder.length
                        ]
                      }:${suggestionOffset}`}
                      type="button"
                      onClick={() => sendContent(item.text)}
                      className="group border border-gray-800 bg-gray-900/60 px-4 py-3 text-left text-sm leading-relaxed text-gray-500 transition-colors hover:border-gray-600 hover:bg-gray-900 hover:text-gray-400 focus:border-[#fabd2f] focus:outline-none"
                    >
                      {item.parts.map((part, partIndex) => (
                        <span
                          key={`${part.text}:${partIndex}`}
                          className={
                            part.variable
                              ? "font-medium text-[#fabd2f] group-hover:text-[#ffd75f]"
                              : undefined
                          }
                        >
                          {part.text}
                        </span>
                      ))}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {messages.map((message) => (
          <Message key={message.id} message={message} />
        ))}

        {contextNotice && (
          <p className="max-w-3xl text-xs text-gray-500">{contextNotice}</p>
        )}

        {streaming && (
          <article className="max-w-3xl border-l-2 border-indigo-500 bg-gray-900 px-4 py-3">
            {!streamingAnswer && (
              <div className="mb-2 text-xs font-bold uppercase tracking-wide text-indigo-400">
                {statusText}
              </div>
            )}
            {reasoning && !streamingAnswer && (
              <div
                ref={reasoningRef}
                className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-sm text-gray-500"
              >
                {reasoning}
                <span className="ml-1 animate-pulse text-indigo-400">_</span>
              </div>
            )}
            {streamingAnswer && <Markdown content={streamingAnswer} />}
            <MediaCards cards={streamingCards} />
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
            autoFocus
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
      <div className="space-y-1 py-2 text-center text-[10px] uppercase tracking-wide text-gray-600">
        <p>/ or Enter to focus · Enter to send · Shift+Enter for newline</p>
        <p className="normal-case tracking-normal" title={modelInfo.modelName}>
          {modelInfo.modelName} · {modelInfo.gpu}
          {typeof modelInfo.tokensPerSecond === "number"
            ? ` · ${modelInfo.tokensPerSecond.toFixed(1)} tok/s`
            : " · tok/s —"}
          {typeof modelInfo.contextUsedPercent === "number"
            ? ` · ${modelInfo.contextUsedPercent.toFixed(1)}% context`
            : " · context —"}
        </p>
      </div>
    </div>
  );
};

export default AiChat;
