import RadarrAPI from '@server/api/servarr/radarr';
import SonarrAPI from '@server/api/servarr/sonarr';
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import downloadTracker, {
  DownloadingItem,
  RecentDownloadItem,
} from '@server/lib/downloadtracker';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { Router } from 'express';

const downloadsRoutes = Router();

interface DownloadsResponse {
  movies: DownloadingItem[];
  tv: DownloadingItem[];
  recent: RecentDownloadItem[];
}

// GET /api/v1/downloads - Get all active downloads
downloadsRoutes.get<Record<string, never>, DownloadsResponse>(
  '/',
  isAuthenticated(Permission.MANAGE_REQUESTS),
  async (_req, res, next) => {
    try {
      const downloads = downloadTracker.getAllDownloads();

      return res.status(200).json({
        ...downloads,
        recent: await downloadTracker.getRecentDownloads(),
      });
    } catch (e) {
      logger.error('Failed to fetch downloads', {
        label: 'API',
        errorMessage: e instanceof Error ? e.message : 'Unknown error',
      });
      return next({
        status: 500,
        message: 'Failed to fetch downloads.',
      });
    }
  }
);

interface RetryRequestBody {
  mediaType: 'movie' | 'tv';
  tmdbId: number;
}

// POST /api/v1/downloads/retry - Trigger a Radarr/Sonarr search for known media
downloadsRoutes.post<
  Record<string, never>,
  { triggered: string[] } | { error: string },
  RetryRequestBody
>(
  '/retry',
  isAuthenticated(Permission.MANAGE_REQUESTS),
  async (req, res, next) => {
    const { mediaType, tmdbId } = req.body ?? {};

    if (
      (mediaType !== 'movie' && mediaType !== 'tv') ||
      !Number.isFinite(Number(tmdbId))
    ) {
      return next({
        status: 400,
        message: 'mediaType and tmdbId are required.',
      });
    }

    try {
      const media = await getRepository(Media).findOne({
        where: {
          tmdbId: Number(tmdbId),
          mediaType: mediaType === 'movie' ? MediaType.MOVIE : MediaType.TV,
        },
      });

      if (!media) {
        return next({
          status: 404,
          message: 'Media not found.',
        });
      }

      const settings = getSettings();
      const servers = mediaType === 'movie' ? settings.radarr : settings.sonarr;
      const triggered: string[] = [];

      for (const is4k of [false, true]) {
        const serviceId = is4k ? media.serviceId4k : media.serviceId;
        const externalId = is4k
          ? media.externalServiceId4k
          : media.externalServiceId;

        if (serviceId === null || serviceId === undefined) continue;
        if (externalId === null || externalId === undefined) continue;

        const server = servers.find((s) => s.id === serviceId);

        if (!server) continue;

        if (mediaType === 'movie') {
          const radarr = new RadarrAPI({
            apiKey: server.apiKey,
            url: RadarrAPI.buildUrl(server, '/api/v3'),
          });
          await radarr.searchMovie(externalId);
        } else {
          const sonarr = new SonarrAPI({
            apiKey: server.apiKey,
            url: SonarrAPI.buildUrl(server, '/api/v3'),
          });
          await sonarr.searchSeries(externalId);
        }

        triggered.push(server.name);
      }

      if (triggered.length === 0) {
        return next({
          status: 400,
          message:
            'This title has no Radarr/Sonarr mapping to search. Approve or re-request it first.',
        });
      }

      logger.info('Manual download search triggered', {
        label: 'API',
        mediaType,
        tmdbId,
        triggered,
        userId: req.user?.id,
      });

      return res.status(200).json({ triggered });
    } catch (e) {
      logger.error('Failed to trigger download search', {
        label: 'API',
        mediaType,
        tmdbId,
        errorMessage: e instanceof Error ? e.message : 'Unknown error',
      });
      return next({
        status: 500,
        message: 'Failed to trigger search.',
      });
    }
  }
);

export default downloadsRoutes;
