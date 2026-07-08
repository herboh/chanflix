import PlexAPI from '@server/api/plexapi';
import TheMovieDb from '@server/api/themoviedb';
import { MediaStatus, MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { User } from '@server/entity/User';
import cacheManager from '@server/lib/cache';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { Router } from 'express';

const libraryRoutes = Router();

export interface LibraryItem {
  id?: number;
  tmdbId?: number;
  tvdbId?: number;
  ratingKey?: string;
  title: string;
  year?: number;
  mediaType: 'movie' | 'tv';
  status: 'available' | 'pending' | 'processing' | 'partial' | 'unknown';
  addedAt?: number;
  posterPath?: string;
}

interface LibraryResponse {
  pageInfo: {
    pages: number;
    pageSize: number;
    results: number;
    page: number;
  };
  results: LibraryItem[];
}

const getYearFromDate = (date?: string): number | undefined => {
  if (!date) {
    return undefined;
  }

  const year = Number(date.slice(0, 4));
  return Number.isFinite(year) ? year : undefined;
};

const isPlaceholderTitle = (title: string): boolean =>
  title.startsWith('Media #');

const getAdminPlexTokenOwner = async (): Promise<
  Pick<User, 'id' | 'plexToken'> | undefined
> => {
  const user = await getRepository(User)
    .createQueryBuilder('user')
    .addSelect('user.plexToken')
    .where('(user.permissions & :adminPermission) = :adminPermission', {
      adminPermission: Permission.ADMIN,
    })
    .andWhere("user.plexToken != ''")
    .orderBy('user.id', 'ASC')
    .getOne();

  return user && user.plexToken
    ? { id: user.id, plexToken: user.plexToken }
    : undefined;
};

const enrichLibraryItem = async (
  tmdbClient: TheMovieDb,
  item: LibraryItem
): Promise<LibraryItem> => {
  if (!item.tmdbId) {
    return item;
  }

  try {
    if (item.mediaType === 'movie') {
      const movie = await tmdbClient.getMovie({ movieId: item.tmdbId });

      return {
        ...item,
        title: isPlaceholderTitle(item.title)
          ? movie.title
          : item.title || movie.title,
        year: item.year ?? getYearFromDate(movie.release_date),
        posterPath: item.posterPath ?? movie.poster_path,
      };
    }

    const tvShow = await tmdbClient.getTvShow({ tvId: item.tmdbId });

    return {
      ...item,
      title: isPlaceholderTitle(item.title)
        ? tvShow.name
        : item.title || tvShow.name,
      year: item.year ?? getYearFromDate(tvShow.first_air_date),
      posterPath: item.posterPath ?? tvShow.poster_path,
    };
  } catch (e) {
    logger.debug('Failed to enrich library item with TMDB metadata', {
      label: 'Library API',
      tmdbId: item.tmdbId,
      mediaType: item.mediaType,
      errorMessage: e instanceof Error ? e.message : 'Unknown error',
    });

    return item;
  }
};

// GET /api/v1/library - Get library items
libraryRoutes.get<
  Record<string, never>,
  LibraryResponse,
  Record<string, never>,
  {
    type?: 'movie' | 'tv' | 'all';
    status?: 'available' | 'pending' | 'all';
    take?: string;
    skip?: string;
    sort?: 'title' | 'added' | 'year';
  }
>('/', isAuthenticated(), async (req, res, next) => {
  const settings = getSettings();
  const mediaRepository = getRepository(Media);
  const userRepository = getRepository(User);

  const type = req.query.type || 'all';
  const status = req.query.status || 'all';
  const take = Math.min(Number(req.query.take) || 50, 100);
  const skip = Number(req.query.skip) || 0;
  const sort = req.query.sort || 'added';
  const cache = cacheManager.getCache('library').data;

  try {
    const activeUser = req.user?.id
      ? await userRepository.findOne({
          select: { id: true, plexToken: true },
          where: { id: req.user.id },
        })
      : undefined;
    let plexToken = activeUser?.plexToken;
    let plexIdentity = plexToken ? `user:${activeUser?.id}` : 'none';

    if (!plexToken && req.user?.hasPermission(Permission.MANAGE_REQUESTS)) {
      const admin = await getAdminPlexTokenOwner();
      plexToken = admin?.plexToken;
      plexIdentity = plexToken ? `admin:${admin?.id}` : 'none';
    }

    const cacheKey = JSON.stringify({
      type,
      status,
      take,
      skip,
      sort,
      plexIdentity,
    });
    const cachedResponse = cache.get<LibraryResponse>(cacheKey);

    if (cachedResponse) {
      return res.status(200).json(cachedResponse);
    }

    const allItems: LibraryItem[] = [];

    // Get available items from Plex if status is 'all' or 'available'
    if (status === 'all' || status === 'available') {
      const plexSettings = settings.plex;

      if (plexSettings.ip && plexSettings.libraries.length > 0) {
        if (!plexToken) {
          logger.warn('No Plex token available for library fetch', {
            label: 'Library API',
            userId: req.user?.id,
          });
        } else {
          try {
            const plexClient = new PlexAPI({ plexToken });

            for (const library of plexSettings.libraries) {
              if (!library.enabled) continue;

              // Filter by type
              if (type !== 'all') {
                if (type === 'movie' && library.type !== 'movie') continue;
                if (type === 'tv' && library.type !== 'show') continue;
              }

              try {
                const { items } = await plexClient.getLibraryContents(
                  library.id,
                  {
                    offset: 0,
                    size: 500, // Get up to 500 items per library
                  }
                );

                for (const item of items) {
                  if (item.type === 'movie' || item.type === 'show') {
                    // Extract TMDB ID from GUIDs
                    let tmdbId: number | undefined;
                    if (item.Guid) {
                      const tmdbGuid = item.Guid.find((g) =>
                        g.id.startsWith('tmdb://')
                      );
                      if (tmdbGuid) {
                        tmdbId = parseInt(
                          tmdbGuid.id.replace('tmdb://', ''),
                          10
                        );
                      }
                    }

                    allItems.push({
                      ratingKey: item.ratingKey,
                      title: item.title,
                      mediaType: item.type === 'show' ? 'tv' : 'movie',
                      status: 'available',
                      addedAt: item.addedAt,
                      tmdbId,
                    });
                  }
                }
              } catch (libError) {
                logger.warn(`Failed to fetch library ${library.name}`, {
                  label: 'Library API',
                  errorMessage:
                    libError instanceof Error
                      ? libError.message
                      : 'Unknown error',
                });
              }
            }
          } catch (plexError) {
            logger.warn('Failed to connect to Plex', {
              label: 'Library API',
              errorMessage:
                plexError instanceof Error
                  ? plexError.message
                  : 'Unknown error',
            });
          }
        }
      }
    }

    // Get pending/processing items from database if status is 'all' or 'pending'
    if (status === 'all' || status === 'pending') {
      const localStatuses = [
        MediaStatus.PENDING,
        MediaStatus.PROCESSING,
        MediaStatus.PARTIALLY_AVAILABLE,
      ];

      const pendingMedia = await mediaRepository
        .createQueryBuilder('media')
        .where('media.status IN (:...statuses)', {
          statuses: localStatuses,
        })
        .andWhere(type !== 'all' ? 'media.mediaType = :mediaType' : '1=1', {
          mediaType: type === 'movie' ? MediaType.MOVIE : MediaType.TV,
        })
        .getMany();

      for (const media of pendingMedia) {
        // Check if we already have this item from Plex
        const existsInPlex = allItems.some(
          (item) =>
            item.tmdbId === media.tmdbId && item.mediaType === media.mediaType
        );

        if (!existsInPlex) {
          let statusString: LibraryItem['status'] = 'unknown';
          switch (media.status) {
            case MediaStatus.PENDING:
              statusString = 'pending';
              break;
            case MediaStatus.PROCESSING:
              statusString = 'processing';
              break;
            case MediaStatus.PARTIALLY_AVAILABLE:
              statusString = 'partial';
              break;
          }

          allItems.push({
            id: media.id,
            tmdbId: media.tmdbId,
            tvdbId: media.tvdbId,
            ratingKey: media.ratingKey ?? undefined,
            title: `Media #${media.tmdbId}`, // Will be enriched by frontend with TMDB data
            mediaType: media.mediaType,
            status: statusString,
            addedAt: media.createdAt?.getTime(),
          });
        }
      }
    }

    // Sort items
    switch (sort) {
      case 'title':
        allItems.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case 'year':
        allItems.sort((a, b) => (b.year || 0) - (a.year || 0));
        break;
      case 'added':
      default:
        allItems.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
        break;
    }

    // Paginate
    const total = allItems.length;
    const tmdbClient = new TheMovieDb();
    const paginatedItems = await Promise.all(
      allItems
        .slice(skip, skip + take)
        .map((item) => enrichLibraryItem(tmdbClient, item))
    );

    const response = {
      pageInfo: {
        pages: Math.ceil(total / take),
        pageSize: take,
        results: total,
        page: Math.floor(skip / take) + 1,
      },
      results: paginatedItems,
    };

    cache.set(cacheKey, response);

    return res.status(200).json(response);
  } catch (e) {
    logger.error('Failed to fetch library', {
      label: 'API',
      errorMessage: e instanceof Error ? e.message : 'Unknown error',
    });
    return next({
      status: 500,
      message: 'Failed to fetch library.',
    });
  }
});

export default libraryRoutes;
