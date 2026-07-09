import { timingSafeEqual } from 'crypto';

export interface ServarrWebhookEvent {
  service: 'radarr' | 'sonarr' | 'unknown';
  eventType: string;
  isTestEvent: boolean;
  isDownloadEvent: boolean;
  title?: string;
  tmdbId?: number;
  tvdbId?: number;
  episodeCount?: number;
}

// Radarr fires "Download" when a movie file is imported (also on upgrades);
// Sonarr fires "Download" per imported episode file. Older/other event names
// are accepted defensively.
const DOWNLOAD_EVENT_TYPES = [
  'download',
  'moviefileimported',
  'episodefileimported',
];

export const isServarrDownloadEventType = (eventType: string): boolean =>
  DOWNLOAD_EVENT_TYPES.includes(eventType.toLowerCase());

export const parseServarrWebhook = (body: unknown): ServarrWebhookEvent => {
  const payload = (body ?? {}) as Record<string, unknown>;
  const eventType =
    typeof payload.eventType === 'string' ? payload.eventType : '';

  const movie = payload.movie as Record<string, unknown> | undefined;
  const series = payload.series as Record<string, unknown> | undefined;
  const episodes = Array.isArray(payload.episodes)
    ? payload.episodes
    : undefined;

  const service: ServarrWebhookEvent['service'] = movie
    ? 'radarr'
    : series
    ? 'sonarr'
    : 'unknown';

  const tmdbId =
    movie && typeof movie.tmdbId === 'number' ? movie.tmdbId : undefined;
  const tvdbId =
    series && typeof series.tvdbId === 'number' ? series.tvdbId : undefined;

  const title =
    movie && typeof movie.title === 'string'
      ? movie.title
      : series && typeof series.title === 'string'
      ? series.title
      : undefined;

  return {
    service,
    eventType,
    isTestEvent: eventType.toLowerCase() === 'test',
    isDownloadEvent: isServarrDownloadEventType(eventType),
    title,
    tmdbId,
    tvdbId,
    episodeCount: episodes?.length,
  };
};

// Constant-time comparison; an unset configured secret rejects everything so
// the endpoint is closed until a secret exists.
export const isValidWebhookSecret = (
  provided: unknown,
  configured: string | undefined
): boolean => {
  if (!configured || typeof provided !== 'string' || provided.length === 0) {
    return false;
  }

  const providedBuffer = Buffer.from(provided);
  const configuredBuffer = Buffer.from(configured);

  if (providedBuffer.length !== configuredBuffer.length) {
    return false;
  }

  return timingSafeEqual(providedBuffer, configuredBuffer);
};
