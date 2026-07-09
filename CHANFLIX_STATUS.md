# Chanflix Stabilization Tracker

Last updated: 2026-07-08

## Overhaul Roadmap (2026-07-08 session)

Feature branches in flight; merge into `dev` after review + typecheck/test/build.

### TODO

- [ ] `feat/design-overhaul` — READY FOR VISUAL REVIEW (do not merge until approved): gruvbox terminal system — warm near-black neutrals, green primary/orange secondary accents (no purple/indigo left), square corners, mono accents, snappy 120ms motion; see `DESIGN.md` on the branch. Rebased onto dev; typecheck + production build verified. Review focus: home widgets, settings pages, TitleCard hover, badge contrast, squared pills/chips.
- [ ] Post-deploy: re-enable Radarr `tagRequests`, configure the servarr webhook in Radarr/Sonarr Connect (steps in `CHANFLIX_DEV_SERVER.md`), verify Now panel/Operations/Library against live Tautulli/Radarr, watch logs.

### DONE (this session)

- [x] Committed pending Dockerfile `COMMIT_TAG=local` default + deploy-path docs (`bd39348`).
- [x] `feat/design-overhaul` merged to dev (`da30a46`): gruvbox terminal design system — warm near-black neutrals, green primary / orange secondary accents (all indigo/purple remapped at the Tailwind theme level, so every surface incl. the new Now panel/Operations picks it up), square corners, mono accents, thin square scrollbars, 120ms snappy motion; documented in `DESIGN.md`. Gate re-run after merge: 28/28 tests, typecheck clean.
- [x] `feat/ops-now` merged to dev (`affaeef`): Tautulli `get_activity` + `GET /api/v1/stats/now` (streams for all users; downloads/finished-in-5-min for request managers, with posters), home Now panel with live-pulse streams and poster'd downloads, compact Popular This Month, scrollable Recent Activity with always-visible timestamps, review/message-board widgets unplugged, `POST /api/v1/downloads/retry` (Radarr `MoviesSearch`/Sonarr `SeriesSearch`) with retry buttons in Operations and Library, Downloads folded into Operations (`/downloads` redirects), Library "Not Downloaded" (stalled) vs "Downloading" classification, Open Plex sidebar action removed. Full gate on merged dev: 28/28 unit tests, typecheck clean, production build clean, all 37 migrations smoke-applied.
- [x] `feat/request-flow` merged to dev: post-request success pane in the movie/TV request modals (poster, approved/pending status, progress link; no new polling), and `POST /api/v1/webhooks/servarr` — secret-authenticated (auto-generated `main.webhookSecret` in settings.json, `X-Webhook-Secret` header or `?secret=`, constant-time, fail-closed), Radarr/Sonarr import events trigger a downloadTracker refresh + a 60s-debounced Plex recently-added scan. Setup steps in `CHANFLIX_DEV_SERVER.md`.
- [x] `feat/quality-triggers` merged to dev (`0c052e2`): per-user quality trigger plumbing — `qualityTriggers` JSON column on `user_settings` (migration `1767897200000`, smoke-tested), GET/POST `/api/v1/user/:id/settings/quality-triggers` (own-profile-or-admin read, MANAGE_USERS write), no-op `evaluateQualityTriggers()` hook wired into sendToRadarr/sendToSonarr where rules will land, and a MANAGE_USERS-gated Quality Triggers settings tab stub (enable toggle + coming-soon profile ceiling). Rule details intentionally deferred.
- [x] `fix/request-tags` merged to dev (`da1df53`): per-user request tagging is now fail-soft — root cause was tag-create failures rethrowing inside the TypeORM save hook, failing the entire request. Legacy `"4 - name"` tags are reused, create races retried via re-read, and a tag failure can never block a request. Safe to re-enable `tagRequests` on Radarr + Sonarr; if logs show `Failed to create user tag`, the servarr API key lacks write access to `/tag`.

## Working Rules

- Keep `dev` as the integration branch and promote to `prod` only after local build/typecheck and a container smoke test.
- Prefer small linear commits grouped by behavior: stability, request flow, navigation, library/activity UX.
- Do not revert unrelated dirty worktree changes. The repo already has local edits and deleted upstream docs/config files.
- Use worktrees for larger features once the current dirty tree is understood.
- Do not commit local backups/secrets/deployment scratch files such as `config/db.bak/`, `config/settings.bak`, or `handoff.md`.
- Local backups/scratch files are now ignored in `.gitignore` so they are harder to stage accidentally.

## Product Decisions

- Tautulli watch history is visible to all authenticated users in Recent Activity.
- Plex launch should deep-link to the requested media where a direct media link is available.
- Completed-download history should survive app/container restarts via the app database or another shared source of truth.
- Persistent TMDB metadata storage is desired once the current cache/timeout improvements are stable; overnight prewarming is acceptable.

## Observed Production Signals

