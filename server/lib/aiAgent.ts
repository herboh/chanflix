import TheMovieDb from "@server/api/themoviedb";
import type {
  TmdbMovieDetails,
  TmdbPersonCreditCast,
  TmdbPersonCreditCrew,
  TmdbPersonResult,
  TmdbTvDetails,
} from "@server/api/themoviedb/interfaces";
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from "@server/constants/media";
import { getRepository } from "@server/datasource";
import Media from "@server/entity/Media";
import { MediaRequest } from "@server/entity/MediaRequest";
import TmdbMetadataCache from "@server/entity/TmdbMetadataCache";
import type { User } from "@server/entity/User";
import downloadTracker, {
  type DownloadingItem,
  type RecentDownloadItem,
} from "@server/lib/downloadtracker";
import { Permission } from "@server/lib/permissions";
import { searchWeb } from "@server/lib/webSearch";
import logger from "@server/logger";
import { mapMovieDetails } from "@server/models/Movie";
import { mapSearchResults } from "@server/models/Search";
import { mapTvDetails } from "@server/models/Tv";
import { randomBytes } from "crypto";
import { In } from "typeorm";
import { z } from "zod";

export const AI_AGENT_MAX_TOOL_ROUNDS = 4;
export const AI_AGENT_MAX_CARDS = 4;
export const AI_AGENT_MAX_TOOL_CALLS = 6;

export type AiMediaType = "movie" | "tv";

export interface AiMediaCard {
  kind: "media";
  mediaType: AiMediaType;
  tmdbId: number;
  title: string;
  year?: string;
  overview?: string;
  posterPath?: string;
  genres?: string[];
  runtimeMinutes?: number;
  voteAverage?: number;
  voteCount?: number;
  popularity?: number;
  imdbId?: string;
  status: "available" | "partial" | "processing" | "pending" | "unknown";
  href: string;
  request?: {
    token: string;
    label: string;
    expiresAt: string;
    note: string;
  };
}

export interface AiToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface AiToolResult {
  content: string;
  cards?: AiMediaCard[];
}

export type PendingAiRequest = {
  userId: number;
  mediaType: AiMediaType;
  tmdbId: number;
  seasons?: number[];
  forcePending: boolean;
  expiresAt: number;
};

const pendingRequests = new Map<string, PendingAiRequest>();
const REQUEST_CONFIRMATION_TTL_MS = 5 * 60 * 1000;
const MAX_PENDING_CONFIRMATIONS_PER_USER = 6;

export interface AiRequestPolicyInput {
  mediaType: AiMediaType;
  voteAverage?: number;
  voteCount?: number;
  seasons?: number[];
  selectedEpisodeCount?: number;
}

export interface AiRequestPolicyConfig {
  minRating: number;
  minVotes: number;
  maxAutoApprovedTvSeasons: number;
  maxAutoApprovedTvEpisodes: number;
}

const boundedEnvNumber = (
  name: string,
  fallback: number,
  min: number,
  max: number
) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= min && value <= max
    ? value
    : fallback;
};

const getRequestPolicyConfig = (): AiRequestPolicyConfig => ({
  minRating: boundedEnvNumber("AI_REQUEST_MIN_RATING", 6.5, 0, 10),
  minVotes: boundedEnvNumber("AI_REQUEST_MIN_VOTES", 250, 0, 1_000_000),
  maxAutoApprovedTvSeasons: boundedEnvNumber(
    "AI_REQUEST_MAX_TV_SEASONS",
    1,
    1,
    3
  ),
  maxAutoApprovedTvEpisodes: boundedEnvNumber(
    "AI_REQUEST_MAX_TV_EPISODES",
    16,
    1,
    100
  ),
});

export const evaluateAiRequestPolicy = (
  input: AiRequestPolicyInput,
  config: AiRequestPolicyConfig = getRequestPolicyConfig()
) => {
  const reasons: string[] = [];
  if ((input.voteAverage ?? 0) < config.minRating) {
    reasons.push(`rating below ${config.minRating.toFixed(1)}`);
  }
  if ((input.voteCount ?? 0) < config.minVotes) {
    reasons.push(`fewer than ${config.minVotes} ratings`);
  }
  if (input.mediaType === "tv") {
    if (!input.seasons?.length) reasons.push("no explicit season");
    if ((input.seasons?.length ?? 0) > config.maxAutoApprovedTvSeasons) {
      reasons.push(`more than ${config.maxAutoApprovedTvSeasons} season`);
    }
    if (
      input.selectedEpisodeCount === undefined ||
      input.selectedEpisodeCount > config.maxAutoApprovedTvEpisodes
    ) {
      reasons.push(
        input.selectedEpisodeCount === undefined
          ? "episode count is unknown"
          : `more than ${config.maxAutoApprovedTvEpisodes} episodes`
      );
    }
  }
  return { autoApprovalEligible: reasons.length === 0, reasons };
};

const mediaTypeSchema = z.enum(["movie", "tv"]);
const eitherMediaTypeSchema = z.enum(["movie", "tv", "either"]);
const searchSchema = z.object({
  query: z.string().trim().min(1).max(120),
  limit: z.number().int().min(1).max(4).default(3),
});
const titleSchema = z.object({
  media_type: mediaTypeSchema,
  tmdb_id: z.number().int().positive(),
});
const peopleSearchSchema = z.object({
  query: z.string().trim().min(1).max(120),
  limit: z.number().int().min(1).max(3).default(3),
});
const personCreditsSchema = z.object({
  person_id: z.number().int().positive(),
  role: z
    .enum(["acting", "directing", "writing", "crew", "all"])
    .default("all"),
  media_type: eitherMediaTypeSchema.default("either"),
  available_only: z.boolean().default(false),
  limit: z.number().int().min(1).max(4).default(4),
});
const personLookupSchema = peopleSearchSchema.merge(
  personCreditsSchema.omit({ person_id: true })
);
const plexSummarySchema = z.object({
  media_type: eitherMediaTypeSchema.default("either"),
  include_recent: z.boolean().default(true),
});
const displayTitlesSchema = z.object({
  titles: z
    .array(
      z.object({
        media_type: mediaTypeSchema,
        tmdb_id: z.number().int().positive(),
      })
    )
    .min(1)
    .max(4),
});
const availableSchema = z.object({
  media_type: z.enum(["movie", "tv", "either"]).default("either"),
  genre: z.string().trim().max(60).optional(),
  min_rating: z.number().min(0).max(10).default(0),
  max_runtime_minutes: z.number().int().min(30).max(360).optional(),
  limit: z.number().int().min(1).max(4).default(3),
});
const requestSchema = z.object({
  media_type: mediaTypeSchema,
  tmdb_id: z.number().int().positive(),
  seasons: z.array(z.number().int().min(1).max(100)).max(3).optional(),
});
const titleRequestSchema = z.object({
  query: z.string().trim().min(1).max(120),
  media_type: eitherMediaTypeSchema.default("either"),
  year: z.number().int().min(1870).max(2100).optional(),
  seasons: z.array(z.number().int().min(1).max(100)).max(3).optional(),
});

const mediaReferenceSchema = z.object({
  media_type: mediaTypeSchema,
  tmdb_id: z.number().int().positive(),
});

const lookupMediaSchema = z
  .object({
    operation: z.enum(["search", "details"]),
    query: z.string().trim().min(1).max(120).optional(),
    media_type: eitherMediaTypeSchema.default("either"),
    year: z.number().int().min(1870).max(2100).optional(),
    items: z.array(mediaReferenceSchema).min(1).max(4).optional(),
    include_credits: z.boolean().default(false),
    limit: z.number().int().min(1).max(4).default(3),
  })
  .superRefine((value, context) => {
    if (value.operation === "search" && !value.query) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "query required",
      });
    }
    if (value.operation === "details" && !value.items?.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "items required",
      });
    }
  });

const mergedPersonLookupSchema = z
  .object({
    query: z.string().trim().min(1).max(120).optional(),
    person_id: z.number().int().positive().optional(),
    role: z
      .enum(["acting", "directing", "writing", "crew", "all"])
      .default("all"),
    media_type: eitherMediaTypeSchema.default("either"),
    available_only: z.boolean().default(false),
    limit: z.number().int().min(1).max(4).default(4),
  })
  .superRefine((value, context) => {
    if (!!value.query === !!value.person_id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "provide exactly one of query or person_id",
      });
    }
  });

