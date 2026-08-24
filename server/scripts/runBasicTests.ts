import assert from 'assert';
import NodeCache from 'node-cache';
import type {} from '@server/types/express';
import type {} from '@server/types/express-session';
import ExternalAPI from '@server/api/externalapi';
import { MediaStatus, MediaType } from '@server/constants/media';
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
import { groupDownloadsBySeason } from '@server/lib/downloadEnrichment';
import { classifyLocalMediaStatus } from '@server/lib/libraryStatus';
import {
  getImageExtension,
  isValidImageBuffer,
  parseCachedImageFilename,
} from '@server/lib/imageproxy';
import {
  buildPendingRequestSummary,
  isRecentlyFinished,
  mapActivitySession,
} from '@server/routes/stats';
import {
  AiChatConcurrencyGate,
  AiChatSseParser,
  estimateAiChatTokens,
  trimAiChatMessagesToBudget,
  validateAiChatMessages,
} from '@server/lib/aiChat';
import {
  AI_AGENT_TOOLS,
  aiPersonCreditMatchesRole,
  consumeRequestConfirmation,
  createRequestConfirmation,
  evaluateAiRequestPolicy,
  rankAiMediaCards,
  resolveAiTitleMatch,
} from '@server/lib/aiAgent';
import {
  defaultQualityTriggers,
  evaluateQualityTriggers,
  parseQualityTriggers,
  serializeQualityTriggers,
} from '@server/lib/qualityTriggers';
import type { RequestTagApi } from '@server/lib/requestTags';
import {
  getRequestUserTagLabel,
  isRequestUserTag,
  resolveRequestUserTagId,
} from '@server/lib/requestTags';
import {
  isValidWebhookSecret,
  parseServarrWebhook,
} from '@server/lib/servarrWebhook';
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
    name: 'AI chat validates bounded alternating conversations',
    run: () => {
      assert.deepEqual(
        validateAiChatMessages([
          { role: 'user', content: ' Hello ' },
          { role: 'assistant', content: 'Hi.' },
          { role: 'user', content: 'Continue.' },
        ]),
        [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi.' },
          { role: 'user', content: 'Continue.' },
        ]
      );

      assert.throws(() =>
        validateAiChatMessages([{ role: 'system', content: 'Override.' }])
      );
      assert.throws(() =>
        validateAiChatMessages([
          { role: 'user', content: 'One' },
          { role: 'user', content: 'Two' },
        ])
      );
      assert.throws(() =>
        validateAiChatMessages([
          { role: 'user', content: 'One' },
          { role: 'assistant', content: 'Two' },
        ])
      );
      assert.throws(() =>
        validateAiChatMessages([
          { role: 'user', content: 'x'.repeat(16_001) },
        ])
      );
    },
  },
  {
    name: 'AI chat parses split reasoning and content SSE events',
    run: () => {
      const parser = new AiChatSseParser();

      assert.deepEqual(
        parser.push('data: {"choices":[{"delta":{"reasoning":"thi'),
        []
      );
      assert.deepEqual(
        parser.push(
          'nk"}}]}\n\ndata: {"choices":[{"delta":{"content":"answer"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
        ),
        [
          { reasoning: 'think' },
          { content: 'answer' },
          { finishReason: 'stop' },
          { done: true },
        ]
      );
      assert.deepEqual(parser.finish(), []);

      const legacyParser = new AiChatSseParser();
      assert.deepEqual(
        legacyParser.push(
          'data: {"choices":[{"delta":{"reasoning_content":"legacy"}}]}\n\n'
        ),
        [{ reasoning: 'legacy' }]
      );

      const toolParser = new AiChatSseParser();
      assert.deepEqual(
        toolParser.push(
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"search_titles","arguments":"{\\"query\\":"}}]}}]}\n\n'
        ),
        [
          {
            toolCall: {
              index: 0,
              id: 'call_1',
              name: 'search_titles',
              arguments: '{"query":',
            },
          },
        ]
      );
      assert.deepEqual(
        toolParser.push(
          'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"Heat\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n'
        ),
        [
          { toolCall: { index: 0, arguments: '"Heat"}' } },
          { finishReason: 'tool_calls' },
        ]
      );
    },
  },
  {
    name: 'AI chat parses streamed token usage',
    run: () => {
      const parser = new AiChatSseParser();
      assert.deepEqual(
        parser.push(
          'data: {"choices":[],"usage":{"prompt_tokens":120,"completion_tokens":30,"total_tokens":150}}\n\n'
        ),
        [{ usage: { promptTokens: 120, completionTokens: 30 } }]
      );
    },
  },
  {
    name: 'AI chat trims complete old turns to a conservative token budget',
    run: () => {
      assert.equal(estimateAiChatTokens('123456'), 2);
      const messages = [
        { role: 'user' as const, content: 'a'.repeat(120) },
        { role: 'assistant' as const, content: 'b'.repeat(120) },
        { role: 'user' as const, content: 'latest' },
      ];
      const fitted = trimAiChatMessagesToBudget(
        messages,
        { system: 'short' },
        30
      );
      assert.deepEqual(fitted.messages, [messages[2]]);
      assert.equal(fitted.droppedMessages, 2);
      assert.ok(fitted.estimatedTokens <= 30);
    },
  },
  {
    name: 'AI media ranking prefers exact titles then popular results',
    run: () => {
      const card = (title: string, voteCount: number) => ({
        kind: 'media' as const,
        mediaType: 'movie' as const,
        tmdbId: voteCount,
        title,
        voteCount,
        status: 'unknown' as const,
        href: `/movie/${voteCount}`,
      });
      const ranked = rankAiMediaCards(
        [card('Heatwave', 20_000), card('Heat', 1_000), card('Other', 5_000)],
        'heat'
      );
      assert.deepEqual(
        ranked.map((item) => item.title),
        ['Heat', 'Heatwave', 'Other']
      );
    },
  },
  {
    name: 'AI agent exposes bounded person, Plex, and request tools',
    run: () => {
      const toolNames = AI_AGENT_TOOLS.map((tool) => tool.function.name);
      assert.ok(toolNames.includes('lookup_person'));
      assert.ok(toolNames.includes('search_people'));
      assert.ok(toolNames.includes('get_person_filmography'));
      assert.ok(toolNames.includes('get_plex_library_summary'));
      assert.ok(toolNames.includes('display_titles'));
      assert.ok(toolNames.includes('prepare_title_request'));

      const director = {
        job: 'Director',
        department: 'Directing',
      } as unknown as Parameters<typeof aiPersonCreditMatchesRole>[0];
      const writer = {
        job: 'Screenplay',
        department: 'Writing',
      } as unknown as Parameters<typeof aiPersonCreditMatchesRole>[0];
      const actor = {
        character: 'Lead',
      } as unknown as Parameters<typeof aiPersonCreditMatchesRole>[0];
      assert.equal(aiPersonCreditMatchesRole(director, 'directing'), true);
      assert.equal(aiPersonCreditMatchesRole(director, 'writing'), false);
      assert.equal(aiPersonCreditMatchesRole(writer, 'writing'), true);
      assert.equal(aiPersonCreditMatchesRole(actor, 'acting'), true);
      assert.equal(aiPersonCreditMatchesRole(actor, 'crew'), false);
    },
  },
  {
    name: 'AI title requests resolve only one exact title',
    run: () => {
      const card = (title: string, year: string, tmdbId: number) => ({
        kind: 'media' as const,
        mediaType: 'movie' as const,
        tmdbId,
        title,
        year,
        status: 'unknown' as const,
        href: `/movie/${tmdbId}`,
      });
      const cards = [
        card('Heat', '1995', 949),
        card('Heat', '1986', 42089),
        card('Heatwave', '2022', 960258),
      ];

      const ambiguous = resolveAiTitleMatch(cards, 'Heat');
      assert.equal(ambiguous.match, undefined);
      assert.equal(ambiguous.ambiguous, true);
      assert.equal(ambiguous.candidates.length, 2);

      const exact = resolveAiTitleMatch(cards, 'Heat', { year: 1995 });
      assert.equal(exact.match?.tmdbId, 949);
      assert.equal(exact.ambiguous, false);

      const fuzzy = resolveAiTitleMatch(cards, 'Heatt');
      assert.equal(fuzzy.match, undefined);
      assert.equal(fuzzy.ambiguous, false);
      assert.equal(fuzzy.candidates[0].title, 'Heat');
    },
  },
  {
    name: 'AI chat concurrency releases users and global slots once',
    run: () => {
      const gate = new AiChatConcurrencyGate(2);
      const releaseOne = gate.acquire(1);
      const releaseTwo = gate.acquire(2);

      assert.ok(releaseOne);
      assert.ok(releaseTwo);
      assert.equal(gate.activeCount, 2);
      assert.equal(gate.acquire(1), undefined);
      assert.equal(gate.acquire(3), undefined);

      releaseOne?.();
      releaseOne?.();
      assert.equal(gate.activeCount, 1);

      const releaseThree = gate.acquire(3);
      assert.ok(releaseThree);
      releaseTwo?.();
      releaseThree?.();
      assert.equal(gate.activeCount, 0);
    },
  },
  {
    name: 'AI request confirmations are user-bound and single-use',
    run: () => {
      const now = 1_000;
      const confirmation = createRequestConfirmation(
        {
          userId: 7,
          mediaType: 'movie',
          tmdbId: 949,
          forcePending: false,
        },
        now
      );

      assert.match(confirmation.token, /^[A-Za-z0-9_-]{32}$/);
      assert.equal(
        consumeRequestConfirmation(confirmation.token, 8, now),
        undefined
      );
      assert.deepEqual(consumeRequestConfirmation(confirmation.token, 7, now), {
        userId: 7,
        mediaType: 'movie',
        tmdbId: 949,
        forcePending: false,
        expiresAt: confirmation.expiresAt,
      });
      assert.equal(
        consumeRequestConfirmation(confirmation.token, 7, now),
        undefined
      );

      const expired = createRequestConfirmation(
        {
          userId: 7,
          mediaType: 'tv',
          tmdbId: 1399,
          seasons: [1],
          forcePending: true,
        },
        now
      );
      assert.equal(
        consumeRequestConfirmation(expired.token, 7, expired.expiresAt + 1),
        undefined
      );
    },
  },
  {
    name: 'AI request policy is deterministic and conservative for series',
    run: () => {
      const config = {
        minRating: 6.5,
        minVotes: 250,
        maxAutoApprovedTvSeasons: 1,
        maxAutoApprovedTvEpisodes: 16,
      };
      assert.deepEqual(
        evaluateAiRequestPolicy(
          { mediaType: 'movie', voteAverage: 7.4, voteCount: 500 },
          config
        ),
        { autoApprovalEligible: true, reasons: [] }
      );
      assert.equal(
        evaluateAiRequestPolicy(
          { mediaType: 'movie', voteAverage: 5.9, voteCount: 4_000 },
          config
        ).autoApprovalEligible,
        false
      );
      const oversized = evaluateAiRequestPolicy(
        {
          mediaType: 'tv',
          voteAverage: 8.2,
          voteCount: 4_000,
          seasons: [1, 2],
          selectedEpisodeCount: 24,
        },
        config
      );
      assert.equal(oversized.autoApprovalEligible, false);
      assert.deepEqual(oversized.reasons, [
        'more than 1 season',
        'more than 16 episodes',
      ]);
    },
  },
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
    name: 'user tag resolution reuses existing new-style and legacy tags',
    run: async () => {
      const requestUser = user(4, 'Nick Hump 4');
      let createCalls = 0;
      const api: RequestTagApi = {
        getTags: async () => [
          { id: 11, label: 'unrelated' },
          { id: 12, label: '4 - nickhump4' },
        ],
        createTag: async () => {
          createCalls += 1;
          return { id: 99 };
        },
      };

      assert.equal(await resolveRequestUserTagId(api, requestUser), 12);
      assert.equal(createCalls, 0);
    },
  },
  {
    name: 'user tag resolution creates sanitized label when missing',
    run: async () => {
      const requestUser = user(4, 'Nick Hump 4');
      let createdLabel: string | undefined;
      const api: RequestTagApi = {
        getTags: async () => [{ id: 11, label: 'unrelated' }],
        createTag: async ({ label }) => {
          createdLabel = label;
          return { id: 42 };
        },
      };

      assert.equal(await resolveRequestUserTagId(api, requestUser), 42);
      assert.equal(createdLabel, 'request-4-nick-hump-4');
    },
  },
  {
    name: 'user tag resolution is fail-soft when tag reads fail',
    run: async () => {
      const requestUser = user(4, 'Nick Hump 4');
      const api: RequestTagApi = {
        getTags: async () => {
          throw new Error('[Radarr] Failed to retrieve tags: HTTP 401');
        },
        createTag: async () => {
          throw new Error('should not be called');
        },
      };

      assert.equal(await resolveRequestUserTagId(api, requestUser), undefined);
    },
  },
  {
    name: 'user tag resolution retries a read after create fails, then gives up softly',
    run: async () => {
      const requestUser = user(4, 'Nick Hump 4');
      let getCalls = 0;
      const racedApi: RequestTagApi = {
        getTags: async () => {
          getCalls += 1;
          // Second read simulates another request having created the tag
          // between our first read and the failed create (or a read-only key).
          return getCalls > 1 ? [{ id: 77, label: 'request-4-nick-hump-4' }] : [];
        },
        createTag: async () => {
          throw new Error('[Radarr] Failed to create tag: HTTP 400');
        },
      };

      assert.equal(await resolveRequestUserTagId(racedApi, requestUser), 77);
      assert.equal(getCalls, 2);

      const brokenApi: RequestTagApi = {
        getTags: async () => [],
        createTag: async () => {
          throw new Error('[Radarr] Failed to create tag: HTTP 400');
        },
      };

      assert.equal(
        await resolveRequestUserTagId(brokenApi, requestUser),
        undefined
      );
    },
  },
  {
    name: 'quality trigger settings parse defensively and round-trip',
    run: () => {
      assert.deepEqual(parseQualityTriggers(null), defaultQualityTriggers());
      assert.deepEqual(parseQualityTriggers('not json'), defaultQualityTriggers());
      assert.deepEqual(parseQualityTriggers('"2"'), defaultQualityTriggers());
      assert.deepEqual(
        parseQualityTriggers('{"enabled":true,"maxProfileId":7,"junk":1}'),
        { enabled: true, maxProfileId: 7, rules: undefined }
      );
      assert.deepEqual(
        parseQualityTriggers('{"enabled":"yes","maxProfileId":-2}'),
        { enabled: false, maxProfileId: undefined, rules: undefined }
      );

      const serialized = serializeQualityTriggers({
        enabled: true,
        maxProfileId: 3,
        rules: [{ note: 'later' }],
      });
      assert.ok(serialized);
      assert.deepEqual(parseQualityTriggers(serialized), {
        enabled: true,
        maxProfileId: 3,
        rules: [{ note: 'later' }],
      });
      assert.equal(serializeQualityTriggers(null), null);
    },
  },
  {
    name: 'quality trigger evaluation is a strict no-op stub',
    run: () => {
      const context = { mediaType: 'movie' as const, is4k: false };

      // No user / no settings / disabled triggers: profile passes through.
      assert.equal(evaluateQualityTriggers(undefined, 5, context), 5);
      assert.equal(
        evaluateQualityTriggers(user(4, 'Nick Hump 4'), 5, context),
        5
      );

      // Enabled triggers must still return the profile unchanged until
      // rules are implemented.
      const triggerUser = user(4, 'Nick Hump 4');
      triggerUser.settings = {
        qualityTriggers: { enabled: true, maxProfileId: 2 },
      } as never;
      assert.equal(evaluateQualityTriggers(triggerUser, 5, context), 5);
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
    name: 'image cache validates cached image filenames and extensions',
    run: () => {
      assert.deepEqual(parseCachedImageFilename('3600.999999999999.etag.jpg'), {
        maxAge: 3600,
        expireAt: 999999999999,
        etag: 'etag',
        extension: 'jpg',
      });
      assert.deepEqual(
        parseCachedImageFilename('3600.999999999999.etag.with.dots.webp'),
        {
          maxAge: 3600,
          expireAt: 999999999999,
          etag: 'etag.with.dots',
          extension: 'webp',
        }
      );
      assert.equal(parseCachedImageFilename('bad-cache-file'), null);
      assert.equal(parseCachedImageFilename('0.999999999999.etag.jpg'), null);
      assert.equal(getImageExtension('/t/p/w300/poster.jpeg?token=1'), 'jpg');
    },
  },
  {
    name: 'image cache rejects empty and non-image cached bodies',
    run: () => {
      const jpeg = Buffer.alloc(64);
      jpeg[0] = 0xff;
      jpeg[1] = 0xd8;
      jpeg[2] = 0xff;

      const png = Buffer.alloc(64);
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);

      const webp = Buffer.alloc(64);
      webp.write('RIFF', 0, 'ascii');
      webp.write('WEBP', 8, 'ascii');

      assert.equal(isValidImageBuffer(Buffer.alloc(0), 'jpg'), false);
      assert.equal(isValidImageBuffer(Buffer.from('<html>nope</html>'), 'jpg'), false);
      assert.equal(isValidImageBuffer(jpeg, 'jpg', 'image/jpeg'), true);
      assert.equal(isValidImageBuffer(jpeg, 'png', 'image/jpeg'), false);
      assert.equal(isValidImageBuffer(jpeg, 'jpg', 'text/html'), false);
      assert.equal(isValidImageBuffer(png, 'png', 'image/png'), true);
      assert.equal(isValidImageBuffer(webp, 'webp', 'image/webp'), true);
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
        isTmdbMetadataFresh(
          { expiresAt: new Date('2026-07-09T00:00:00.000Z') },
          new Date('2026-07-08T00:00:00.000Z')
        ),
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
  {
    name: 'servarr webhook parses Radarr download payloads',
    run: () => {
      const event = parseServarrWebhook({
        eventType: 'Download',
        movie: { tmdbId: 603, title: 'The Matrix' },
        isUpgrade: false,
      });

      assert.equal(event.service, 'radarr');
      assert.equal(event.isDownloadEvent, true);
      assert.equal(event.isTestEvent, false);
      assert.equal(event.tmdbId, 603);
      assert.equal(event.title, 'The Matrix');
    },
  },
  {
    name: 'servarr webhook parses Sonarr download and test payloads',
    run: () => {
      const download = parseServarrWebhook({
        eventType: 'Download',
        series: { tvdbId: 121361, title: 'Game of Thrones' },
        episodes: [{ episodeNumber: 1 }, { episodeNumber: 2 }],
      });

      assert.equal(download.service, 'sonarr');
      assert.equal(download.isDownloadEvent, true);
      assert.equal(download.tvdbId, 121361);
      assert.equal(download.episodeCount, 2);

      const test = parseServarrWebhook({
        eventType: 'Test',
        series: { tvdbId: 1, title: 'Test Title' },
      });

      assert.equal(test.isTestEvent, true);
      assert.equal(test.isDownloadEvent, false);

      const junk = parseServarrWebhook(null);

      assert.equal(junk.service, 'unknown');
      assert.equal(junk.isDownloadEvent, false);
      assert.equal(junk.eventType, '');
    },
  },
  {
    name: 'servarr webhook ignores non-download events',
    run: () => {
      const grab = parseServarrWebhook({
        eventType: 'Grab',
        movie: { tmdbId: 603, title: 'The Matrix' },
      });

      assert.equal(grab.isDownloadEvent, false);

      const health = parseServarrWebhook({ eventType: 'Health' });

      assert.equal(health.isDownloadEvent, false);
    },
  },
  {
    name: 'webhook secret validation is strict and fail-closed',
    run: () => {
      assert.equal(isValidWebhookSecret('sekrit', 'sekrit'), true);
      assert.equal(isValidWebhookSecret('wrong', 'sekrit'), false);
      assert.equal(isValidWebhookSecret('sekrit-longer', 'sekrit'), false);
      assert.equal(isValidWebhookSecret('', 'sekrit'), false);
      assert.equal(isValidWebhookSecret(undefined, 'sekrit'), false);
      assert.equal(isValidWebhookSecret({ evil: true }, 'sekrit'), false);
      // Unset configured secret rejects everything.
      assert.equal(isValidWebhookSecret('anything', ''), false);
      assert.equal(isValidWebhookSecret('anything', undefined), false);
      assert.equal(isValidWebhookSecret('', ''), false);
    },
  },
  {
    name: 'Now panel maps Tautulli sessions and clamps progress',
    run() {
      const episode = mapActivitySession({
        session_key: '7',
        user: 'nick',
        friendly_name: 'Nick',
        state: 'playing',
        media_type: 'episode',
        title: 'The Inner Light',
        parent_title: 'Season 5',
        grandparent_title: 'Star Trek: The Next Generation',
        full_title: 'Star Trek: TNG - The Inner Light',
        media_index: '25',
        parent_media_index: '5',
        progress_percent: '250',
        view_offset: '0',
        duration: '0',
        player: 'Living Room TV',
        product: 'Plex for Roku',
        platform: 'Roku',
        quality_profile: 'Original',
        transcode_decision: 'direct play',
        rating_key: '999',
        parent_rating_key: '998',
        grandparent_rating_key: '900',
        thumb: '',
        grandparent_thumb: '',
        year: '1992',
      });

      assert.equal(episode.mediaType, 'episode');
      assert.equal(episode.title, 'Star Trek: The Next Generation');
      assert.equal(episode.user, 'Nick');
      assert.equal(episode.progressPercent, 100);
      assert.equal(episode.grandparentRatingKey, '900');
      assert.ok(episode.episodeTitle?.includes('The Inner Light'));

      const movie = mapActivitySession({
        session_key: '8',
        user: 'herbie',
        friendly_name: '',
        state: 'paused',
        media_type: 'movie',
        title: 'Heat',
        parent_title: '',
        grandparent_title: '',
        full_title: 'Heat',
        media_index: '',
        parent_media_index: '',
        progress_percent: 'not-a-number',
        view_offset: '0',
        duration: '0',
        player: '',
        product: 'Plex Web',
        platform: 'Chrome',
        quality_profile: 'Original',
        transcode_decision: 'transcode',
        rating_key: '123',
        parent_rating_key: '',
        grandparent_rating_key: '',
        thumb: '',
        grandparent_thumb: '',
        year: '1995',
      });

      assert.equal(movie.mediaType, 'movie');
      assert.equal(movie.user, 'herbie');
      assert.equal(movie.progressPercent, 0);
      assert.equal(movie.player, 'Plex Web');
      assert.equal(movie.episodeTitle, undefined);
    },
  },
  {
    name: 'Now panel recently-finished window only keeps fresh completions',
    run() {
      const now = new Date('2026-07-08T12:00:00Z');

      assert.equal(
        isRecentlyFinished(
          { completedAt: new Date('2026-07-08T11:56:30Z') },
          now
        ),
        true
      );
      assert.equal(
        isRecentlyFinished(
          { completedAt: new Date('2026-07-08T11:54:00Z') },
          now
        ),
        false
      );
      assert.equal(
        isRecentlyFinished(
          { completedAt: new Date('2026-07-08T12:01:00Z') },
          now
        ),
        false
      );
      assert.equal(
        isRecentlyFinished({ completedAt: 'not a date' }, now),
        false
      );
    },
  },
  {
    name: 'Library classification separates downloading from stalled media',
    run() {
      const activeIds = new Set([42]);

      assert.equal(
        classifyLocalMediaStatus(
          {
            status: MediaStatus.PROCESSING,
            externalServiceId: 42,
            externalServiceId4k: null,
          },
          activeIds
        ),
        'processing'
      );
      assert.equal(
        classifyLocalMediaStatus(
          {
            status: MediaStatus.PROCESSING,
            externalServiceId: 43,
            externalServiceId4k: null,
          },
          activeIds
        ),
        'stalled'
      );
      assert.equal(
        classifyLocalMediaStatus(
          {
            status: MediaStatus.PROCESSING,
            externalServiceId: null,
            externalServiceId4k: null,
          },
          activeIds
        ),
        'stalled'
      );
      assert.equal(
        classifyLocalMediaStatus(
          {
            status: MediaStatus.PENDING,
            externalServiceId: null,
            externalServiceId4k: null,
          },
          activeIds
        ),
        'pending'
      );
      assert.equal(
        classifyLocalMediaStatus(
          {
            status: MediaStatus.PARTIALLY_AVAILABLE,
            externalServiceId: null,
            externalServiceId4k: null,
          },
          activeIds
        ),
        'partial'
      );
    },
  },
  {
    name: 'groupDownloadsBySeason collapses episodes by series and season',
    run: () => {
      type Row = {
        mediaType: 'movie' | 'tv';
        externalId: number;
        size: number;
        sizeLeft: number;
        title: string;
        episode?: { seasonNumber: number; episodeNumber: number; id: number };
      };

      const rows: Row[] = [
        { mediaType: 'movie', externalId: 1, size: 100, sizeLeft: 0, title: 'A' },
        {
          mediaType: 'tv',
          externalId: 5,
          size: 10,
          sizeLeft: 2,
          title: 'Raw.S01E03',
          episode: { seasonNumber: 1, episodeNumber: 3, id: 903 },
        },
        {
          mediaType: 'tv',
          externalId: 5,
          size: 20,
          sizeLeft: 4,
          title: 'Raw.S01E01',
          episode: { seasonNumber: 1, episodeNumber: 1, id: 901 },
        },
        {
          mediaType: 'tv',
          externalId: 5,
          size: 30,
          sizeLeft: 6,
          title: 'Raw.S01E02',
          episode: { seasonNumber: 1, episodeNumber: 2, id: 902 },
        },
        {
          mediaType: 'tv',
          externalId: 5,
          size: 40,
          sizeLeft: 8,
          title: 'Raw.S02E01',
          episode: { seasonNumber: 2, episodeNumber: 1, id: 921 },
        },
      ];

      const grouped = groupDownloadsBySeason(rows);

      // movie + season 1 (collapsed) + season 2 = 3 rows
      assert.equal(grouped.length, 3);

      const s1 = grouped.find(
        (r) => r.externalId === 5 && r.seasonNumber === 1
      );
      assert.ok(s1);
      assert.equal(s1?.episodeCount, 3);
      assert.deepEqual(s1?.episodeNumbers, [1, 2, 3]);
      assert.equal(s1?.size, 60);
      assert.equal(s1?.sizeLeft, 12);
      assert.equal(s1?.episode, undefined);

      const movie = grouped.find((r) => r.mediaType === 'movie');
      assert.ok(movie);
      assert.equal(movie?.episodeCount, undefined);

      const s2 = grouped.find((r) => r.seasonNumber === 2);
      assert.equal(s2?.episodeCount, 1);
      assert.deepEqual(s2?.episodeNumbers, [1]);
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
