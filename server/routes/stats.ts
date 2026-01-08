import TautulliAPI, {
  TautulliHistoryRecord,
  TautulliHomeStatItem,
} from '@server/api/tautulli';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { Router } from 'express';

const statsRoutes = Router();

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

export default statsRoutes;