const browseLibrarySchema = z.object({
  operation: z.enum(["summary", "discover"]),
  media_type: eitherMediaTypeSchema.default("either"),
  availability: z.enum(["ready", "include_partial"]).default("ready"),
  genres: z.array(z.string().trim().min(1).max(60)).max(4).default([]),
  exclude_genres: z.array(z.string().trim().min(1).max(60)).max(4).default([]),
  min_rating: z.number().min(0).max(10).default(0),
  max_runtime_minutes: z.number().int().min(1).max(600).optional(),
  year_from: z.number().int().min(1870).max(2100).optional(),
  year_to: z.number().int().min(1870).max(2100).optional(),
  sort: z.enum(["quality", "popular", "recent"]).default("quality"),
  limit: z.number().int().min(1).max(4).default(3),
});

const checkActivitySchema = z.object({
  kind: z.enum(["requests", "downloads"]),
  query: z.string().trim().min(1).max(120).optional(),
  media_type: eitherMediaTypeSchema.default("either"),
  include_recent: z.boolean().default(false),
  limit: z.number().int().min(1).max(8).default(5),
});

const requestMediaSchema = z
  .object({
    query: z.string().trim().min(1).max(120).optional(),
    tmdb_id: z.number().int().positive().optional(),
    media_type: eitherMediaTypeSchema.default("either"),
    year: z.number().int().min(1870).max(2100).optional(),
    seasons: z.array(z.number().int().min(1).max(100)).max(3).optional(),
  })
  .superRefine((value, context) => {
    if (!!value.query === !!value.tmdb_id) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "provide exactly one of query or tmdb_id",
      });
    }
    if (value.tmdb_id && value.media_type === "either") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "exact IDs require movie or tv",
      });
    }
  });

const webSearchSchema = z.object({
  query: z.string().trim().min(2).max(300),
  limit: z.number().int().min(1).max(4).default(4),
});

const tool = (
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[] = []
) => ({
  type: "function" as const,
  function: {
    name,
    description,
    // Chanflix intentionally uses optional fields. vLLM strict mode requires
    // every property to be required (nullable when optional), which would
    // change the proven Qwen call shape. Zod still validates every call here.
    strict: false,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties,
      required,
    },
  },
});

export const AI_AGENT_TOOLS = [
  tool(
    "lookup_media",
    "Search for a movie or series, or get exact metadata and canonical cards. Use search when IDs are unknown; use details for known IDs, credits, or a final selected set.",
    {
      operation: { type: "string", enum: ["search", "details"] },
      query: { type: "string", description: "Required for search." },
      media_type: { type: "string", enum: ["movie", "tv", "either"] },
      year: { type: "integer", minimum: 1870, maximum: 2100 },
      items: {
        type: "array",
        minItems: 1,
        maxItems: 4,
        description: "Required for details.",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            media_type: { type: "string", enum: ["movie", "tv"] },
            tmdb_id: { type: "integer", minimum: 1 },
          },
          required: ["media_type", "tmdb_id"],
        },
      },
      include_credits: { type: "boolean" },
      limit: { type: "integer", minimum: 1, maximum: 4 },
    },
    ["operation"]
  ),
  tool(
    "lookup_person",
    "Resolve a film person by name or exact TMDB person ID and return verified identity plus a small filmography. Ambiguous names are returned for clarification.",
    {
      query: { type: "string", description: "Person name." },
      person_id: {
        type: "integer",
        minimum: 1,
        description: "Use instead of query after resolving ambiguity.",
      },
      role: {
        type: "string",
        enum: ["acting", "directing", "writing", "crew", "all"],
      },
      media_type: { type: "string", enum: ["movie", "tv", "either"] },
      available_only: {
        type: "boolean",
        description:
          "True when the user asks what is available, on Plex, or on this server.",
      },
      limit: { type: "integer", minimum: 1, maximum: 4 },
    }
  ),
  tool(
    "browse_library",
    "Read the local Plex-synced Chanflix library. Use summary for counts; use discover for a small cache-first set of titles actually ready to watch.",
    {
      operation: { type: "string", enum: ["summary", "discover"] },
      media_type: { type: "string", enum: ["movie", "tv", "either"] },
      availability: {
        type: "string",
        enum: ["ready", "include_partial"],
      },
      genres: {
        type: "array",
        maxItems: 4,
        items: { type: "string" },
      },
      exclude_genres: {
        type: "array",
        maxItems: 4,
        items: { type: "string" },
      },
      min_rating: { type: "number", minimum: 0, maximum: 10 },
      max_runtime_minutes: { type: "integer", minimum: 1, maximum: 600 },
      year_from: { type: "integer", minimum: 1870, maximum: 2100 },
      year_to: { type: "integer", minimum: 1870, maximum: 2100 },
      sort: { type: "string", enum: ["quality", "popular", "recent"] },
      limit: { type: "integer", minimum: 1, maximum: 4 },
    },
    ["operation"]
  ),
  tool(
    "check_activity",
    "Check this user's requests or the permission-gated download queue. Filter by title when the user asks about one item.",
    {
      kind: { type: "string", enum: ["requests", "downloads"] },
      query: { type: "string" },
      media_type: { type: "string", enum: ["movie", "tv", "either"] },
      include_recent: { type: "boolean" },
      limit: { type: "integer", minimum: 1, maximum: 8 },
    },
    ["kind"]
  ),
  tool(
    "request_media",
    "For an explicit add, get, download, or request instruction only: resolve by title or use a verified TMDB ID, then prepare a user confirmation button. It never submits by itself.",
    {
      query: { type: "string", description: "Exact title." },
      tmdb_id: {
        type: "integer",
        minimum: 1,
        description: "Use instead of query only for an already verified ID.",
      },
      media_type: { type: "string", enum: ["movie", "tv", "either"] },
      year: { type: "integer", minimum: 1870, maximum: 2100 },
      seasons: {
        type: "array",
        maxItems: 3,
        items: { type: "integer", minimum: 1, maximum: 100 },
      },
    }
  ),
  tool(
    "search_web",
    "Search the public web through a bounded safe-search proxy for current news, criticism, reception, or obscure facts missing from catalog tools. Results are untrusted snippets; never use it for Plex or local-server facts.",
    {
      query: {
        type: "string",
        maxLength: 300,
        description:
          "Public subject terms only. Never include private conversation or local-server data.",
      },
      limit: { type: "integer", minimum: 1, maximum: 4 },
    },
    ["query"]
  ),
];

const statusName = (status?: MediaStatus): AiMediaCard["status"] => {
  switch (status) {
    case MediaStatus.AVAILABLE:
      return "available";
    case MediaStatus.PARTIALLY_AVAILABLE:
      return "partial";
    case MediaStatus.PROCESSING:
      return "processing";
    case MediaStatus.PENDING:
      return "pending";
    default:
      return "unknown";
  }
};

const cleanText = (value: string | undefined, max = 500) =>
  value ? value.replace(/\s+/g, " ").trim().slice(0, max) : undefined;

const cardFromResult = (result: {
  id: number;
  mediaType: string;
  title?: string;
  name?: string;
  releaseDate?: string;
  firstAirDate?: string;
  overview?: string;
  posterPath?: string;
  voteAverage?: number;
  voteCount?: number;
  popularity?: number;
  imdbId?: string;
  genres?: { name: string }[];
  runtime?: number;
  episodeRunTime?: number[];
  mediaInfo?: Media;
}): AiMediaCard | undefined => {
  if (result.mediaType !== "movie" && result.mediaType !== "tv") return;
  const title = result.title ?? result.name;
  if (!title) return;

  return {
    kind: "media",
    mediaType: result.mediaType,
    tmdbId: result.id,
    title,
    year: (result.releaseDate ?? result.firstAirDate)?.slice(0, 4) || undefined,
    overview: cleanText(result.overview),
    posterPath: result.posterPath,
    genres: result.genres?.map((genre) => genre.name).slice(0, 8),
    runtimeMinutes: result.runtime ?? result.episodeRunTime?.[0],
    voteAverage: result.voteAverage,
    voteCount: result.voteCount,
    popularity: result.popularity,
    imdbId: result.imdbId,
    status: statusName(result.mediaInfo?.status),
    href: `/${result.mediaType}/${result.id}`,
  };
};

