import downloadTracker, { DownloadingItem } from '@server/lib/downloadtracker';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { Router } from 'express';

const downloadsRoutes = Router();

interface DownloadsResponse {
  movies: DownloadingItem[];
  tv: DownloadingItem[];
}

// GET /api/v1/downloads - Get all active downloads
downloadsRoutes.get<Record<string, never>, DownloadsResponse>(
  '/',
  isAuthenticated(),
  async (_req, res, next) => {
    try {
      const downloads = downloadTracker.getAllDownloads();

      return res.status(200).json(downloads);
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

export default downloadsRoutes;
