import TheMovieDb from "@server/api/themoviedb";
import type {
  TmdbPersonCreditCast,
  TmdbPersonCreditCrew,
  TmdbPersonResult,
} from "@server/api/themoviedb/interfaces";
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from "@server/constants/media";
import { getRepository } from "@server/datasource";
import Media from "@server/entity/Media";
import { MediaRequest } from "@server/entity/MediaRequest";
import type { User } from "@server/entity/User";
import downloadTracker from "@server/lib/downloadtracker";
import { Permission } from "@server/lib/permissions";
import logger from "@server/logger";
import { mapMovieDetails } from "@server/models/Movie";
import { mapSearchResults } from "@server/models/Search";
import { mapTvDetails } from "@server/models/Tv";
import { randomBytes } from "crypto";
import { In } from "typeorm";
import { z } from "zod";

export const AI_AGENT_MAX_TOOL_ROUNDS = 4;
export const AI_AGENT_MAX_CARDS = 5;
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
const searchSchema = z.object({
  query: z.string().trim().min(1).max(120),
  limit: z.number().int().min(1).max(5).default(3),
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
  media_type: z.enum(["movie", "tv", "either"]).default("either"),
  available_only: z.boolean().default(false),
  limit: z.number().int().min(1).max(5).default(5),
});
const personLookupSchema = peopleSearchSchema.merge(
  personCreditsSchema.omit({ person_id: true })
);
const plexSummarySchema = z.object({
  media_type: z.enum(["movie", "tv", "either"]).default("either"),
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
    .max(5),
});
const availableSchema = z.object({
  media_type: z.enum(["movie", "tv", "either"]).default("either"),
  genre: z.string().trim().max(60).optional(),
  min_rating: z.number().min(0).max(10).default(0),
  max_runtime_minutes: z.number().int().min(30).max(360).optional(),
  limit: z.number().int().min(1).max(5).default(3),
});
const requestSchema = z.object({
  media_type: mediaTypeSchema,
  tmdb_id: z.number().int().positive(),
  seasons: z.array(z.number().int().min(1).max(100)).max(3).optional(),
});
const titleRequestSchema = z.object({
  query: z.string().trim().min(1).max(120),
  media_type: z.enum(["movie", "tv", "either"]).default("either"),
  year: z.number().int().min(1870).max(2100).optional(),
  seasons: z.array(z.number().int().min(1).max(100)).max(3).optional(),
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
    "search_titles",
    "Search the Chanflix/TMDB catalog for movies or series. Use this before assuming a title identity.",
    {
      query: { type: "string", description: "Title or concise search phrase." },
      limit: { type: "integer", minimum: 1, maximum: 5 },
    },
    ["query"]
  ),
  tool(
    "get_title",
    "Get confirmed metadata, availability, cast, directors, writers, and creators for one exact movie or series.",
    {
      media_type: { type: "string", enum: ["movie", "tv"] },
      tmdb_id: { type: "integer", minimum: 1 },
    },
    ["media_type", "tmdb_id"]
  ),
  tool(
    "lookup_person",
    "Resolve an actor, director, writer, or other film person by name and return verified identity, biography, birth details, IMDb ID, and a small filmography in one call. Prefer this over separate person search and filmography calls; ambiguous names are returned for clarification.",
    {
      query: { type: "string", description: "Person name." },
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
      limit: { type: "integer", minimum: 1, maximum: 5 },
    },
    ["query"]
  ),
  tool(
    "search_people",
    "Resolve an ambiguous film-person name into candidates. Usually use lookup_person instead.",
    {
      query: { type: "string", description: "Person name." },
      limit: { type: "integer", minimum: 1, maximum: 3 },
    },
    ["query"]
  ),
  tool(
    "get_person_filmography",
    "Get a verified filmography when a person's TMDB ID is already known, usually after resolving an ambiguous lookup_person result.",
    {
      person_id: { type: "integer", minimum: 1 },
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
      limit: { type: "integer", minimum: 1, maximum: 5 },
    },
    ["person_id"]
  ),
  tool(
    "get_plex_library_summary",
    "Read the local Chanflix database for Plex-synced movie and series counts and a few recently added titles. Use whenever the user asks about this server, Plex, the library, or what is on here in general.",
    {
      media_type: { type: "string", enum: ["movie", "tv", "either"] },
      include_recent: { type: "boolean" },
    }
  ),
  tool(
    "display_titles",
    "Render the canonical Chanflix cards for one to five exact titles, including poster, year, rating, availability, and link. Use before the final answer whenever you name a concrete movie/series set and no prior tool in this request already returned cards for those titles.",
    {
      titles: {
        type: "array",
        minItems: 1,
        maxItems: 5,
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
    },
    ["titles"]
  ),
  tool(
    "list_available_media",
    "Find titles actually ready to watch on this Plex server. Useful for tailored recommendations.",
    {
      media_type: { type: "string", enum: ["movie", "tv", "either"] },
      genre: { type: "string", description: "Optional genre name." },
      min_rating: { type: "number", minimum: 0, maximum: 10 },
      max_runtime_minutes: { type: "integer", minimum: 30, maximum: 360 },
      limit: { type: "integer", minimum: 1, maximum: 5 },
    }
  ),
  tool(
    "find_something_to_watch",
    "Return a small, factual candidate set from titles actually ready on this server after the conversation has established the user's taste. Never return more than three unless asked.",
    {
      media_type: { type: "string", enum: ["movie", "tv", "either"] },
      genre: {
        type: "string",
        description: "Optional genre preference established in conversation.",
      },
      min_rating: { type: "number", minimum: 0, maximum: 10 },
      max_runtime_minutes: { type: "integer", minimum: 30, maximum: 360 },
      limit: { type: "integer", minimum: 1, maximum: 3 },
    }
  ),
  tool(
    "get_my_requests",
    "Get the logged-in user's recent movie and series request status.",
    { limit: { type: "integer", minimum: 1, maximum: 10 } }
  ),
  tool(
    "get_download_status",
    "Get active Radarr/Sonarr downloads. This tool is permission-gated and may refuse access.",
    {}
  ),
  tool(
    "prepare_title_request",
    "For an explicit add, get, download, or request instruction: resolve an exact movie or series by title and optional year, then prepare its Chanflix confirmation button. It refuses fuzzy or ambiguous matches. Confirmation, permissions, quotas, and server approval policy still apply.",
    {
      query: { type: "string", description: "Exact title." },
      media_type: { type: "string", enum: ["movie", "tv", "either"] },
      year: { type: "integer", minimum: 1870, maximum: 2100 },
      seasons: {
        type: "array",
        maxItems: 3,
        items: { type: "integer", minimum: 1, maximum: 100 },
      },
    },
    ["query"]
  ),
  tool(
    "prepare_request",
    "Prepare a confirmation when an exact movie or series and its verified TMDB ID are already present in the current context. Never invent the TMDB ID; otherwise use prepare_title_request.",
    {
      media_type: { type: "string", enum: ["movie", "tv"] },
      tmdb_id: { type: "integer", minimum: 1 },
      seasons: {
        type: "array",
        maxItems: 3,
        items: { type: "integer", minimum: 1, maximum: 100 },
      },
    },
    ["media_type", "tmdb_id"]
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
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

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
  query?: string
): AiMediaCard[] => {
  const normalizedQuery = query ? normalizedTitle(query) : undefined;
  return [...cards].sort((left, right) => {
    if (normalizedQuery) {
      const leftExact = normalizedTitle(left.title) === normalizedQuery;
      const rightExact = normalizedTitle(right.title) === normalizedQuery;
      if (leftExact !== rightExact) return leftExact ? -1 : 1;
    }
    return (
      (right.voteCount ?? 0) - (left.voteCount ?? 0) ||
      (right.popularity ?? 0) - (left.popularity ?? 0) ||
      (right.voteAverage ?? 0) - (left.voteAverage ?? 0)
    );
  });
};

const parseArguments = (raw: string): unknown => {
  if (raw.length > 4_000) throw new Error("Tool arguments are too large.");
  try {
    return JSON.parse(raw || "{}");
  } catch (_error) {
    throw new Error("Tool arguments were not valid JSON.");
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
  const entries = credits
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
    )
    .sort(
      (left, right) =>
        Number(
          right.card.status === "available" || right.card.status === "partial"
        ) -
          Number(
            left.card.status === "available" || left.card.status === "partial"
          ) ||
        (right.card.voteCount ?? 0) - (left.card.voteCount ?? 0) ||
        (right.card.popularity ?? 0) - (left.card.popularity ?? 0)
    )
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

const executeAvailable = async (raw: unknown): Promise<AiToolResult> => {
  const args = availableSchema.parse(raw);
  const repository = getRepository(Media);
  const candidates = await repository.find({
    where: {
      status: In([MediaStatus.AVAILABLE, MediaStatus.PARTIALLY_AVAILABLE]),
      ...(args.media_type === "either"
        ? {}
        : {
            mediaType:
              args.media_type === "movie" ? MediaType.MOVIE : MediaType.TV,
          }),
    },
    order: { mediaAddedAt: "DESC", updatedAt: "DESC" },
    take: Math.min(20, Math.max(args.limit * 4, 12)),
  });

  const details: Array<AiMediaCard | undefined> = [];
  for (let index = 0; index < candidates.length; index += 4) {
    details.push(
      ...(await Promise.all(
        candidates
          .slice(index, index + 4)
          .map((media) =>
            getDetailsCard(
              media.mediaType === MediaType.MOVIE ? "movie" : "tv",
              media.tmdbId
            ).catch(() => undefined)
          )
      ))
    );
  }
  const genre = args.genre?.toLowerCase();
  const cards = rankAiMediaCards(
    details
      .filter((card): card is AiMediaCard => !!card)
      .filter((card) => (card.voteAverage ?? 0) >= args.min_rating)
      .filter(
        (card) =>
          !genre ||
          card.genres?.some((name) => name.toLowerCase().includes(genre))
      )
      .filter(
        (card) =>
          !args.max_runtime_minutes ||
          !card.runtimeMinutes ||
          card.runtimeMinutes <= args.max_runtime_minutes
      )
  ).slice(0, args.limit);

  return {
    content: JSON.stringify({
      confirmedAvailable: true,
      notExhaustive: true,
      note: genre
        ? "Genre is a preference hint; verify fit from metadata."
        : undefined,
      results: summarizeCards(cards),
    }),
    cards,
  };
};

const executeMyRequests = async (
  raw: unknown,
  user: User
): Promise<AiToolResult> => {
  const args = z
    .object({ limit: z.number().int().min(1).max(10).default(5) })
    .parse(raw);
  const requests = await getRepository(MediaRequest).find({
    where: { requestedBy: { id: user.id } },
    relations: { media: true, seasons: true },
    order: { createdAt: "DESC" },
    take: args.limit,
  });
  const status = (value: MediaRequestStatus) =>
    MediaRequestStatus[value]?.toLowerCase();
  const cards = (
    await Promise.all(
      requests.map((request) =>
        getDetailsCard(
          request.type === MediaType.MOVIE ? "movie" : "tv",
          request.media.tmdbId
        ).catch(() => undefined)
      )
    )
  ).filter((card): card is AiMediaCard => !!card);
  return {
    content: JSON.stringify({
      results: requests.map((request) => ({
        requestId: request.id,
        mediaType: request.type,
        tmdbId: request.media.tmdbId,
        requestStatus: status(request.status),
        mediaStatus: statusName(
          request.is4k ? request.media.status4k : request.media.status
        ),
        seasons: request.seasons?.map((season) => season.seasonNumber),
        createdAt: request.createdAt,
      })),
    }),
    cards,
  };
};

const executeDownloads = async (user: User): Promise<AiToolResult> => {
  if (!user.hasPermission(Permission.MANAGE_REQUESTS)) {
    return {
      content: JSON.stringify({
        refused: true,
        reason: "You do not have permission to view the server download queue.",
      }),
    };
  }
  const downloads = downloadTracker.getAllDownloads();
  const compact = (items: typeof downloads.movies) =>
    items.slice(0, 12).map((item) => ({
      title: item.title,
      mediaType: item.mediaType,
      status: item.status,
      sizeBytes: item.size,
      remainingBytes: item.sizeLeft,
      timeLeft: item.timeLeft,
      estimatedCompletionTime: item.estimatedCompletionTime,
      episode: item.episode
        ? {
            season: item.episode.seasonNumber,
            episode: item.episode.episodeNumber,
          }
        : undefined,
    }));
  return {
    content: JSON.stringify({
      movies: compact(downloads.movies),
      tv: compact(downloads.tv),
    }),
  };
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

export const createRequestConfirmation = (
  request: Omit<PendingAiRequest, "expiresAt">,
  now = Date.now()
) => {
  pruneRequestConfirmations(now);
  for (const [existingToken, pending] of pendingRequests) {
    if (pending.userId === request.userId)
      pendingRequests.delete(existingToken);
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
    switch (call.name) {
      case "search_titles":
        return await executeSearch(raw);
      case "get_title":
        return await executeGetTitle(raw);
      case "lookup_person":
        return await executeLookupPerson(raw);
      case "search_people":
        return await executeSearchPeople(raw);
      case "get_person_filmography":
        return await executePersonFilmography(raw);
      case "get_plex_library_summary":
        return await executePlexSummary(raw);
      case "display_titles":
        return await executeDisplayTitles(raw);
      case "list_available_media":
        return await executeAvailable(raw);
      case "find_something_to_watch": {
        const candidate = z.record(z.unknown()).parse(raw);
        return await executeAvailable({
          ...candidate,
          limit: Math.min(Number(candidate.limit ?? 3), 3),
        });
      }
      case "get_my_requests":
        return await executeMyRequests(raw, user);
      case "get_download_status":
        return await executeDownloads(user);
      case "prepare_title_request":
        return await executePrepareTitleRequest(raw, user);
      case "prepare_request":
        return await executePrepareRequest(raw, user);
      default:
        return {
          content: JSON.stringify({ refused: true, reason: "Unknown tool." }),
        };
    }
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
    return { content: JSON.stringify({ error: message }) };
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