- `/home/chan/docker/chanflix/logs/overseerr-2026-07-08.log` shows repeated missing docs reads for `/app/src/docs/user-guide.md`.
- Radarr request failures happen when `tagRequests` creates labels like `4 - nickhump4`; Radarr returns HTTP 400 creating the tag.
- Plex recently-added scan runs every 5 minutes and Plex watchlist sync runs every 3 minutes.
- Library and download UI/routes already exist, but Library was using the signed-in user's Plex token only.
- Existing Tautulli API integration has popular content, global history, user watch history, and media watch-user endpoints.
- `chandlerfulmer@gmail.com` / HerbieHan is user ID 1 and has `Permission.ADMIN`.
- Current live settings show Radarr `tagRequests` off and Sonarr `tagRequests` on.

## Completed In This Pass

- Fixed shared external API cache writes so cache-specific TTLs are honored instead of forcing 5 minutes everywhere.
- Added bounded timeout/retry/backoff behavior to shared external API reads/writes.
- Added stale-cache fallback for shared API GET requests when a refresh fails.
- Cached Radarr/Sonarr tag reads with rolling refresh.
- Sanitized per-request Radarr/Sonarr user tag labels to `request-<userId>-<display-name>`.
- Removed the Docs tab from desktop and mobile navigation and disabled the `/api/v1/docs` route.
- Made Library fall back to the admin Plex token when the signed-in user has no Plex token.
- Queued Discord webhook notifications with pacing and 429 `retry_after` backoff.
- Changed the sidebar Watch action to `Open Plex` and made `/api/v1/auth/plex/launch` target the configured Plex server when possible.
- Coalesced concurrent TMDB image-proxy cache misses/stale refreshes and added safer default image TTL handling.
- Added a short-lived Library API response cache to avoid repeatedly walking Plex libraries on rapid refresh/navigation.
- Enriched paginated Library API results with cached TMDB titles, posters, and years so pending rows no longer render as `Media #...`.
- Converted remaining raw TMDB `<img>` usages in common browsing/detail surfaces to `CachedImage`.
- Added `/api/v1/stats/recent` and updated the home Recent Activity widget to show recent requests, Tautulli watches, and active downloads together.
- Extracted request user tag normalization into `server/lib/requestTags.ts` so Radarr/Sonarr tag behavior has one shared implementation.
- Removed upstream Overseerr update/changelog polling from `/api/v1/status` and simplified About/version UI to local Chanflix information.
- Reduced frontend polling pressure by disabling minute polling for watch-user/review detail widgets and slowing recent activity/community/version refreshes.
- Added cached "On the Server" rows to Movies and Series discovery pages using the Library API.
- Added an admin/request-manager Operations page for active downloads, pending requests, and recent activity.
- Restricted the downloads API and downloads navigation to users with `MANAGE_REQUESTS`.
- Added cached pending-request summaries for Operations so request rows show titles, requester, status, 4K flag, and profile/tag IDs without frontend TMDB fan-out.
- Fixed Operations recent activity rows to render `mediaTitle` from `/api/v1/stats/recent`.
- Added a short-lived Stats API cache for recent activity and pending-request summaries to avoid repeated Tautulli/TMDB aggregation on rapid refresh.
- Enriched Operations pending request rows with locally-derived server, quality profile, root folder, and tag-count context.
- Added bounded in-memory recent download history from Radarr/Sonarr queue transitions and surfaced it in Operations/recent activity.
- Fixed download tracker daily reset to clear both Radarr and Sonarr active queues.
- Added a lightweight `yarn test:unit` harness covering request-tag sanitization/matching and stability cache bucket registration.
- Tightened request-tag matching so `request-4-*` cannot accidentally match `request-40-*`, with regression coverage.
- Expanded `yarn test:unit` to cover `ExternalAPI` per-request TTLs, transient retry behavior, and stale-cache fallback.
- Added unit coverage for download queue transition history so completed/cleared Operations rows are less likely to regress.
- Made `ExternalAPI` stale fallback retain bounded last-known responses after NodeCache TTL expiry, with regression coverage.
- Fixed `ExternalAPI` cache-hit and stale-fallback checks to preserve valid falsy API responses like `false`, `0`, and `null`, with regression coverage.
- Added durable completed-download history with a `DownloadHistory` entity/migration, persisted Radarr/Sonarr queue transitions, and database-backed recent-download reads.
- Added unit coverage for Operations permission gates and pending-request summary shaping.
- Added `.gitignore` guardrails for local DB/settings backups and deployment scratch notes.
- Added persistent TMDB movie/show detail metadata caching with `TmdbMetadataCache`, stale fallback, and 30-day refresh TTL.
- Added a nightly `tmdb-metadata-prewarm` scheduled job that warms a bounded batch of known library/request media into the persistent TMDB cache.
- Added unit coverage for TMDB metadata cache keys/freshness/payload parsing and prewarm candidate de-duplication.
- Centralized frontend operational polling intervals in `src/utils/pollingIntervals.ts`.
- Reduced polling pressure on Downloads, Operations, Jobs/Cache, Logs, and Plex sync status screens.
- Removed the leftover Docs page/component/API route so direct `/docs` no longer hits the missing-docs code path.
- Added OpenAPI path coverage for Library, Downloads, and Stats endpoints.
- Verified a production `yarn build` after removing the Docs route.
- Verified production TypeORM migrations against a disposable SQLite DB at `/tmp/chanflix-migration-smoke`; all 36 migrations applied and the new `download_history` / `tmdb_metadata_cache` tables and indexes were created.
- Added a tested Plex launch URL builder and extended `/api/v1/auth/plex/launch` to accept `ratingKey` for direct media deep links.
- Removed the unused client-side `plexLauncher` helper.
- Fixed the production Chanflix image build path so Docker Compose passes the current Git SHA as `COMMIT_TAG`; redeployed `chanflix:latest` at `021aefe6167e` and verified `/api/v1/status` plus the baked Next bundle both report that tag.