const summarizeCards = (cards: AiMediaCard[]) =>
  cards.map((card) => ({
    mediaType: card.mediaType,
    tmdbId: card.tmdbId,
    title: card.title,
    year: card.year,
    rating: card.voteAverage,
    voteCount: card.voteCount,
    popularity: card.popularity,
    imdbId: card.imdbId,
    genres: card.genres,
    runtimeMinutes: card.runtimeMinutes,
    status: card.status,
    overview: card.overview,
  }));

const normalizedTitle = (value: string) =>
  value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\p{M}+/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

type AiToolResultCode =
  | "ok"
  | "clarification_required"
  | "not_found"
  | "permission_denied"
  | "already_available"
  | "confirmation_ready"
  | "invalid_arguments"
  | "temporarily_unavailable";

const normalizedToolResult = ({
  ok,
  code,
  message,
  data,
  cards,
  meta,
}: {
  ok: boolean;
  code: AiToolResultCode;
  message: string;
  data?: unknown;
  cards?: AiMediaCard[];
  meta?: Record<string, unknown>;
}): AiToolResult => ({
  content: JSON.stringify({
    ok,
    code,
    message,
    ...(data === undefined ? {} : { data }),
    ...(cards?.length ? { media: summarizeCards(cards) } : {}),
    ...(meta ? { meta } : {}),
  }),
  ...(cards?.length ? { cards } : {}),
});

const normalizeLegacyToolResult = (
  result: AiToolResult,
  successMessage: string
): AiToolResult => {
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(result.content) as Record<string, unknown>;
  } catch (_error) {
    return normalizedToolResult({
      ok: false,
      code: "temporarily_unavailable",
      message: "The tool returned unreadable data.",
    });
  }

  if (typeof data.error === "string") {
    return normalizedToolResult({
      ok: false,
      code: "temporarily_unavailable",
      message: data.error,
      data,
      cards: result.cards,
    });
  }
  if (data.requiresClarification === true || data.resolved === false) {
    const candidates = Array.isArray(data.candidates) ? data.candidates : [];
    if (!candidates.length) {
      return normalizedToolResult({
        ok: false,
        code: "not_found",
        message:
          typeof data.reason === "string"
            ? data.reason
            : "No matching result was found.",
        data,
        cards: result.cards,
      });
    }
    return normalizedToolResult({
      ok: false,
      code: "clarification_required",
      message:
        typeof data.reason === "string"
          ? data.reason
          : "A specific match is required.",
      data,
      cards: result.cards,
    });
  }
  if (data.refused === true) {
    const reason =
      typeof data.reason === "string" ? data.reason : "The action was refused.";
    return normalizedToolResult({
      ok: false,
      code: /permission/i.test(reason)
        ? "permission_denied"
        : /already available/i.test(reason)
        ? "already_available"
        : "temporarily_unavailable",
      message: reason,
      data,
      cards: result.cards,
    });
  }
  if (data.prepared === true) {
    return normalizedToolResult({
      ok: true,
      code: "confirmation_ready",
      message:
        "A confirmation button is ready. The request has not been submitted.",
      data,
      cards: result.cards,
    });
  }
  if (Array.isArray(data.results) && data.results.length === 0) {
    return normalizedToolResult({
      ok: false,
      code: "not_found",
      message: "No matching result was found.",
      data,
      cards: result.cards,
    });
  }

  return normalizedToolResult({
    ok: true,
    code: "ok",
    message: successMessage,
    data,
    cards: result.cards,
  });
};

export const resolveAiTitleMatch = (
  cards: AiMediaCard[],
  query: string,
  options: { mediaType?: "movie" | "tv" | "either"; year?: number } = {}
): {
  match?: AiMediaCard;
  ambiguous: boolean;
  candidates: AiMediaCard[];
} => {
  const eligible = cards.filter(
    (card) =>
      (!options.mediaType ||
        options.mediaType === "either" ||
        card.mediaType === options.mediaType) &&
      (!options.year || Number(card.year) === options.year)
  );
  const exact = eligible.filter(
    (card) => normalizedTitle(card.title) === normalizedTitle(query)
  );
  return {
    match: exact.length === 1 ? exact[0] : undefined,
    ambiguous: exact.length > 1,
    candidates: (exact.length > 1 ? exact : eligible).slice(0, 3),
  };
};

export const rankAiMediaCards = (
  cards: AiMediaCard[],
  query?: string,
  options: { preferAvailable?: boolean } = {}
): AiMediaCard[] => {
  const normalizedQuery = query ? normalizedTitle(query) : undefined;
  return [...cards].sort((left, right) => {
    if (normalizedQuery) {
      const leftExact = normalizedTitle(left.title) === normalizedQuery;
      const rightExact = normalizedTitle(right.title) === normalizedQuery;
      if (leftExact !== rightExact) return leftExact ? -1 : 1;
    }
    if (options.preferAvailable) {
      const leftAvailable =
        left.status === "available" || left.status === "partial";
      const rightAvailable =
        right.status === "available" || right.status === "partial";
      if (leftAvailable !== rightAvailable) return leftAvailable ? -1 : 1;
    }
    return (
      (right.voteCount ?? 0) - (left.voteCount ?? 0) ||
      (right.popularity ?? 0) - (left.popularity ?? 0) ||
      (right.voteAverage ?? 0) - (left.voteAverage ?? 0)
    );
  });
};

export const finalizeAiMediaCards = (cards: AiMediaCard[]): AiMediaCard[] => {
  const unique = new Map<string, AiMediaCard>();
  for (const card of cards) {
    const key = `${card.mediaType}:${card.tmdbId}`;
    unique.set(key, card);
  }
  return [...unique.values()].slice(0, AI_AGENT_MAX_CARDS);
};

export const stageAiMediaCards = (
  current: AiMediaCard[],
  latestRound: AiMediaCard[]
): AiMediaCard[] => (latestRound.length ? latestRound : current);

const parseArguments = (raw: string): unknown => {
  if (raw.length > 4_000) throw new Error("Tool arguments are too large.");
  try {
    return JSON.parse(raw || "{}");
  } catch (_error) {
    throw new Error("Tool arguments were not valid JSON.");
  }
};

export const validateAiToolCallArguments = (call: AiToolCall): boolean => {
  try {
    const raw = parseArguments(call.arguments);
    switch (call.name) {
      case "lookup_media":
        lookupMediaSchema.parse(raw);
        return true;
      case "lookup_person":
        mergedPersonLookupSchema.parse(raw);
        return true;
      case "browse_library":
        browseLibrarySchema.parse(raw);
        return true;
      case "check_activity":
        checkActivitySchema.parse(raw);
        return true;
      case "request_media":
        requestMediaSchema.parse(raw);
        return true;
      case "search_web":
        webSearchSchema.parse(raw);
        return true;
      default:
        return false;
    }
  } catch (_error) {
    return false;
  }
};

const getDetailsCard = async (
  mediaType: AiMediaType,
  tmdbId: number
): Promise<AiMediaCard> => {
  const tmdb = new TheMovieDb();
  const type = mediaType === "movie" ? MediaType.MOVIE : MediaType.TV;
  const media = await Media.getMedia(tmdbId, type);

  if (mediaType === "movie") {
    const details = mapMovieDetails(
      await tmdb.getMovie({ movieId: tmdbId }),
      media
    );
    return cardFromResult({ ...details, mediaType: "movie" }) as AiMediaCard;
  }

  const details = mapTvDetails(await tmdb.getTvShow({ tvId: tmdbId }), media);
  return cardFromResult({
    ...details,
    mediaType: "tv",
    firstAirDate: details.firstAirDate,
    imdbId: details.externalIds.imdbId,
  }) as AiMediaCard;
};

type CachedCardLookup = {
  cards: Map<string, AiMediaCard>;
  freshKeys: Set<string>;
};

export type AiLibraryEntry = {
  card: AiMediaCard;
  mediaAddedAt?: Date;
};

export type AiLibraryCriteria = z.infer<typeof browseLibrarySchema>;

type AiLibrarySnapshot = {
  expiresAt: number;
  entries: AiLibraryEntry[];
  missing: Media[];
  freshCount: number;
  totalCount: number;
};

const AI_LIBRARY_SNAPSHOT_TTL_MS = 90_000;
const AI_LIBRARY_CACHE_CHUNK_SIZE = 400;
const AI_LIBRARY_LIVE_FALLBACK_LIMIT = 8;
let aiLibrarySnapshot: AiLibrarySnapshot | undefined;

