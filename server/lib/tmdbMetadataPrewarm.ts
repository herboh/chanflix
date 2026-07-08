import TheMovieDb from '@server/api/themoviedb';
import { MediaType } from '@server/constants/media';
import dataSource, { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import logger from '@server/logger';

export interface TmdbPrewarmCandidate {
  mediaType: MediaType;
  tmdbId: number;
}

export interface TmdbPrewarmResult {
  attempted: number;
  succeeded: number;
  failed: number;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export const dedupeTmdbPrewarmCandidates = (
  candidates: TmdbPrewarmCandidate[]
): TmdbPrewarmCandidate[] => {
  const seen = new Set<string>();

  return candidates.filter((candidate) => {
    const key = `${candidate.mediaType}:${candidate.tmdbId}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
};

export const getTmdbPrewarmCandidates = async (
  take = 250
): Promise<TmdbPrewarmCandidate[]> => {
  if (!dataSource.isInitialized) {
    return [];
  }

  const media = await getRepository(Media).find({
    select: {
      mediaType: true,
      tmdbId: true,
      updatedAt: true,
      mediaAddedAt: true,
    },
    order: {
      mediaAddedAt: 'DESC',
      updatedAt: 'DESC',
    },
    take,
  });

  return dedupeTmdbPrewarmCandidates(
    media
      .filter((item) => item.tmdbId)
      .map((item) => ({
        mediaType: item.mediaType,
        tmdbId: item.tmdbId,
      }))
  );
};

export const prewarmTmdbMetadata = async ({
  take = 250,
  delayMs = 125,
}: {
  take?: number;
  delayMs?: number;
} = {}): Promise<TmdbPrewarmResult> => {
  const candidates = await getTmdbPrewarmCandidates(take);
  const tmdb = new TheMovieDb();
  const result: TmdbPrewarmResult = {
    attempted: candidates.length,
    succeeded: 0,
    failed: 0,
  };

  for (const candidate of candidates) {
    try {
      if (candidate.mediaType === MediaType.MOVIE) {
        await tmdb.getMovie({ movieId: candidate.tmdbId });
      } else {
        await tmdb.getTvShow({ tvId: candidate.tmdbId });
      }

      result.succeeded += 1;
    } catch (e) {
      result.failed += 1;
      logger.debug('Failed to prewarm TMDB metadata', {
        label: 'TMDB Cache',
        mediaType: candidate.mediaType,
        tmdbId: candidate.tmdbId,
        errorMessage: e instanceof Error ? e.message : 'Unknown error',
      });
    }

    if (delayMs > 0) {
      await sleep(delayMs);
    }
  }

  logger.info('Finished TMDB metadata prewarm', {
    label: 'TMDB Cache',
    attempted: result.attempted,
    succeeded: result.succeeded,
    failed: result.failed,
  });

  return result;
};