## Next Stability Work

- Continue auditing any remaining high-frequency SWR refreshes after smoke testing, especially request/detail flows with active downloads.
- Expand TMDB prewarm coverage beyond known media if needed, for example popular/discover pages, after watching live TMDB 429 rates.
- Add container smoke testing and live-log validation after the commit stack is cleaned up.
- Consider removing or replacing remaining upstream external docs links in notification settings if Chanflix-specific docs are desired later.

## Next UX Work

- Wire direct-media Plex launch into any future media-specific controls by passing `ratingKey` to `/api/v1/auth/plex/launch`; existing media detail links still use stored `plexUrl` values.

## Integration / Commit Plan

Suggested stabilization commit groups:

1. API resilience and tests:
   - `server/api/externalapi.ts`
   - `server/api/themoviedb/index.ts`
   - `server/api/servarr/base.ts`
   - `server/lib/cache.ts`
   - `server/lib/requestTags.ts`
   - `server/lib/tmdbMetadataCache.ts`
   - `server/lib/tmdbMetadataPrewarm.ts`
   - `server/scripts/runBasicTests.ts`
   - `package.json`
   - `server/entity/TmdbMetadataCache.ts`
   - `server/migration/1767897100000-AddTmdbMetadataCache.ts`
   - `server/job/schedule.ts`
   - `server/lib/settings.ts`

2. Request/download/notification stability:
   - `server/entity/MediaRequest.ts`
   - `server/entity/DownloadHistory.ts`
   - `server/lib/downloadtracker.ts`
   - `server/lib/notifications/agents/discord.ts`
   - `server/lib/plexLaunch.ts`
   - `server/routes/downloads.ts`
   - `server/routes/auth.ts`
   - `server/migration/1767897000000-AddDownloadHistory.ts`

3. Image and Library pressure reduction:
   - `server/lib/imageproxy.ts`
   - `server/routes/library.ts`
   - `src/components/Library/index.tsx`
   - `src/components/Discover/LibrarySlider/index.tsx`
   - TMDB image caller conversions in Discover/MediaSlider/Tv season components

4. Activity and Operations UX:
   - `server/routes/stats.ts`
   - `overseerr-api.yml`
   - `src/components/Operations/`
   - `src/pages/operations.tsx`
   - `src/components/Discover/Widgets/ActivityWidget.tsx`
   - Operations/sidebar/mobile nav changes
   - `src/utils/pollingIntervals.ts`
   - operational polling interval updates in Downloads, Jobs/Cache, Logs, Plex settings

5. Upstream cleanup:
   - docs route/nav removal
   - docs page/component/API deletion
   - About/version status simplification
   - removal of `src/components/Settings/SettingsAbout/Releases/index.tsx`

Keep out of this stabilization batch unless intentionally reviewed:

- `config/db.bak/`
- `config/settings.bak`
- `handoff.md`
- local deployment/Cloudflare notes
- unrelated branding assets unless they are part of the intended Chanflix rebrand
- pre-existing review/watch feature files unless shipping those features together

Before deploy:

- Run `yarn test:unit`
- Run `yarn typecheck`
- Run `git diff --check`
- Build/container smoke test
- Deploy production with `scripts/deploy-chanflix-prod.sh` so the Docker build receives the current `COMMIT_TAG`; do not run the compose build without `CHANFLIX_COMMIT_TAG` unless intentionally building a local image.
- Run production migration smoke test against a disposable SQLite DB when entity/migration files change
- Confirm `/api/v1/status` no longer calls upstream GitHub
- Confirm `/api/v1/downloads` returns 403 for non-`MANAGE_REQUESTS`
- Confirm Library and Operations load as Herbie/admin
- Watch live logs for TMDB 429s, Discord 429s, Radarr/Sonarr tag errors, and docs route errors

## Open Questions

- Confirm whether the nightly TMDB prewarm should stay scoped to known local media or also crawl popular/discover pages.