const mediaKey = (mediaType: AiMediaType, tmdbId: number) =>
  `${mediaType}:${tmdbId}`;

const mediaEntityType = (media: Media): AiMediaType =>
  media.mediaType === MediaType.MOVIE ? "movie" : "tv";

const chunks = <T>(items: T[], size: number): T[][] => {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
};

const cardFromCachedMetadata = (
  media: Media,
  payload: TmdbMovieDetails | TmdbTvDetails
): AiMediaCard | undefined => {
  if (media.mediaType === MediaType.MOVIE) {
    const details = mapMovieDetails(payload as TmdbMovieDetails, media);
    return cardFromResult({ ...details, mediaType: "movie" });
  }

  const details = mapTvDetails(payload as TmdbTvDetails, media);
  return cardFromResult({
    ...details,
    mediaType: "tv",
    firstAirDate: details.firstAirDate,
    imdbId: details.externalIds.imdbId,
  });
};

const getCachedCardsForMedia = async (
  media: Media[]
): Promise<CachedCardLookup> => {
  const cards = new Map<string, AiMediaCard>();
  const freshKeys = new Set<string>();
  if (!media.length) return { cards, freshKeys };

  const cacheRepository = getRepository(TmdbMetadataCache);
  const newestRows = new Map<string, TmdbMetadataCache>();

  for (const mediaType of [MediaType.MOVIE, MediaType.TV] as const) {
    const ids = Array.from(
      new Set(
        media
          .filter((item) => item.mediaType === mediaType)
          .map((item) => item.tmdbId)
      )
    );
    for (const idChunk of chunks(ids, AI_LIBRARY_CACHE_CHUNK_SIZE)) {
      if (!idChunk.length) continue;
      const rows = await cacheRepository.find({
        where: {
          mediaType: mediaType === MediaType.MOVIE ? "movie" : "tv",
          tmdbId: In(idChunk),
          language: "en",
        },
        order: { fetchedAt: "DESC" },
      });
      for (const row of rows) {
        const key = mediaKey(row.mediaType, row.tmdbId);
        if (!newestRows.has(key)) newestRows.set(key, row);
      }
    }
  }

  const mediaByKey = new Map(
    media.map((item) => [mediaKey(mediaEntityType(item), item.tmdbId), item])
  );
  for (const [key, row] of newestRows) {
    const item = mediaByKey.get(key);
    if (!item) continue;
    try {
      const card = cardFromCachedMetadata(
        item,
        JSON.parse(row.payload) as TmdbMovieDetails | TmdbTvDetails
      );
      if (!card) continue;
      cards.set(key, card);
      if (row.expiresAt.getTime() > Date.now()) freshKeys.add(key);
    } catch (_error) {
      // One malformed cache row must not make the whole library unavailable.
    }
  }
  return { cards, freshKeys };
};

const loadAiLibrarySnapshot = async (): Promise<AiLibrarySnapshot> => {
  if (aiLibrarySnapshot && aiLibrarySnapshot.expiresAt > Date.now()) {
    return aiLibrarySnapshot;
  }

  const media = await getRepository(Media).find({
    where: {
      status: In([MediaStatus.AVAILABLE, MediaStatus.PARTIALLY_AVAILABLE]),
    },
    order: { mediaAddedAt: "DESC", updatedAt: "DESC" },
  });
  const cached = await getCachedCardsForMedia(media);
  const entries: AiLibraryEntry[] = [];
  const missing: Media[] = [];
  for (const item of media) {
    const card = cached.cards.get(mediaKey(mediaEntityType(item), item.tmdbId));
    if (card) entries.push({ card, mediaAddedAt: item.mediaAddedAt });
    else missing.push(item);
  }

  aiLibrarySnapshot = {
    expiresAt: Date.now() + AI_LIBRARY_SNAPSHOT_TTL_MS,
    entries,
    missing,
    freshCount: cached.freshKeys.size,
    totalCount: media.length,
  };
  return aiLibrarySnapshot;
};

const qualityScore = (card: AiMediaCard): number => {
  const votes = Math.max(0, card.voteCount ?? 0);
  const rating = card.voteAverage ?? 0;
  const confidenceVotes = 500;
  const globalMean = 6.5;
  return (
    (votes / (votes + confidenceVotes)) * rating +
    (confidenceVotes / (votes + confidenceVotes)) * globalMean
  );
};

const matchesLibraryCriteria = (
  entry: AiLibraryEntry,
  args: z.infer<typeof browseLibrarySchema>
): boolean => {
  const { card } = entry;
  if (args.media_type !== "either" && card.mediaType !== args.media_type) {
    return false;
  }
  if (args.availability === "ready" && card.status !== "available") {
    return false;
  }
  if ((card.voteAverage ?? 0) < args.min_rating) return false;
  if (
    args.max_runtime_minutes !== undefined &&
    (card.runtimeMinutes === undefined ||
      card.runtimeMinutes > args.max_runtime_minutes)
  ) {
    return false;
  }
  const year = Number(card.year);
  if (args.year_from && (!Number.isFinite(year) || year < args.year_from)) {
    return false;
  }
  if (args.year_to && (!Number.isFinite(year) || year > args.year_to)) {
    return false;
  }
  const genres = (card.genres ?? []).map(normalizedTitle);
  if (
    args.genres.length &&
    !args.genres.every((genre) =>
      genres.some((candidate) => candidate.includes(normalizedTitle(genre)))
    )
  ) {
    return false;
  }
  if (
    args.exclude_genres.some((genre) =>
      genres.some((candidate) => candidate.includes(normalizedTitle(genre)))
    )
  ) {
    return false;
  }
  return true;
};

const sortLibraryEntries = (
  entries: AiLibraryEntry[],
  sort: z.infer<typeof browseLibrarySchema>["sort"]
): AiLibraryEntry[] =>
  [...entries].sort((left, right) => {
    if (sort === "recent") {
      return (
        (right.mediaAddedAt?.getTime() ?? 0) -
        (left.mediaAddedAt?.getTime() ?? 0)
      );
    }
    if (sort === "popular") {
      return (
        (right.card.popularity ?? 0) - (left.card.popularity ?? 0) ||
        (right.card.voteCount ?? 0) - (left.card.voteCount ?? 0)
      );
    }
    return (
      qualityScore(right.card) - qualityScore(left.card) ||
      (right.card.voteCount ?? 0) - (left.card.voteCount ?? 0)
    );
  });

export const filterAndRankAiLibraryEntries = (
  entries: AiLibraryEntry[],
  criteria: AiLibraryCriteria
): AiLibraryEntry[] =>
  sortLibraryEntries(
    entries.filter((entry) => matchesLibraryCriteria(entry, criteria)),
    criteria.sort
  );

const summarizeKnownFor = (person: TmdbPersonResult, relatedMedia: Media[]) =>
  person.known_for.slice(0, 3).map((credit) => {
    const media = relatedMedia.find(
      (candidate) =>
        candidate.tmdbId === credit.id &&
        candidate.mediaType ===
          (credit.media_type === "movie" ? MediaType.MOVIE : MediaType.TV)
    );
    return {
      mediaType: credit.media_type,
      tmdbId: credit.id,
      title: credit.media_type === "movie" ? credit.title : credit.name,
      year: (credit.media_type === "movie"
        ? credit.release_date
        : credit.first_air_date
      )?.slice(0, 4),
      status: statusName(media?.status),
    };
  });

const executeSearchPeople = async (raw: unknown): Promise<AiToolResult> => {
  const args = peopleSearchSchema.parse(raw);
  const response = await new TheMovieDb().searchMulti({
    query: args.query,
    page: 1,
  });
  const people = response.results
    .filter(
      (result): result is TmdbPersonResult =>
        result.media_type === "person" && !result.adult
    )
    .sort((left, right) => right.popularity - left.popularity)
    .slice(0, args.limit);
  const relatedMedia = await Media.getRelatedMedia(
    people.flatMap((person) => person.known_for.map((credit) => credit.id))
  );

  return {
    content: JSON.stringify({
      source: "TMDB identity search plus local Chanflix availability",
      results: people.map((person) => ({
        personId: person.id,
        name: person.name,
        popularity: person.popularity,
        knownFor: summarizeKnownFor(person, relatedMedia),
      })),
    }),
  };
};

