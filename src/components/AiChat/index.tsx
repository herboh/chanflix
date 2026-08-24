import RTAudFresh from "@app/assets/rt_aud_fresh.svg";
import RTAudRotten from "@app/assets/rt_aud_rotten.svg";
import RTFresh from "@app/assets/rt_fresh.svg";
import RTRotten from "@app/assets/rt_rotten.svg";
import ImdbLogo from "@app/assets/services/imdb.svg";
import CachedImage from "@app/components/Common/CachedImage";
import {
  ArrowUpIcon,
  ClipboardDocumentIcon,
  FilmIcon,
  PlusCircleIcon,
  StopIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import {
  BellIcon,
  CheckCircleIcon,
  ClockIcon,
} from "@heroicons/react/24/solid";
import type { RTRating } from "@server/api/rating/rottentomatoes";
import type { RatingResponse } from "@server/api/ratings";
import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import useSWR from "swr";

type ChatRole = "user" | "assistant";

interface MediaContext {
  mediaType: "movie" | "tv";
  tmdbId: number;
  title: string;
  year?: string;
}

interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  cards?: MediaCardData[];
  mediaContext?: MediaContext;
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

interface MediaRatingsResponse {
  ratings: Record<string, RatingResponse | RTRating | null>;
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
        mediaContext:
          message.mediaContext &&
          (message.mediaContext.mediaType === "movie" ||
            message.mediaContext.mediaType === "tv") &&
          Number.isInteger(message.mediaContext.tmdbId) &&
          message.mediaContext.tmdbId > 0 &&
          typeof message.mediaContext.title === "string"
            ? {
                mediaType: message.mediaContext.mediaType,
                tmdbId: message.mediaContext.tmdbId,
                title: message.mediaContext.title.slice(0, 200),
                year:
                  typeof message.mediaContext.year === "string" &&
                  /^\d{4}$/.test(message.mediaContext.year)
                    ? message.mediaContext.year
                    : undefined,
              }
            : undefined,
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
              .slice(0, 4)
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

const RatingChip = ({
  href,
  icon,
  label,
  value,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  value: string;
}) => (
  <a
    href={href}
    target="_blank"
    rel="noreferrer"
    title={label}
    className="relative z-20 inline-flex items-center gap-1 border border-gray-700 bg-gray-900 px-2 py-1 text-xs font-bold text-gray-200 transition hover:border-gray-500 hover:text-white"
  >
    <span className="flex h-4 w-4 items-center justify-center">{icon}</span>
    <span>{value}</span>
  </a>
);

const MediaCard = ({
  card,
  ratings,
  onPrepareAgain,
}: {
  card: MediaCardData;
  ratings?: RatingResponse | RTRating | null;
  onPrepareAgain?: (card: MediaCardData) => void;
}) => {
  const [requestState, setRequestState] = useState<
    "idle" | "submitting" | "done" | "error"
  >("idle");
  const [requestMessage, setRequestMessage] = useState("");
  const [requestExpired, setRequestExpired] = useState(false);
  const rtRating =
    card.mediaType === "movie"
      ? (ratings as RatingResponse | undefined)?.rt
      : (ratings as RTRating | undefined);
  const imdbRating =
    card.mediaType === "movie"
      ? (ratings as RatingResponse | undefined)?.imdb
      : undefined;

  useEffect(() => {
    if (!card.request) return;
    const expiresAt = Date.parse(card.request.expiresAt);
    if (!Number.isFinite(expiresAt)) {
      setRequestExpired(true);
      return;
    }

    const updateExpired = () => setRequestExpired(Date.now() >= expiresAt);
    updateExpired();
    const timeout = window.setTimeout(
      updateExpired,
      Math.max(0, expiresAt - Date.now())
    );
    return () => window.clearTimeout(timeout);
  }, [card.request]);

  const submitRequest = async () => {
    if (
      !card.request ||
      requestExpired ||
      requestState === "submitting" ||
      requestState === "done"
    )
      return;
    setRequestState("submitting");
    setRequestMessage("");
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
      if (!response.ok) {
        if (response.status !== 429) setRequestExpired(true);
        throw new Error(body.error ?? "Request failed.");
      }
      setRequestMessage(body.message ?? "Request submitted.");
      setRequestState("done");
    } catch (error) {
      setRequestMessage(
        error instanceof Error ? error.message : "Request failed."
      );
      setRequestState("error");
    }
  };

  const effectiveStatus = requestState === "done" ? "pending" : card.status;
  const status =
    effectiveStatus === "available"
      ? {
          label: "On server",
          border: "border-green-500",
          badge: "border-green-400 bg-green-900 text-green-100",
          icon: <CheckCircleIcon className="h-4 w-4" />,
        }
      : effectiveStatus === "partial"
      ? {
          label: "Partially on server",
          border: "border-green-700",
          badge: "border-green-500 bg-green-900 text-green-100",
          icon: <CheckCircleIcon className="h-4 w-4" />,
        }
      : effectiveStatus === "processing"
      ? {
          label: "Downloading",
          border: "border-orange-500",
          badge: "border-orange-400 bg-orange-900 text-orange-100",
          icon: <ClockIcon className="h-4 w-4" />,
        }
      : effectiveStatus === "pending"
      ? {
          label: "Requested",
          border: "border-yellow-500",
          badge: "border-yellow-400 bg-yellow-900 text-yellow-100",
          icon: <BellIcon className="h-4 w-4" />,
        }
      : {
          label: "Available to request",
          border: "border-gray-600",
          badge: "border-gray-500 bg-gray-900 text-gray-200",
          icon: <PlusCircleIcon className="h-4 w-4" />,
        };

  return (
    <article
      className={`relative flex h-full min-w-0 cursor-pointer flex-col overflow-hidden border-2 bg-gray-900 transition focus-within:ring-2 focus-within:ring-indigo-400 hover:bg-gray-800 ${status.border}`}
    >
      <Link href={card.href}>
        <a
          className="absolute inset-0 z-10"
          aria-label={`Open ${card.title}`}
        />
      </Link>
      <div className="relative aspect-[2/3] w-full overflow-hidden bg-gray-800">
        {card.posterPath ? (
          <CachedImage
            src={`https://image.tmdb.org/t/p/w300_and_h450_face${card.posterPath}`}
            alt={`${card.title} poster`}
            layout="fill"
            objectFit="cover"
          />
        ) : (
          <span className="flex h-full items-center justify-center text-gray-600">
            <FilmIcon className="h-12 w-12" />
          </span>
        )}
        <span
          className={`pointer-events-none absolute left-2 top-2 z-20 inline-flex items-center gap-1.5 border px-2 py-1 text-[0.65rem] font-bold uppercase tracking-wide shadow-lg ${status.badge}`}
        >
          {status.icon}
          {status.label}
        </span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col p-3">
        <h3 className="m-0 text-base font-bold leading-tight text-gray-100 line-clamp-2">
          {card.title}
        </h3>
        <div className="mt-1 text-xs uppercase tracking-wide text-gray-500">
          {card.year ?? "Year unknown"} ·{" "}
          {card.mediaType === "movie" ? "Movie" : "Series"}
        </div>
        <div className="mt-3 flex min-h-[1.75rem] flex-wrap gap-1.5">
          {rtRating?.criticsScore ? (
            <RatingChip
              href={rtRating.url}
              label="Rotten Tomatoes critics"
              value={`${rtRating.criticsScore}%`}
              icon={
                rtRating.criticsRating === "Rotten" ? (
                  <RTRotten className="h-4 w-4" />
                ) : (
                  <RTFresh className="h-4 w-4" />
                )
              }
            />
          ) : null}
          {rtRating?.audienceScore ? (
            <RatingChip
              href={rtRating.url}
              label="Rotten Tomatoes audience"
              value={`${rtRating.audienceScore}%`}
              icon={
                rtRating.audienceRating === "Spilled" ? (
                  <RTAudRotten className="h-4 w-4" />
                ) : (
                  <RTAudFresh className="h-4 w-4" />
                )
              }
            />
          ) : null}
          {imdbRating?.criticsScore ? (
            <RatingChip
              href={imdbRating.url}
              label="IMDb user rating"
              value={imdbRating.criticsScore.toFixed(1)}
              icon={<ImdbLogo className="h-4 w-4" />}
            />
          ) : null}
          {!rtRating && !imdbRating && typeof card.voteAverage === "number" ? (
            <RatingChip
              href={`https://www.themoviedb.org/${card.mediaType}/${card.tmdbId}`}
              label="TMDB user rating"
              value={`${Math.round(card.voteAverage * 10)}%`}
              icon={<span className="text-[0.6rem] text-blue-300">TMDB</span>}
            />
          ) : null}
        </div>
        {card.overview && (
          <div className="mt-3">
            <p className="text-xs leading-relaxed text-gray-400 line-clamp-3">
              {card.overview}
            </p>
            <Link href={card.href}>
              <a className="relative z-20 mt-1 inline-block text-xs font-bold text-indigo-400 hover:text-indigo-300">
                Show more →
              </a>
            </Link>
          </div>
        )}
        {card.request && requestState !== "done" && (
          <>
            <p className="mt-3 text-xs text-gray-500">
              {requestExpired
                ? "This confirmation expired. Prepare a fresh one to continue."
                : card.request.note}
            </p>
            <button
              type="button"
              onClick={() =>
                requestExpired ? onPrepareAgain?.(card) : submitRequest()
              }
              disabled={
                requestState === "submitting" ||
                (requestExpired && !onPrepareAgain)
              }
              className="relative z-20 mt-3 w-full border border-indigo-500 bg-indigo-900 px-3 py-2 text-xs font-bold uppercase tracking-wide text-indigo-200 hover:bg-indigo-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {requestState === "submitting"
                ? "Submitting…"
                : requestExpired
                ? "Prepare again"
                : requestState === "error"
                ? "Try again"
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

const MediaCards = ({
  cards,
  onPrepareAgain,
}: {
  cards?: MediaCardData[];
  onPrepareAgain?: (card: MediaCardData) => void;
}) => {
  const ratingItems = cards
    ?.slice(0, 4)
    .map((card) => `${card.mediaType}:${card.tmdbId}`)
    .join(",");
  const ratingsEndpoint = ratingItems
    ? `/api/v1/chat/ratings?items=${encodeURIComponent(ratingItems)}`
    : null;
  const { data } = useSWR<MediaRatingsResponse>(ratingsEndpoint);

  return cards?.length ? (
    <div className="mt-4 grid max-w-3xl gap-4 sm:grid-cols-2">
      {cards.map((card) => (
        <MediaCard
          key={`${card.mediaType}:${card.tmdbId}:${card.request?.token ?? ""}`}
          card={card}
          ratings={data?.ratings[`${card.mediaType}:${card.tmdbId}`]}
          onPrepareAgain={onPrepareAgain}
        />
      ))}
    </div>
  ) : null;
};

const Markdown = ({ content }: { content: string }) => (
  <ReactMarkdown
    skipHtml
    remarkPlugins={[remarkGfm]}
    className="prose prose-invert max-w-none break-words text-sm text-gray-200 prose-headings:text-gray-100 prose-a:text-indigo-400 prose-code:text-yellow-400 prose-pre:overflow-x-auto prose-pre:border prose-pre:border-gray-700 prose-pre:bg-gray-900 sm:text-base"
    components={{
      a: ({ node: _node, ...props }) => (
        <a {...props} target="_blank" rel="noreferrer" />
      ),
      table: ({ node: _node, ...props }) => (
        <div className="my-4 overflow-x-auto border border-gray-700 bg-gray-900">
          <table {...props} className="m-0 min-w-full text-left text-sm" />
        </div>
      ),
      th: ({ node: _node, ...props }) => (
        <th
          {...props}
          className="border-b border-gray-600 bg-gray-800 px-3 py-2 font-bold text-gray-100"
        />
      ),
      td: ({ node: _node, ...props }) => (
        <td
          {...props}
          className="border-b border-gray-800 px-3 py-2 align-top text-gray-300"
        />
      ),
    }}
  >
    {content}
  </ReactMarkdown>
);

const Message = ({
  message,
  onPrepareAgain,
}: {
  message: ChatMessage;
  onPrepareAgain?: (card: MediaCardData) => void;
}) => {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  if (message.role === "user") {
    return (
      <article className="ml-auto max-w-3xl border-r-2 border-indigo-500 bg-gray-800 px-4 py-3 text-right text-sm text-gray-100 sm:text-base">
        {message.mediaContext && (
          <Link
            href={`/${message.mediaContext.mediaType}/${message.mediaContext.tmdbId}`}
          >
            <a className="mb-2 ml-auto flex w-fit max-w-full items-center gap-2 border border-gray-700 bg-gray-900 px-2.5 py-1.5 text-left text-xs text-gray-400 transition hover:border-indigo-500 hover:text-gray-200">
              <FilmIcon className="h-4 w-4 shrink-0 text-indigo-400" />
              <span className="truncate font-bold text-gray-200">
                {message.mediaContext.title}
              </span>
              <span className="shrink-0 uppercase tracking-wide text-gray-500">
                {message.mediaContext.year
                  ? `${message.mediaContext.year} · `
                  : ""}
                {message.mediaContext.mediaType === "movie"
                  ? "Movie"
                  : "Series"}
              </span>
            </a>
          </Link>
        )}
        <div className="whitespace-pre-wrap break-words">{message.content}</div>
      </article>
    );
  }

  return (
    <article className="group max-w-3xl border-l-2 border-gray-600 bg-gray-900 px-4 py-3">
      <Markdown content={message.content} />
      <MediaCards cards={message.cards} onPrepareAgain={onPrepareAgain} />
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
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [draftMediaContext, setDraftMediaContext] = useState<MediaContext>();
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
  const scrollerRef = useRef<HTMLDivElement>(null);
  const reasoningRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const controllerRef = useRef<AbortController>();
  const abortIntentRef = useRef<"stop" | "reset">();
  const followStreamRef = useRef(true);
  const mountedRef = useRef(true);
  const answerTextRef = useRef("");
  const answerBufferRef = useRef("");
  const reasoningBufferRef = useRef("");
  const frameRef = useRef<number>();
  const mediaHandoffStartedRef = useRef(false);
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
      abortIntentRef.current = "reset";
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

  useEffect(() => {
    if (reasoningRef.current) {
      reasoningRef.current.scrollTop = reasoningRef.current.scrollHeight;
    }
  }, [reasoning]);

  useEffect(() => {
    if (!streaming && !blockedByFailedTurn) {
      requestAnimationFrame(() => {
        const activeElement = document.activeElement;
        if (
          !activeElement ||
          activeElement === document.body ||
          activeElement === document.documentElement ||
          activeElement === composerRef.current
        ) {
          composerRef.current?.focus({ preventScroll: true });
        }
      });
    }
  }, [blockedByFailedTurn, streaming]);

  useEffect(() => {
    const focusComposer = (event: KeyboardEvent) => {
      if (
        streaming ||
        blockedByFailedTurn ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.defaultPrevented
      ) {
        return;
      }
      const target = event.target as HTMLElement | null;
      const interactiveTarget = target?.closest(
        'a[href], button, input, textarea, select, summary, [contenteditable="true"], [role="button"], [role="link"], [tabindex]:not([tabindex="-1"])'
      );
      const isInteractive =
        interactiveTarget && interactiveTarget.tagName !== "MAIN";
      if (!isInteractive && (event.key === "/" || event.key === "Enter")) {
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
        const merged = new Map<string, MediaCardData>();
        cards.forEach((card) => {
          merged.set(`${card.mediaType}:${card.tmdbId}`, card);
        });
        cardsRef.current = Array.from(merged.values()).slice(0, 4);
        setStreamingCards(cardsRef.current);
      }
    },
    [scheduleFlush]
  );

  const startStream = useCallback(
    async (requestMessages: ChatMessage[]) => {
      const controller = new AbortController();
      controllerRef.current = controller;
      abortIntentRef.current = undefined;
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
            messages: requestMessages.map((message) => ({
              role: message.role,
              content: message.content,
              ...(message.mediaContext
                ? {
                    mediaContext: {
                      mediaType: message.mediaContext.mediaType,
                      tmdbId: message.mediaContext.tmdbId,
                    },
                  }
                : {}),
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
          if (controller.signal.aborted && abortIntentRef.current === "stop") {
            flushBuffers();
            const partialAnswer = answerTextRef.current.trim();
            if (partialAnswer) {
              const stoppedMessages = [
                ...requestMessages,
                {
                  id: createId(),
                  role: "assistant" as const,
                  content: partialAnswer,
                  cards: cardsRef.current.length ? cardsRef.current : undefined,
                },
              ];
              setMessages(stoppedMessages);
              saveMessages(stoppedMessages);
              setContextNotice("Generation stopped; partial answer kept.");
            } else {
              const previousMessages = requestMessages.slice(0, -1);
              const stoppedPrompt = requestMessages[requestMessages.length - 1];
              setMessages(previousMessages);
              saveMessages(previousMessages);
              setDraft(stoppedPrompt?.content ?? "");
              setDraftMediaContext(stoppedPrompt?.mediaContext);
              setContextNotice(
                "Generation stopped before an answer; your prompt was restored."
              );
            }
            setError("");
          } else if (!controller.signal.aborted) {
            setError(
              streamError instanceof Error
                ? streamError.message
                : "Qwen is currently unavailable."
            );
          }
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
        if (controllerRef.current === controller) {
          controllerRef.current = undefined;
          abortIntentRef.current = undefined;
        }
      }
    },
    [flushBuffers, processEvent]
  );

  const sendContent = async (
    rawContent: string,
    mediaContext?: MediaContext
  ) => {
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
      {
        id: createId(),
        role: "user" as const,
        content,
        mediaContext: mediaContext ?? draftMediaContext,
      },
    ];
    setMessages(nextMessages);
    setDraft("");
    setDraftMediaContext(undefined);
    if (composerRef.current) {
      composerRef.current.style.height = "auto";
    }
    await startStream(nextMessages);
  };

  useEffect(() => {
    if (!router.isReady || mediaHandoffStartedRef.current) return;

    const mediaType = Array.isArray(router.query.mediaType)
      ? router.query.mediaType[0]
      : router.query.mediaType;
    const rawTmdbId = Array.isArray(router.query.tmdbId)
      ? router.query.tmdbId[0]
      : router.query.tmdbId;
    const tmdbId = rawTmdbId ? Number(rawTmdbId) : 0;
    const hasHandoffQuery = ["mediaType", "tmdbId", "title", "year"].some(
      (key) => router.query[key] !== undefined
    );
    if (
      (mediaType !== "movie" && mediaType !== "tv") ||
      !rawTmdbId ||
      !/^\d+$/.test(rawTmdbId) ||
      !Number.isSafeInteger(tmdbId) ||
      tmdbId <= 0
    ) {
      if (hasHandoffQuery) {
        mediaHandoffStartedRef.current = true;
        void router.replace("/ai", undefined, { shallow: true });
      }
      return;
    }

    mediaHandoffStartedRef.current = true;
    const titleQuery = Array.isArray(router.query.title)
      ? router.query.title[0]
      : router.query.title;
    const yearQuery = Array.isArray(router.query.year)
      ? router.query.year[0]
      : router.query.year;
    const title = titleQuery?.trim().slice(0, 200);
    const year = yearQuery && /^\d{4}$/.test(yearQuery) ? yearQuery : undefined;
    const mediaContext: MediaContext = {
      mediaType,
      tmdbId,
      title:
        title || `${mediaType === "movie" ? "Movie" : "Series"} #${rawTmdbId}`,
      year,
    };
    const initialMessages: ChatMessage[] = [
      {
        id: createId(),
        role: "user",
        content: "Tell me about this.",
        mediaContext,
      },
    ];

    sessionStorage.removeItem(STORAGE_KEY);
    setMessages(initialMessages);
    setDraft("");
    setDraftMediaContext(undefined);
    void router.replace("/ai", undefined, { shallow: true });
    void startStream(initialMessages);
  }, [router, router.isReady, router.query, startStream]);

  const send = () => sendContent(draft);

  const prepareAgain = (card: MediaCardData) => {
    void sendContent("Prepare a fresh request confirmation for this title.", {
      mediaType: card.mediaType,
      tmdbId: card.tmdbId,
      title: card.title,
      year: card.year,
    });
  };

  const retry = () => {
    if (!streaming && messages[messages.length - 1]?.role === "user") {
      startStream(messages);
    }
  };

  const stop = () => {
    abortIntentRef.current = "stop";
    controllerRef.current?.abort();
  };

  const newChat = () => {
    abortIntentRef.current = "reset";
    controllerRef.current?.abort();
    sessionStorage.removeItem(STORAGE_KEY);
    setMessages([]);
    setDraft("");
    setDraftMediaContext(undefined);
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
  const visibleSuggestions = suggestionOrder
    .slice(0, 3)
    .map((index) => AI_CHAT_SUGGESTIONS[index]);
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
              <div className="mt-7 overflow-hidden opacity-75">
                <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.22em] text-gray-700">
                  Try asking
                </p>
                <div className="space-y-1.5">
                  {visibleSuggestions.map((item) => (
                    <button
                      key={item.text}
                      type="button"
                      onClick={() => sendContent(item.text)}
                      title={item.text}
                      className="group block w-full truncate border-l border-gray-800 bg-gradient-to-r from-gray-900/30 to-transparent px-3 py-2 text-left text-xs text-gray-600 transition-colors hover:border-gray-700 hover:text-gray-400 focus:border-[#fabd2f]/70 focus:outline-none"
                    >
                      {item.parts.map((part, partIndex) => (
                        <span
                          key={`${part.text}:${partIndex}`}
                          className={
                            part.variable
                              ? "font-medium text-[#fabd2f]/70 group-hover:text-[#fabd2f]"
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
          <Message
            key={message.id}
            message={message}
            onPrepareAgain={streaming ? undefined : prepareAgain}
          />
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
              setDraftMediaContext(undefined);
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
