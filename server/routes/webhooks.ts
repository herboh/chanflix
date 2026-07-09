import downloadTracker from '@server/lib/downloadtracker';
import { plexRecentScanner } from '@server/lib/scanners/plex';
import {
  isValidWebhookSecret,
  parseServarrWebhook,
} from '@server/lib/servarrWebhook';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { Router } from 'express';

const webhookRoutes = Router();

const SCAN_DEBOUNCE_MS = 60 * 1000;
let lastScanTriggeredAt = 0;

// POST /api/v1/webhooks/servarr - Radarr/Sonarr "On Import Complete" hook.
// Authenticated by shared secret, not by session/API key: Radarr and Sonarr
// only need permission to nudge a queue refresh and a recently-added scan.
webhookRoutes.post('/servarr', (req, res) => {
  const settings = getSettings();
  const providedSecret = req.header('x-webhook-secret') ?? req.query.secret;

  if (!isValidWebhookSecret(providedSecret, settings.main.webhookSecret)) {
    logger.warn('Rejected servarr webhook with missing or invalid secret', {
      label: 'Webhook',
      ip: req.ip,
    });

    return res.status(401).json({ error: 'Invalid webhook secret' });
  }

  const event = parseServarrWebhook(req.body);

  if (event.isTestEvent) {
    logger.info('Received servarr webhook test event', {
      label: 'Webhook',
      service: event.service,
    });

    return res.status(202).json({ status: 'ok', test: true });
  }

  // Respond immediately; queue refresh and scan run async.
  res.status(202).json({ status: 'accepted' });

  if (!event.isDownloadEvent) {
    logger.debug('Ignoring non-download servarr webhook event', {
      label: 'Webhook',
      service: event.service,
      eventType: event.eventType,
    });

    return;
  }

  logger.info('Download-complete webhook received', {
    label: 'Webhook',
    service: event.service,
    eventType: event.eventType,
    title: event.title,
    tmdbId: event.tmdbId,
    tvdbId: event.tvdbId,
    episodeCount: event.episodeCount,
  });

  setImmediate(async () => {
    try {
      downloadTracker.updateDownloads();

      const now = Date.now();

      if (plexRecentScanner.status().running) {
        logger.debug(
          'Skipping webhook-triggered scan; recently-added scan already running',
          { label: 'Webhook' }
        );

        return;
      }

      if (now - lastScanTriggeredAt < SCAN_DEBOUNCE_MS) {
        logger.debug(
          'Skipping webhook-triggered scan; last scan ran less than 60s ago',
          { label: 'Webhook' }
        );

        return;
      }

      lastScanTriggeredAt = now;
      logger.info('Starting webhook-triggered Plex recently-added scan', {
        label: 'Webhook',
        title: event.title,
      });
      await plexRecentScanner.run();
    } catch (e) {
      logger.error('Webhook-triggered availability refresh failed', {
        label: 'Webhook',
        errorMessage: e instanceof Error ? e.message : 'Unknown error',
      });
    }
  });
});

export default webhookRoutes;