type PersonCredit = TmdbPersonCreditCast | TmdbPersonCreditCrew;
type PersonRole = z.infer<typeof personCreditsSchema>["role"];

export const aiPersonCreditMatchesRole = (
  credit: PersonCredit,
  role: PersonRole
): boolean => {
  if (role === "all") return true;
  if (role === "acting") return "character" in credit;
  if ("character" in credit) return false;
  if (role === "directing") return credit.job?.toLowerCase() === "director";
  if (role === "writing") {
    const contribution = `${credit.department ?? ""} ${credit.job ?? ""}`;
    return /writing|writer|screenplay|story|novel/i.test(contribution);
  }
  return true;
};

const executePersonFilmography = async (
  raw: unknown
): Promise<AiToolResult> => {
  const args = personCreditsSchema.parse(raw);
  const tmdb = new TheMovieDb();
  const [person, combined] = await Promise.all([
    tmdb.getPerson({ personId: args.person_id }),
    tmdb.getPersonCombinedCredits({ personId: args.person_id }),
  ]);
  const selected: Array<{
    credit: PersonCredit;
    contribution: string;
  }> = [];
  if (args.role === "acting" || args.role === "all") {
    selected.push(
      ...combined.cast.map((credit) => ({
        credit,
        contribution: credit.character
          ? `Actor as ${credit.character}`
          : "Actor",
      }))
    );
  }
  if (args.role !== "acting") {
    selected.push(
      ...combined.crew
        .filter((credit) => aiPersonCreditMatchesRole(credit, args.role))
        .map((credit) => ({
          credit,
          contribution: credit.job || credit.department || "Crew",
        }))
    );
  }

  const deduped = new Map<string, (typeof selected)[number]>();
  for (const item of selected) {
    if (
      item.credit.adult ||
      (item.credit.media_type !== "movie" && item.credit.media_type !== "tv") ||
      (args.media_type !== "either" &&
        item.credit.media_type !== args.media_type)
    ) {
      continue;
    }
    const key = `${item.credit.media_type}:${item.credit.id}`;
    if (!deduped.has(key)) deduped.set(key, item);
  }

  const credits = [...deduped.values()];
  const relatedMedia = await Media.getRelatedMedia(
    credits.map((item) => item.credit.id)
  );
  const filteredEntries = credits
    .map((item) => {
      const media = relatedMedia.find(
        (candidate) =>
          candidate.tmdbId === item.credit.id &&
          candidate.mediaType ===
            (item.credit.media_type === "movie"
              ? MediaType.MOVIE
              : MediaType.TV)
      );
      const card = cardFromResult({
        id: item.credit.id,
        mediaType: item.credit.media_type ?? "",
        title: item.credit.title,
        name: item.credit.name,
        releaseDate: item.credit.release_date,
        firstAirDate: item.credit.first_air_date,
        overview: item.credit.overview,
        posterPath: item.credit.poster_path,
        voteAverage: item.credit.vote_average,
        voteCount: item.credit.vote_count,
        popularity: item.credit.popularity,
        mediaInfo: media,
      });
      return card ? { card, contribution: item.contribution } : undefined;
    })
    .filter(
      (entry): entry is { card: AiMediaCard; contribution: string } => !!entry
    )
    .filter(
      (entry) =>
        !args.available_only ||
        entry.card.status === "available" ||
        entry.card.status === "partial"
    );
  const entryByCard = new Map(
    filteredEntries.map((entry) => [entry.card, entry])
  );
  const entries = rankAiMediaCards(
    filteredEntries.map((entry) => entry.card),
    undefined,
    { preferAvailable: args.available_only }
  )
    .map((card) => entryByCard.get(card) as (typeof filteredEntries)[number])
    .slice(0, args.limit);
  const cards = entries.map((entry) => entry.card);

  return {
    content: JSON.stringify({
      source: "Cached TMDB person data cross-checked with local Chanflix media",
      person: {
        personId: person.id,
        imdbId: person.imdb_id,
        name: person.name,
        knownForDepartment: person.known_for_department,
        birthday: person.birthday,
        deathday: person.deathday,
        placeOfBirth: person.place_of_birth,
        biography: cleanText(person.biography, 900),
      },
      role: args.role,
      availableOnly: args.available_only,
      notExhaustive: true,
      results: entries.map((entry) => ({
        ...summarizeCards([entry.card])[0],
        contribution: entry.contribution,
      })),
    }),
    cards,
  };
};

const executeLookupPerson = async (raw: unknown): Promise<AiToolResult> => {
  const args = personLookupSchema.parse(raw);
  const response = await new TheMovieDb().searchMulti({
    query: args.query,
    page: 1,
  });
  const people = response.results
    .filter(
      (result): result is TmdbPersonResult =>
        result.media_type === "person" && !result.adult
    )
    .sort((left, right) => right.popularity - left.popularity);
  const exact = people.filter(
    (person) => normalizedTitle(person.name) === normalizedTitle(args.query)
  );

  if (exact.length === 1) {
    return executePersonFilmography({
      person_id: exact[0].id,
      role: args.role,
      media_type: args.media_type,
      available_only: args.available_only,
      limit: args.limit,
    });
  }

  const candidates = (exact.length > 1 ? exact : people).slice(0, 3);
  const relatedMedia = await Media.getRelatedMedia(
    candidates.flatMap((person) => person.known_for.map((credit) => credit.id))
  );
  return {
    content: JSON.stringify({
      resolved: false,
      ambiguous: exact.length > 1,
      reason:
        exact.length > 1
          ? "Multiple people have that exact name; a specific candidate is required."
          : "No exact person-name match was found; clarification is required.",
      candidates: candidates.map((person) => ({
        personId: person.id,
        name: person.name,
        knownFor: summarizeKnownFor(person, relatedMedia),
      })),
    }),
  };
};

const executePlexSummary = async (raw: unknown): Promise<AiToolResult> => {
  const args = plexSummarySchema.parse(raw);
  const repository = getRepository(Media);
  const query = repository
    .createQueryBuilder("media")
    .select("media.mediaType", "mediaType")
    .addSelect("media.status", "status")
    .addSelect("COUNT(*)", "count")
    .groupBy("media.mediaType")
    .addGroupBy("media.status");
  if (args.media_type !== "either") {
    query.where("media.mediaType = :mediaType", {
      mediaType: args.media_type === "movie" ? MediaType.MOVIE : MediaType.TV,
    });
  }
  const rows = await query.getRawMany<{
    mediaType: MediaType;
    status: number;
    count: string;
  }>();
  const counts = rows.map((row) => ({
    mediaType: row.mediaType === MediaType.MOVIE ? "movie" : "tv",
    status: statusName(Number(row.status) as MediaStatus),
    count: Number(row.count),
  }));
  const recent = args.include_recent
    ? await repository.find({
        where: {
          ...(args.media_type === "either"
            ? {}
            : {
                mediaType:
                  args.media_type === "movie" ? MediaType.MOVIE : MediaType.TV,
              }),
          status: In([MediaStatus.AVAILABLE, MediaStatus.PARTIALLY_AVAILABLE]),
        },
        order: { mediaAddedAt: "DESC", updatedAt: "DESC" },
        take: 3,
      })
    : [];
  const cards = (
    await Promise.all(
      recent.map((media) =>
        getDetailsCard(
          media.mediaType === MediaType.MOVIE ? "movie" : "tv",
          media.tmdbId
        ).catch(() => undefined)
      )
    )
  ).filter((card): card is AiMediaCard => !!card);

  return {
    content: JSON.stringify({
      source: "Local Chanflix database synchronized from Plex and Servarr",
      counts,
      recent: summarizeCards(cards),
    }),
    cards,
  };
};

const executeDisplayTitles = async (raw: unknown): Promise<AiToolResult> => {
  const args = displayTitlesSchema.parse(raw);
  const unique = new Map(
    args.titles.map((title) => [`${title.media_type}:${title.tmdb_id}`, title])
  );
  const cards = (
    await Promise.all(
      [...unique.values()].map((title) =>
        getDetailsCard(title.media_type, title.tmdb_id).catch(() => undefined)
      )
    )
  ).filter((card): card is AiMediaCard => !!card);

  return {
    content: JSON.stringify({
      cardsDisplayed: true,
      results: summarizeCards(cards),
      missingCount: unique.size - cards.length,
    }),
    cards,
  };
};

