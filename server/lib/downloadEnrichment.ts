import type TheMovieDb from '@server/api/themoviedb';
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import logger from '@server/logger';

export interface DownloadMetadata {
  tmdbId?: number;
  posterPath?: string;
  title?: string;
}

/**
 * Resolve a Radarr/Sonarr queue item's `externalId` (movieId / seriesId) to
 * clean TMDB metadata via the local Media row and the TMDB-cache-backed client.
 * Returns an empty object on any miss/failure so callers keep the raw title.
 */
export const resolveDownloadMetadata = async (
  tmdb: TheMovieDb,
  mediaType: MediaType,
  externalId: number
): Promise<DownloadMetadata> => {
  try {
    const media = await getRepository(Media).findOne({
      where: [
        { mediaType, externalServiceId: externalId },
        { mediaType, externalServiceId4k: externalId },
      ],
    });

    if (!media?.tmdbId) {
      return {};
    }

    if (mediaType === MediaType.MOVIE) {
      const movie = await tmdb.getMovie({ movieId: media.tmdbId });
      return {
        tmdbId: media.tmdbId,
        posterPath: movie.poster_path ?? undefined,
        title: movie.title,
      };
    }

    const tv = await tmdb.getTvShow({ tvId: media.tmdbId });
    return {
      tmdbId: media.tmdbId,
      posterPath: tv.poster_path ?? undefined,
      title: tv.name,
    };
  } catch (e) {
    logger.debug('Failed to resolve download metadata', {
      label: 'API',
      mediaType,
      externalId,
      errorMessage: e instanceof Error ? e.message : 'Unknown error',
    });
    return {};
  }
};

export interface SeasonGroupFields {
  seasonNumber?: number;
  episodeNumbers?: number[];
  episodeCount?: number;
}

type Groupable = {
  mediaType: MediaType | 'movie' | 'tv';
  externalId: number;
  size: number;
  sizeLeft: number;
  episode?: { seasonNumber: number; episodeNumber: number; id: number };
};

/**
 * Collapse per-episode TV rows that share a series (`externalId`) and season
 * into a single row — summing size/sizeLeft and collecting episode numbers —
 * so "Show S01E01…E10" renders as one "Season 1 · 8 eps" row. Movies and
 * season-less rows pass through untouched, preserving first-seen order.
 *
 * Presentation-layer only: the persistence keys in downloadtracker /
 * DownloadHistory are per-episode and are not affected.
 */
export const groupDownloadsBySeason = <T extends Groupable>(
  rows: T[]
): (T & SeasonGroupFields)[] => {
  const buckets = new Map<string, T[]>();
  const order: Array<(T & SeasonGroupFields) | { __key: string }> = [];

  for (const row of rows) {
    if (String(row.mediaType) === 'tv' && row.episode) {
      const key = `${row.externalId}:${row.episode.seasonNumber}`;
      const existing = buckets.get(key);
      if (existing) {
        existing.push(row);
      } else {
        buckets.set(key, [row]);
        order.push({ __key: key });
      }
    } else {
      order.push(row);
    }
  }

  return order.map((entry) => {
    if ('__key' in entry) {
      const members = buckets.get(entry.__key) as T[];
      const first = members[0];
      const episodeNumbers = Array.from(
        new Set(members.map((m) => m.episode?.episodeNumber ?? 0))
      ).sort((a, b) => a - b);

      return {
        ...first,
        size: members.reduce((sum, m) => sum + (m.size || 0), 0),
        sizeLeft: members.reduce((sum, m) => sum + (m.sizeLeft || 0), 0),
        seasonNumber: first.episode?.seasonNumber,
        episodeNumbers,
        episodeCount: members.length,
        episode: members.length > 1 ? undefined : first.episode,
      };
    }

    return entry;
  });
};
