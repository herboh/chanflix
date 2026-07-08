import assert from 'assert';
import NodeCache from 'node-cache';
import type {} from '@server/types/express';
import type {} from '@server/types/express-session';
import ExternalAPI from '@server/api/externalapi';
import { MediaType } from '@server/constants/media';
import { MediaRequestStatus } from '@server/constants/media';
import { MediaRequest } from '@server/entity/MediaRequest';
import type { DownloadingItem } from '@server/lib/downloadtracker';
import { DownloadTracker } from '@server/lib/downloadtracker';
import cacheManager from '@server/lib/cache';
import { hasPermission, Permission } from '@server/lib/permissions';
import { buildPlexLaunchUrl } from '@server/lib/plexLaunch';
import {
  getTmdbMetadataCacheKey,
  isTmdbMetadataFresh,
  parseTmdbMetadataPayload,
} from '@server/lib/tmdbMetadataCache';
import { dedupeTmdbPrewarmCandidates } from '@server/lib/tmdbMetadataPrewarm';
import { buildPendingRequestSummary } from '@server/routes/stats';
import {
  getRequestUserTagLabel,
  isRequestUserTag,
} from '@server/lib/requestTags';
import type { User } from '@server/entity/User';

type TestCase = {
  name: string;
  run: () => void | Promise<void>;
};

class TestExternalAPI extends ExternalAPI {
  constructor(cache?: NodeCache, retries = 0) {
    super('https://example.test', {}, { nodeCache: cache, retries });
  }

  public fetch<T>(endpoint: string, ttl?: number): Promise<T> {
    return this.get<T>(endpoint, undefined, ttl);
  }

  public setAxiosGet(get: (endpoint: string) => Promise<{ data: unknown }>) {
    (this as unknown as { axios: { get: typeof get } }).axios = { get };
  }
}

const axiosError = (status: number): Error & {
  isAxiosError: boolean;
  response: { status: number; headers: Record<string, string> };
} => {
  return Object.assign(new Error(`HTTP ${status}`), {
    isAxiosError: true,
    response: {
      status,
      headers: {},
    },
  });
};

class TestDownloadTracker extends DownloadTracker {
  public record(
    previousItems: DownloadingItem[],
    nextItems: DownloadingItem[] = []
  ) {
    this.recordQueueTransitions(1, previousItems, nextItems);
  }
}

const download = (
  title: string,
  status: string,
  sizeLeft: number
): DownloadingItem => ({
  mediaType: MediaType.MOVIE,
  externalId: title.length,
  size: 100,
  sizeLeft,
  status,
  timeLeft: '',
  estimatedCompletionTime: new Date(),
  title,
});

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const user = (id: number, displayName: string): User =>
  ({
    id,
    displayName,
  } as User);