const executeSearch = async (raw: unknown): Promise<AiToolResult> => {
  const args = searchSchema.parse(raw);
  const tmdb = new TheMovieDb();
  const response = await tmdb.searchMulti({ query: args.query, page: 1 });
  const media = await Media.getRelatedMedia(
    response.results.map((item) => item.id)
  );
  const cards = rankAiMediaCards(
    mapSearchResults(response.results, media)
      .map(cardFromResult)
      .filter((card): card is AiMediaCard => !!card),
    args.query
  ).slice(0, args.limit);

  return { content: JSON.stringify({ results: summarizeCards(cards) }), cards };
};

const executeGetTitle = async (raw: unknown): Promise<AiToolResult> => {
  const args = titleSchema.parse(raw);
  const card = await getDetailsCard(args.media_type, args.tmdb_id);
  const tmdb = new TheMovieDb();
  let credits: Record<string, unknown>;
  if (args.media_type === "movie") {
    const details = await tmdb.getMovie({ movieId: args.tmdb_id });
    credits = {
      directors: details.credits.crew
        .filter((person) => person.job.toLowerCase() === "director")
        .slice(0, 5)
        .map((person) => ({ personId: person.id, name: person.name })),
      writers: details.credits.crew
        .filter((person) =>
          /writing|writer|screenplay|story|novel/i.test(
            `${person.department} ${person.job}`
          )
        )
        .slice(0, 6)
        .map((person) => ({
          personId: person.id,
          name: person.name,
          job: person.job,
        })),
      cast: details.credits.cast.slice(0, 8).map((person) => ({
        personId: person.id,
        name: person.name,
        character: person.character,
      })),
    };
  } else {
    const details = await tmdb.getTvShow({ tvId: args.tmdb_id });
    credits = {
      creators: details.created_by.slice(0, 5).map((person) => ({
        personId: person.id,
        name: person.name,
      })),
      directors: details.credits.crew
        .filter((person) => person.job.toLowerCase() === "director")
        .slice(0, 5)
        .map((person) => ({ personId: person.id, name: person.name })),
      writers: details.credits.crew
        .filter((person) =>
          /writing|writer|screenplay|story|novel/i.test(
            `${person.department} ${person.job}`
          )
        )
        .slice(0, 6)
        .map((person) => ({
          personId: person.id,
          name: person.name,
          job: person.job,
        })),
      cast: details.aggregate_credits.cast.slice(0, 8).map((person) => ({
        personId: person.id,
        name: person.name,
        roles: person.roles.slice(0, 3).map((role) => role.character),
      })),
    };
  }
  return {
    content: JSON.stringify({
      result: summarizeCards([card])[0],
      credits,
      cardDisplayed: true,
    }),
    cards: [card],
  };
};

const executeMergedLookupMedia = async (
  raw: unknown
): Promise<AiToolResult> => {
  const args = lookupMediaSchema.parse(raw);
  if (args.operation === "search") {
    const response = await new TheMovieDb().searchMulti({
      query: args.query as string,
      page: 1,
    });
    const media = await Media.getRelatedMedia(
      response.results.map((item) => item.id)
    );
    const cards = rankAiMediaCards(
      mapSearchResults(response.results, media)
        .map(cardFromResult)
        .filter((card): card is AiMediaCard => !!card)
        .filter(
          (card) =>
            args.media_type === "either" || card.mediaType === args.media_type
        )
        .filter((card) => !args.year || Number(card.year) === args.year),
      args.query
    ).slice(0, args.limit);
    return {
      content: JSON.stringify({
        query: args.query,
        results: summarizeCards(cards),
      }),
      cards,
    };
  }

  const unique = new Map(
    (args.items ?? []).map((item) => [
      mediaKey(item.media_type, item.tmdb_id),
      item,
    ])
  );
  if (!args.include_credits) {
    return executeDisplayTitles({ titles: [...unique.values()] });
  }

  const results = await Promise.all(
    [...unique.values()].map((item) =>
      executeGetTitle(item).catch(() => undefined)
    )
  );
  const cards = results.flatMap((result) => result?.cards ?? []);
  return {
    content: JSON.stringify({
      results: results
        .map((result) => {
          if (!result) return undefined;
          try {
            return JSON.parse(result.content) as unknown;
          } catch (_error) {
            return undefined;
          }
        })
        .filter((result) => result !== undefined),
      missingCount: unique.size - cards.length,
    }),
    cards,
  };
};

const executeMergedLookupPerson = async (
  raw: unknown
): Promise<AiToolResult> => {
  const args = mergedPersonLookupSchema.parse(raw);
  if (args.person_id) {
    return executePersonFilmography({
      person_id: args.person_id,
      role: args.role,
      media_type: args.media_type,
      available_only: args.available_only,
      limit: args.limit,
    });
  }
  return executeLookupPerson({
    query: args.query,
    role: args.role,
    media_type: args.media_type,
    available_only: args.available_only,
    limit: args.limit,
  });
};

const executeBrowseLibrary = async (raw: unknown): Promise<AiToolResult> => {
  const args = browseLibrarySchema.parse(raw);
  if (args.operation === "summary") {
    return executePlexSummary({
      media_type: args.media_type,
      include_recent: false,
    });
  }

  const snapshot = await loadAiLibrarySnapshot();
  let entries = filterAndRankAiLibraryEntries(snapshot.entries, args);

  let liveFallbackCount = 0;
  if (entries.length < args.limit && snapshot.missing.length) {
    const eligibleMissing = snapshot.missing
      .filter(
        (item) =>
          args.media_type === "either" ||
          mediaEntityType(item) === args.media_type
      )
      .filter(
        (item) =>
          args.availability === "include_partial" ||
          item.status === MediaStatus.AVAILABLE
      )
      .slice(0, AI_LIBRARY_LIVE_FALLBACK_LIMIT);
    const liveEntries: AiLibraryEntry[] = [];
    for (const batch of chunks(eligibleMissing, 3)) {
      const cards = await Promise.all(
        batch.map((item) =>
          getDetailsCard(mediaEntityType(item), item.tmdbId).catch(
            () => undefined
          )
        )
      );
      cards.forEach((card, index) => {
        if (card) {
          liveEntries.push({
            card,
            mediaAddedAt: batch[index].mediaAddedAt,
          });
          liveFallbackCount += 1;
        }
      });
    }
    entries = filterAndRankAiLibraryEntries(
      [...snapshot.entries, ...liveEntries],
      args
    );
    if (liveFallbackCount) aiLibrarySnapshot = undefined;
  }

  const cards = entries.slice(0, args.limit).map((entry) => entry.card);
  return {
    content: JSON.stringify({
      confirmedAvailable: true,
      results: summarizeCards(cards),
      coverage: {
        localTitles: snapshot.totalCount,
        cachedMetadata: snapshot.entries.length,
        freshMetadata: snapshot.freshCount,
        missingMetadata: Math.max(
          0,
          snapshot.totalCount - snapshot.entries.length - liveFallbackCount
        ),
        liveFallbackCount,
      },
    }),
    cards,
  };
};

