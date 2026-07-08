import dataSource, { getRepository } from '@server/datasource';
import TmdbMetadataCache from '@server/entity/TmdbMetadataCache';
import logger from '@server/logger';

type TmdbMediaType = 'movie' | 'tv';

export const TMDB_METADATA_TTL_MS = 1000 * 60 * 60 * 24 * 30;

export const getTmdbMetadataCacheKey = ({
  mediaType,
  tmdbId,
  language,
  appendToResponse,
}: {
  mediaType: TmdbMediaType;
  tmdbId: number;
  language: string;
  appendToResponse: string;
}): string =>
  [mediaType, tmdbId, language || 'en', appendToResponse].join(':');

export const isTmdbMetadataFresh = (
  item: Pick<TmdbMetadataCache, 'expiresAt'>,
  now = new Date()
): boolean => item.expiresAt.getTime() > now.getTime();

export const parseTmdbMetadataPayload = <T>(
  item: Pick<TmdbMetadataCache, 'payload'>
): T => JSON.parse(item.payload) as T;

export const getTmdbMetadata = async <T>({
  mediaType,
  tmdbId,
  language,
  appendToResponse,
  allowStale = false,
}: {
  mediaType: TmdbMediaType;
  tmdbId: number;
  language: string;
  appendToResponse: string;
  allowStale?: boolean;
}): Promise<T | undefined> => {
  if (!dataSource.isInitialized) {
    return undefined;
  }

  const cacheKey = getTmdbMetadataCacheKey({
    mediaType,
    tmdbId,
    language,
    appendToResponse,
  });

  try {
    const item = await getRepository(TmdbMetadataCache).findOne({
      where: { cacheKey },
    });

    if (!item || (!allowStale && !isTmdbMetadataFresh(item))) {
      return undefined;
    }

    return parseTmdbMetadataPayload<T>(item);
  } catch (e) {
    logger.warn('Failed to read persistent TMDB metadata cache', {
      label: 'TMDB Cache',
      mediaType,
      tmdbId,
      errorMessage: e instanceof Error ? e.message : 'Unknown error',
    });

    return undefined;
  }
};

export const setTmdbMetadata = async <T>({
  mediaType,
  tmdbId,
  language,
  appendToResponse,
  payload,
  ttlMs = TMDB_METADATA_TTL_MS,
}: {
  mediaType: TmdbMediaType;
  tmdbId: number;
  language: string;
  appendToResponse: string;
  payload: T;
  ttlMs?: number;
}): Promise<void> => {
  if (!dataSource.isInitialized) {
    return;
  }

  const repository = getRepository(TmdbMetadataCache);
  const cacheKey = getTmdbMetadataCacheKey({
    mediaType,
    tmdbId,
    language,
    appendToResponse,
  });
  const fetchedAt = new Date();
  const expiresAt = new Date(fetchedAt.getTime() + ttlMs);

  try {
    const existing = await repository.findOne({ where: { cacheKey } });

    await repository.save(
      new TmdbMetadataCache({
        ...(existing ?? {}),
        cacheKey,
        mediaType,
        tmdbId,
        language,
        appendToResponse,
        payload: JSON.stringify(payload),
        fetchedAt,
        expiresAt,
      })
    );
  } catch (e) {
    logger.warn('Failed to write persistent TMDB metadata cache', {
      label: 'TMDB Cache',
      mediaType,
      tmdbId,
      errorMessage: e instanceof Error ? e.message : 'Unknown error',
    });
  }
};