const tests: TestCase[] = [
  {
    name: 'request tags sanitize display names for Servarr labels',
    run: () => {
      assert.equal(
        getRequestUserTagLabel(user(4, 'Nick Hump 4')),
        'request-4-nick-hump-4'
      );
      assert.equal(
        getRequestUserTagLabel(user(7, 'A/B: C_D@example.com')),
        'request-7-a-b-c-d-example-com'
      );
      assert.equal(getRequestUserTagLabel(user(9, '***')), 'request-9');
    },
  },
  {
    name: 'request tag matching accepts new and legacy labels for same user',
    run: () => {
      const requestUser = user(4, 'Nick Hump 4');

      assert.equal(isRequestUserTag('request-4-nick-hump-4', requestUser), true);
      assert.equal(isRequestUserTag('request-4-old-name', requestUser), true);
      assert.equal(isRequestUserTag('4 - nickhump4', requestUser), true);
      assert.equal(isRequestUserTag('request-5-nick-hump-4', requestUser), false);
      assert.equal(isRequestUserTag('request-40-nick-hump-4', requestUser), false);
      assert.equal(isRequestUserTag('14 - nickhump4', requestUser), false);
    },
  },
  {
    name: 'stability cache buckets are registered',
    run: () => {
      const caches = cacheManager.getAllCaches();

      assert.ok(caches.tmdb);
      assert.ok(caches.radarr);
      assert.ok(caches.sonarr);
      assert.ok(caches.library);
      assert.ok(caches.stats);
    },
  },
  {
    name: 'TMDB metadata cache keys include media identity and language',
    run: () => {
      assert.equal(
        getTmdbMetadataCacheKey({
          mediaType: 'movie',
          tmdbId: 550,
          language: 'en',
          appendToResponse: 'credits',
        }),
        'movie:550:en:credits'
      );
      assert.notEqual(
        getTmdbMetadataCacheKey({
          mediaType: 'movie',
          tmdbId: 550,
          language: 'en',
          appendToResponse: 'credits',
        }),
        getTmdbMetadataCacheKey({
          mediaType: 'tv',
          tmdbId: 550,
          language: 'en',
          appendToResponse: 'credits',
        })
      );
    },
  },
  {
    name: 'TMDB metadata cache freshness and payload parsing are deterministic',
    run: () => {
      assert.equal(
        isTmdbMetadataFresh({
          expiresAt: new Date('2026-07-09T00:00:00.000Z'),
        }),
        true
      );
      assert.equal(
        isTmdbMetadataFresh(
          { expiresAt: new Date('2026-07-07T00:00:00.000Z') },
          new Date('2026-07-08T00:00:00.000Z')
        ),
        false
      );
      assert.deepEqual(
        parseTmdbMetadataPayload<{ title: string }>({
          payload: JSON.stringify({ title: 'Fight Club' }),
        }),
        { title: 'Fight Club' }
      );
    },
  },
  {
    name: 'TMDB metadata prewarm candidates dedupe by media type and TMDB id',
    run: () => {
      assert.deepEqual(
        dedupeTmdbPrewarmCandidates([
          { mediaType: MediaType.MOVIE, tmdbId: 550 },
          { mediaType: MediaType.MOVIE, tmdbId: 550 },
          { mediaType: MediaType.TV, tmdbId: 550 },
        ]),
        [
          { mediaType: MediaType.MOVIE, tmdbId: 550 },
          { mediaType: MediaType.TV, tmdbId: 550 },
        ]
      );
    },
  },
  {
    name: 'Plex launch URLs support server and direct media targets',
    run: () => {
      assert.equal(
        buildPlexLaunchUrl({
          plexToken: 'token with spaces',
          machineId: 'machine123',
        }),
        'https://app.plex.tv/desktop?X-Plex-Token=token%20with%20spaces#!/server/machine123'
      );
      assert.equal(
        buildPlexLaunchUrl({
          baseUrl: 'https://plex.example/web',
          plexToken: 'token',
          machineId: 'machine123',
          ratingKey: '456',
        }),
        'https://plex.example/web?X-Plex-Token=token#!/server/machine123/details?key=%2Flibrary%2Fmetadata%2F456'
      );
    },
  },
  {
    name: 'Operations permissions allow admins and request managers only',
    run: () => {
      assert.equal(hasPermission(Permission.MANAGE_REQUESTS, Permission.ADMIN), true);
      assert.equal(
        hasPermission(Permission.MANAGE_REQUESTS, Permission.MANAGE_REQUESTS),
        true
      );
      assert.equal(hasPermission(Permission.MANAGE_REQUESTS, Permission.REQUEST), false);
    },
  },
  {
    name: 'Operations pending request summaries include resolved request context',
    async run() {
      const request = {
        id: 42,
        createdAt: new Date('2026-07-08T01:02:03.000Z'),
        updatedAt: new Date('2026-07-08T02:03:04.000Z'),
        requestedBy: user(4, 'Nick Hump 4'),
        type: MediaType.MOVIE,
        media: { tmdbId: 550 },
        status: MediaRequestStatus.PENDING,
        is4k: false,
        serverId: undefined,
        profileId: undefined,
        rootFolder: undefined,
        tags: undefined,
      } as unknown as MediaRequest;
      const settings = {
        radarr: [
          {
            id: 1,
            name: 'Radarr HD',
            isDefault: true,
            is4k: false,
            activeProfileId: 6,
            activeProfileName: 'HD-1080p',
            activeDirectory: '/movies',
            tags: [12, 34],
          },
        ],
        sonarr: [],
      };
      const tmdb = {
        getMovie: async () => ({ title: 'Fight Club' }),
        getTvShow: async () => ({ name: 'Unused' }),
      };

      const summary = await buildPendingRequestSummary(
        tmdb,
        request,
        settings as unknown as ReturnType<
          typeof import('@server/lib/settings').getSettings
        >
      );

      assert.equal(summary.mediaTitle, 'Fight Club');
      assert.equal(summary.user, 'Nick Hump 4');
      assert.equal(summary.serverName, 'Radarr HD');
      assert.equal(summary.profileName, 'HD-1080p');
      assert.equal(summary.rootFolder, '/movies');
      assert.deepEqual(summary.tags, [12, 34]);
    },
  },
  {
    name: 'ExternalAPI honors per-request cache TTL',
    async run() {
      const cache = new NodeCache({ stdTTL: 300, checkperiod: 0 });
      const api = new TestExternalAPI(cache);

      api.setAxiosGet(async () => ({ data: { ok: true } }));

      await api.fetch('/ttl', 1);

      const ttl = cache.getTtl('https://example.test/ttl');
      assert.ok(ttl);
      assert.ok(ttl - Date.now() <= 1100);
    },
  },
  {
    name: 'ExternalAPI treats falsy cached values as cache hits',
    async run() {
      const cache = new NodeCache({ stdTTL: 300, checkperiod: 0 });
      const api = new TestExternalAPI(cache);
      let requests = 0;

      cache.set('https://example.test/falsy', false);
      api.setAxiosGet(async () => {
        requests += 1;
        return { data: true };
      });

      const response = await api.fetch<boolean>('/falsy');

      assert.equal(response, false);
      assert.equal(requests, 0);
    },
  },
  {
    name: 'ExternalAPI retries transient axios failures',
    async run() {
      const api = new TestExternalAPI(undefined, 1);
      let attempts = 0;

      api.setAxiosGet(async () => {
        attempts += 1;
        if (attempts === 1) {
          throw axiosError(500);
        }

        return { data: { attempts } };
      });

      const response = await api.fetch<{ attempts: number }>('/retry');

      assert.equal(response.attempts, 2);
      assert.equal(attempts, 2);
    },
  },
  {
    name: 'ExternalAPI serves last-known response after TTL expiry and failure',
    async run() {
      const stale = { ok: 'last-known' };
      const cache = new NodeCache({ checkperiod: 0 });
      const api = new TestExternalAPI(cache);
      let shouldFail = false;

      api.setAxiosGet(async () => {
        if (shouldFail) {
          throw axiosError(503);
        }

        return { data: stale };
      });

      await api.fetch<typeof stale>('/stale', 1);
      shouldFail = true;
      await sleep(1100);

      const response = await api.fetch<typeof stale>('/stale', 1);

      assert.deepEqual(response, stale);
    },
  },
  {
    name: 'ExternalAPI serves falsy last-known response after failure',
    async run() {
      const cache = new NodeCache({ checkperiod: 0 });
      const api = new TestExternalAPI(cache);
      let shouldFail = false;

      api.setAxiosGet(async () => {
        if (shouldFail) {
          throw axiosError(503);
        }

        return { data: null };
      });

      await api.fetch<null>('/null-stale', 1);
      shouldFail = true;
      await sleep(1100);

      const response = await api.fetch<null>('/null-stale', 1);

      assert.equal(response, null);
    },
  },
  {
    name: 'DownloadTracker records bounded queue transition history',
    async run() {
      const tracker = new TestDownloadTracker();

      tracker.record([
        download('Finished Movie', 'completed', 0),
        download('Missing Movie', 'downloading', 50),
      ]);

      const recent = await tracker.getRecentDownloads();

      assert.equal(recent.length, 2);
      assert.equal(recent[0].title, 'Missing Movie');
      assert.equal(recent[0].outcome, 'cleared');
      assert.equal(recent[1].title, 'Finished Movie');
      assert.equal(recent[1].outcome, 'completed');
    },
  },
];

let failed = 0;

const run = async () => {
  for (const test of tests) {
    try {
      await test.run();
      process.stdout.write(`PASS ${test.name}\n`);
    } catch (e) {
      failed += 1;
      process.stderr.write(`FAIL ${test.name}\n`);
      process.stderr.write(`${e instanceof Error ? e.stack : String(e)}\n`);
    }
  }

  if (failed > 0) {
    process.exit(1);
  }
};

run();