const executeActivityRequests = async (
  args: z.infer<typeof checkActivitySchema>,
  user: User
): Promise<AiToolResult> => {
  const requests = await getRepository(MediaRequest).find({
    where: {
      requestedBy: { id: user.id },
      ...(args.media_type === "either"
        ? {}
        : {
            type: args.media_type === "movie" ? MediaType.MOVIE : MediaType.TV,
          }),
    },
    relations: { media: true, seasons: true },
    order: { createdAt: "DESC" },
    take: args.query ? 100 : args.limit,
  });
  const typeFiltered = requests.filter(
    (request) =>
      args.media_type === "either" || request.type === args.media_type
  );
  const media = Array.from(
    new Map(
      typeFiltered.map((request) => [
        mediaKey(
          request.type === MediaType.MOVIE ? "movie" : "tv",
          request.media.tmdbId
        ),
        request.media,
      ])
    ).values()
  );
  const cached = await getCachedCardsForMedia(media);
  const cardsByKey = new Map(cached.cards);
  const missing = media
    .filter(
      (item) => !cardsByKey.has(mediaKey(mediaEntityType(item), item.tmdbId))
    )
    .slice(0, AI_LIBRARY_LIVE_FALLBACK_LIMIT);
  for (const batch of chunks(missing, 3)) {
    const cards = await Promise.all(
      batch.map((item) =>
        getDetailsCard(mediaEntityType(item), item.tmdbId).catch(
          () => undefined
        )
      )
    );
    cards.forEach((card) => {
      if (card) cardsByKey.set(mediaKey(card.mediaType, card.tmdbId), card);
    });
  }

  const normalizedQuery = args.query && normalizedTitle(args.query);
  const selected = typeFiltered
    .map((request) => ({
      request,
      card: cardsByKey.get(
        mediaKey(
          request.type === MediaType.MOVIE ? "movie" : "tv",
          request.media.tmdbId
        )
      ),
    }))
    .filter(
      ({ card }) =>
        !normalizedQuery ||
        (card ? normalizedTitle(card.title).includes(normalizedQuery) : false)
    )
    .slice(0, args.limit);
  const status = (value: MediaRequestStatus) =>
    MediaRequestStatus[value]?.toLowerCase();
  const cards = selected
    .map(({ card }) => card)
    .filter((card): card is AiMediaCard => !!card);
  return {
    content: JSON.stringify({
      results: selected.map(({ request, card }) => ({
        requestId: request.id,
        mediaType: request.type,
        tmdbId: request.media.tmdbId,
        title: card?.title,
        year: card?.year,
        requestStatus: status(request.status),
        mediaStatus: statusName(
          request.is4k ? request.media.status4k : request.media.status
        ),
        seasons: request.seasons?.map((season) => season.seasonNumber),
        createdAt: request.createdAt,
      })),
      metadataMissing: Math.max(0, media.length - cardsByKey.size),
    }),
    cards,
  };
};

type ActivityDownload = (DownloadingItem | RecentDownloadItem) & {
  active: boolean;
  completedAt?: Date;
  outcome?: "completed" | "cleared";
};

const executeActivityDownloads = async (
  args: z.infer<typeof checkActivitySchema>,
  user: User
): Promise<AiToolResult> => {
  if (!user.hasPermission(Permission.MANAGE_REQUESTS)) {
    return {
      content: JSON.stringify({
        refused: true,
        reason: "You do not have permission to view the server download queue.",
      }),
    };
  }

  const active = downloadTracker.getAllDownloads();
  const items: ActivityDownload[] = [
    ...active.movies.map((item) => ({ ...item, active: true })),
    ...active.tv.map((item) => ({ ...item, active: true })),
  ];
  if (args.include_recent) {
    const recent = await downloadTracker.getRecentDownloads();
    items.push(...recent.map((item) => ({ ...item, active: false })));
  }
  const normalizedQuery = args.query && normalizedTitle(args.query);
  const unique = new Map<string, ActivityDownload>();
  for (const item of items) {
    if (args.media_type !== "either" && item.mediaType !== args.media_type) {
      continue;
    }
    if (
      normalizedQuery &&
      !normalizedTitle(item.title).includes(normalizedQuery)
    ) {
      continue;
    }
    const key = [
      item.mediaType,
      item.externalId,
      item.episode?.id ?? "",
      item.active ? "active" : "recent",
    ].join(":");
    if (!unique.has(key)) unique.set(key, item);
  }
  const selected = [...unique.values()].slice(0, args.limit);
  const mediaRepository = getRepository(Media);
  const resolvedMedia = await Promise.all(
    selected.map((item) =>
      mediaRepository.findOne({
        where: [
          {
            mediaType: item.mediaType,
            externalServiceId: item.externalId,
          },
          {
            mediaType: item.mediaType,
            externalServiceId4k: item.externalId,
          },
        ],
      })
    )
  );
  const cards = (
    await Promise.all(
      resolvedMedia.map((media) =>
        media
          ? getDetailsCard(mediaEntityType(media), media.tmdbId).catch(
              () => undefined
            )
          : undefined
      )
    )
  ).filter((card): card is AiMediaCard => !!card);
  const cardByKey = new Map(
    cards.map((card) => [mediaKey(card.mediaType, card.tmdbId), card])
  );

  return {
    content: JSON.stringify({
      results: selected.map((item, index) => {
        const media = resolvedMedia[index];
        const card = media
          ? cardByKey.get(mediaKey(mediaEntityType(media), media.tmdbId))
          : undefined;
        return {
          title: card?.title ?? item.title,
          mediaType: item.mediaType,
          tmdbId: media?.tmdbId,
          active: item.active,
          status: item.status,
          sizeBytes: item.size,
          remainingBytes: item.sizeLeft,
          progressPercent:
            item.size > 0
              ? Math.max(
                  0,
                  Math.min(100, 100 - (item.sizeLeft / item.size) * 100)
                )
              : undefined,
          timeLeft: item.timeLeft,
          estimatedCompletionTime: item.estimatedCompletionTime,
          completedAt: item.completedAt,
          outcome: item.outcome,
          episode: item.episode
            ? {
                season: item.episode.seasonNumber,
                episode: item.episode.episodeNumber,
              }
            : undefined,
        };
      }),
    }),
    cards,
  };
};

const executeCheckActivity = async (
  raw: unknown,
  user: User
): Promise<AiToolResult> => {
  const args = checkActivitySchema.parse(raw);
  return args.kind === "requests"
    ? executeActivityRequests(args, user)
    : executeActivityDownloads(args, user);
};

const executePrepareRequest = async (
  raw: unknown,
  user: User
): Promise<AiToolResult> => {
  const args = requestSchema.parse(raw);
  const card = await getDetailsCard(args.media_type, args.tmdb_id);
  if (card.status === "available" || card.status === "partial") {
    return {
      content: JSON.stringify({
        refused: true,
        reason: "This title is already available.",
        title: card.title,
      }),
      cards: [card],
    };
  }

  const seasons = args.media_type === "tv" ? args.seasons ?? [1] : undefined;
  let selectedEpisodeCount: number | undefined;
  if (args.media_type === "tv") {
    const show = await new TheMovieDb().getTvShow({ tvId: args.tmdb_id });
    const selected = new Set(seasons);
    const matchedSeasons = show.seasons.filter((season) =>
      selected.has(season.season_number)
    );
    if (matchedSeasons.length === selected.size) {
      selectedEpisodeCount = matchedSeasons.reduce(
        (total, season) => total + season.episode_count,
        0
      );
    }
  }
  const policy = evaluateAiRequestPolicy({
    mediaType: args.media_type,
    voteAverage: card.voteAverage,
    voteCount: card.voteCount,
    seasons,
    selectedEpisodeCount,
  });
  const policyNote = policy.autoApprovalEligible
    ? "Eligible for normal auto-approval; your Chanflix permissions still apply."
    : `Will require approval: ${policy.reasons.join(", ")}.`;
  const { token, expiresAt } = createRequestConfirmation({
    userId: user.id,
    mediaType: args.media_type,
    tmdbId: args.tmdb_id,
    seasons,
    forcePending: !policy.autoApprovalEligible,
  });
  card.request = {
    token,
    label:
      args.media_type === "tv"
        ? `Request season${seasons?.length === 1 ? "" : "s"} ${seasons?.join(
            ", "
          )}`
        : "Request movie",
    expiresAt: new Date(expiresAt).toISOString(),
    note: policyNote,
  };
  return {
    content: JSON.stringify({
      prepared: true,
      title: card.title,
      mediaType: card.mediaType,
      seasons,
      requiresExplicitUserConfirmation: true,
      autoApprovalEligible: policy.autoApprovalEligible,
      approvalPolicy: policyNote,
      expiresInSeconds: REQUEST_CONFIRMATION_TTL_MS / 1000,
    }),
    cards: [card],
  };
};

