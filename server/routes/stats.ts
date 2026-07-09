import TautulliAPI, {
  TautulliActivitySession,
  TautulliHistoryRecord,
  TautulliHomeStatItem,
} from '@server/api/tautulli';
import TheMovieDb from '@server/api/themoviedb';
import { MediaRequestStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import cacheManager from '@server/lib/cache';
import downloadTracker, {
  DownloadingItem,
  RecentDownloadItem,
} from '@server/lib/downloadtracker';
import { Permission } from '@server/lib/permissions';
import type { DVRSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { Router } from 'express';

const statsRoutes = Router();

type RequestActivityStatus = 'pending' | 'approved' | 'declined' | 'failed';

type RecentActivityItem =
  | {
      id: string;
      type: 'request';
      occurredAt: string;
      user: string;
      mediaType: MediaType;
      mediaTitle: string;
      tmdbId: number;
      status: RequestActivityStatus;
      is4k: boolean;
    }
  | {
      id: string;
      type: 'watch';
      occurredAt: string;
      user: string;
      mediaType: 'movie' | 'episode';
      mediaTitle: string;
      episodeTitle?: string;
    }
  | {
      id: string;
      type: 'download';
      occurredAt: string;
      mediaType: MediaType;
      mediaTitle: string;
      status: string;
    };

export type PendingRequestSummary = {
  id: number;
  createdAt: string;
  updatedAt: string;
  user: string;
  mediaType: MediaType;
  mediaTitle: string;
  tmdbId: number;
  status: RequestActivityStatus;
  is4k: boolean;
  serverId?: number;
  serverName?: string;
  profileId?: number;
  profileName?: string;
  rootFolder?: string;
  tags?: number[];
};

type PendingRequestsResponse = {
  pageInfo: {
    pages: number;
    pageSize: number;
    results: number;
    page: number;
  };
  results: PendingRequestSummary[];
};

type MediaTitleClient = {
  getMovie: (options: { movieId: number }) => Promise<{ title: string }>;
  getTvShow: (options: { tvId: number }) => Promise<{ name: string }>;
};

export const mapRequestStatus = (
  status: MediaRequestStatus
): RequestActivityStatus => {
  switch (status) {
    case MediaRequestStatus.PENDING:
      return 'pending';
    case MediaRequestStatus.APPROVED:
      return 'approved';
    case MediaRequestStatus.DECLINED:
      return 'declined';
    case MediaRequestStatus.FAILED:
      return 'failed';
  }
};

export const getRequestTitle = async (
  tmdb: MediaTitleClient,
  request: MediaRequest
): Promise<string> => {
  try {
    if (request.type === MediaType.MOVIE) {
      const movie = await tmdb.getMovie({ movieId: request.media.tmdbId });

      return movie.title;
    }

    const tv = await tmdb.getTvShow({ tvId: request.media.tmdbId });

    return tv.name;
  } catch (e) {
    logger.debug('Failed to resolve request title for recent activity', {
      label: 'API',
      mediaType: request.type,
      tmdbId: request.media.tmdbId,
      errorMessage: e instanceof Error ? e.message : 'Unknown error',
    });

    return `${request.type === MediaType.MOVIE ? 'Movie' : 'Series'} #${
      request.media.tmdbId
    }`;
  }
};

export const getRequestServer = (
  request: MediaRequest,
  settings: ReturnType<typeof getSettings>
): DVRSettings | undefined => {
  const servers: DVRSettings[] =
    request.type === MediaType.MOVIE ? settings.radarr : settings.sonarr;

  return (
    servers.find((server) => server.id === request.serverId) ??
    servers.find(
      (server) => server.isDefault && server.is4k === request.is4k
    ) ??
    servers.find((server) => server.isDefault)
  );
};

export const getRequestProfileName = (
  request: MediaRequest,
  server?: DVRSettings
): string | undefined => {
  if (!request.profileId && !server?.activeProfileName) {
    return undefined;
  }

  if (!request.profileId || request.profileId === server?.activeProfileId) {
    return server?.activeProfileName;
  }

  return `Profile ${request.profileId}`;
};

export const buildPendingRequestSummary = async (
  tmdb: MediaTitleClient,
  request: MediaRequest,
  settings: ReturnType<typeof getSettings>
): Promise<PendingRequestSummary> => {
  const server = getRequestServer(request, settings);

  return {
    id: request.id,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
    user: request.requestedBy.displayName,
    mediaType: request.type,
    mediaTitle: await getRequestTitle(tmdb, request),
    tmdbId: request.media.tmdbId,
    status: mapRequestStatus(request.status),
    is4k: request.is4k,
    serverId: request.serverId ?? server?.id,
    serverName: server?.name,
    profileId: request.profileId ?? server?.activeProfileId,
    profileName: getRequestProfileName(request, server),
    rootFolder: request.rootFolder ?? server?.activeDirectory,
    tags: request.tags ?? server?.tags,
  };
};

// GET /api/v1/stats/popular - Get popular content from Tautulli
statsRoutes.get<
  Record<string, never>,
  TautulliHomeStatItem[] | { error: string },
  Record<string, never>,
  { days?: string; take?: string }
>('/popular', isAuthenticated(), async (req, res, next) => {
  const settings = getSettings();

  if (!settings.tautulli.hostname || !settings.tautulli.apiKey) {
    return res.status(200).json([]);
  }

  const days = Number(req.query.days) || 30;
  const take = Number(req.query.take) || 5;

  try {
    const tautulli = new TautulliAPI(settings.tautulli);
    const popular = await tautulli.getPopularContent(days, take);

    return res.status(200).json(popular);
  } catch (e) {
    logger.error('Failed to fetch popular content from Tautulli', {
      label: 'API',
      errorMessage: e instanceof Error ? e.message : 'Unknown error',
    });
    return next({
      status: 500,
      message: 'Failed to fetch popular content.',
    });
  }
});

// GET /api/v1/stats/activity - Get recent watch activity from Tautulli
statsRoutes.get<
  Record<string, never>,
  TautulliHistoryRecord[] | { error: string },
  Record<string, never>,
  { take?: string }
>('/activity', isAuthenticated(), async (req, res, next) => {
  const settings = getSettings();

  if (!settings.tautulli.hostname || !settings.tautulli.apiKey) {
    return res.status(200).json([]);
  }

  const take = Number(req.query.take) || 10;

  try {
    const tautulli = new TautulliAPI(settings.tautulli);
    const history = await tautulli.getGlobalHistory(take);

    return res.status(200).json(history);
  } catch (e) {
    logger.error('Failed to fetch activity from Tautulli', {
      label: 'API',
      errorMessage: e instanceof Error ? e.message : 'Unknown error',
    });
    return next({
      status: 500,
      message: 'Failed to fetch activity.',
    });
  }
});

// GET /api/v1/stats/recent - Unified recent request/watch/download activity
statsRoutes.get<
  Record<string, never>,
  RecentActivityItem[] | { error: string },
  Record<string, never>,
  { take?: string }
>('/recent', isAuthenticated(), async (req, res, next) => {
  const settings = getSettings();
  const take = Math.min(Number(req.query.take) || 8, 20);
  const canViewAllRequests = req.user?.hasPermission(
    [Permission.MANAGE_REQUESTS, Permission.REQUEST_VIEW],
    { type: 'or' }
  );
  const canViewDownloads = req.user?.hasPermission(Permission.MANAGE_REQUESTS);
  const cache = cacheManager.getCache('stats').data;
  const cacheKey = JSON.stringify({
    route: 'recent',
    take,
    userId: canViewAllRequests ? 'all' : req.user?.id,
    downloads: canViewDownloads,
  });
  const cachedResponse = cache.get<RecentActivityItem[]>(cacheKey);

  if (cachedResponse) {
    return res.status(200).json(cachedResponse);
  }

  try {
    const requestRepository = getRepository(MediaRequest);
    let requestQuery = requestRepository
      .createQueryBuilder('request')
      .leftJoinAndSelect('request.media', 'media')
      .leftJoinAndSelect('request.requestedBy', 'requestedBy')
      .orderBy('request.updatedAt', 'DESC')
      .take(take);

    if (!canViewAllRequests) {
      requestQuery = requestQuery.where('requestedBy.id = :id', {
        id: req.user?.id,
      });
    }

    const [requests, watchHistory] = await Promise.all([
      requestQuery.getMany(),
      settings.tautulli.hostname && settings.tautulli.apiKey
        ? new TautulliAPI(settings.tautulli).getGlobalHistory(take)
        : Promise.resolve([] as TautulliHistoryRecord[]),
    ]);

    const tmdb = new TheMovieDb();
    const requestActivities = await Promise.all(
      requests.map(async (request) => ({
        id: `request-${request.id}`,
        type: 'request' as const,
        occurredAt: request.updatedAt.toISOString(),
        user: request.requestedBy.displayName,
        mediaType: request.type,
        mediaTitle: await getRequestTitle(tmdb, request),
        tmdbId: request.media.tmdbId,
        status: mapRequestStatus(request.status),
        is4k: request.is4k,
      }))
    );

    const watchActivities: RecentActivityItem[] = watchHistory.map((item) => ({
      id: `watch-${item.row_id ?? item.rating_key}-${item.date}`,
      type: 'watch',
      occurredAt: new Date(item.date * 1000).toISOString(),
      user: item.friendly_name || item.user,
      mediaType: item.media_type === 'episode' ? 'episode' : 'movie',
      mediaTitle:
        item.media_type === 'episode'
          ? item.grandparent_title || item.title
          : item.title,
      episodeTitle:
        item.media_type === 'episode'
          ? [item.parent_title, item.title].filter(Boolean).join(' - ')
          : undefined,
    }));

    let downloadActivities: RecentActivityItem[] = [];
    let recentDownloadActivities: RecentActivityItem[] = [];

    if (canViewDownloads) {
      const downloads = downloadTracker.getAllDownloads();
      downloadActivities = [...downloads.movies, ...downloads.tv].map(
        (item, index) => ({
          id: `download-${item.mediaType}-${item.externalId}-${index}`,
          type: 'download',
          occurredAt: new Date().toISOString(),
          mediaType: item.mediaType,
          mediaTitle: item.title,
          status: item.status,
        })
      );
      recentDownloadActivities = (
        await downloadTracker.getRecentDownloads()
      ).map((item, index) => ({
        id: `recent-download-${item.mediaType}-${item.externalId}-${index}`,
        type: 'download',
        occurredAt: item.completedAt.toISOString(),
        mediaType: item.mediaType,
        mediaTitle: item.title,
        status: item.outcome,
      }));
    }

    const response = [
      ...requestActivities,
      ...watchActivities,
      ...downloadActivities,
      ...recentDownloadActivities,
    ]
      .sort(
        (a, b) =>
          new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
      )
      .slice(0, take);

    cache.set(cacheKey, response);

    return res.status(200).json(response);
  } catch (e) {
    logger.error('Failed to fetch recent activity', {
      label: 'API',
      errorMessage: e instanceof Error ? e.message : 'Unknown error',
    });
    return next({
      status: 500,
      message: 'Failed to fetch recent activity.',
    });
  }
});

// GET /api/v1/stats/pending-requests - Operations-friendly pending requests
statsRoutes.get<
  Record<string, never>,
  PendingRequestsResponse | { error: string },
  Record<string, never>,
  { take?: string; skip?: string }
>(
  '/pending-requests',
  isAuthenticated(Permission.MANAGE_REQUESTS),
  async (req, res, next) => {
    const settings = getSettings();
    const take = Math.min(Number(req.query.take) || 6, 20);
    const skip = Number(req.query.skip) || 0;
    const cache = cacheManager.getCache('stats').data;
    const cacheKey = JSON.stringify({
      route: 'pending-requests',
      take,
      skip,
    });
    const cachedResponse = cache.get<PendingRequestsResponse>(cacheKey);

    if (cachedResponse) {
      return res.status(200).json(cachedResponse);
    }

    try {
      const requestRepository = getRepository(MediaRequest);
      const query = requestRepository
        .createQueryBuilder('request')
        .leftJoinAndSelect('request.media', 'media')
        .leftJoinAndSelect('request.requestedBy', 'requestedBy')
        .where('request.status = :status', {
          status: MediaRequestStatus.PENDING,
        })
        .orderBy('request.updatedAt', 'DESC');

      const [requests, requestCount] = await query
        .take(take)
        .skip(skip)
        .getManyAndCount();

      const tmdb = new TheMovieDb();
      const results = await Promise.all(
        requests.map((request) =>
          buildPendingRequestSummary(tmdb, request, settings)
        )
      );

      const response = {
        pageInfo: {
          pages: Math.ceil(requestCount / take),
          pageSize: take,
          results: requestCount,
          page: Math.floor(skip / take) + 1,
        },
        results,
      };

      cache.set(cacheKey, response);

      return res.status(200).json(response);
    } catch (e) {
      logger.error('Failed to fetch pending request summaries', {
        label: 'API',
        errorMessage: e instanceof Error ? e.message : 'Unknown error',
      });
      return next({
        status: 500,
        message: 'Failed to fetch pending request summaries.',
      });
    }
  }
);

export type NowStream = {
  id: string;
  user: string;
  state: string;
  mediaType: 'movie' | 'episode' | 'other';
  title: string;
  episodeTitle?: string;
  progressPercent: number;
  player: string;
  year?: number;
  ratingKey?: string;
  grandparentRatingKey?: string;
  tmdbId?: number;
  posterPath?: string;
};

export type NowDownload = {
  mediaType: MediaType;
  externalId: number;
  title: string;
  status: string;
  size: number;
  sizeLeft: number;
  timeLeft: string;
  estimatedCompletionTime: string;
  episode?: {
    seasonNumber: number;
    episodeNumber: number;
    id: number;
  };
  tmdbId?: number;
  posterPath?: string;
};

export type NowRecentDownload = NowDownload & {
  completedAt: string;
  outcome: 'completed' | 'cleared';
};

type NowResponse = {
  streams: NowStream[];
  downloads: NowDownload[];
  recentlyFinished: NowRecentDownload[];
  updatedAt: string;
};

export const RECENTLY_FINISHED_WINDOW_MS = 5 * 60 * 1000;

export const mapActivitySession = (
  session: TautulliActivitySession
): NowStream => {
  const isEpisode = session.media_type === 'episode';
  const progress = Number(session.progress_percent);

  return {
    id: `stream-${session.session_key}`,
    user: session.friendly_name || session.user,
    state: session.state,
    mediaType:
      session.media_type === 'movie'
        ? 'movie'
        : isEpisode
        ? 'episode'
        : 'other',
    title: isEpisode
      ? session.grandparent_title || session.title
      : session.title,
    episodeTitle: isEpisode
      ? [
          session.parent_title,
          session.media_index ? `Episode ${session.media_index}` : '',
          session.title,
        ]
          .filter(Boolean)
          .join(' · ')
      : undefined,
    progressPercent: Number.isFinite(progress)
      ? Math.max(0, Math.min(progress, 100))
      : 0,
    player: session.player || session.product,
    year: Number(session.year) || undefined,
    ratingKey: session.rating_key || undefined,
    grandparentRatingKey: session.grandparent_rating_key || undefined,
  };
};

export const isRecentlyFinished = (
  item: { completedAt: Date | string },
  now: Date = new Date(),
  windowMs: number = RECENTLY_FINISHED_WINDOW_MS
): boolean => {
  const completedAt = new Date(item.completedAt).getTime();

  return (
    Number.isFinite(completedAt) &&
    completedAt <= now.getTime() &&
    now.getTime() - completedAt <= windowMs
  );
};

const resolvePoster = async (
  tmdb: TheMovieDb,
  mediaType: MediaType,
  tmdbId: number
): Promise<string | undefined> => {
  try {
    if (mediaType === MediaType.MOVIE) {
      return (await tmdb.getMovie({ movieId: tmdbId })).poster_path;
    }

    return (await tmdb.getTvShow({ tvId: tmdbId })).poster_path;
  } catch (e) {
    logger.debug('Failed to resolve poster for now panel', {
      label: 'API',
      mediaType,
      tmdbId,
      errorMessage: e instanceof Error ? e.message : 'Unknown error',
    });

    return undefined;
  }
};

const enrichNowDownload = async (
  tmdb: TheMovieDb,
  item: DownloadingItem
): Promise<NowDownload> => {
  const base: NowDownload = {
    mediaType: item.mediaType,
    externalId: item.externalId,
    title: item.title,
    status: item.status,
    size: item.size,
    sizeLeft: item.sizeLeft,
    timeLeft: item.timeLeft,
    estimatedCompletionTime: new Date(
      item.estimatedCompletionTime
    ).toISOString(),
    episode: item.episode
      ? {
          seasonNumber: item.episode.seasonNumber,
          episodeNumber: item.episode.episodeNumber,
          id: item.episode.id,
        }
      : undefined,
  };

  try {
    const media = await getRepository(Media).findOne({
      where: [
        { mediaType: item.mediaType, externalServiceId: item.externalId },
        { mediaType: item.mediaType, externalServiceId4k: item.externalId },
      ],
    });

    if (media?.tmdbId) {
      return {
        ...base,
        tmdbId: media.tmdbId,
        posterPath: await resolvePoster(tmdb, item.mediaType, media.tmdbId),
      };
    }
  } catch (e) {
    logger.debug('Failed to enrich now download with media metadata', {
      label: 'API',
      externalId: item.externalId,
      errorMessage: e instanceof Error ? e.message : 'Unknown error',
    });
  }

  return base;
};

const enrichNowStream = async (
  tmdb: TheMovieDb,
  stream: NowStream
): Promise<NowStream> => {
  const ratingKeys = [stream.grandparentRatingKey, stream.ratingKey].filter(
    (key): key is string => Boolean(key)
  );

  if (ratingKeys.length === 0) {
    return stream;
  }

  try {
    const media = await getRepository(Media)
      .createQueryBuilder('media')
      .where('media.ratingKey IN (:...keys)', { keys: ratingKeys })
      .orWhere('media.ratingKey4k IN (:...keys)', { keys: ratingKeys })
      .getOne();

    if (media?.tmdbId) {
      return {
        ...stream,
        tmdbId: media.tmdbId,
        posterPath: await resolvePoster(tmdb, media.mediaType, media.tmdbId),
      };
    }
  } catch (e) {
    logger.debug('Failed to enrich now stream with media metadata', {
      label: 'API',
      ratingKeys,
      errorMessage: e instanceof Error ? e.message : 'Unknown error',
    });
  }

  return stream;
};

// GET /api/v1/stats/now - Live streams, active downloads, and just-finished downloads
statsRoutes.get<Record<string, never>, NowResponse | { error: string }>(
  '/now',
  isAuthenticated(),
  async (req, res, next) => {
    const settings = getSettings();
    const canViewDownloads = req.user?.hasPermission(
      Permission.MANAGE_REQUESTS
    );
    const cache = cacheManager.getCache('stats').data;
    const cacheKey = JSON.stringify({
      route: 'now',
      downloads: canViewDownloads,
    });
    const cachedResponse = cache.get<NowResponse>(cacheKey);

    if (cachedResponse) {
      return res.status(200).json(cachedResponse);
    }

    try {
      const tmdb = new TheMovieDb();

      const sessions =
        settings.tautulli.hostname && settings.tautulli.apiKey
          ? await new TautulliAPI(settings.tautulli)
              .getActivity()
              .catch(() => [] as TautulliActivitySession[])
          : [];

      const streams = await Promise.all(
        sessions
          .filter((session) =>
            ['movie', 'episode'].includes(session.media_type)
          )
          .map((session) => enrichNowStream(tmdb, mapActivitySession(session)))
      );

      let downloads: NowDownload[] = [];
      let recentlyFinished: NowRecentDownload[] = [];

      if (canViewDownloads) {
        const active = downloadTracker.getAllDownloads();
        const recent = await downloadTracker.getRecentDownloads();
        const now = new Date();

        downloads = await Promise.all(
          [...active.movies, ...active.tv].map((item) =>
            enrichNowDownload(tmdb, item)
          )
        );

        recentlyFinished = await Promise.all(
          recent
            .filter((item: RecentDownloadItem) => isRecentlyFinished(item, now))
            .map(async (item) => ({
              ...(await enrichNowDownload(tmdb, item)),
              completedAt: new Date(item.completedAt).toISOString(),
              outcome: item.outcome,
            }))
        );
      }

      const response: NowResponse = {
        streams,
        downloads,
        recentlyFinished,
        updatedAt: new Date().toISOString(),
      };

      cache.set(cacheKey, response, 20);

      return res.status(200).json(response);
    } catch (e) {
      logger.error('Failed to fetch now panel data', {
        label: 'API',
        errorMessage: e instanceof Error ? e.message : 'Unknown error',
      });
      return next({
        status: 500,
        message: 'Failed to fetch now panel data.',
      });
    }
  }
);

export default statsRoutes;