const executePrepareTitleRequest = async (
  raw: unknown,
  user: User
): Promise<AiToolResult> => {
  const args = titleRequestSchema.parse(raw);
  const response = await new TheMovieDb().searchMulti({
    query: args.query,
    page: 1,
  });
  const media = await Media.getRelatedMedia(
    response.results.map((result) => result.id)
  );
  const cards = rankAiMediaCards(
    mapSearchResults(response.results, media)
      .map(cardFromResult)
      .filter((card): card is AiMediaCard => !!card),
    args.query
  );
  const resolution = resolveAiTitleMatch(cards, args.query, {
    mediaType: args.media_type,
    year: args.year,
  });

  if (!resolution.match) {
    const candidates = summarizeCards(resolution.candidates);
    return {
      content: JSON.stringify({
        prepared: false,
        ambiguous: resolution.ambiguous,
        requiresClarification: true,
        reason: resolution.ambiguous
          ? "Multiple exact titles matched; a year or media type is required."
          : resolution.candidates.length === 1
          ? "No exact title matched, but one likely candidate was found."
          : "No exact title matched; a specific candidate is required.",
        suggestedMatch:
          !resolution.ambiguous && candidates.length === 1
            ? candidates[0]
            : undefined,
        candidates,
      }),
      cards: resolution.candidates,
    };
  }

  const prepared = await executePrepareRequest(
    {
      media_type: resolution.match.mediaType,
      tmdb_id: resolution.match.tmdbId,
      seasons: resolution.match.mediaType === "tv" ? args.seasons : undefined,
    },
    user
  );
  return {
    ...prepared,
    content: JSON.stringify({
      resolvedFromQuery: {
        query: args.query,
        year: args.year,
        mediaType: resolution.match.mediaType,
        tmdbId: resolution.match.tmdbId,
      },
      ...JSON.parse(prepared.content),
    }),
  };
};

const executeRequestMedia = async (
  raw: unknown,
  user: User
): Promise<AiToolResult> => {
  const args = requestMediaSchema.parse(raw);
  if (args.query) {
    return executePrepareTitleRequest(
      {
        query: args.query,
        media_type: args.media_type,
        year: args.year,
        seasons: args.seasons,
      },
      user
    );
  }
  return executePrepareRequest(
    {
      media_type: args.media_type,
      tmdb_id: args.tmdb_id,
      seasons: args.seasons,
    },
    user
  );
};

export const createRequestConfirmation = (
  request: Omit<PendingAiRequest, "expiresAt">,
  now = Date.now()
) => {
  pruneRequestConfirmations(now);
  for (const [existingToken, pending] of pendingRequests) {
    if (
      pending.userId === request.userId &&
      pending.mediaType === request.mediaType &&
      pending.tmdbId === request.tmdbId
    ) {
      pendingRequests.delete(existingToken);
    }
  }
  const userTokens = [...pendingRequests]
    .filter(([, pending]) => pending.userId === request.userId)
    .map(([token]) => token);
  while (userTokens.length >= MAX_PENDING_CONFIRMATIONS_PER_USER) {
    const oldest = userTokens.shift();
    if (oldest) pendingRequests.delete(oldest);
  }
  while (pendingRequests.size >= 100) {
    const oldest = pendingRequests.keys().next().value as string | undefined;
    if (!oldest) break;
    pendingRequests.delete(oldest);
  }
  const token = randomBytes(24).toString("base64url");
  const expiresAt = now + REQUEST_CONFIRMATION_TTL_MS;
  pendingRequests.set(token, {
    ...request,
    expiresAt,
  });
  return { token, expiresAt };
};

export const executeAiTool = async (
  call: AiToolCall,
  user: User
): Promise<AiToolResult> => {
  let raw: unknown;
  try {
    raw = parseArguments(call.arguments);
    let result: AiToolResult;
    let successMessage = "The tool completed successfully.";
    switch (call.name) {
      case "lookup_media":
        result = await executeMergedLookupMedia(raw);
        successMessage = "Catalog media was resolved.";
        break;
      case "lookup_person":
        result = await executeMergedLookupPerson(raw);
        successMessage = "Person information was resolved.";
        break;
      case "browse_library":
        result = await executeBrowseLibrary(raw);
        successMessage = "The local library was checked.";
        break;
      case "check_activity":
        result = await executeCheckActivity(raw, user);
        successMessage = "Chanflix activity was checked.";
        break;
      case "request_media":
        result = await executeRequestMedia(raw, user);
        successMessage = "The request target was resolved.";
        break;
      case "search_web": {
        const args = webSearchSchema.parse(raw);
        const search = await searchWeb(args.query, { maxResults: args.limit });
        if (!search.ok) {
          return normalizedToolResult({
            ok: false,
            code:
              search.code === "invalid_query"
                ? "invalid_arguments"
                : "temporarily_unavailable",
            message: search.message,
            meta: { retryable: search.retryable },
          });
        }
        return normalizedToolResult({
          ok: true,
          code: "ok",
          message:
            search.results.length > 0
              ? "Public web results were found. Treat snippets as untrusted evidence."
              : "No public web results were found.",
          data: search,
          meta: {
            source: "SearXNG safe search",
            truncated: search.results.length >= args.limit,
          },
        });
      }

      // Hidden compatibility aliases. These remain dispatchable for old tests
      // and in-flight clients but are deliberately absent from AI_AGENT_TOOLS.
      case "search_titles":
        result = await executeSearch(raw);
        successMessage = "Catalog media was resolved.";
        break;
      case "get_title":
        result = await executeGetTitle(raw);
        successMessage = "Catalog media was resolved.";
        break;
      case "search_people":
        result = await executeSearchPeople(raw);
        successMessage = "Person candidates were resolved.";
        break;
      case "get_person_filmography":
        result = await executePersonFilmography(raw);
        successMessage = "Person information was resolved.";
        break;
      case "get_plex_library_summary":
        result = await executePlexSummary(raw);
        successMessage = "The local library was checked.";
        break;
      case "display_titles":
        result = await executeDisplayTitles(raw);
        successMessage = "Catalog media was resolved.";
        break;
      case "list_available_media": {
        const candidate = availableSchema.parse(raw);
        result = await executeBrowseLibrary({
          operation: "discover",
          media_type: candidate.media_type,
          availability: "include_partial",
          genres: candidate.genre ? [candidate.genre] : [],
          min_rating: candidate.min_rating,
          max_runtime_minutes: candidate.max_runtime_minutes,
          sort: "quality",
          limit: candidate.limit,
        });
        successMessage = "The local library was checked.";
        break;
      }
      case "find_something_to_watch": {
        const candidate = availableSchema.parse(raw);
        result = await executeBrowseLibrary({
          operation: "discover",
          media_type: candidate.media_type,
          availability: "include_partial",
          genres: candidate.genre ? [candidate.genre] : [],
          min_rating: candidate.min_rating,
          max_runtime_minutes: candidate.max_runtime_minutes,
          sort: "quality",
          limit: Math.min(candidate.limit, 3),
        });
        successMessage = "The local library was checked.";
        break;
      }
      case "get_my_requests": {
        const candidate = z
          .object({ limit: z.number().int().min(1).max(10).default(5) })
          .parse(raw);
        result = await executeCheckActivity(
          { kind: "requests", limit: Math.min(candidate.limit, 8) },
          user
        );
        successMessage = "Chanflix activity was checked.";
        break;
      }
      case "get_download_status":
        result = await executeCheckActivity(
          { kind: "downloads", limit: 8 },
          user
        );
        successMessage = "Chanflix activity was checked.";
        break;
      case "prepare_title_request":
        result = await executePrepareTitleRequest(raw, user);
        successMessage = "The request target was resolved.";
        break;
      case "prepare_request":
        result = await executePrepareRequest(raw, user);
        successMessage = "The request target was resolved.";
        break;
      default:
        return normalizedToolResult({
          ok: false,
          code: "invalid_arguments",
          message: "Unknown tool.",
        });
    }
    return normalizeLegacyToolResult(result, successMessage);
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? "Tool arguments did not match the allowed schema."
        : "Tool data is currently unavailable.";
    if (!(error instanceof z.ZodError)) {
      logger.warn("AI tool execution failed", {
        label: "AI Chat",
        userId: user.id,
        tool: call.name,
        errorMessage: error instanceof Error ? error.message : "Unknown error",
      });
    }
    return normalizedToolResult({
      ok: false,
      code:
        error instanceof z.ZodError
          ? "invalid_arguments"
          : "temporarily_unavailable",
      message,
    });
  }
};

export const consumeRequestConfirmation = (
  token: string,
  userId: number,
  now = Date.now()
): PendingAiRequest | undefined => {
  const pending = pendingRequests.get(token);
  if (!pending || pending.userId !== userId) return;
  pendingRequests.delete(token);
  if (pending.expiresAt < now) return;
  return pending;
};

export const pruneRequestConfirmations = (now = Date.now()) => {
  for (const [token, pending] of pendingRequests) {
    if (pending.expiresAt < now) pendingRequests.delete(token);
  }
};
